const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const mocks = { '@getpaseo/plugin': { defineSettings: value => value } };
const { MessageLedger, createLimiter } = loadTs('shared/feedback-queue.ts', mocks);
const feedback = loadTs('shared/feedback.ts', mocks);
const { pendingChecks, quoteOf, isStaleChecking, checkingStaleMs, feedbackRowSchema, feedbackRowId } = feedback;

test('the ledger hands out each message once, whichever trigger asks first', () => {
  const ledger = new MessageLedger();
  assert.equal(ledger.claim('english-feedback:a'), true);
  assert.equal(ledger.claim('english-feedback:a'), false);
  assert.equal(ledger.claim('english-feedback:b'), true);
});

test('the ledger forgets the oldest ids past its size, so a long chat does not grow it without bound', () => {
  const ledger = new MessageLedger(3);
  for (const id of ['a', 'b', 'c', 'd']) ledger.claim(id);
  assert.equal(ledger.claim('d'), false);
  assert.equal(ledger.claim('a'), true);
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('the limiter runs at most two tasks at a time and starts queued ones in order', async () => {
  const limit = createLimiter(2);
  let running = 0, peak = 0;
  const started = [];
  const gates = [];
  const tasks = [0, 1, 2, 3].map(i => limit(async () => {
    started.push(i); running++; peak = Math.max(peak, running);
    await new Promise(resolve => gates.push(resolve));
    running--;
    return i;
  }));
  await tick();
  assert.deepEqual(started, [0, 1]);
  gates.shift()(); await tick(); await tick();
  assert.deepEqual(started, [0, 1, 2]);
  while (gates.length || started.length < 4) { gates.shift()?.(); await tick(); await tick(); }
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test('a failed task frees its slot', async () => {
  const limit = createLimiter(1);
  await assert.rejects(limit(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await limit(async () => 'next'), 'next');
});

const user = (seq, text, turnId, messageId = `m${seq}`) => ({ seqStart: seq, turnId, item: { type: 'user_message', text, messageId } });
const row = (seq, messageId, state) => ({ seqStart: seq, item: { type: 'plugin', id: feedbackRowId({ messageId }, 0), kind: 'english-feedback', data: { state } } });
const reply = (seq, turnId) => ({ seqStart: seq, turnId, item: { type: 'assistant_message', text: 'ok' } });

test('at the end of a turn, a message with a result row needs nothing', () => {
  const entries = [user(1, 'we was deploy it', 't1'), row(2, 'm1', 'corrected'), reply(3, 't1')];
  assert.deepEqual(pendingChecks(entries, 't1'), []);
  for (const state of ['fine', 'unchecked'])
    assert.deepEqual(pendingChecks([user(1, 'x y', 't1'), row(2, 'm1', state)], 't1'), []);
});

test('a message whose row is still checking is finished in place, one without a row gets a late row', () => {
  const entries = [user(1, 'first message here', 't1'), row(2, 'm1', 'checking'), reply(3, 't1'), user(4, 'we was deploy it', 't1'), reply(5, 't1')];
  assert.deepEqual(pendingChecks(entries, 't1'), [
    { id: 'english-feedback:m1', text: 'first message here', late: false },
    { id: 'english-feedback:m4', text: 'we was deploy it', late: true },
  ]);
});

test('messages of other turns are left alone, and a turn without an id only looks at its last message', () => {
  const entries = [user(1, 'old message', 't0'), reply(2, 't0'), user(3, 'new message', 't1'), user(4, 'steered one', 't1')];
  assert.deepEqual(pendingChecks(entries, 't1').map(p => p.id), ['english-feedback:m3', 'english-feedback:m4']);
  assert.deepEqual(pendingChecks(entries, null).map(p => p.id), ['english-feedback:m4']);
});

test('the quote is the start of the message on one line, cut at a word', () => {
  assert.equal(quoteOf('  we was deploy\nthe new version  '), 'we was deploy the new version');
  const long = 'i want to know why the build are failing since yesterday, can you checking it please';
  const quote = quoteOf(long);
  assert.ok(quote.endsWith('…'), quote);
  assert.ok(quote.length <= 61, `${quote.length}`);
  assert.ok(long.startsWith(quote.slice(0, -1)), quote);
  assert.ok(!quote.slice(0, -1).endsWith(' '), quote);
});

test('a checking row goes stale after the limit, so a check that died never pulses forever', () => {
  const now = Date.parse('2026-10-26T10:00:00Z');
  assert.equal(isStaleChecking(new Date(now - checkingStaleMs + 1000), now), false);
  assert.equal(isStaleChecking(new Date(now - checkingStaleMs - 1000), now), true);
  assert.equal(checkingStaleMs, 90_000);
});

test('late rows carry their quote and still pass the renderer schema; live rows have neither field', () => {
  for (const data of [
    { state: 'checking', late: true, quote: 'we was deploy' },
    { state: 'corrected', original: 'a', corrected: 'b', truncated: false, issues: [], late: true, quote: 'a' },
    { state: 'checking' },
  ])
    assert.equal(feedbackRowSchema.safeParse(data).success, true, JSON.stringify(data));
});
