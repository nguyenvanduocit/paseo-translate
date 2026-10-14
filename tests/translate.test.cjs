const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const mocks = { '@getpaseo/plugin': { defineSettings: value => value } };
const shared = loadTs('shared/translate.ts', mocks);
const { defaultSettings } = loadTs('shared/settings.ts', mocks);
const { candidateFromSelection, sentenceAround, sentenceRadius, maxSelectionLength, buildPrompt, defaultPromptTemplate, parseReply, replyJsonSchema } = shared;
const block = 'The committee will deliberate on the proposal before the end of the week.';
const pick = selected => candidateFromSelection({ selected, block });

test('a word, a phrase and a whole sentence are accepted', () => {
  assert.equal(pick('deliberate').text, 'deliberate');
  assert.equal(pick('end of').text, 'end of');
  assert.equal(pick('The committee will deliberate on the proposal').text, 'The committee will deliberate on the proposal');
});

test('surrounding whitespace and punctuation are trimmed', () => {
  assert.equal(pick('  proposal.\n').text, 'proposal');
  assert.equal(pick('"committee,"').text, 'committee');
});

test('line breaks inside a selection collapse to spaces', () => {
  assert.equal(pick('the proposal\n\n  before the end').text, 'the proposal before the end');
});

test('selections with no letters are rejected', () => {
  for (const selected of ['', '   ', '12345', '=== ---', '3.14 / 2'])
    assert.equal(pick(selected), null, selected);
});

test('code-like and non-Latin selections still count', () => {
  assert.equal(pick('foo_bar').text, 'foo_bar');
  assert.equal(pick('猫が好きです').text, '猫が好きです');
});

test('a selection over the ceiling is rejected', () => {
  assert.ok(pick('a'.repeat(maxSelectionLength)));
  assert.equal(pick('a'.repeat(maxSelectionLength + 1)), null);
});

test('apostrophes, hyphens and accented letters are kept', () => {
  assert.equal(pick("don't").text, "don't");
  assert.equal(pick('well-known').text, 'well-known');
  assert.equal(pick('café').text, 'café');
});

test('the sentence is the text around the selection, bounded to the radius on each side', () => {
  assert.equal(pick('deliberate').sentence, block);
  const long = `${'x '.repeat(sentenceRadius)}target${' y'.repeat(sentenceRadius)}`;
  const { sentence } = candidateFromSelection({ selected: 'target', block: long });
  assert.ok(sentence.includes('target'));
  assert.ok(sentence.length <= 2 * sentenceRadius + 'target'.length, `${sentence.length}`);
  assert.ok(sentence.length > sentenceRadius);
});

test('a selection longer than the radius is its own context', () => {
  const passage = 'word '.repeat(sentenceRadius);
  assert.equal(candidateFromSelection({ selected: passage, block: `before ${passage} after` }).sentence, passage.trim().replace(/\s+/g, ' '));
});

test('the sentence falls back to the word when the block does not contain it', () => {
  assert.equal(sentenceAround('unrelated text', 'missing'), 'missing');
});

const candidate = { text: 'deliberate', sentence: block };
const settings = (patch = {}) => ({ ...defaultSettings, ...patch });

test('the prompt names the word, its sentence and every reply field', () => {
  const prompt = buildPrompt(candidate);
  for (const part of ['"deliberate"', block, 'translation', 'pronunciation', 'breakdown', 'grammar', 'patterns', 'examples', 'Vietnamese', 'English teacher'])
    assert.ok(prompt.includes(part), part);
});

test('the default settings give the default prompt', () => {
  assert.equal(buildPrompt(candidate, defaultSettings), buildPrompt(candidate));
  assert.ok(!buildPrompt(candidate).includes('Additional instructions'));
});

test('a custom template replaces the default task and fills its placeholders', () => {
  const promptTemplate = 'Explain {{text}} in Japanese, from: {{sentence}}. Again: {{text}}';
  const prompt = buildPrompt(candidate, settings({ promptTemplate }));
  assert.ok(prompt.startsWith(`Explain deliberate in Japanese, from: ${block}. Again: deliberate`));
  assert.ok(!prompt.includes('Vietnamese'));
  assert.ok(prompt.includes('breakdown'), 'the reply format stays');
});

test('a blank template falls back to the default', () => {
  assert.equal(buildPrompt(candidate, settings({ promptTemplate: '   \n' })), buildPrompt(candidate));
});

test('placeholder values containing dollar signs or braces are inserted literally', () => {
  const prompt = buildPrompt({ text: 'a', sentence: "cost $& {{text}} $1" }, settings({ promptTemplate: '{{sentence}}' }));
  assert.ok(prompt.startsWith('cost $& {{text}} $1'));
  assert.ok(buildPrompt({ text: 'a', sentence: '{{sentence}}' }, settings({ promptTemplate: '{{sentence}}' })).startsWith('{{sentence}}'));
});

test('extra instructions are appended, with a custom template or the default', () => {
  for (const promptTemplate of ['', 'Look up {{text}}']) {
    const prompt = buildPrompt(candidate, settings({ promptTemplate, extraInstructions: '  prefer medical senses ' }));
    assert.ok(prompt.endsWith('Additional instructions:\nprefer medical senses'));
  }
});

const reply = {
  translation: 'Họ cân nhắc kỹ.',
  pronunciation: '/dɪˈlɪb.ər.ət/',
  breakdown: [{ term: 'deliberate', partOfSpeech: 'verb', meaning: 'cân nhắc', note: 'thường đi với **on**' }],
  grammar: [{ point: 'Simple future', explanation: '`will` + động từ nguyên mẫu.' }],
  patterns: [{ pattern: 'deliberate on + noun', meaning: 'cân nhắc về', example: 'They deliberate on the plan.' }],
  examples: ['The jury will deliberate for hours.'],
};

test('a full reply parses, with or without a code fence or prose', () => {
  const json = JSON.stringify(reply);
  for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `Here you go: ${json} Done.`])
    assert.deepEqual(parseReply(text), { ok: true, value: reply });
});

test('a reply that omits the empty fields still parses, with those fields empty', () => {
  assert.deepEqual(parseReply('{"translation":"Xin chào"}'), {
    ok: true,
    value: { translation: 'Xin chào', pronunciation: '', breakdown: [], grammar: [], patterns: [], examples: [] },
  });
});

test('malformed replies report an error', () => {
  for (const text of [null, undefined, '', 'no json here', '{"translation": ', '{"pronunciation":"x"}', JSON.stringify({ ...reply, translation: '' }),
    JSON.stringify({ ...reply, breakdown: [{ term: '', meaning: 'x' }] })])
    assert.equal(parseReply(text).ok, false, String(text));
});

test('the JSON schema handed to the provider lists the reply fields', () => {
  assert.equal(replyJsonSchema.type, 'object');
  assert.deepEqual(Object.keys(replyJsonSchema.properties).sort(), Object.keys(reply).sort());
  assert.ok(replyJsonSchema.required.includes('breakdown'));
  assert.equal('$schema' in replyJsonSchema, false);
});

const { parseInline } = loadTs('shared/rich-text.ts');

test('inline bold and code become spans, the rest stays plain', () => {
  assert.deepEqual(parseInline('dùng **will** hoặc `be going to` ở đây'), [
    { text: 'dùng ' }, { text: 'will', bold: true }, { text: ' hoặc ' }, { text: 'be going to', code: true }, { text: ' ở đây' },
  ]);
});

test('text without marks is one plain span, and an unmatched mark stays literal', () => {
  assert.deepEqual(parseInline('plain'), [{ text: 'plain' }]);
  assert.deepEqual(parseInline('2 ** 3 and `open'), [{ text: '2 ** 3 and `open' }]);
  assert.deepEqual(parseInline(''), []);
});

const { parsePartialJson } = loadTs('shared/partial-json.ts', mocks);
const { parsePartialReply } = shared;
const fullReply = JSON.stringify({
  translation: 'Bản sửa tài liệu "đã" commit',
  pronunciation: '',
  breakdown: [{ term: 'doc fix', partOfSpeech: 'noun phrase', meaning: 'bản sửa tài liệu', note: '' }],
  grammar: [{ point: 'Passive', explanation: 'Bị động' }],
  patterns: [],
  examples: ['One', 'Two'],
});

test('every prefix of a reply parses to an object or to nothing, never throws', () => {
  for (let end = 0; end <= fullReply.length; end++) {
    const value = parsePartialJson(fullReply.slice(0, end));
    assert.ok(value === undefined || (typeof value === 'object' && value !== null), `prefix ${end}`);
  }
  assert.deepEqual(parsePartialJson(fullReply), JSON.parse(fullReply));
});

test('a string cut mid-way keeps the characters that arrived, and a key without a value is dropped', () => {
  assert.deepEqual(parsePartialJson('{"translation":"Bản sử'), { translation: 'Bản sử' });
  assert.deepEqual(parsePartialJson('{"translation":"x","pronunciation"'), { translation: 'x' });
  assert.deepEqual(parsePartialJson('{"translation":"x","breakdown":[{"term":"a"},{"te'), { translation: 'x', breakdown: [{ term: 'a' }, {}] });
  assert.deepEqual(parsePartialJson('{"translation":"a\\'), { translation: 'a' });
  assert.deepEqual(parsePartialJson('{"translation":"a\\u00'), { translation: 'a' });
  assert.deepEqual(parsePartialJson('{"a":tru'), {});
});

test('text before the object and braces inside strings are handled', () => {
  assert.deepEqual(parsePartialJson('```json\n{"translation":"{x}'), { translation: '{x}' });
  assert.equal(parsePartialJson('no object yet'), undefined);
});

test('a streaming reply shows nothing until the translation starts, then grows with the stream', () => {
  assert.equal(parsePartialReply('{"translation":"'), null);
  assert.equal(parsePartialReply('{"translation":"B')?.translation, 'B');
  const midway = parsePartialReply(fullReply.slice(0, fullReply.indexOf('"note"')));
  assert.equal(midway.breakdown.length, 1);
  assert.equal(midway.breakdown[0].meaning, 'bản sửa tài liệu');
  assert.deepEqual(midway.grammar, []);
});

test('a streaming reply hides an entry until its first field starts, and the finished reply equals the validated one', () => {
  assert.deepEqual(parsePartialReply('{"translation":"x","breakdown":[{"term":"').breakdown, []);
  assert.equal(parsePartialReply('{"translation":"x","breakdown":[{"term":"d').breakdown[0].term, 'd');
  assert.deepEqual(parsePartialReply(fullReply), shared.parseReply(fullReply).value);
});

const { wordStart, wordEnd } = shared;

test('a boundary inside a word moves to the edge of that word', () => {
  const text = 'The committee will deliberate';
  assert.equal(wordStart(text, 7), 4);
  assert.equal(wordEnd(text, 7), 13);
  assert.equal(wordStart(text, 4), 4);
  assert.equal(wordEnd(text, 13), 13);
  assert.equal(wordStart(text, 0), 0);
  assert.equal(wordEnd(text, text.length), text.length);
});

test('an apostrophe or hyphen between letters belongs to the word, one at the edge does not', () => {
  assert.equal(wordEnd("they don't go", 7), 10);
  assert.equal(wordStart('a well-known fact', 8), 2);
  assert.equal(wordEnd("'quoted' word", 3), 7);
  assert.equal(wordStart('x - y', 3), 3);
});

test('accented letters and digits are word characters, and a word that never ends is left alone', () => {
  assert.equal(wordEnd('Việt Nam', 2), 4);
  assert.equal(wordStart('commit 725a153 now', 10), 7);
  const hash = 'a'.repeat(60);
  assert.equal(wordStart(hash, 30), 30);
  assert.equal(wordEnd(hash, 30), 30);
});
