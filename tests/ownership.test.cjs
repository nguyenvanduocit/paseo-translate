const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const { createOwnership } = loadTs('client/ownership.ts');

test('each workspace is looked up once, whatever the answer', async () => {
  const asked = [];
  const owns = createOwnership(async id => { asked.push(id); return id === 'mine'; });
  assert.deepEqual(await Promise.all([owns('mine'), owns('mine'), owns('theirs'), owns('theirs')]), [true, true, false, false]);
  assert.equal(await owns('mine'), true);
  assert.deepEqual(asked, ['mine', 'theirs']);
});

test('a failed lookup answers false and is asked again next time', async () => {
  let calls = 0;
  const owns = createOwnership(async () => { if (++calls === 1) throw new Error('offline'); return true; });
  assert.equal(await owns('ws'), false);
  assert.equal(await owns('ws'), true);
  assert.equal(calls, 2);
});
