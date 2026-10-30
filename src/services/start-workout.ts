import type { useRouter } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';

import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { prefetchLiveQuery } from '@/db/live';
import { getActiveWorkout, startWorkout } from '@/db/workouts';

import { haptics } from './haptics';

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
  if (!(await getActiveWorkout(db))) {
    await startWorkout(db, { dayId, name });
    haptics.success();
  }
  // The sheet rises with the exercises already in it.
  await prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  router.push('/workout');
}
