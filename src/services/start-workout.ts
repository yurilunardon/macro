import type { useRouter } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { forgetLiveQuery, prefetchLiveQuery } from '@/db/live';
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

/** Brings back the workout in progress, at once; what it reads ahead is there if it arrives in time. */
export function openActiveWorkout(db: SQLiteDatabase, router: ReturnType<typeof useRouter>): void {
  void prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  router.push('/workout');
}

/**
 * Starts a workout of a day of the program and opens it; one already running is opened instead.
 * Without a day it takes `name`, e.g. the "Push" planned in the calendar.
 *
 * The sheet goes first: writing the workout takes a good part of a second, and waiting for it left
 * the tap without an answer. The sheet rises with the workout's name and fills as it lands.
 */
export async function startAndOpenWorkout(db: SQLiteDatabase, router: ReturnType<typeof useRouter>, dayId: number | null, name: string): Promise<void> {
  if (await getActiveWorkout(db)) {
    openActiveWorkout(db, router);
    return;
  }
  const started = Date.now();
  haptics.success();
  setStarting(true);
  // What it showed last is another workout, or none.
  forgetLiveQuery(ACTIVE_WORKOUT_KEY);
  router.push({ pathname: '/workout', params: { title: name } });
  try {
    await startWorkout(db, { dayId, name });
  } finally {
    setTimeout(() => setStarting(false), Math.max(0, COVERED_MS - (Date.now() - started)));
  }
}
