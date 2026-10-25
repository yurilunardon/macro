import type { SQLiteDatabase } from 'expo-sqlite';

import type { EntryRow } from '@/lib/backup';
import type { DateKey } from '@/lib/dates';
import type { MealKey } from '@/lib/meals';
import { rescaleNutrients, scaleNutrients, type Food, type Nutrients, type Unit } from '@/lib/nutrition';

import { notifyChange } from './live';

export type Entry = {
  id: number;
  date: DateKey;
  meal: MealKey;
  foodId: number | null;
  name: string;
  brand: string | null;
  unit: Unit;
  quantity: number;
  totals: Nutrients;
  /** Typed as kcal and macros without a food ("aggiunta rapida"); stored with quantity 0. */
  quick: boolean;
};

export type DayTotals = { date: DateKey } & Pick<Nutrients, 'kcal' | 'protein' | 'carbs' | 'fat'>;

function entryFromRow(row: EntryRow): Entry {
  return {
    id: row.id,
    date: row.date,
    meal: row.meal as MealKey,
    foodId: row.food_id,
    name: row.name,
    brand: row.brand,
    unit: row.unit === 'ml' ? 'ml' : 'g',
    quantity: row.quantity,
    totals: {
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      sugars: row.sugars,
      fiber: row.fiber,
      satFat: row.sat_fat,
      salt: row.salt,
    },
    quick: row.food_id === null && row.quantity === 0,
  };
}

function totalsParams(n: Nutrients) {
  return [n.kcal, n.protein, n.carbs, n.fat, n.sugars, n.fiber, n.satFat, n.salt];
}

/**
 * Logs a food. The entry stores its own copy of name and totals, so later edits to the
 * food (or deleting it) never change past days.
 */
export async function addEntry(
  db: SQLiteDatabase,
  input: { date: DateKey; meal: MealKey; food: Food; quantity: number },
): Promise<number> {
  const totals = scaleNutrients(input.food.per100, input.quantity);
  const result = await db.runAsync(
    `INSERT INTO entries (date, meal, food_id, name, brand, unit, quantity, kcal, protein, carbs, fat,
       sugars, fiber, sat_fat, salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.date,
    input.meal,
    input.food.id,
    input.food.name,
    input.food.brand,
    input.food.unit,
    input.quantity,
    ...totalsParams(totals),
    new Date().toISOString(),
  );
  notifyChange();
  return result.lastInsertRowId;
}

/** Logs calories and macros directly, without choosing a food. */
export async function addQuickEntry(
  db: SQLiteDatabase,
  input: { date: DateKey; meal: MealKey; name: string; totals: Nutrients },
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO entries (date, meal, food_id, name, brand, unit, quantity, kcal, protein, carbs, fat,
       sugars, fiber, sat_fat, salt, created_at)
     VALUES (?, ?, NULL, ?, NULL, 'g', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.date,
    input.meal,
    input.name,
    ...totalsParams(input.totals),
    new Date().toISOString(),
  );
  notifyChange();
  return result.lastInsertRowId;
}

export async function updateQuickEntry(
  db: SQLiteDatabase,
  id: number,
  changes: { meal: MealKey; name: string; totals: Nutrients },
): Promise<void> {
  await db.runAsync(
    `UPDATE entries SET meal = ?, name = ?, kcal = ?, protein = ?, carbs = ?, fat = ?,
       sugars = ?, fiber = ?, sat_fat = ?, salt = ?
     WHERE id = ? AND food_id IS NULL AND quantity = 0`,
    changes.meal,
    changes.name,
    ...totalsParams(changes.totals),
    id,
  );
  notifyChange();
}

export async function getEntry(db: SQLiteDatabase, id: number): Promise<Entry | null> {
  const row = await db.getFirstAsync<EntryRow>('SELECT * FROM entries WHERE id = ?', id);
  return row ? entryFromRow(row) : null;
}

export async function getEntriesForDate(db: SQLiteDatabase, date: DateKey): Promise<Entry[]> {
  const rows = await db.getAllAsync<EntryRow>('SELECT * FROM entries WHERE date = ? ORDER BY created_at, id', date);
  return rows.map(entryFromRow);
}

/** Changes quantity and meal. Totals are rescaled from the entry's own values. */
export async function updateEntry(
  db: SQLiteDatabase,
  entry: Entry,
  changes: { quantity: number; meal: MealKey },
): Promise<void> {
  const totals = rescaleNutrients(entry.totals, entry.quantity, changes.quantity);
  await db.runAsync(
    `UPDATE entries SET meal = ?, quantity = ?, kcal = ?, protein = ?, carbs = ?, fat = ?,
       sugars = ?, fiber = ?, sat_fat = ?, salt = ?
     WHERE id = ?`,
    changes.meal,
    changes.quantity,
    ...totalsParams(totals),
    entry.id,
  );
  notifyChange();
}

export async function deleteEntry(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM entries WHERE id = ?', id);
  notifyChange();
}

/** Copies every entry of one meal to another day (for example "same breakfast as yesterday"). */
export async function copyMeal(
  db: SQLiteDatabase,
  from: { date: DateKey; meal: MealKey },
  to: { date: DateKey; meal: MealKey },
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO entries (date, meal, food_id, name, brand, unit, quantity, kcal, protein, carbs, fat,
       sugars, fiber, sat_fat, salt, created_at)
     SELECT ?, ?, food_id, name, brand, unit, quantity, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt, ?
     FROM entries WHERE date = ? AND meal = ? ORDER BY created_at, id`,
    to.date,
    to.meal,
    new Date().toISOString(),
    from.date,
    from.meal,
  );
  notifyChange();
  return result.changes;
}

export async function countMealEntries(db: SQLiteDatabase, date: DateKey, meal: MealKey): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM entries WHERE date = ? AND meal = ?',
    date,
    meal,
  );
  return row?.n ?? 0;
}

/** Daily sums between two days, inclusive. Days without entries are missing from the result. */
export async function getDailyTotals(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<DayTotals[]> {
  return db.getAllAsync<DayTotals>(
    `SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat
     FROM entries WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
    from,
    to,
  );
}
