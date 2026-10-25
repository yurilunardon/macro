import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toCsv } from '@/lib/csv';
import { todayKey } from '@/lib/dates';
import { MEASUREMENTS } from '@/lib/measurements';
import { mealLabel } from '@/lib/meals';

import { getEntriesBetween } from './entries';
import { getMeasurements } from './measurements';

async function share(name: string, content: string): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  return 'shared';
}

/** Every diary entry, one row each, for a spreadsheet. */
export async function exportDiaryCsv(db: SQLiteDatabase): Promise<'shared' | 'unavailable'> {
  const entries = await getEntriesBetween(db, '0000-01-01', '9999-12-31');
  const csv = toCsv(
    ['Data', 'Pasto', 'Alimento', 'Marca', 'Quantità', 'Unità', 'kcal', 'Proteine (g)', 'Carboidrati (g)', 'di cui zuccheri (g)', 'Grassi (g)', 'di cui saturi (g)', 'Fibre (g)', 'Sale (g)'],
    entries.map((e) => [
      e.date,
      mealLabel(e.meal),
      e.name,
      e.brand,
      e.quick ? null : e.quantity,
      e.quick ? null : e.unit,
      e.totals.kcal,
      e.totals.protein,
      e.totals.carbs,
      e.totals.sugars,
      e.totals.fat,
      e.totals.satFat,
      e.totals.fiber,
      e.totals.salt,
    ]),
  );
  return share(`macro-diario-${todayKey()}.csv`, csv);
}

/** Weight and body measurements by day, one column each. */
export async function exportBodyCsv(db: SQLiteDatabase): Promise<'shared' | 'unavailable'> {
  const [weights, measurements] = await Promise.all([
    db.getAllAsync<{ date: string; kg: number }>('SELECT date, kg FROM weights'),
    getMeasurements(db),
  ]);
  const dates = [...new Set([...weights.map((w) => w.date), ...measurements.map((m) => m.date)])].sort();
  const csv = toCsv(
    ['Data', 'Peso (kg)', ...MEASUREMENTS.map((m) => `${m.label} (${m.unit})`)],
    dates.map((date) => [
      date,
      weights.find((w) => w.date === date)?.kg ?? null,
      ...MEASUREMENTS.map((m) => measurements.find((r) => r.date === date && r.kind === m.kind)?.value ?? null),
    ]),
  );
  return share(`macro-peso-misure-${todayKey()}.csv`, csv);
}
