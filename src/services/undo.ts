import type { SFSymbol } from 'expo-symbols';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { toast } from '@/components/toast';

import { haptics } from './haptics';

/**
 * Delete with "Annulla", as Mail and Photos do instead of asking first: the item leaves the
 * list at once and is really deleted a few seconds later, unless the user taps "Annulla" in
 * the toast. Lists hide what is waiting with `usePendingDeletes()`.
 */
const UNDO_MS = 4500;
/**
 * How long what was deleted stays hidden after the write: the lists are still reading the data
 * again, and showing it now would bring it back for a moment, pushing the rows under it down and
 * up again.
 */
const REREAD_MS = 1500;

type Pending = { commit: () => Promise<void>; timer: ReturnType<typeof setTimeout>; written?: boolean };

const pending = new Map<string, Pending>();
let snapshot: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = new Set(pending.keys());
  for (const listener of listeners) listener();
}

async function commit(key: string): Promise<void> {
  const item = pending.get(key);
  if (!item || item.written) return;
  item.written = true;
  clearTimeout(item.timer);
  try {
    await item.commit();
  } finally {
    setTimeout(() => {
      pending.delete(key);
      emit();
    }, REREAD_MS);
  }
}

/** Runs every waiting delete now, e.g. when the app goes to the background. */
export function commitPendingDeletes(): void {
  for (const key of [...pending.keys()]) void commit(key);
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') commitPendingDeletes();
});

type DeleteOptions = {
  /** Identifies the item in its list, e.g. "program:3". */
  key: string;
  /** Shown in the toast, e.g. "Scheda eliminata". */
  title: string;
  icon?: SFSymbol;
  /** The real delete. */
  run: () => Promise<void>;
};

export function deleteWithUndo({ key, title, icon = 'trash', run }: DeleteOptions): void {
  // Only the last delete can be undone: the ones before it go ahead now.
  commitPendingDeletes();
  pending.set(key, { commit: run, timer: setTimeout(() => void commit(key), UNDO_MS) });
  emit();
  toast.show(title, icon, {
    label: 'Annulla',
    onPress: () => {
      const item = pending.get(key);
      if (!item || item.written) return;
      clearTimeout(item.timer);
      pending.delete(key);
      emit();
      haptics.success();
    },
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keys of the items deleted but still undoable, to leave out of lists. */
export function usePendingDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot);
}
