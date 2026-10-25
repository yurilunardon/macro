import { useSyncExternalStore } from 'react';

import type { LabelValues } from '@/lib/label-parser';

/**
 * The values read from the last photo of a nutrition label. The scanner screen writes them and
 * goes back; the food form underneath offers to use them.
 */
export type LabelScan = { id: number; values: LabelValues };

let current: LabelScan | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLabelScan(): LabelScan | null {
  return useSyncExternalStore(subscribe, () => current);
}

export const labelScan = {
  set(values: LabelValues): void {
    current = { id: nextId++, values };
    emit();
  },
  clear(): void {
    current = null;
    emit();
  },
  /** The id of the latest scan, so a form can ignore results from before it opened. */
  latestId(): number {
    return current?.id ?? 0;
  },
};
