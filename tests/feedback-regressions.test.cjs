const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const cache = new Map();
const mocks = { '@getpaseo/plugin': { defineSettings: value => value }, react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() } };
const load = file => loadTs(file, mocks, [], cache);
const rules = load('shared/feedback-rules.ts');
const { createFeedbackChecks } = load('server/feedback.ts');
const { startLookup } = load('client/translator.ts');
const { useLatestLookup } = load('client/lookups.ts');

test('a one-line sentence that mentions an error name or a timestamp is still checked', () => {
  for (const text of [
    'Why do I get a TypeError here?',
    'i got a TypeError when i call this function, can you fix it',
    'the deploy at 2026-10-26 10:00 fail and i dont know why',
  ])
    assert.equal(rules.skipReason(text), null, text);
  assert.equal(rules.skipReason('TypeError: x is not a function\n    at run (src/a.ts:1:1)\nwhy?'), 'code');
});

test('one long token without symbols is judged in linear time', () => {
  const started = Date.now();
  assert.equal(rules.skipReason('a'.repeat(100_000)), 'short');
  assert.ok(Date.now() - started < 500, `${Date.now() - started} ms`);
});

test('a failed helper-label lookup is asked again on the next turn', async () => {
  let refreshes = 0;
  const rows = [];
  const helper = { waitForFinish: async () => ({ status: 'idle', lastMessage: '{"ok":true,"corrected":"we was deploy it","issues":[]}' }), archive: async () => {} };
  const paseo = {
    agents: { ref: () => ({
      refresh: async () => { if (++refreshes === 1) throw new Error('daemon RPC timeout'); return { agent: { labels: {} } }; },
      timeline: {
        refetch: async () => ({ entries: [{ seqStart: 1, turnId: 't1', item: { type: 'user_message', text: 'we was deploy it', messageId: 'm1' } }] }),
        subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
        append: async row => { rows.push(row.data.state); },
      },
    }) },
    workspaces: { ref: () => ({ agents: { create: async () => helper } }) },
  };
  const agent = { id: 'agent-12345678', parentAgentId: null, provider: 'claude', workspaceId: 'ws1' };
  const context = { paseo, signal: new AbortController().signal };
  const checks = createFeedbackChecks(async () => true);
  await assert.rejects(checks.turnStarted({ agent, turnId: 't1' }, context), /daemon RPC timeout/);
  await checks.turnStarted({ agent, turnId: 't1' }, context);
  assert.deepEqual(rows, ['checking', 'fine']);
  await checks.stop();
});

test('a lookup that fails after part of the reply streamed shows only the error', async () => {
  let handler;
  const helper = {
    timeline: { subscribe: next => { handler = next; return Object.assign(() => {}, { ready: Promise.resolve() }); } },
    waitForFinish: async () => {
      handler({ event: { type: 'timeline', item: { type: 'assistant_message', text: '{"translation":"Anh ấy đã đi tới cửa hàng và mua' } } });
      return { status: 'timeout', error: 'Timed out', lastMessage: null };
    },
    archive: async () => {},
  };
  const created = [];
  const paseo = {
    agents: { list: async () => ({ entries: [
      // the English-check helper is the most recently updated agent, the user's chat the one before it
      { agent: { id: 'check', workspaceId: 'w', labels: { 'paseo-translate-feedback': '1' }, provider: 'claude', model: 'claude-haiku-5-5' } },
      { agent: { id: 'chat', workspaceId: 'w', labels: {}, provider: 'claude', model: 'claude-opus-5-5' } },
    ] }) },
    workspaces: { ref: () => ({ agents: { create: async options => { created.push(options); return helper; } } }) },
  };
  startLookup({ paseo, requestPrompt: async () => ({ prompt: 'p' }) }, { workspaceId: 'w', text: 'He went to the store', sentence: 'He went to the store.' });
  await new Promise(resolve => setTimeout(resolve, 100));
  const lookup = useLatestLookup('w');
  assert.equal(lookup.status, 'error');
  assert.equal(lookup.translation, undefined);
  assert.equal(created[0].parent, 'chat');
  assert.equal(created[0].config.provider, 'claude/claude-opus-5-5');
});
