import { z } from "zod";

// The model that checks a message, on the Claude account of the host that owns the chat.
export const feedbackProvider = "claude/claude-haiku-5-5";
export const feedbackRowKind = "english-feedback";
export const feedbackRowVersion = 1;

const required = z.string().min(1);

export const issueSchema = z.object({
  original: required,
  replacement: z.string(),
  tag: z.enum(["mistake", "unnatural", "tip"]),
  explanation: required,
});
export type FeedbackIssue = z.infer<typeof issueSchema>;

export const feedbackReplySchema = z.object({
  ok: z.boolean(),
  corrected: z.string(),
  issues: z.array(issueSchema).default([]),
});
export type FeedbackReply = z.infer<typeof feedbackReplySchema>;

// Handed to the helper agent so the provider constrains its final reply to this shape.
export const { $schema: _draft, ...feedbackReplyJsonSchema } = z.toJSONSchema(feedbackReplySchema);

// A row written when its turn ended, at the end of the turn rather than under the message, says which message it is
// about. Live rows carry neither field.
const lateFields = { late: z.literal(true).optional(), quote: z.string().optional() };

/**
 * The timeline row under a user message. `checking` shows while Haiku works; `fine` (nothing to fix) and
 * `unchecked` (the check failed) render nothing; `corrected` holds both texts, and the renderer diffs them.
 */
export const feedbackRowSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("checking"), ...lateFields }),
  z.object({ state: z.literal("fine"), ...lateFields }),
  z.object({ state: z.literal("unchecked"), ...lateFields }),
  z.object({ state: z.literal("corrected"), original: z.string(), corrected: z.string(), truncated: z.boolean(), issues: z.array(issueSchema), ...lateFields }),
]);
export type FeedbackRowData = z.infer<typeof feedbackRowSchema>;

export const feedbackSystemPrompt =
  "You are an English teacher. Reply with one JSON object and nothing else. Never use tools, never read files, never ask questions.";

export function buildFeedbackPrompt(text: string): string {
  return [
    "A Vietnamese learner of English, around B1 level, wrote this chat message to an AI coding assistant. Check its English.",
    "",
    "Message:",
    "<<<",
    text,
    ">>>",
    "",
    "Rules:",
    "- Fix grammar, wrong words, and wording a native speaker would find unnatural. Keep the learner's meaning, tone and informal chat style; leave sentences that are already fine as they are.",
    "- Leave code, commands, file paths, URLs, identifiers, quoted logs and error messages exactly as written.",
    "- A missing full stop at the very end of the message is fine in chat. A lowercase \"i\", a sentence start without a capital, and a question without a question mark are tips.",
    "- If the message is not mainly English, or has nothing to fix, reply with ok true, corrected equal to the message, and no issues.",
    "",
    "Reply with one JSON object with these fields:",
    "- ok: true when the message needs no change.",
    "- corrected: the whole message with every fix applied and nothing else changed.",
    "- issues: one entry per fix, in order of appearance: { original, replacement, tag, explanation }. original is the text exactly as written and replacement its fixed form. tag is \"mistake\" for grammar or wording that is wrong, \"unnatural\" for text that is correct but a native speaker would say differently, and \"tip\" for capitals, punctuation and other small things. explanation is one short sentence in plain English that a B1 learner can follow.",
  ].join("\n");
}

export type ParsedFeedback = { ok: true; value: FeedbackReply } | { ok: false; error: string };

/** Validates the helper's final message; tolerates a code fence or prose around the JSON object. */
export function parseFeedbackReply(final: string | null | undefined): ParsedFeedback {
  if (!final) return { ok: false, error: "Empty reply" };
  const start = final.indexOf("{");
  const end = final.lastIndexOf("}");
  if (start < 0 || end < start) return { ok: false, error: "Reply has no JSON object" };
  let json: unknown;
  try {
    json = JSON.parse(final.slice(start, end + 1));
  } catch {
    return { ok: false, error: "Reply is not valid JSON" };
  }
  const parsed = feedbackReplySchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

// More fixes than this do not help a learner, and the cap keeps a row far under the 64 KiB timeline limit.
export const maxShownIssues = 10;

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** The row for a parsed reply: quiet when there is nothing to show, else both texts and the reasons. */
export function rowFromReply(original: string, truncated: boolean, reply: FeedbackReply): FeedbackRowData {
  if (reply.issues.length === 0 && (reply.ok || sameText(original, reply.corrected))) return { state: "fine" };
  return { state: "corrected", original, corrected: reply.corrected, truncated, issues: reply.issues.slice(0, maxShownIssues) };
}

/** One row per user message, so checking the same message again replaces its row. */
export function feedbackRowId(message: { messageId?: string; clientMessageId?: string }, seq: number): string {
  return `${feedbackRowKind}:${message.messageId ?? message.clientMessageId ?? `seq-${seq}`}`;
}

// A check that died with the plugin leaves its row on `checking`; past this age the renderer stops showing it. A check
// takes 4 to 25 s, so a live one is never this old.
export const checkingStaleMs = 90_000;

/** Whether a `checking` row written at `writtenAt` is too old to still be running. */
export const isStaleChecking = (writtenAt: Date, now: number) => now - writtenAt.getTime() > checkingStaleMs;

const quoteLength = 60;

/** The start of a message on one line, cut at a word, for a row that sits away from it. */
export function quoteOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= quoteLength) return line;
  const head = line.slice(0, quoteLength);
  const cut = head.lastIndexOf(" ");
  return `${(cut > quoteLength / 2 ? head.slice(0, cut) : head).trimEnd()}…`;
}

/** The parts of a timeline entry this plugin reads; the daemon's entries have more. */
export interface TimelineEntryLike {
  seqStart: number;
  turnId?: string;
  item: { type: string; text?: string; messageId?: string; clientMessageId?: string; id?: string; kind?: string; data?: unknown };
}

const resultStates = new Set(["corrected", "fine", "unchecked"]);

/**
 * The user messages of a turn that still need a check when it ends: one whose row is still `checking` is finished in
 * place, one without any row gets a late row. A turn without an id has only its last message looked at.
 */
export function pendingChecks(entries: readonly TimelineEntryLike[], turnId: string | null): { id: string; text: string; late: boolean }[] {
  const rows = new Map<string, string>();
  for (const { item } of entries)
    if (item.type === "plugin" && item.kind === feedbackRowKind && item.id) rows.set(item.id, (item.data as { state?: string } | undefined)?.state ?? "");
  const users = entries.filter(entry => entry.item.type === "user_message");
  const ofTurn = turnId === null ? users.slice(-1) : users.filter(entry => entry.turnId === turnId);
  return ofTurn.flatMap(({ item, seqStart }) => {
    const id = feedbackRowId(item, seqStart);
    const state = rows.get(id);
    if (state !== undefined && resultStates.has(state)) return [];
    return [{ id, text: item.text ?? "", late: state === undefined }];
  });
}
