// The correction line under a message is a diff of the learner's text against the model's corrected text.
// It is computed here, never asked of the model, so the marks always match the two texts exactly.

export interface DiffSegment {
  kind: "same" | "del" | "ins";
  text: string;
}

// A word (an apostrophe or hyphen may join two parts, as in "don't"), a run of whitespace, or one other character.
const tokenPattern = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;
const tokens = (text: string) => text.match(tokenPattern) ?? [];
const isSpace = (token: string) => /^\s+$/.test(token);

/** Token-level edit script by longest common subsequence; a deletion comes before the insertion that replaces it. */
function editScript(a: string[], b: string[]): DiffSegment[] {
  const width = b.length + 1;
  const common = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1] + 1 : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
  const script: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      script.push({ kind: "same", text: a[i++] });
      j++;
    } else if (j >= b.length || (i < a.length && common[(i + 1) * width + j] >= common[i * width + j + 1])) script.push({ kind: "del", text: a[i++] });
    else script.push({ kind: "ins", text: b[j++] });
  }
  return script;
}

/** Splits a group's shared leading and trailing whitespace out of its deletion and insertion. */
function trimGroup(del: string, ins: string): DiffSegment[] {
  const lead = /^\s*/.exec(del)![0];
  const trail = /\s*$/.exec(del)![0];
  const start = lead && ins.startsWith(lead) && lead.length < del.length ? lead : "";
  const end = trail && ins.endsWith(trail) && start.length + trail.length < Math.min(del.length, ins.length) ? trail : "";
  return [
    { kind: "same", text: start },
    { kind: "del", text: del.slice(start.length, del.length - end.length) },
    { kind: "ins", text: ins.slice(start.length, ins.length - end.length) },
    { kind: "same", text: end },
  ];
}

/**
 * The learner's text against the corrected text as unchanged, deleted and inserted segments. Changes one space
 * apart read as one phrase ("[are] → [has been]"), so a space between two changes joins them.
 */
export function wordDiff(original: string, corrected: string): DiffSegment[] {
  const script = editScript(tokens(original), tokens(corrected));
  const segments: DiffSegment[] = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del || ins) segments.push(...trimGroup(del, ins));
    del = ins = "";
  };
  script.forEach((step, index) => {
    const joins = step.kind === "same" && isSpace(step.text) && (del || ins) && script[index + 1] !== undefined && script[index + 1].kind !== "same";
    if (step.kind === "same" && !joins) {
      flush();
      segments.push(step);
      return;
    }
    if (step.kind !== "ins") del += step.text;
    if (step.kind !== "del") ins += step.text;
  });
  flush();
  // Adjacent segments of one kind merge, and empty ones go.
  return segments.reduce<DiffSegment[]>((merged, segment) => {
    if (!segment.text) return merged;
    const last = merged[merged.length - 1];
    if (last?.kind === segment.kind) last.text += segment.text;
    else merged.push({ ...segment });
    return merged;
  }, []);
}
