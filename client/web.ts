import { Platform } from "react-native";
import { candidateFromSelection, sentenceRadius, type Candidate } from "../shared/translate";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface DomNode { nodeType: number; parentElement: DomElement | null }
interface DomElement extends DomNode {
  innerText?: string;
  closest(selector: string): DomElement | null;
  contains(node: unknown): boolean;
  remove(): void;
}
interface DomRect { left: number; top: number; bottom: number; width: number; height: number }
interface DomRange { commonAncestorContainer: DomNode; getBoundingClientRect(): DomRect }
interface DomSelection {
  rangeCount: number;
  isCollapsed: boolean;
  getRangeAt(index: number): DomRange;
  toString(): string;
}
interface DomEvent { target: unknown; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; preventDefault(): void }
type DomListener = (event: DomEvent) => void;
interface DomButton extends DomElement {
  type: string;
  className: string;
  innerHTML: string;
  style: { display: string; left: string; top: string };
  offsetWidth: number;
  offsetHeight: number;
  addEventListener(type: string, listener: DomListener): void;
}
interface DomStyle extends DomElement { id: string; textContent: string }
declare const document: {
  createElement(tag: "button"): DomButton;
  createElement(tag: "style"): DomStyle;
  head: { appendChild(node: unknown): void };
  body: { appendChild(node: unknown): void };
  addEventListener(type: string, listener: DomListener): void;
  removeEventListener(type: string, listener: DomListener): void;
};
declare const window: {
  location: { pathname: string };
  innerWidth: number;
  getSelection(): DomSelection | null;
  addEventListener(type: string, listener: DomListener, capture: boolean): void;
  removeEventListener(type: string, listener: DomListener, capture: boolean): void;
};
declare function atob(data: string): string;
declare class TextDecoder {
  decode(bytes: Uint8Array): string;
}

const elementNode = 1;

// The plugin SDK has no text-selection API and `<Text selectable>` exposes no selection state, so
// the selection comes from the browser's own events. Electron and the web app have them; the native
// mobile app does not, and `startSelectionListener` is a no-op there.
export function canListenToSelection(): boolean {
  return Platform.OS === "web" && typeof document !== "undefined";
}

export interface SelectionRequest extends Candidate {
  workspaceId: string;
}

const blockSearchDepth = 6;
const base64Prefix = "b64_";
const editable = "input, textarea, [contenteditable]:not([contenteditable='false'])";

export interface SelectionOptions {
  /** A web `testID` (rendered as `data-testid`) whose subtree is never offered for translation. */
  ignoreTestId: string;
}

// The app routes a workspace as /h/<serverId>/workspace/<id>; ids that are not URL-safe travel as
// `b64_` + base64url. `client.openPanel` needs the workspace id and the DOM is the only place the
// current workspace shows up, so this is the one spot that depends on the app's route shape.
function workspaceIdFromLocation(): string | null {
  const match = window.location.pathname.match(/\/workspace\/([^/]+)/);
  if (!match) return null;
  const segment = decodeURIComponent(match[1]);
  if (!segment.startsWith(base64Prefix)) return segment;
  const base64 = segment.slice(base64Prefix.length).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const elementOf = (node: DomNode): DomElement | null => (node.nodeType === elementNode ? (node as DomElement) : node.parentElement);

/** Text of the smallest ancestor that holds the selection plus some surrounding words. */
function blockText(container: DomElement, selected: string): string {
  let element = container;
  for (let depth = 0; depth < blockSearchDepth && element.parentElement; depth++) {
    if ((element.innerText ?? "").length >= selected.length + 2 * sentenceRadius) break;
    element = element.parentElement;
  }
  return element.innerText ?? selected;
}

function readSelection(ignored: string): { request: SelectionRequest; rect: DomRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container = elementOf(range.commonAncestorContainer);
  if (!container || container.closest(editable) || container.closest(ignored)) return null;
  const selected = selection.toString();
  const candidate = candidateFromSelection({ selected, block: blockText(container, selected) });
  const workspaceId = workspaceIdFromLocation();
  const rect = range.getBoundingClientRect();
  if (!candidate || !workspaceId || (rect.width === 0 && rect.height === 0)) return null;
  return { request: { ...candidate, workspaceId }, rect };
}

// Lucide "languages" icon.
const icon =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
const gap = 8;
const edge = 8;

// The button looks like Paseo's composer pills. Paseo (Unistyles) publishes every theme color as a
// `--colors-<name>` variable on the root element and swaps them with the theme, so plain CSS follows
// the active theme with no color logic here. The fallbacks are CSS system colors, which follow the
// OS scheme on a host that does not publish the variables.
const buttonClass = "paseo-translate-button";
const styleId = "paseo-translate-style";
const buttonCss = `
.${buttonClass} {
  position: fixed; z-index: 2147483000; display: none; align-items: center; gap: 8px;
  min-height: 32px; padding: 0 12px; box-sizing: border-box; white-space: nowrap; cursor: pointer;
  border: 1px solid var(--colors-border-accent, GrayText); border-radius: 16px;
  background: var(--colors-surface1, Canvas); color: var(--colors-foreground-muted, GrayText);
  font: 14px/1 var(--paseo-ui-font, system-ui, sans-serif);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.${buttonClass}:hover { background: var(--colors-surface2, Canvas); color: var(--colors-foreground, CanvasText); }
`;

function createButton(): DomButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = buttonClass;
  button.innerHTML = `${icon}<span>Translate</span>`;
  // A press on the button must not collapse the selection it is about to translate.
  button.addEventListener("mousedown", event => event.preventDefault());
  return button;
}

/** Shows a floating "Translate" button next to a valid selection. Returns the cleanup. */
export function startSelectionListener(onTranslate: (request: SelectionRequest) => void, options: SelectionOptions): () => void {
  if (!canListenToSelection()) return () => {};
  const ignored = `[data-testid="${options.ignoreTestId}"]`;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = buttonCss;
  const button = createButton();
  let current: SelectionRequest | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    current = null;
    button.style.display = "none";
  };
  const refresh = () => {
    const read = readSelection(ignored);
    if (!read) return hide();
    current = read.request;
    button.style.display = "flex";
    const { offsetWidth, offsetHeight } = button;
    const left = Math.min(Math.max(edge, read.rect.left), window.innerWidth - offsetWidth - edge);
    const above = read.rect.top - offsetHeight - gap;
    button.style.left = `${left}px`;
    button.style.top = `${above >= edge ? above : read.rect.bottom + gap}px`;
  };
  // Decide only once the user has finished selecting, not on every `selectionchange` while dragging.
  // The tick lets the browser settle the selection (a click inside a selection collapses it).
  const cancelDecision = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const decideSoon = () => {
    cancelDecision();
    timer = setTimeout(refresh, 0);
  };
  const onMouseDown = (event: DomEvent) => {
    if (!button.contains(event.target)) hide();
  };
  const onMouseUp = (event: DomEvent) => {
    if (!button.contains(event.target)) decideSoon();
  };
  // Keyboard selections end when the key is released: Shift+Arrow, Shift+Home/End, Cmd/Ctrl+A.
  const onKeyUp = (event: DomEvent) => {
    if (event.key === "Shift" || event.shiftKey || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a")) decideSoon();
  };
  const onSelectionChange = () => {
    if (window.getSelection()?.isCollapsed) hide();
  };
  const onScroll = () => {
    if (current) refresh();
  };
  button.addEventListener("click", () => {
    if (current) onTranslate(current);
    hide();
  });

  document.head.appendChild(style);
  document.body.appendChild(button);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("scroll", onScroll, true);
  return () => {
    cancelDecision();
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("selectionchange", onSelectionChange);
    window.removeEventListener("scroll", onScroll, true);
    button.remove();
    style.remove();
  };
}
