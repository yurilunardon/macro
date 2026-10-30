import type { SQLiteDatabase } from 'expo-sqlite';

import type { WeightRow } from '@/lib/backup';
import type { DateKey } from '@/lib/dates';

import { notifyChange } from './live';

export type Weight = WeightRow;

/**
 * One weight per day: logging again on the same day replaces it. `loggedAt` is when it was
 * logged, kept for a weigh-in of the day itself so the calendar can say at what time it was.
 */
export async function setWeight(db: SQLiteDatabase, date: DateKey, kg: number, loggedAt: string | null = null): Promise<void> {
  await db.runAsync(
    'INSERT INTO weights (date, kg, logged_at) VALUES (?, ?, ?) ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, logged_at = excluded.logged_at',
    date,
    kg,
    loggedAt,
  );
  notifyChange('body');
}

export async function deleteWeight(db: SQLiteDatabase, date: DateKey): Promise<void> {
  await db.runAsync('DELETE FROM weights WHERE date = ?', date);
  notifyChange('body');
}

/** Weights from `from` onwards, oldest first. */
export async function getWeightsSince(db: SQLiteDatabase, from: DateKey): Promise<Weight[]> {
  return db.getAllAsync<Weight>('SELECT date, kg, logged_at FROM weights WHERE date >= ? ORDER BY date', from);
}

/** The weigh-in of one day, if there was one. */
export async function getWeightOn(db: SQLiteDatabase, date: DateKey): Promise<Weight | null> {
  return db.getFirstAsync<Weight>('SELECT date, kg, logged_at FROM weights WHERE date = ?', date);
}

export async function getLatestWeight(db: SQLiteDatabase): Promise<Weight | null> {
  return db.getFirstAsync<Weight>('SELECT date, kg, logged_at FROM weights ORDER BY date DESC LIMIT 1');
}

/** The weight of a day, or the last one logged before it; null when there is none up to that day. */
export async function getWeightUpTo(db: SQLiteDatabase, date: DateKey): Promise<Weight | null> {
  return db.getFirstAsync<Weight>('SELECT date, kg, logged_at FROM weights WHERE date <= ? ORDER BY date DESC LIMIT 1', date);
}
