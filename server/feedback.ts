import type { PaseoAgentHandle, PaseoAgentRunResult } from "@getpaseo/client";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import {
  buildFeedbackPrompt,
  feedbackProvider,
  feedbackReplyJsonSchema,
  feedbackRowId,
  feedbackRowKind,
  feedbackRowVersion,
  feedbackSystemPrompt,
  parseFeedbackReply,
  rowFromReply,
  type FeedbackRowData,
} from "../shared/feedback";
import { excerpt, feedbackHelperLabel, isClaudeSession, isOwnHelper, isTopLevel, skipReason } from "../shared/feedback-rules";

// Under the 30 s limit Paseo gives a hook, leaving time to write the row before the hook is cut off. A check takes
// 6 to 13 s, in a bare directory or a repository alike, once the helper skips the project's MCP servers (below).
const checkTimeoutMs = 25_000;
// The helper starts in the user's repository, and Claude Code connects the project's MCP servers (`.mcp.json`) before
// the first turn; one unreachable server held it for 30 s. `--strict-mcp-config` keeps only the servers Paseo passes,
// which the helper does not use either. `extraArgs` is part of the Claude provider options Paseo validates.
const helperProviderOptions = { extraArgs: { "strict-mcp-config": null } };
const tailLimit = 8;

type TurnStarted = PluginLifecycleEvents["agent.turn_started"];

// One line per check, never the message itself.
const log = (agentId: string, outcome: string, startedAt: number) =>
  console.log(`[english-feedback] ${agentId.slice(0, 8)} ${outcome} after ${Date.now() - startedAt} ms`);

/**
 * The user message that started this turn, or null when the turn has none of its own or the message already has a
 * row. The daemon records the message before the turn starts, so it is in the tail when the hook runs.
 */
async function turnMessage(agent: PaseoAgentHandle, turnId: string | null) {
  const { entries } = await agent.timeline.refetch({ direction: "tail", limit: tailLimit });
  const entry = entries.findLast(({ item }) => item.type === "user_message");
  if (!entry || entry.item.type !== "user_message") return null;
  if (turnId !== null && entry.turnId !== undefined && entry.turnId !== turnId) return null;
  const id = feedbackRowId(entry.item, entry.seqStart);
  if (entries.some(({ item }) => item.type === "plugin" && item.id === id)) return null;
  return { text: entry.item.text, id };
}

/** Claude Haiku's final reply about `text`, from a helper agent under the user's agent on this host. */
async function askHaiku(context: PluginHookContext, workspaceId: string, parentId: string, text: string): Promise<string | null> {
  const helper = await context.paseo.workspaces.ref(workspaceId).agents.create({
    config: { provider: feedbackProvider, systemPrompt: feedbackSystemPrompt, options: helperProviderOptions },
    parent: parentId,
    title: "English check",
    labels: { [feedbackHelperLabel]: "1" },
    autoArchive: true,
    outputSchema: feedbackReplyJsonSchema,
    prompt: buildFeedbackPrompt(text),
  });
  let stop = () => {};
  const aborted = new Promise<PaseoAgentRunResult>(resolve => {
    const onAbort = () => resolve({ status: "timeout", final: null, error: "Hook aborted", lastMessage: null });
    context.signal.addEventListener("abort", onAbort, { once: true });
    stop = () => context.signal.removeEventListener("abort", onAbort);
  });
  let result: PaseoAgentRunResult | undefined;
  try {
    result = await Promise.race([helper.waitForFinish(checkTimeoutMs), aborted]);
    if (result.status !== "idle") throw new Error(result.error ?? `Helper stopped with status ${result.status}`);
    return result.lastMessage;
  } finally {
    stop();
    // autoArchive archives a helper that finished its turn; one cut off by a timeout or a permission request is archived here.
    if (result?.status !== "idle") await helper.archive().catch(() => undefined);
  }
}

/**
 * Checks the English of the message that started a turn and writes the result as a row under it. A message that is
 * skipped, or a check that fails, leaves no visible trace: the failure goes to the plugin log only.
 */
export async function checkTurn({ agent, turnId }: TurnStarted, context: PluginHookContext, isEnabled: () => Promise<boolean>) {
  const startedAt = Date.now();
  const workspaceId = agent.workspaceId;
  if (!isTopLevel(agent) || !isClaudeSession(agent) || workspaceId === null) return;
  if (!(await isEnabled())) return;
  const ref = context.paseo.agents.ref(agent.id);
  const [message, snapshot] = await Promise.all([turnMessage(ref, turnId), ref.refresh()]);
  if (!message || isOwnHelper(snapshot?.agent.labels)) return;
  const reason = skipReason(message.text);
  if (reason) return log(agent.id, `skipped (${reason})`, startedAt);

  const { text, truncated } = excerpt(message.text);
  const write = (data: FeedbackRowData) =>
    ref.timeline.append({ type: "plugin", id: message.id, kind: feedbackRowKind, version: feedbackRowVersion, data });
  // Written before Haiku runs: a row takes its place in the timeline from its first write, and this one belongs
  // directly under the message, ahead of the assistant's reply.
  await write({ state: "checking" });
  try {
    const parsed = parseFeedbackReply(await askHaiku(context, workspaceId, agent.id, text));
    if (!parsed.ok) throw new Error(parsed.error);
    const row = rowFromReply(text, truncated, parsed.value);
    await write(row);
    log(agent.id, row.state, startedAt);
  } catch (error) {
    await write({ state: "unchecked" }).catch(() => undefined);
    log(agent.id, `unchecked: ${error instanceof Error ? error.message : String(error)}`, startedAt);
  }
}
