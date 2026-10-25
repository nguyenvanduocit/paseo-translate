// Bookkeeping for checks that several triggers can start: a message arrives live, starts a turn, or turns up when the
// turn ends. Plain values only, so the rules run in tests without a daemon.

/** Message row ids already handled on this agent, so a message is checked once whichever trigger sees it first. */
export class MessageLedger {
  private readonly ids = new Set<string>();

  constructor(private readonly size = 500) {}

  /** True the first time an id is claimed; false after that. The oldest ids are forgotten past `size`. */
  claim(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.size) this.ids.delete(this.ids.values().next().value as string);
    return true;
  }
}

/** Runs at most `max` tasks at once; the rest wait their turn in order. A task that fails frees its slot. */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>(resolve => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      // A waiting task takes this slot over, so the count stays as it is.
      if (waiting.length) waiting.shift()!();
      else running--;
    }
  };
}
