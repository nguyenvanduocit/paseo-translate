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

const maxLookups = 50;
let lookups: readonly Lookup[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Lookup[]) {
  lookups = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Newest first. */
export const useLookups = (): readonly Lookup[] => useSyncExternalStore(subscribe, () => lookups);

export const getLookup = (id: string) => lookups.find(lookup => lookup.id === id);

export function addLookup(lookup: Lookup) {
  publish([lookup, ...lookups].slice(0, maxLookups));
}

export function updateLookup(id: string, patch: Partial<Lookup>) {
  publish(lookups.map(lookup => (lookup.id === id ? { ...lookup, ...patch } : lookup)));
}

export function removeLookup(id: string) {
  publish(lookups.filter(lookup => lookup.id !== id));
}

export function clearLookups(workspaceId: string) {
  publish(lookups.filter(lookup => lookup.workspaceId !== workspaceId));
}
