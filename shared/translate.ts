import { z } from "zod";
import { parsePartialJson } from "./partial-json";
import { defaultSettings, type TranslateSettings } from "./settings";

const plain = z.string().default("");
const required = z.string().min(1);

// Strings and arrays default to empty, so a reply that omits an empty field still parses.
export const translationSchema = z.object({
  translation: required,
  pronunciation: plain,
  breakdown: z.array(z.object({ term: required, partOfSpeech: plain, meaning: required, note: plain })).default([]),
  grammar: z.array(z.object({ point: required, explanation: required })).default([]),
  patterns: z.array(z.object({ pattern: required, meaning: plain, example: plain })).default([]),
  examples: z.array(required).default([]),
});
export type Translation = z.infer<typeof translationSchema>;

// Handed to the helper agent so the provider constrains its final reply to this shape.
export const { $schema: _draft, ...replyJsonSchema } = z.toJSONSchema(translationSchema);

export const systemPrompt =
  "You are an English teacher. Reply with one JSON object and nothing else. Never use tools, never read files, never ask questions.";

export interface Candidate {
  text: string;
  sentence: string;
}

export const sentenceRadius = 400;
// A guard against a stray select-all handing a whole page to a model, not a product limit.
export const maxSelectionLength = 5000;
const edgePunctuation = /^[\s"'“”‘’.,;:!?()[\]…—–-]+|[\s"'“”‘’.,;:!?()[\]…—–-]+$/g;

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

// A word is letters, digits and marks; an apostrophe or hyphen joins two letters inside one ("don't", "well-known").
const wordChar = /[\p{L}\p{N}\p{M}]/u;
const joiner = /['’-]/;
// A guard against a "word" that never ends (a long URL, a hash), which is left as the user selected it.
const maxWordLength = 40;

function inWord(text: string, index: number): boolean {
  const char = text[index];
  if (char === undefined) return false;
  if (wordChar.test(char)) return true;
  return joiner.test(char) && wordChar.test(text[index - 1] ?? "") && wordChar.test(text[index + 1] ?? "");
}

/** The bounds of the word that `offset` falls inside, or null on a boundary or inside a word too long to be one. */
function wordAround(text: string, offset: number): [number, number] | null {
  if (!inWord(text, offset - 1) || !inWord(text, offset)) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && inWord(text, start - 1)) start--;
  while (end < text.length && inWord(text, end)) end++;
  return end - start <= maxWordLength ? [start, end] : null;
}

/** `offset` moved back to the start of the word it falls inside; unchanged on a boundary. */
export const wordStart = (text: string, offset: number) => wordAround(text, offset)?.[0] ?? offset;

/** `offset` moved forward to the end of the word it falls inside; unchanged on a boundary. */
export const wordEnd = (text: string, offset: number) => wordAround(text, offset)?.[1] ?? offset;

/** The selection plus the text around it, or null when there is nothing worth translating. */
export function candidateFromSelection(input: { selected: string; block: string }): Candidate | null {
  const text = collapse(input.selected).replace(edgePunctuation, "");
  if (!/\p{L}/u.test(text) || text.length > maxSelectionLength) return null;
  return { text, sentence: sentenceAround(collapse(input.block), text) };
}

/** Up to `sentenceRadius` characters of `block` on each side of the first occurrence of `text`. A selection longer than that is its own context. */
export function sentenceAround(block: string, text: string): string {
  if (text.length > sentenceRadius) return text;
  const at = block.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return text;
  return block.slice(Math.max(0, at - sentenceRadius), at + text.length + sentenceRadius).trim();
}

// The teaching approach and the target language live here, so changing either means editing the prompt.
export const defaultPromptTemplate = [
  "You are an English teacher helping a Vietnamese learner.",
  "",
  'The learner selected: "{{text}}"',
  'It appears in this context: "{{sentence}}"',
  "",
  "Translate the selection into Vietnamese, then teach it:",
  "- Pick out only the words and phrases a Vietnamese learner at an intermediate level would likely need explained: phrasal verbs, idioms, collocations, less common or tricky words, and common words used in a non-obvious sense. Skip everything the learner almost certainly knows (articles, pronouns, 'be', 'have', basic prepositions and conjunctions, everyday words). Give each pick's meaning as used here.",
  "- Point out the grammar at work (tense, voice, clause structure, word order, and so on) and explain it simply.",
  "- Give reusable sentence patterns the learner can copy, each with an example.",
  "Write every explanation in Vietnamese and keep English terms in English.",
].join("\n");

// What each reply field holds. The task above names the target language.
const replyFormat = [
  "Reply with one JSON object with these fields:",
  "- translation: the natural translation of the selection itself (not of its context sentence) into the target language.",
  "- pronunciation: IPA for a single word or short phrase, otherwise an empty string.",
  "- breakdown: an array of { term, partOfSpeech, meaning, note } in order of appearance, listing only the selected entries. term is the word or phrase as written (dictionary form for a single word). partOfSpeech is in English (noun, phrasal verb, idiom, and so on). meaning is the meaning in the target language, as used here. note is optional usage, collocation, register or nuance, otherwise an empty string. Include only words and phrases worth learning, never every word of the text; a short sentence often needs just 1 to 3 entries, and an empty array is fine when nothing needs explaining. For a single word or short phrase give one detailed entry. For a longer text give at most 10 entries.",
  "- grammar: an array of { point, explanation }, at most 4, naming each grammar point at work and explaining it in the target language. Empty for a single word unless it matters.",
  "- patterns: an array of { pattern, meaning, example }, at most 3. pattern is a reusable template such as \"be going to + verb\"; example is an English sentence.",
  "- examples: up to 2 extra English example sentences for a single word or short phrase, otherwise an empty array.",
  "In any text field you may use **bold** and `code` to highlight key words.",
].join("\n");

// One pass, so a placeholder inside an inserted value stays literal.
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);

/** The task (the settings' template or the default), the reply format, then the user's extra instructions. */
export function buildPrompt(candidate: Candidate, settings: TranslateSettings = defaultSettings): string {
  const task = fill(settings.promptTemplate.trim() || defaultPromptTemplate, {
    text: candidate.text,
    sentence: candidate.sentence,
  });
  const extra = settings.extraInstructions.trim();
  return [task, replyFormat, ...(extra ? [`Additional instructions:\n${extra}`] : [])].join("\n\n");
}

export type ParsedReply = { ok: true; value: Translation } | { ok: false; error: string };

/** Validates the helper's final message; tolerates a code fence or prose around the JSON object. */
export function parseReply(final: string | null | undefined): ParsedReply {
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
  const parsed = translationSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

// What a reply looks like while it streams: any field may be missing or cut short.
const streamingSchema = z.object({
  translation: plain,
  pronunciation: plain,
  breakdown: z.array(z.object({ term: plain, partOfSpeech: plain, meaning: plain, note: plain })).default([]),
  grammar: z.array(z.object({ point: plain, explanation: plain })).default([]),
  patterns: z.array(z.object({ pattern: plain, meaning: plain, example: plain })).default([]),
  examples: z.array(plain).default([]),
});

/**
 * The part of a streaming reply that has arrived, shaped like a `Translation`: strings may end mid-word, and an
 * entry shows once its first field has started. Null until the translation itself has started.
 */
export function parsePartialReply(stream: string): Translation | null {
  const parsed = streamingSchema.safeParse(parsePartialJson(stream));
  if (!parsed.success || !parsed.data.translation) return null;
  const { breakdown, grammar, patterns, examples, ...rest } = parsed.data;
  return {
    ...rest,
    breakdown: breakdown.filter(item => item.term),
    grammar: grammar.filter(item => item.point),
    patterns: patterns.filter(item => item.pattern),
    examples: examples.filter(Boolean),
  };
}
