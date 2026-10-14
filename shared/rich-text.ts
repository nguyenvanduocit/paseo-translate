export interface Span {
  text: string;
  bold?: boolean;
  code?: boolean;
}

const marks = /\*\*(.+?)\*\*|`([^`]+)`/g;

/** Splits text on `**bold**` and `` `code` `` into spans; everything else is plain text. */
export function parseInline(source: string): Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const match of source.matchAll(marks)) {
    if (match.index > at) spans.push({ text: source.slice(at, match.index) });
    spans.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2], code: true });
    at = match.index + match[0].length;
  }
  if (at < source.length) spans.push({ text: source.slice(at) });
  return spans;
}
