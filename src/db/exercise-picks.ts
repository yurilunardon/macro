import type { SQLiteDatabase } from 'expo-sqlite';

import type { Exercise } from './exercises';
import { addDayExercise, DEFAULT_PLAN } from './programs';
import { addWorkoutExercise, replaceWorkoutExercise } from './workouts';

/** Where the exercise picker puts its choice: a day of a program, the workout, or in place of one. */
export type PickerTarget = 'day' | 'workout' | 'replace';

export function isPickerTarget(value: unknown): value is PickerTarget {
  return value === 'day' || value === 'workout' || value === 'replace';
}

/** Adds the chosen exercise to a day of a program or to the workout, or swaps one in the workout. */
export async function applyPick(db: SQLiteDatabase, target: PickerTarget, id: number, exercise: Exercise): Promise<void> {
  if (target === 'day') {
    await addDayExercise(db, id, exercise.id, exercise.kind === 'time' ? { ...DEFAULT_PLAN, repMin: 30, repMax: 60 } : DEFAULT_PLAN);
  } else if (target === 'workout') {
    await addWorkoutExercise(db, id, exercise.id);
  } else {
    await replaceWorkoutExercise(db, id, exercise.id);
  }
}

