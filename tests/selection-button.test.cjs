const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { loadTs } = require('./load-ts.cjs');

const mocks = { 'react-native': { Platform: { OS: 'web' } } };
const options = ownsWorkspace => ({ ignoreTestId: 'panel', ownsWorkspace });
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// A page that records what the plugin adds to it and lets a test select text and finish a mouse press.
function fakePage(pathname) {
  const page = { head: [], body: [], document: new Map(), window: new Map() };
  const listeners = map => ({
    add: (type, fn) => map.set(fn, type),
    remove: (_type, fn) => map.delete(fn),
  });
  const documentListeners = listeners(page.document);
  const windowListeners = listeners(page.window);
  const element = () => {
    const node = {
      nodeType: 1, parentElement: null, style: {}, className: '', innerText: 'The committee will deliberate on the proposal before the end.',
      addEventListener() {}, contains: () => false, closest: () => null,
      remove() { for (const list of [page.head, page.body]) { const i = list.indexOf(node); if (i >= 0) list.splice(i, 1); } },
    };
    return node;
  };
  const paragraph = element();
  const range = {
    commonAncestorContainer: paragraph, startContainer: paragraph, startOffset: 0, endContainer: paragraph, endOffset: 0,
    getBoundingClientRect: () => ({ left: 100, top: 200, bottom: 220, width: 60, height: 20 }),
  };
  const selection = { rangeCount: 1, isCollapsed: false, toString: () => 'deliberate', getRangeAt: () => range };
  page.button = () => page.body[0];
  page.release = () => { for (const [fn, type] of page.document) if (type === 'mouseup') fn({ target: {} }); };
  page.fakes = {
    document: {
      createElement: element,
      head: { appendChild: node => page.head.push(node) },
      body: { appendChild: node => page.body.push(node) },
      addEventListener: documentListeners.add,
      removeEventListener: documentListeners.remove,
    },
    window: {
      location: { pathname }, innerWidth: 1000, getSelection: () => selection,
      addEventListener: windowListeners.add,
      removeEventListener: windowListeners.remove,
    },
  };
  return page;
}

let page;
const start = (ownsWorkspace, onTranslate = () => {}) =>
  loadTs('client/web.ts', mocks, [], new Map()).startSelectionListener(onTranslate, options(ownsWorkspace));

beforeEach(() => {
  page = fakePage('/h/srv_a/workspace/ws-1');
  globalThis.document = page.fakes.document;
  globalThis.window = page.fakes.window;
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test('one plugin evaluation adds one button, one style and its listeners, and its cleanup removes them', () => {
  const stop = start(async () => true);
  assert.equal(page.body.length, 1);
  assert.equal(page.head.length, 1);
  assert.equal(page.document.size, 4);
  assert.equal(page.window.size, 1);
  stop();
  assert.equal(page.body.length + page.head.length + page.document.size + page.window.size, 0);
});

test('the button shows for a workspace that belongs to this host and asks about that workspace', async () => {
  const asked = [];
  start(async id => { asked.push(id); return true; });
  page.release();
  await settle();
  assert.deepEqual(asked, ['ws-1']);
  assert.equal(page.button().style.display, 'flex');
});

test('the button stays hidden for a workspace that belongs to another host', async () => {
  start(async () => false);
  page.release();
  await settle();
  assert.notEqual(page.button().style.display, 'flex');
});

test('the button stays hidden when asking the host fails', async () => {
  start(async () => { throw new Error('offline'); });
  page.release();
  await settle();
  assert.notEqual(page.button().style.display, 'flex');
});

test('an answer that arrives after the selection was dismissed does not show the button', async () => {
  let answer;
  start(() => new Promise(resolve => { answer = resolve; }));
  page.release();
  await settle();
  for (const [fn, type] of page.document) if (type === 'mousedown') fn({ target: {} });
  answer(true);
  await settle();
  assert.notEqual(page.button().style.display, 'flex');
});

test('hosts that each run their own copy decide independently, so only the owner shows a button', async () => {
  const owner = start(async () => true);
  const other = start(async () => false);
  page.release();
  await settle();
  const [first, second] = page.body;
  assert.deepEqual([first.style.display, second.style.display].sort(), ['flex', 'none']);
  owner();
  other();
});
