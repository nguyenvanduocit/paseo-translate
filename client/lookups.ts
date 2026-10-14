import { useSyncExternalStore } from "react";
import type { Translation } from "../shared/translate";

export interface Lookup {
  id: string;
  workspaceId: string;
  text: string;
  sentence: string;
  status: "loading" | "done" | "error";
  translation?: Translation;
  error?: string;
}

// The panel shows one result per workspace: the latest lookup replaces the one before it.
let latest: ReadonlyMap<string, Lookup> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, Lookup>) {
  latest = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useLatestLookup = (workspaceId: string): Lookup | undefined =>
  useSyncExternalStore(subscribe, () => latest.get(workspaceId));

/** The lookup with this id while it is still its workspace's latest, otherwise undefined. */
export const getLookup = (id: string) => [...latest.values()].find(lookup => lookup.id === id);

export function setLatestLookup(lookup: Lookup) {
  publish(new Map(latest).set(lookup.workspaceId, lookup));
}

/** Patches a lookup that is still the latest; the answer to a replaced lookup is dropped. */
export function updateLookup(id: string, patch: Partial<Lookup>) {
  const current = getLookup(id);
  if (current) publish(new Map(latest).set(current.workspaceId, { ...current, ...patch }));
}
