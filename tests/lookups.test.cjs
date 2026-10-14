const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

// `useSyncExternalStore` reads the store directly outside React.
const mocks = { react: { useSyncExternalStore: (_subscribe, read) => read() } };
const store = () => loadTs('client/lookups.ts', mocks, [], new Map());
const lookup = (id, workspaceId = 'w1') => ({ id, workspaceId, text: id, sentence: id, status: 'loading' });

test('a new lookup replaces the workspace\'s latest', () => {
  const { setLatestLookup, useLatestLookup } = store();
  setLatestLookup(lookup('a'));
  setLatestLookup(lookup('b'));
  assert.equal(useLatestLookup('w1').id, 'b');
});

test('each workspace keeps its own latest', () => {
  const { setLatestLookup, useLatestLookup } = store();
  setLatestLookup(lookup('a', 'w1'));
  setLatestLookup(lookup('b', 'w2'));
  assert.equal(useLatestLookup('w1').id, 'a');
  assert.equal(useLatestLookup('w2').id, 'b');
  assert.equal(useLatestLookup('w3'), undefined);
});

test('an update patches the latest lookup', () => {
  const { setLatestLookup, updateLookup, useLatestLookup } = store();
  setLatestLookup(lookup('a'));
  updateLookup('a', { status: 'done' });
  assert.equal(useLatestLookup('w1').status, 'done');
});

test('the answer to a replaced lookup is dropped', () => {
  const { setLatestLookup, updateLookup, useLatestLookup, getLookup } = store();
  setLatestLookup(lookup('a'));
  setLatestLookup(lookup('b'));
  updateLookup('a', { status: 'done' });
  assert.equal(useLatestLookup('w1').id, 'b');
  assert.equal(useLatestLookup('w1').status, 'loading');
  assert.equal(getLookup('a'), undefined);
});
