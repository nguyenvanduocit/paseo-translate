import type { PaseoApi } from "@getpaseo/client";
import { isOwnHelper } from "../shared/feedback-rules";
import { parsePartialReply, parseReply, replyJsonSchema, systemPrompt, type Candidate, type Translation } from "../shared/translate";
import { getLookup, setLatestLookup, updateLookup } from "./lookups";

// Marks the helper agents so they can be told apart from the user's own agents.
const translatorLabel = "paseo-translate";

export interface TranslatorDeps {
  paseo: PaseoApi;
  /** Asks the daemon to assemble the prompt from the host's settings. */
  requestPrompt: (candidate: Candidate) => Promise<{ prompt: string }>;
}

const attempts = 2;
const waitMs = 120_000;

/** The workspace's most recently updated agent that is not a helper; its provider and id carry over to the helper. */
async function findSession(paseo: PaseoApi, workspaceId: string) {
  const { entries } = await paseo.agents.list({
    scope: "active",
    sort: [{ key: "updated_at", direction: "desc" }],
    page: { limit: 50 },
  });
  const session = entries.map(entry => entry.agent).find(agent => agent.workspaceId === workspaceId && !isOwnHelper(agent.labels));
  if (!session) throw new Error("This workspace has no chat to take a provider from.");
  return session;
}

/** A helper agent answers one lookup: `autoArchive` archives it after its first turn, so each lookup creates its own. The lookup shows the reply as it streams in. */
async function translate({ paseo, requestPrompt }: TranslatorDeps, lookupId: string, workspaceId: string, candidate: Candidate): Promise<Translation> {
  const { prompt } = await requestPrompt(candidate);
  const session = await findSession(paseo, workspaceId);
  const provider = session.model ? `${session.provider}/${session.model}` : session.provider;
  let failure = "No reply";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const helper = await paseo.workspaces.ref(workspaceId).agents.create({
      config: { provider, systemPrompt },
      parent: session.id,
      title: `Translate: ${candidate.text}`,
      labels: { [translatorLabel]: "1" },
      autoArchive: true,
      outputSchema: replyJsonSchema,
      prompt,
    });
    let streamed = "";
    updateLookup(lookupId, { translation: undefined });
    const subscription = helper.timeline.subscribe(({ event }) => {
      if (event.type !== "timeline" || event.item.type !== "assistant_message") return;
      streamed += event.item.text;
      const partial = parsePartialReply(streamed);
      if (partial) updateLookup(lookupId, { translation: partial });
    });
    // Streaming is for show: a subscription that fails to attach leaves the final reply to `waitForFinish`.
    subscription.ready.catch(() => undefined);
    const result = await helper.waitForFinish(waitMs).finally(subscription);
    if (result.status !== "idle") {
      // A helper stuck on a permission request or a timeout never finishes its turn, so autoArchive never fires.
      await helper.archive().catch(() => undefined);
      failure = result.error ?? `Helper stopped with status ${result.status}`;
      continue;
    }
    const parsed = parseReply(result.lastMessage);
    if (parsed.ok) return parsed.value;
    failure = parsed.error;
  }
  throw new Error(failure);
}

async function settle(deps: TranslatorDeps, id: string) {
  const lookup = getLookup(id);
  if (!lookup) return;
  try {
    const translation = await translate(deps, id, lookup.workspaceId, lookup);
    updateLookup(id, { status: "done", translation, error: undefined });
  } catch (error) {
    updateLookup(id, { status: "error", error: error instanceof Error ? error.message : String(error), translation: undefined });
  }
}

export function startLookup(deps: TranslatorDeps, input: Candidate & { workspaceId: string }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setLatestLookup({ id, status: "loading", ...input });
  void settle(deps, id);
}

export function retryLookup(deps: TranslatorDeps, id: string) {
  updateLookup(id, { status: "loading", error: undefined, translation: undefined });
  void settle(deps, id);
}
