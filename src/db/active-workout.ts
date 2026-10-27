import type { SQLiteDatabase } from 'expo-sqlite';

import type { Topic } from './live';
import { getSetting } from './settings';
import { getActiveWorkout, getWorkout } from './workouts';

/** The query of the workout sheet, shared so the screens that open it can run it ahead. */
export const ACTIVE_WORKOUT_KEY = 'workout:active';
export const ACTIVE_WORKOUT_TOPICS: readonly Topic[] = ['training', 'settings'];

export async function loadActiveWorkout(db: SQLiteDatabase) {
  const active = await getActiveWorkout(db);
  const [workout, restAlert] = await Promise.all([active ? getWorkout(db, active.id) : Promise.resolve(null), getSetting(db, 'restAlert')]);
  return { workout, sound: restAlert === 'sound' };
}
