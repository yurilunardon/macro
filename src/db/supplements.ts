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
  type DoseChange,
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
  times: string | null;
  every_days: number | null;
  once_on: string | null;
  remind: number | null;
  contents: string | null;
  note: string | null;
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
    // An older backup may still say "alternate"; it is restored as every 2 days.
    schedule: row.schedule === 'alternate' ? 'every' : isSchedule(row.schedule) ? row.schedule : 'daily',
    weekdays: row.weekdays
      .split(',')
      .filter((d) => d !== '')
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    everyDays: row.schedule === 'alternate' ? 2 : row.every_days,
    onceOn: row.once_on,
    times: timesFrom(row.times) ?? (row.reminder ? [row.reminder] : []),
    remind: row.remind !== 0,
    contents: row.contents,
    note: row.note,
    packageAmount: row.package_amount,
    packagePrice: row.package_price,
    position: row.position,
    archived: row.archived === 1,
    startedOn: row.started_on,
  };
}

/** "07:30,19:00" as a list; null for one with no times yet. */
function timesFrom(text: string | null): string[] | null {
  if (text === null) return null;
  return text.split(',').filter((t) => /^\d{2}:\d{2}$/.test(t));
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
  'name' | 'dose' | 'unit' | 'schedule' | 'weekdays' | 'times' | 'packageAmount' | 'packagePrice'
> &
  Partial<Pick<Supplement, 'everyDays' | 'onceOn' | 'remind' | 'contents' | 'note'>>;

/** Empty text is stored as null. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function timesText(times: readonly string[]): string {
  return [...new Set(times)].sort().join(',');
}

function weekdaysText(weekdays: readonly number[]): string {
  return [...new Set(weekdays)].sort((a, b) => a - b).join(',');
}

/** From `today`: the days before it were not due. */
export async function addSupplement(db: SQLiteDatabase, input: SupplementInput, today: DateKey): Promise<number> {
  const last = await db.getFirstAsync<{ p: number | null }>('SELECT MAX(position) AS p FROM supplements');
  const result = await db.runAsync(
    `INSERT INTO supplements (name, dose, unit, times_per_day, schedule, weekdays, times, every_days, once_on, remind, contents, note,
       package_amount, package_price, position, archived, started_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    input.name.trim(),
    input.dose,
    input.unit,
    Math.max(1, input.times.length),
    input.schedule,
    weekdaysText(input.weekdays),
    timesText(input.times),
    input.everyDays ?? null,
    input.onceOn ?? null,
    input.remind === false ? 0 : 1,
    text(input.contents),
    text(input.note),
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
    `UPDATE supplements SET name = ?, dose = ?, unit = ?, times_per_day = ?, schedule = ?, weekdays = ?, times = ?,
       every_days = ?, once_on = ?, remind = ?, contents = ?, note = ?, package_amount = ?, package_price = ? WHERE id = ?`,
    input.name.trim(),
    input.dose,
    input.unit,
    Math.max(1, input.times.length),
    input.schedule,
    weekdaysText(input.weekdays),
    timesText(input.times),
    input.everyDays ?? null,
    input.onceOn ?? null,
    input.remind === false ? 0 : 1,
    text(input.contents),
    text(input.note),
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
  else await db.runAsync('UPDATE supplements SET archived = 1, remind = 0 WHERE id = ?', id);
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

/** When each dose of a day was ticked, as "id:index" → ISO date and time. */
export async function getDoseTimes(db: SQLiteDatabase, date: DateKey): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ supplement_id: number; dose_index: number; taken_at: string }>(
    'SELECT supplement_id, dose_index, taken_at FROM supplement_doses WHERE date = ?',
    date,
  );
  return new Map(rows.map((r) => [`${r.supplement_id}:${r.dose_index}`, r.taken_at]));
}

/** Ticks or unticks the `index`-th dose of a day; `at` when it was taken at another time than now. */
export async function setDoseTaken(db: SQLiteDatabase, supplementId: number, date: DateKey, index: number, taken: boolean, at?: string): Promise<void> {
  if (taken) {
    await db.runAsync(
      `INSERT INTO supplement_doses (supplement_id, date, dose_index, taken_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (supplement_id, date, dose_index) DO UPDATE SET taken_at = excluded.taken_at`,
      supplementId,
      date,
      index,
      at ?? new Date().toISOString(),
    );
    // Taken after all: no longer skipped.
    await db.runAsync('UPDATE supplement_day SET skipped = NULL WHERE supplement_id = ? AND date = ? AND dose_index = ?', supplementId, date, index);
  } else {
    await db.runAsync('DELETE FROM supplement_doses WHERE supplement_id = ? AND date = ? AND dose_index = ?', supplementId, date, index);
  }
  notifyChange('calendar');
}

/** Ticks these doses of a day, e.g. from a notification's "Fatto". */
export async function takeDoses(db: SQLiteDatabase, doses: readonly { id: number; index: number }[], date: DateKey): Promise<number> {
  const now = new Date().toISOString();
  for (const { id, index } of doses) {
    await db.runAsync('INSERT OR IGNORE INTO supplement_doses (supplement_id, date, dose_index, taken_at) VALUES (?, ?, ?, ?)', id, date, index, now);
  }
  notifyChange('calendar');
  return doses.length;
}

/** Doses ticked from `from` to `to`, as "id:date:index". */
export async function getDoseKeys(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ supplement_id: number; date: string; dose_index: number }>(
    'SELECT supplement_id, date, dose_index FROM supplement_doses WHERE date BETWEEN ? AND ?',
    from,
    to,
  );
  return new Set(rows.map((r) => `${r.supplement_id}:${r.date}:${r.dose_index}`));
}

/** The doses changed for one day only, from `from` to `to`, as "id:date:index". */
export async function getDoseChanges(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<Map<string, DoseChange>> {
  const rows = await db.getAllAsync<{ supplement_id: number; date: string; dose_index: number; time: string | null; skipped: number | null }>(
    'SELECT supplement_id, date, dose_index, time, skipped FROM supplement_day WHERE date BETWEEN ? AND ?',
    from,
    to,
  );
  return new Map(rows.map((r) => [`${r.supplement_id}:${r.date}:${r.dose_index}`, { time: r.time, skipped: r.skipped === 1 }]));
}

/** A dose at another time, that day only; null back to its usual one. */
export async function setDoseTime(db: SQLiteDatabase, supplementId: number, date: DateKey, index: number, time: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO supplement_day (supplement_id, date, dose_index, time) VALUES (?, ?, ?, ?)
     ON CONFLICT (supplement_id, date, dose_index) DO UPDATE SET time = excluded.time`,
    supplementId,
    date,
    index,
    time,
  );
  notifyChange('calendar');
}

export async function setDoseSkipped(db: SQLiteDatabase, supplementId: number, date: DateKey, index: number, skipped: boolean): Promise<void> {
  await db.runAsync(
    `INSERT INTO supplement_day (supplement_id, date, dose_index, skipped) VALUES (?, ?, ?, ?)
     ON CONFLICT (supplement_id, date, dose_index) DO UPDATE SET skipped = excluded.skipped`,
    supplementId,
    date,
    index,
    skipped ? 1 : null,
  );
  notifyChange('calendar');
}

/** From now on at this time: its usual one, in place of the dose's. */
export async function setUsualTime(db: SQLiteDatabase, supplementId: number, index: number, time: string): Promise<void> {
  const row = await db.getFirstAsync<SupplementRow>('SELECT * FROM supplements WHERE id = ?', supplementId);
  if (!row) return;
  const times = supplementFromRow(row).times;
  times[Math.min(index, Math.max(0, times.length - 1))] = time;
  await db.runAsync('UPDATE supplements SET times = ? WHERE id = ?', timesText(times), supplementId);
  notifyChange('calendar');
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
