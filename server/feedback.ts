import type { PaseoAgentHandle, PaseoAgentRunResult, PaseoApi } from "@getpaseo/client";
import type { PluginHookAgent, PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import {
  buildFeedbackPrompt,
  feedbackProvider,
  feedbackReplyJsonSchema,
  feedbackRowId,
  feedbackRowKind,
  feedbackRowVersion,
  feedbackSystemPrompt,
  parseFeedbackReply,
  pendingChecks,
  quoteOf,
  rowFromReply,
  type FeedbackRowData,
  type TimelineEntryLike,
} from "../shared/feedback";
import { createLimiter, MessageLedger } from "../shared/feedback-queue";
import { excerpt, feedbackHelperLabel, isClaudeSession, isOwnHelper, isTopLevel, skipReason } from "../shared/feedback-rules";

// A check started by a hook (the message that starts a turn, or one left over when it ends) runs inside Paseo's 30 s
// hook limit, so it leaves time to write its row. A check takes 4 to 15 s; one slow helper took 25 s.
const hookCheckTimeoutMs = 25_000;
// A message sent while the agent is working starts no turn and fires no hook. It is seen on the agent's live timeline
// and checked after the hook that opened the subscription has returned, so its limit is not tied to the hook's.
const liveCheckTimeoutMs = 60_000;
// A burst of messages sent mid-turn waits in line rather than starting a helper each on the host's Claude account.
const maxHelpersPerAgent = 2;
// The helper starts in the user's repository, and Claude Code connects the project's MCP servers (`.mcp.json`) before
// the first turn; one unreachable server held it for 30 s. `--strict-mcp-config` keeps only the servers Paseo passes,
// which the helper does not use either. `extraArgs` is part of the Claude provider options Paseo validates.
const helperProviderOptions = { extraArgs: { "strict-mcp-config": null } };
const turnStartTail = 8;
// When a turn ends, its messages are read back page by page, up to this many entries.
const turnEndPage = 100;
const turnEndPages = 5;
// On plugin stop, checks still running get this long to archive their helpers.
const stopGraceMs = 10_000;

type Events = PluginLifecycleEvents;
interface Message {
  id: string;
  text: string;
}

// One line per check, never the message itself.
const log = (agentId: string, outcome: string, startedAt: number) =>
  console.log(`[english-feedback] ${agentId.slice(0, 8)} ${outcome} after ${Date.now() - startedAt} ms`);

/** A signal that aborts when any of `signals` does. */
function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/**
 * The user message that started this turn, or null when the turn has none of its own or the message already has a
 * row. The daemon records the message before the turn starts, so it is in the tail when the hook runs.
 */
async function turnMessage(agent: PaseoAgentHandle, turnId: string | null): Promise<Message | null> {
  const { entries } = await agent.timeline.refetch({ direction: "tail", limit: turnStartTail });
  const entry = entries.findLast(({ item }) => item.type === "user_message");
  if (!entry || entry.item.type !== "user_message") return null;
  if (turnId !== null && entry.turnId !== undefined && entry.turnId !== turnId) return null;
  const id = feedbackRowId(entry.item, entry.seqStart);
  if (entries.some(({ item }) => item.type === "plugin" && item.id === id)) return null;
  return { text: entry.item.text, id };
}

/** The timeline back to the start of turn `turnId`, read in pages from the end. */
async function turnEntries(agent: PaseoAgentHandle, turnId: string | null): Promise<TimelineEntryLike[]> {
  let page = await agent.timeline.refetch({ direction: "tail", limit: turnEndPage });
  let entries: TimelineEntryLike[] = page.entries;
  for (let pages = 1; pages < turnEndPages && turnId !== null && page.hasOlder && page.startCursor; pages++) {
    const oldestTurn = entries.find(entry => entry.turnId !== undefined)?.turnId;
    if (oldestTurn !== turnId) break;
    page = await agent.timeline.refetch({ direction: "before", cursor: page.startCursor, limit: turnEndPage });
    entries = [...page.entries, ...entries];
  }
  return entries;
}

/** Claude Haiku's final reply about `text`, from a helper agent under the user's agent on this host. */
async function askHaiku(paseo: PaseoApi, agent: PluginHookAgent, text: string, timeoutMs: number, signal: AbortSignal): Promise<string | null> {
  // A check can wait in the helper queue past its hook's limit or its agent's archive; it then starts no helper.
  if (signal.aborted) throw new Error("Check aborted before its helper started");
  const helper = await paseo.workspaces.ref(agent.workspaceId!).agents.create({
    config: { provider: feedbackProvider, systemPrompt: feedbackSystemPrompt, options: helperProviderOptions },
    parent: agent.id,
    title: "English check",
    labels: { [feedbackHelperLabel]: "1" },
    autoArchive: true,
    outputSchema: feedbackReplyJsonSchema,
    prompt: buildFeedbackPrompt(text),
  });
  let stop = () => {};
  const aborted = new Promise<PaseoAgentRunResult>(resolve => {
    const onAbort = () => resolve({ status: "timeout", final: null, error: "Check aborted", lastMessage: null });
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    stop = () => signal.removeEventListener("abort", onAbort);
  });
  let result: PaseoAgentRunResult | undefined;
  try {
    result = await Promise.race([helper.waitForFinish(timeoutMs), aborted]);
    if (result.status !== "idle") throw new Error(result.error ?? `Helper stopped with status ${result.status}`);
    return result.lastMessage;
  } finally {
    stop();
    // autoArchive archives a helper that finished its turn; one cut off by a timeout or an abort is archived here.
    if (result?.status !== "idle") await helper.archive().catch(() => undefined);
  }
}

/** What the plugin keeps per user agent: which messages it has taken, its helper queue and its live subscription. */
interface Watch {
  ledger: MessageLedger;
  limit: ReturnType<typeof createLimiter>;
  controller: AbortController;
  ownHelper?: Promise<boolean>;
  unsubscribe?: () => void;
}

/**
 * English feedback for every message the user writes in a top-level Claude chat, written as a row under the message.
 * Three triggers can see a message: the turn it starts, the agent's live timeline while a turn runs (a message sent
 * mid-turn starts no turn), and the end of the turn. Each message is checked once, by whichever sees it first. A
 * message that is skipped, or a check that fails, leaves no visible trace: the reason goes to the plugin log only.
 */
export function createFeedbackChecks(isEnabled: () => Promise<boolean>) {
  const lifetime = new AbortController();
  const watches = new Map<string, Watch>();
  const running = new Set<Promise<void>>();

  const watchOf = (agentId: string) => {
    let watch = watches.get(agentId);
    if (!watch) watches.set(agentId, (watch = { ledger: new MessageLedger(), limit: createLimiter(maxHelpersPerAgent), controller: new AbortController() }));
    return watch;
  };

  /** Whether this agent's messages get feedback: a top-level Claude chat that is not a helper, with feedback on. */
  async function eligible(agent: PluginHookAgent, paseo: PaseoApi): Promise<boolean> {
    if (!isTopLevel(agent) || !isClaudeSession(agent) || agent.workspaceId === null) return false;
    if (!(await isEnabled())) return false;
    const watch = watchOf(agent.id);
    watch.ownHelper ??= paseo.agents.ref(agent.id).refresh().then(snapshot => isOwnHelper(snapshot?.agent.labels));
    return !(await watch.ownHelper);
  }

  /** Checks one message and writes its row, unless another trigger has already taken it. */
  async function check(paseo: PaseoApi, agent: PluginHookAgent, message: Message, late: boolean, timeoutMs: number, signal: AbortSignal) {
    const watch = watchOf(agent.id);
    if (!watch.ledger.claim(message.id)) return;
    const startedAt = Date.now();
    const reason = skipReason(message.text);
    if (reason) return log(agent.id, `skipped (${reason})`, startedAt);

    const ref = paseo.agents.ref(agent.id);
    const { text, truncated } = excerpt(message.text);
    const placement = late ? { late: true as const, quote: quoteOf(message.text) } : {};
    const write = (data: FeedbackRowData) =>
      ref.timeline.append({ type: "plugin", id: message.id, kind: feedbackRowKind, version: feedbackRowVersion, data: { ...data, ...placement } });
    try {
      // Written before Haiku runs: a row takes its place in the timeline from its first write, so a live row sits
      // directly under its message, ahead of the assistant's reply. Writing an existing id again keeps that place.
      await write({ state: "checking" });
      const parsed = parseFeedbackReply(await watch.limit(() => askHaiku(paseo, agent, text, timeoutMs, signal)));
      if (!parsed.ok) throw new Error(parsed.error);
      const row = rowFromReply(text, truncated, parsed.value);
      await write(row);
      log(agent.id, late ? `${row.state} (late)` : row.state, startedAt);
    } catch (error) {
      await write({ state: "unchecked" }).catch(() => undefined);
      log(agent.id, `unchecked: ${error instanceof Error ? error.message : String(error)}`, startedAt);
    }
  }

  /** Runs a check that outlives the hook that found it; it settles on its own and never rejects. */
  function detach(task: Promise<void>) {
    const tracked = task.catch(error => console.log(`[english-feedback] check failed: ${error instanceof Error ? error.message : String(error)}`));
    running.add(tracked);
    void tracked.finally(() => running.delete(tracked));
  }

  /**
   * Watches the agent's timeline for messages sent while this turn runs. The subscription uses the turn's hook
   * context, and Paseo keeps that context working after the hook returns (measured on 0.13.0; its docs do not
   * promise it). If that changes, live checks stop and the end of the turn still checks every message.
   */
  function watchLive(agent: PluginHookAgent, paseo: PaseoApi) {
    const watch = watchOf(agent.id);
    if (watch.unsubscribe) return;
    const close = () => {
      unsubscribe();
      if (watch.unsubscribe === close) watch.unsubscribe = undefined;
    };
    const unsubscribe = paseo.agents.ref(agent.id).timeline.subscribe(update => {
      const { event } = update;
      if (event.type === "error") return close();
      if (event.type !== "timeline" || event.item.type !== "user_message") return;
      const message = { id: feedbackRowId(event.item, "seq" in update ? (update.seq ?? 0) : 0), text: event.item.text };
      detach(check(paseo, agent, message, false, liveCheckTimeoutMs, anySignal(lifetime.signal, watch.controller.signal)));
    });
    watch.unsubscribe = close;
    unsubscribe.ready.catch(error => {
      console.log(`[english-feedback] ${agent.id.slice(0, 8)} live watch failed: ${error instanceof Error ? error.message : String(error)}`);
      close();
    });
  }

  /** Stops watching an agent and aborts its checks; the next turn starts afresh. */
  function forget(agentId: string) {
    const watch = watches.get(agentId);
    if (!watch) return;
    watch.unsubscribe?.();
    watch.controller.abort();
    watches.delete(agentId);
  }

  return {
    async turnStarted({ agent, turnId }: Events["agent.turn_started"], context: PluginHookContext) {
      if (!(await eligible(agent, context.paseo))) return;
      watchLive(agent, context.paseo);
      const message = await turnMessage(context.paseo.agents.ref(agent.id), turnId);
      if (message) await check(context.paseo, agent, message, false, hookCheckTimeoutMs, anySignal(context.signal, watchOf(agent.id).controller.signal));
    },

    async turnEnded({ agent, turnId }: Events["agent.turn_ended"], context: PluginHookContext) {
      watches.get(agent.id)?.unsubscribe?.();
      if (!(await eligible(agent, context.paseo))) return;
      // `turn_ended.timeline` is deprecated and always empty, so the turn is read back from the daemon.
      const entries = await turnEntries(context.paseo.agents.ref(agent.id), turnId);
      const signal = anySignal(context.signal, watchOf(agent.id).controller.signal);
      await Promise.all(pendingChecks(entries, turnId).map(({ late, ...message }) => check(context.paseo, agent, message, late, hookCheckTimeoutMs, signal)));
    },

    forget,

    /** Plugin cleanup: ends every subscription, aborts every check and waits briefly for their helpers to be archived. */
    async stop() {
      lifetime.abort();
      for (const agentId of [...watches.keys()]) forget(agentId);
      await Promise.race([Promise.allSettled([...running]), new Promise<void>(resolve => setTimeout(() => resolve(), stopGraceMs))]);
    },
  };
}
