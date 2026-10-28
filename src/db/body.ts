import type { SQLiteDatabase } from 'expo-sqlite';

import type { WeightRow } from '@/lib/backup';
import type { DateKey } from '@/lib/dates';

import { notifyChange } from './live';

export type Weight = WeightRow;

/** One weight per day: logging again on the same day replaces it. */
export async function setWeight(db: SQLiteDatabase, date: DateKey, kg: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO weights (date, kg) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET kg = excluded.kg',
    date,
    kg,
  );
  notifyChange('body');
}

export async function deleteWeight(db: SQLiteDatabase, date: DateKey): Promise<void> {
  await db.runAsync('DELETE FROM weights WHERE date = ?', date);
  notifyChange('body');
}

/** Weights from `from` onwards, oldest first. */
export async function getWeightsSince(db: SQLiteDatabase, from: DateKey): Promise<Weight[]> {
  return db.getAllAsync<Weight>('SELECT date, kg FROM weights WHERE date >= ? ORDER BY date', from);
}

export async function getLatestWeight(db: SQLiteDatabase): Promise<Weight | null> {
  return db.getFirstAsync<Weight>('SELECT date, kg FROM weights ORDER BY date DESC LIMIT 1');
}

/** The weight of a day, or the last one logged before it; null when there is none up to that day. */
export async function getWeightUpTo(db: SQLiteDatabase, date: DateKey): Promise<Weight | null> {
  return db.getFirstAsync<Weight>('SELECT date, kg FROM weights WHERE date <= ? ORDER BY date DESC LIMIT 1', date);
}
