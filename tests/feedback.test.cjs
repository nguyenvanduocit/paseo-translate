const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const mocks = { '@getpaseo/plugin': { defineSettings: value => value } };
const { wordDiff } = loadTs('shared/word-diff.ts', mocks);
const rules = loadTs('shared/feedback-rules.ts', mocks);
const feedback = loadTs('shared/feedback.ts', mocks);
const { translateSettingsSchema } = loadTs('shared/settings.ts', mocks);

// [-deleted-] and {+inserted+}, so an expected diff reads as one line.
const show = segments => segments.map(({ kind, text }) => (kind === 'del' ? `[-${text}-]` : kind === 'ins' ? `{+${text}+}` : text)).join('');

test('the word diff marks each changed word, joins changes one space apart, and keeps outer spaces unmarked', () => {
  assert.equal(
    show(wordDiff(
      'i want to know why the build are failing since yesterday, can you checking it',
      'I want to know why the build has been failing since yesterday. Can you check it?',
    )),
    '[-i-]{+I+} want to know why the build [-are-]{+has been+} failing since yesterday[-, can-]{+. Can+} you [-checking-]{+check+} it{+?+}',
  );
});

test('a run of changed words becomes one deletion and one insertion', () => {
  assert.equal(
    show(wordDiff('please review it more carefully than before', 'please review it more carefully than last time')),
    'please review it more carefully than [-before-]{+last time+}',
  );
  assert.equal(show(wordDiff('fixed the bug, please review', 'fixed the bug. Please review')), 'fixed the bug[-, please-]{+. Please+} review');
});

test('identical text is one unchanged segment and empty text gives no segments', () => {
  assert.deepEqual(wordDiff('Can you add a retry?', 'Can you add a retry?'), [{ kind: 'same', text: 'Can you add a retry?' }]);
  assert.deepEqual(wordDiff('', ''), []);
});

test('joining the unchanged and inserted segments gives the corrected text, the unchanged and deleted ones the original', () => {
  const original = "it don't work when i run the tests , and the log say nothing";
  const corrected = "It doesn't work when I run the tests, and the log says nothing.";
  const segments = wordDiff(original, corrected);
  assert.equal(segments.filter(s => s.kind !== 'del').map(s => s.text).join(''), corrected);
  assert.equal(segments.filter(s => s.kind !== 'ins').map(s => s.text).join(''), original);
});

test('line breaks are kept', () => {
  assert.equal(show(wordDiff('first line\nsecond lines', 'first line\nsecond line')), 'first line\nsecond [-lines-]{+line+}');
});

const top = { parentAgentId: null, provider: 'claude' };

test('only top-level agents are checked', () => {
  assert.equal(rules.isTopLevel(top), true);
  assert.equal(rules.isTopLevel({ ...top, parentAgentId: 'agent-1' }), false);
});

test('only Claude sessions are checked', () => {
  assert.equal(rules.isClaudeSession(top), true);
  assert.equal(rules.isClaudeSession({ ...top, provider: 'claude/claude-opus-5-5' }), true);
  for (const provider of ['codex', 'opencode', 'claudette'])
    assert.equal(rules.isClaudeSession({ ...top, provider }), false, provider);
});

test("this plugin's helpers are recognised by their labels", () => {
  assert.equal(rules.isOwnHelper({ 'paseo-translate': '1' }), true);
  assert.equal(rules.isOwnHelper({ [rules.feedbackHelperLabel]: '1' }), true);
  assert.equal(rules.isOwnHelper({}), false);
  assert.equal(rules.isOwnHelper(undefined), false);
});

test('a normal English message is checked', () => {
  for (const text of ['i want to know why the build are failing since yesterday, can you checking it', 'Can you add a retry to the upload step?',
    'Please look at `src/upload.ts` and tell me why the retry never fires.'])
    assert.equal(rules.skipReason(text), null, text);
});

test('slash commands are skipped', () => {
  assert.equal(rules.skipReason('/compact keep the plan'), 'command');
  assert.equal(rules.skipReason('  /review'), 'command');
});

test('messages under three words are skipped', () => {
  for (const text of ['ok', 'yes please', 'continue', '  ', 'go!'])
    assert.equal(rules.skipReason(text), 'short', text);
  assert.equal(rules.skipReason('yes please continue'), null);
});

test('messages that are mostly code, logs or links are skipped', () => {
  assert.equal(rules.skipReason('```ts\nconst retry = await upload(file, { attempts: 3 });\nif (!retry.ok) throw new Error(retry.message);\n```\nfix this'), 'code');
  assert.equal(rules.skipReason('https://gitlab.example.com/group/project/-/jobs/123456 https://gitlab.example.com/group/project/-/jobs/123457'), 'code');
  assert.equal(rules.skipReason('2026-10-25T13:44:29Z ERROR upload failed\n2026-10-25T13:44:30Z ERROR retry failed\n    at upload (src/upload.ts:42:7)\nwhy?'), 'code');
});

test('Vietnamese and other non-English messages are skipped', () => {
  for (const text of ['Tôi muốn biết tại sao build bị lỗi từ hôm qua', 'Bạn kiểm tra giúp mình file này được không?', 'この関数が動かない理由を教えてください', 'Почему сборка падает со вчерашнего дня?'])
    assert.equal(rules.skipReason(text), 'not-english', text);
  assert.equal(rules.skipReason('Can you rename the café table to cafe_orders?'), null);
});

test('a long message is cut at a sentence end before the limit and marked as cut', () => {
  const sentence = 'The upload step fails when the file is large. ';
  const long = sentence.repeat(Math.ceil((rules.maxCheckedLength * 2) / sentence.length));
  const cut = rules.excerpt(long);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= rules.maxCheckedLength, `${cut.text.length}`);
  assert.ok(cut.text.endsWith('large.'), cut.text.slice(-20));
  assert.deepEqual(rules.excerpt('  Short message here.  '), { text: 'Short message here.', truncated: false });
});

test('a long message without sentence ends is cut at a space', () => {
  const cut = rules.excerpt('word '.repeat(rules.maxCheckedLength));
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.endsWith('word'));
  assert.ok(cut.text.length <= rules.maxCheckedLength);
});

test('the prompt carries the message, the learner level and every reply field', () => {
  const prompt = feedback.buildFeedbackPrompt('can you checking it');
  for (const part of ['can you checking it', 'Vietnamese', 'B1', 'ok', 'corrected', 'issues', 'original', 'replacement', 'mistake', 'unnatural', 'tip', 'explanation', 'code'])
    assert.ok(prompt.includes(part), part);
});

test('the JSON schema handed to the provider lists the reply fields', () => {
  const schema = feedback.feedbackReplyJsonSchema;
  assert.equal(schema.type, 'object');
  assert.deepEqual(Object.keys(schema.properties).sort(), ['corrected', 'issues', 'ok']);
  assert.deepEqual(schema.properties.issues.items.properties.tag.enum, ['mistake', 'unnatural', 'tip']);
  assert.equal('$schema' in schema, false);
});

const reply = {
  ok: false,
  corrected: 'Can you check it?',
  issues: [{ original: 'can you checking', replacement: 'Can you check', tag: 'mistake', explanation: 'After "can you", use the base verb.' }],
};

test('a reply parses, with or without a code fence or prose around it', () => {
  const json = JSON.stringify(reply);
  for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `Here: ${json}`])
    assert.deepEqual(feedback.parseFeedbackReply(text), { ok: true, value: reply });
});

test('malformed replies report an error', () => {
  for (const text of [null, undefined, '', "There's an issue with the selected model (claude-x). It may not exist.", '{"ok": false, "corrected": ', '{"ok": "no"}',
    JSON.stringify({ ...reply, issues: [{ ...reply.issues[0], tag: 'style' }] }), JSON.stringify({ ...reply, issues: [{ ...reply.issues[0], explanation: '' }] })])
    assert.equal(feedback.parseFeedbackReply(text).ok, false, String(text));
});

test('a reply that finds nothing to fix gives a quiet row', () => {
  const text = 'Can you add a retry to the upload step?';
  assert.deepEqual(feedback.rowFromReply(text, false, { ok: true, corrected: text, issues: [] }), { state: 'fine' });
  assert.deepEqual(feedback.rowFromReply(text, false, { ok: false, corrected: ` ${text}\n`, issues: [] }), { state: 'fine' });
});

test('a reply with fixes gives a corrected row', () => {
  const row = feedback.rowFromReply('can you checking it', false, reply);
  assert.deepEqual(row, { state: 'corrected', original: 'can you checking it', corrected: 'Can you check it?', truncated: false, issues: reply.issues });
  assert.equal(feedback.feedbackRowSchema.safeParse(row).success, true);
});

test('every row state passes the renderer schema and a long reply stays under the 64 KiB limit', () => {
  const big = 'word '.repeat(rules.maxCheckedLength / 5);
  const issues = Array.from({ length: 40 }, () => ({ original: 'x'.repeat(200), replacement: 'y'.repeat(200), tag: 'tip', explanation: 'z'.repeat(600) }));
  const corrected = feedback.rowFromReply(big, true, { ok: false, corrected: `${big}!`, issues });
  assert.equal(corrected.issues.length, feedback.maxShownIssues);
  for (const row of [{ state: 'checking' }, { state: 'fine' }, { state: 'unchecked' }, corrected]) {
    assert.equal(feedback.feedbackRowSchema.safeParse(row).success, true, row.state);
    assert.ok(Buffer.byteLength(JSON.stringify(row)) < 64 * 1024);
  }
});

test('the row id comes from the user message, so a re-check replaces the row', () => {
  assert.equal(feedback.feedbackRowId({ messageId: 'abc' }, 7), 'english-feedback:abc');
  assert.equal(feedback.feedbackRowId({ clientMessageId: 'c1' }, 7), 'english-feedback:c1');
  assert.equal(feedback.feedbackRowId({}, 7), 'english-feedback:seq-7');
});

test('feedback is on by default, also for settings saved before the switch existed', () => {
  assert.equal(translateSettingsSchema.parse({}).feedbackEnabled, true);
  assert.equal(translateSettingsSchema.parse({ promptTemplate: 'x', extraInstructions: '' }).feedbackEnabled, true);
  assert.equal(translateSettingsSchema.parse({ feedbackEnabled: false }).feedbackEnabled, false);
});
