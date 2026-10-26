import type { SQLiteDatabase } from 'expo-sqlite';

import type { DateKey } from '@/lib/dates';
import { isMeasurementKind, type Measurement, type MeasurementKind } from '@/lib/measurements';

import { notifyChange } from './live';

/** Saves the measurements of one day; null removes a value. */
export async function setMeasurements(
  db: SQLiteDatabase,
  date: DateKey,
  values: Partial<Record<MeasurementKind, number | null>>,
): Promise<void> {
  for (const [kind, value] of Object.entries(values)) {
    if (value === null || value === undefined) {
      await db.runAsync('DELETE FROM measurements WHERE date = ? AND kind = ?', date, kind);
    } else {
      await db.runAsync(
        `INSERT INTO measurements (date, kind, value) VALUES (?, ?, ?)
         ON CONFLICT (date, kind) DO UPDATE SET value = excluded.value`,
        date,
        kind,
        value,
      );
    }
  }
  notifyChange('body');
}

export async function getMeasurements(db: SQLiteDatabase): Promise<Measurement[]> {
  const rows = await db.getAllAsync<{ date: string; kind: string; value: number }>(
    'SELECT date, kind, value FROM measurements ORDER BY date, kind',
  );
  return rows.flatMap((r) => (isMeasurementKind(r.kind) ? [{ date: r.date, kind: r.kind, value: r.value }] : []));
}

export async function deleteMeasurementsOn(db: SQLiteDatabase, date: DateKey): Promise<void> {
  await db.runAsync('DELETE FROM measurements WHERE date = ?', date);
  notifyChange('body');
}
