// Which messages get English feedback. Each rule is its own function so changing one does not touch the others.

/** Marks the feedback helper agents, the way `paseo-translate` marks the translation helpers. */
export const feedbackHelperLabel = "paseo-translate-feedback";
const ownLabels = ["paseo-translate", feedbackHelperLabel];

/**
 * Messages longer than this are checked only up to here, cut at a sentence end. About 150 to 200 words: enough for
 * a full request, while a pasted document does not turn one check into a long and costly turn.
 */
export const maxCheckedLength = 1000;
const minWords = 2;
// Share of the message that may be code, logs and links before it is no longer a sentence to check.
const maxCodeShare = 0.5;
// Share of letters outside A to Z above which the message is taken as not English (Vietnamese, Japanese, ...).
const maxForeignLetterShare = 0.1;

interface SessionAgent {
  parentAgentId: string | null;
  provider: string;
}

/** Subagents and helpers write their own prompts; only the user's own chats are checked. */
export const isTopLevel = (agent: SessionAgent) => agent.parentAgentId === null;

/** The check sends the message to Claude Haiku; v1 does that only for chats that already talk to Claude. */
export const isClaudeSession = (agent: SessionAgent) => agent.provider === "claude" || agent.provider.startsWith("claude/");

/** A helper agent of this plugin, so the plugin never checks its own prompts. */
export const isOwnHelper = (labels: Record<string, string> | null | undefined) => ownLabels.some(label => labels?.[label] !== undefined);

export type SkipReason = "no text" | "command" | "short" | "code" | "not-english";

const codePatterns = [
  /```[\s\S]*?(?:```|$)/g, // fenced block, also one left open
  /`[^`\n]*`/g, // inline code
  /\bhttps?:\/\/\S+/g, // link
  /^.*(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\s+at\s+\S|\b[A-Z][A-Za-z]*(?:Error|Exception)\b).*$/gm, // log or stack line
  /\S*[/\\{}[\]<>=|$#;]\S*/g, // path, expression or other symbol-heavy token
];

/** The message with code, logs, links and paths taken out. */
function prose(text: string): string {
  return codePatterns.reduce((rest, pattern) => rest.replace(pattern, " "), text);
}

const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

/** Why a message gets no feedback, or null when it should be checked. */
export function skipReason(text: string): SkipReason | null {
  const trimmed = text.trim();
  // An image sent on its own arrives as a message with empty text.
  if (!trimmed) return "no text";
  if (trimmed.startsWith("/")) return "command";
  const rest = prose(trimmed);
  const restLength = rest.replace(/\s+/g, "").length;
  if (restLength < (1 - maxCodeShare) * trimmed.replace(/\s+/g, "").length) return "code";
  // Before the word count: Japanese and Chinese have no spaces, so a whole sentence counts as one word.
  const letters = rest.match(/\p{L}/gu) ?? [];
  const foreign = letters.filter(letter => !/[A-Za-z]/.test(letter)).length;
  if (foreign > maxForeignLetterShare * letters.length) return "not-english";
  if (words(rest).length < minWords) return "short";
  return null;
}

/** The part of the message that is checked: all of it, or the start cut at a sentence end (else a space) before the limit. */
export function excerpt(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxCheckedLength) return { text: trimmed, truncated: false };
  const head = trimmed.slice(0, maxCheckedLength);
  const sentenceEnd = Math.max(...[". ", "! ", "? ", ".\n", "!\n", "?\n"].map(end => head.lastIndexOf(end)));
  const cut = sentenceEnd > maxCheckedLength / 2 ? sentenceEnd + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : maxCheckedLength;
  return { text: head.slice(0, cut).trimEnd(), truncated: true };
}
