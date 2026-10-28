import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, type DateKey } from '@/lib/dates';
import type { DoseTick } from '@/lib/timeline';
import {
  daysLeft,
  dosesPerDay,
  isDoseUnit,
  isSchedule,
  monthlyCost,
  recentWindow,
  stockLeft,
  type Purchase,
  type Supplement,
} from '@/lib/supplements';

import { notifyChange } from './live';

type SupplementRow = {
  id: number;
  name: string;
  dose: number;
  unit: string;
  times_per_day: number;
  schedule: string;
  weekdays: string;
  reminder: string | null;
  package_amount: number | null;
  package_price: number | null;
  position: number;
  archived: number;
  started_on: string;
};

type PurchaseRow = { id: number; supplement_id: number; date: string; amount: number; price: number };

function supplementFromRow(row: SupplementRow): Supplement {
  return {
    id: row.id,
    name: row.name,
    dose: row.dose,
    unit: isDoseUnit(row.unit) ? row.unit : 'g',
    timesPerDay: Math.max(1, row.times_per_day),
    schedule: isSchedule(row.schedule) ? row.schedule : 'daily',
    weekdays: row.weekdays
      .split(',')
      .filter((d) => d !== '')
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    reminder: row.reminder,
    packageAmount: row.package_amount,
    packagePrice: row.package_price,
    position: row.position,
    archived: row.archived === 1,
    startedOn: row.started_on,
  };
}

function purchaseFromRow(row: PurchaseRow): Purchase {
  return { id: row.id, supplementId: row.supplement_id, date: row.date, amount: row.amount, price: row.price };
}

/** The supplements in use, in the user's order; with `archived`, the deleted ones too (for the past). */
export async function getSupplements(db: SQLiteDatabase, { archived = false }: { archived?: boolean } = {}): Promise<Supplement[]> {
  const rows = await db.getAllAsync<SupplementRow>(
    `SELECT * FROM supplements ${archived ? '' : 'WHERE archived = 0'} ORDER BY position, id`,
  );
  return rows.map(supplementFromRow);
}

export async function getSupplement(db: SQLiteDatabase, id: number): Promise<Supplement | null> {
  const row = await db.getFirstAsync<SupplementRow>('SELECT * FROM supplements WHERE id = ?', id);
  return row ? supplementFromRow(row) : null;
}

export type SupplementInput = Pick<
  Supplement,
  'name' | 'dose' | 'unit' | 'timesPerDay' | 'schedule' | 'weekdays' | 'reminder' | 'packageAmount' | 'packagePrice'
>;

function weekdaysText(weekdays: readonly number[]): string {
  return [...new Set(weekdays)].sort((a, b) => a - b).join(',');
}

/** From `today`: the days before it were not due. */
export async function addSupplement(db: SQLiteDatabase, input: SupplementInput, today: DateKey): Promise<number> {
  const last = await db.getFirstAsync<{ p: number | null }>('SELECT MAX(position) AS p FROM supplements');
  const result = await db.runAsync(
    `INSERT INTO supplements (name, dose, unit, times_per_day, schedule, weekdays, reminder, package_amount, package_price,
       position, archived, started_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    input.name.trim(),
    input.dose,
    input.unit,
    input.timesPerDay,
    input.schedule,
    weekdaysText(input.weekdays),
    input.reminder,
    input.packageAmount,
    input.packagePrice,
    (last?.p ?? -1) + 1,
    today,
    new Date().toISOString(),
  );
  notifyChange('calendar');
  return result.lastInsertRowId;
}

export async function updateSupplement(db: SQLiteDatabase, id: number, input: SupplementInput): Promise<void> {
  await db.runAsync(
    `UPDATE supplements SET name = ?, dose = ?, unit = ?, times_per_day = ?, schedule = ?, weekdays = ?, reminder = ?,
       package_amount = ?, package_price = ? WHERE id = ?`,
    input.name.trim(),
    input.dose,
    input.unit,
    input.timesPerDay,
    input.schedule,
    weekdaysText(input.weekdays),
    input.reminder,
    input.packageAmount,
    input.packagePrice,
    id,
  );
  notifyChange('calendar');
}

/** One never taken nor bought is deleted; otherwise it leaves the lists but stays in the reports. */
export async function deleteSupplement(db: SQLiteDatabase, id: number): Promise<void> {
  const used = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM supplement_doses WHERE supplement_id = ?) +
            (SELECT COUNT(*) FROM supplement_purchases WHERE supplement_id = ?) AS n`,
    id,
    id,
  );
  if ((used?.n ?? 0) === 0) await db.runAsync('DELETE FROM supplements WHERE id = ?', id);
  else await db.runAsync('UPDATE supplements SET archived = 1, reminder = NULL WHERE id = ?', id);
  notifyChange('calendar');
}

/** Doses ticked from `from` to `to`, as "id:date" → how many. */
export async function getDosesTaken(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ supplement_id: number; date: string; n: number }>(
    'SELECT supplement_id, date, COUNT(*) AS n FROM supplement_doses WHERE date BETWEEN ? AND ? GROUP BY supplement_id, date',
    from,
    to,
  );
  return new Map(rows.map((r) => [`${r.supplement_id}:${r.date}`, r.n]));
}

/** Ticks or unticks the `index`-th dose of a day. */
export async function setDoseTaken(db: SQLiteDatabase, supplementId: number, date: DateKey, index: number, taken: boolean): Promise<void> {
  if (taken) {
    await db.runAsync(
      'INSERT OR IGNORE INTO supplement_doses (supplement_id, date, dose_index, taken_at) VALUES (?, ?, ?, ?)',
      supplementId,
      date,
      index,
      new Date().toISOString(),
    );
  } else {
    await db.runAsync('DELETE FROM supplement_doses WHERE supplement_id = ? AND date = ? AND dose_index = ?', supplementId, date, index);
  }
  notifyChange('calendar');
}

/** Ticks every dose of a day of these supplements, e.g. from the reminder's "Segna come presi". */
export async function takeAllDoses(db: SQLiteDatabase, ids: readonly number[], date: DateKey): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;
  for (const id of ids) {
    const row = await db.getFirstAsync<{ times_per_day: number }>('SELECT times_per_day FROM supplements WHERE id = ?', id);
    if (!row) continue;
    for (let index = 0; index < row.times_per_day; index++) {
      await db.runAsync(
        'INSERT OR IGNORE INTO supplement_doses (supplement_id, date, dose_index, taken_at) VALUES (?, ?, ?, ?)',
        id,
        date,
        index,
        now,
      );
    }
    count++;
  }
  notifyChange('calendar');
  return count;
}

/** Which doses of each supplement were ticked on a day, as id → indexes. */
export async function getDosesOn(db: SQLiteDatabase, date: DateKey): Promise<Map<number, Set<number>>> {
  const rows = await db.getAllAsync<{ supplement_id: number; dose_index: number }>(
    'SELECT supplement_id, dose_index FROM supplement_doses WHERE date = ?',
    date,
  );
  const map = new Map<number, Set<number>>();
  for (const r of rows) {
    const set = map.get(r.supplement_id) ?? new Set<number>();
    set.add(r.dose_index);
    map.set(r.supplement_id, set);
  }
  return map;
}

export async function getPurchases(db: SQLiteDatabase, supplementId: number): Promise<Purchase[]> {
  const rows = await db.getAllAsync<PurchaseRow>(
    'SELECT id, supplement_id, date, amount, price FROM supplement_purchases WHERE supplement_id = ? ORDER BY date DESC, id DESC',
    supplementId,
  );
  return rows.map(purchaseFromRow);
}

export async function getPurchasesBetween(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<Purchase[]> {
  const rows = await db.getAllAsync<PurchaseRow>(
    'SELECT id, supplement_id, date, amount, price FROM supplement_purchases WHERE date BETWEEN ? AND ? ORDER BY date, id',
    from,
    to,
  );
  return rows.map(purchaseFromRow);
}

export async function addPurchase(db: SQLiteDatabase, purchase: Omit<Purchase, 'id'>): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO supplement_purchases (supplement_id, date, amount, price, created_at) VALUES (?, ?, ?, ?, ?)',
    purchase.supplementId,
    purchase.date,
    purchase.amount,
    purchase.price,
    new Date().toISOString(),
  );
  notifyChange('calendar');
  return result.lastInsertRowId;
}

export async function deletePurchase(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM supplement_purchases WHERE id = ?', id);
  notifyChange('calendar');
}

export type SupplementStock = {
  /** In the supplement's unit; null without purchases. */
  left: number | null;
  daysLeft: number | null;
  /** At the usual price and pace; null without a price. */
  monthly: number | null;
};

/** What is left of each supplement and what a month of it costs. */
export async function getSupplementStock(db: SQLiteDatabase, supplements: readonly Supplement[], today: DateKey): Promise<Map<number, SupplementStock>> {
  const [purchases, doses] = await Promise.all([
    db.getAllAsync<PurchaseRow>('SELECT id, supplement_id, date, amount, price FROM supplement_purchases'),
    db.getAllAsync<{ supplement_id: number; date: string }>('SELECT supplement_id, date FROM supplement_doses WHERE date <= ?', today),
  ]);
  const stock = new Map<number, SupplementStock>();
  for (const s of supplements) {
    const own = purchases.filter((p) => p.supplement_id === s.id).map(purchaseFromRow);
    const taken = doses.filter((d) => d.supplement_id === s.id);
    const days = recentWindow(s.startedOn, today);
    const since = addDays(today, -days + 1);
    const recent = { doses: taken.filter((d) => d.date >= since).length, days };
    const left = stockLeft(s, own, (from) => taken.filter((d) => d.date >= from).length);
    stock.set(s.id, { left, daysLeft: daysLeft(s, left, dosesPerDay(s, recent)), monthly: monthlyCost(s, recent) });
  }
  return stock;
}

/** Every dose ticked from `from` to `to`, with when it was ticked. */
export async function getDoseTicks(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<DoseTick[]> {
  const rows = await db.getAllAsync<{ supplement_id: number; date: string; taken_at: string }>(
    'SELECT supplement_id, date, taken_at FROM supplement_doses WHERE date BETWEEN ? AND ? ORDER BY taken_at',
    from,
    to,
  );
  return rows.map((r) => ({ supplementId: r.supplement_id, date: r.date, takenAt: r.taken_at }));
}
