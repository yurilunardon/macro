import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';

import { getSetting } from '@/db/settings';
import type { MealKey } from '@/lib/meals';

/**
 * Which meals are folded in the diary: the same on every day, and remembered. Kept in memory
 * and saved straight to the settings table, without the change feed, so folding a meal does not
 * make every day on screen read the database again.
 */
let collapsed: ReadonlySet<MealKey> = new Set();
let loaded = false;
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

async function load(db: SQLiteDatabase): Promise<void> {
  if (loaded) return;
  loaded = true;
  const saved = await getSetting(db, 'collapsedMeals');
  if (saved && saved.length > 0) {
    collapsed = new Set(saved);
    emit();
  }
}

export function toggleMeal(db: SQLiteDatabase, meal: MealKey): void {
  const next = new Set(collapsed);
  if (next.has(meal)) next.delete(meal);
  else next.add(meal);
  collapsed = next;
  emit();
  void db
    .runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      'collapsedMeals',
      JSON.stringify([...next]),
    )
    .catch(() => {});
}

export function useCollapsedMeals(db: SQLiteDatabase): ReadonlySet<MealKey> {
  useEffect(() => {
    void load(db);
  }, [db]);
  return useSyncExternalStore(subscribe, () => collapsed);
}
