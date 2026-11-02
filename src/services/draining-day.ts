import { useSyncExternalStore } from 'react';

import type { DateKey } from '@/lib/dates';

/**
 * Emptying a day: its ring and bars drain in one slow, even movement over this long, while the
 * foods leave one after the other in the same time.
 */
export const CLEAR_MS = 1600;

let draining: DateKey | null = null;
const listeners = new Set<() => void>();

/** The day being emptied, for what shows that day elsewhere to drain along with it. */
export function setDrainingDay(day: DateKey | null): void {
  draining = day;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDrainingDay(): DateKey | null {
  return useSyncExternalStore(subscribe, () => draining);
}
