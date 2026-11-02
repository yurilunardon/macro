import type { useRouter } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { prefetchLiveQuery } from '@/db/live';
import { getActiveWorkout, startWorkout } from '@/db/workouts';

import { haptics } from './haptics';

/** About how long the workout's sheet takes to cover what is under it. */
const COVERED_MS = 700;

let starting = false;
const listeners = new Set<() => void>();

function setStarting(value: boolean): void {
  starting = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True from the tap on "Inizia" until the workout's sheet has covered the page. What shows the
 * workout in progress waits for it: changing under the rising sheet, the page and the bar made
 * the start look like a series of jumps.
 */
export function useWorkoutStarting(): boolean {
  return useSyncExternalStore(subscribe, () => starting);
}

/** Brings back the workout in progress, its sheet rising already filled. */
export async function openActiveWorkout(db: SQLiteDatabase, router: ReturnType<typeof useRouter>): Promise<void> {
  await prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  router.push('/workout');
}

/**
 * Starts a workout of a day of the program and opens it; one already running is opened instead.
 * Without a day it takes `name`, e.g. the "Push" planned in the calendar.
 */
export async function startAndOpenWorkout(
  db: SQLiteDatabase,
  router: ReturnType<typeof useRouter>,
  dayId: number | null,
  name: string | null = null,
): Promise<void> {
  const fresh = !(await getActiveWorkout(db));
  if (fresh) {
    haptics.success();
    setStarting(true);
  }
  try {
    if (fresh) await startWorkout(db, { dayId, name });
    // The sheet rises with the exercises already in it.
    await prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
    router.push('/workout');
  } finally {
    if (fresh) setTimeout(() => setStarting(false), COVERED_MS);
  }
}
