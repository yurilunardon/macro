import type { SQLiteDatabase } from 'expo-sqlite';

import { weekdayOf, type DateKey } from '@/lib/dates';
import { dayTypeFor, type DayType, type Targets } from '@/lib/goals';

import { notifyChange } from './live';
import { deleteSetting, getSetting, getTargets, setSetting } from './settings';

/** Monday, Wednesday and Friday, until the user picks their own days. */
export const DEFAULT_TRAINING_WEEKDAYS = [1, 3, 5];

export type TrainingSettings = {
  /** null when every day has the same targets. */
  restTargets: Targets | null;
  trainingWeekdays: number[];
};

export type DayPlan = {
  targets: Targets;
  /** True while the user has not set any targets yet. */
  isDefault: boolean;
  /** null when training and rest days share the same targets. */
  dayType: DayType | null;
  /** True when the day was set by hand instead of following the weekly schedule. */
  overridden: boolean;
};

export async function getTrainingSettings(db: SQLiteDatabase): Promise<TrainingSettings> {
  const [restTargets, trainingWeekdays] = await Promise.all([
    getSetting(db, 'restTargets'),
    getSetting(db, 'trainingWeekdays'),
  ]);
  return { restTargets, trainingWeekdays: trainingWeekdays ?? DEFAULT_TRAINING_WEEKDAYS };
}

export async function setTrainingSettings(db: SQLiteDatabase, settings: TrainingSettings): Promise<void> {
  if (settings.restTargets) await setSetting(db, 'restTargets', settings.restTargets);
  else await deleteSetting(db, 'restTargets');
  await setSetting(db, 'trainingWeekdays', settings.trainingWeekdays);
}

/** Targets and kind of day for each date, oldest first. */
export async function getDayPlans(db: SQLiteDatabase, dates: readonly DateKey[]): Promise<Map<DateKey, DayPlan>> {
  const [{ targets, isDefault }, training] = await Promise.all([getTargets(db), getTrainingSettings(db)]);
  const plans = new Map<DateKey, DayPlan>();
  if (!training.restTargets) {
    for (const date of dates) plans.set(date, { targets, isDefault, dayType: null, overridden: false });
    return plans;
  }
  const overrides = new Map<string, DayType>();
  const workoutDays = new Set<string>();
  if (dates.length > 0) {
    const placeholders = dates.map(() => '?').join(', ');
    const [rows, workouts] = await Promise.all([
      db.getAllAsync<{ date: string; type: DayType }>(`SELECT date, type FROM day_types WHERE date IN (${placeholders})`, ...dates),
      db.getAllAsync<{ date: string }>(`SELECT DISTINCT date FROM workouts WHERE date IN (${placeholders})`, ...dates),
    ]);
    for (const row of rows) overrides.set(row.date, row.type);
    for (const row of workouts) workoutDays.add(row.date);
  }
  for (const date of dates) {
    const override = overrides.get(date) ?? null;
    // A day with a workout is a training day, unless it was set by hand.
    const dayType = dayTypeFor(weekdayOf(date), training.trainingWeekdays, override ?? (workoutDays.has(date) ? 'training' : null));
    plans.set(date, {
      targets: dayType === 'rest' ? training.restTargets : targets,
      isDefault,
      dayType,
      overridden: override !== null,
    });
  }
  return plans;
}

export async function getDayPlan(db: SQLiteDatabase, date: DateKey): Promise<DayPlan> {
  return (await getDayPlans(db, [date])).get(date) as DayPlan;
}

/** Marks a day as training or rest by hand; null goes back to the weekly schedule. */
export async function setDayType(db: SQLiteDatabase, date: DateKey, type: DayType | null): Promise<void> {
  if (type === null) {
    await db.runAsync('DELETE FROM day_types WHERE date = ?', date);
  } else {
    await db.runAsync(
      'INSERT INTO day_types (date, type) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET type = excluded.type',
      date,
      type,
    );
  }
  notifyChange();
}
