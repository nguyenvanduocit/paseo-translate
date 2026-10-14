// The helper's reply streams in as text, so by the time it is complete JSON the user has waited for all of it.
// These functions read the first object of a prefix of that text, so the panel can render what has arrived.

const maxTrim = 48;

/** `text` with an open string, array and object closed, so a prefix of a JSON object can parse. */
function close(text: string): string {
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if (char === "}" || char === "]") open.pop();
  }
  // A string cut inside an escape sequence has no valid ending, so the sequence goes.
  const head = inString ? text.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "") : text;
  const tail = inString ? '"' : "";
  return head + tail + open.reverse().join("");
}

/**
 * The value of the first JSON object in `text`, which may be cut anywhere. A string cut short keeps the characters
 * that arrived; a key without its value, or a literal cut short, is dropped. Undefined when nothing parses yet.
 */
export function parsePartialJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  const body = text.slice(start);
  for (let trim = 0; trim <= maxTrim && trim < body.length; trim++) {
    try {
      return JSON.parse(close(body.slice(0, body.length - trim)));
    } catch {
      // The end of the text is a key, a colon or a literal that is not finished; drop one more character.
    }
  }
  return undefined;
}
