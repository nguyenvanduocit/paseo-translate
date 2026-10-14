const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const mocks = { 'react-native': { Platform: { OS: 'web' } } };

// A page that records what the plugin adds to it. Each `load()` evaluates web.ts again with its own
// module scope, the way the host evaluates the client bundle again on every plugin reload.
function fakePage() {
  const listeners = new Set();
  const track = () => ({
    add(type, fn) { listeners.add(`${type}`); (this.map ??= new Map()).set(fn, type); },
    remove(_type, fn) { this.map?.delete(fn); },
    get size() { return this.map?.size ?? 0; },
  });
  const documentListeners = track();
  const windowListeners = track();
  const page = { head: [], body: [], documentListeners, windowListeners };
  const element = () => {
    const node = {
      style: {}, className: '', addEventListener() {}, contains: () => false,
      remove() { for (const list of [page.head, page.body]) { const i = list.indexOf(node); if (i >= 0) list.splice(i, 1); } },
    };
    return node;
  };
  const document = {
    createElement: element,
    head: { appendChild: node => page.head.push(node) },
    body: { appendChild: node => page.body.push(node) },
    addEventListener: (type, fn) => documentListeners.add(type, fn),
    removeEventListener: (type, fn) => documentListeners.remove(type, fn),
  };
  const window = {
    location: { pathname: '/' }, innerWidth: 1000, getSelection: () => null,
    addEventListener: (type, fn) => windowListeners.add(type, fn),
    removeEventListener: (type, fn) => windowListeners.remove(type, fn),
  };
  return { page, document, window };
}

let page;
const load = () => loadTs('client/web.ts', mocks, [], new Map()).startSelectionListener;
const options = { ignoreTestId: 'panel' };

beforeEach(() => {
  const fake = fakePage();
  page = fake.page;
  globalThis.document = fake.document;
  globalThis.window = fake.window;
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test('one plugin evaluation adds one button, one style and the listeners, and its cleanup removes them', () => {
  const stop = load()(() => {}, options);
  assert.equal(page.body.length, 1);
  assert.equal(page.head.length, 1);
  assert.equal(page.documentListeners.size, 4);
  assert.equal(page.windowListeners.size, 1);
  stop();
  assert.equal(page.body.length + page.head.length, 0);
  assert.equal(page.documentListeners.size + page.windowListeners.size, 0);
});

test('a second evaluation replaces the first even when the first was never cleaned up', () => {
  load()(() => {}, options);
  const stop = load()(() => {}, options);
  assert.equal(page.body.length, 1);
  assert.equal(page.head.length, 1);
  assert.equal(page.documentListeners.size, 4);
  assert.equal(page.windowListeners.size, 1);
  stop();
  assert.equal(page.body.length + page.head.length, 0);
  assert.equal(page.documentListeners.size + page.windowListeners.size, 0);
});
