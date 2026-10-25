import type { SQLiteDatabase } from 'expo-sqlite';

import type { FastRow } from '@/lib/backup';
import type { Fast } from '@/lib/fasting';

import { notifyChange } from './live';

function fastFromRow(row: FastRow): Fast {
  return { id: row.id, start: row.start, end: row.end, goalHours: row.goal_hours };
}

/** The fast in progress, if any. */
export async function getActiveFast(db: SQLiteDatabase): Promise<Fast | null> {
  const row = await db.getFirstAsync<FastRow>('SELECT * FROM fasts WHERE end IS NULL ORDER BY start DESC LIMIT 1');
  return row ? fastFromRow(row) : null;
}

/** Finished fasts, newest first. */
export async function getFastHistory(db: SQLiteDatabase, limit = 30): Promise<Fast[]> {
  const rows = await db.getAllAsync<FastRow>(
    'SELECT * FROM fasts WHERE end IS NOT NULL ORDER BY start DESC LIMIT ?',
    limit,
  );
  return rows.map(fastFromRow);
}

/** Starts a fast, ending any that was left running. */
export async function startFast(db: SQLiteDatabase, goalHours: number, start: Date = new Date()): Promise<number> {
  await db.runAsync('UPDATE fasts SET end = ? WHERE end IS NULL', start.toISOString());
  const result = await db.runAsync(
    'INSERT INTO fasts (start, end, goal_hours) VALUES (?, NULL, ?)',
    start.toISOString(),
    goalHours,
  );
  notifyChange();
  return result.lastInsertRowId;
}

export async function endFast(db: SQLiteDatabase, id: number, end: Date = new Date()): Promise<void> {
  await db.runAsync('UPDATE fasts SET end = ? WHERE id = ?', end.toISOString(), id);
  notifyChange();
}

/** Moves the start, for when the fast was started late in the app. */
export async function setFastStart(db: SQLiteDatabase, id: number, start: Date): Promise<void> {
  await db.runAsync('UPDATE fasts SET start = ? WHERE id = ?', start.toISOString(), id);
  notifyChange();
}

export async function deleteFast(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM fasts WHERE id = ?', id);
  notifyChange();
}
