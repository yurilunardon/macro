import type { SQLiteDatabase } from 'expo-sqlite';

import type { EntryRow, FoodRow } from '@/lib/backup';
import type { DateKey } from '@/lib/dates';
import { nextDose, sameMoment, sameProduct } from '@/lib/links';
import { mealForClock } from '@/lib/meals';
import { scaleNutrients } from '@/lib/nutrition';
import { clockOf } from '@/lib/plan';

import { foodFromRow } from './foods';
import { notifyChange } from './live';

/**
 * A supplement that is also a food, such as a whey shake, is one thing in two places: logged in
 * the diary it is ticked among the supplements, ticked there it is in the diary with the amount
 * last logged. Only plain SQL here, so neither side calls the other back.
 */

type SupplementName = { id: number; name: string; schedule: string; times_per_day: number };

async function supplementFor(db: SQLiteDatabase, food: string): Promise<SupplementName | null> {
  const rows = await db.getAllAsync<SupplementName>('SELECT id, name, schedule, times_per_day FROM supplements WHERE archived = 0 ORDER BY position, id');
  return rows.find((s) => sameProduct(s.name, food)) ?? null;
}

/** A food just logged: the supplement it is gets its next dose of that day ticked, at the same time. */
export async function tickDoseForEntry(db: SQLiteDatabase, entry: Pick<EntryRow, 'date' | 'name' | 'created_at'>): Promise<void> {
  const supplement = await supplementFor(db, entry.name);
  if (!supplement) return;
  const doses = await db.getAllAsync<{ dose_index: number; taken_at: string }>(
    'SELECT dose_index, taken_at FROM supplement_doses WHERE supplement_id = ? AND date = ?',
    supplement.id,
    entry.date,
  );
  // Ticked a moment ago, and that is what logged this food.
  if (doses.some((d) => sameMoment(d.taken_at, entry.created_at))) return;
  const index = nextDose(
    doses.map((d) => d.dose_index),
    supplement.times_per_day,
    supplement.schedule === 'asNeeded',
  );
  if (index === null) return;
  await db.runAsync(
    'INSERT OR IGNORE INTO supplement_doses (supplement_id, date, dose_index, taken_at) VALUES (?, ?, ?, ?)',
    supplement.id,
    entry.date,
    index,
    entry.created_at,
  );
  await db.runAsync('UPDATE supplement_day SET skipped = NULL WHERE supplement_id = ? AND date = ? AND dose_index = ?', supplement.id, entry.date, index);
  notifyChange('calendar');
}

/** A food taken out of the diary: the dose it ticked is unticked. */
export async function untickDoseForEntry(db: SQLiteDatabase, entry: Pick<EntryRow, 'date' | 'name' | 'created_at'>): Promise<void> {
  const supplement = await supplementFor(db, entry.name);
  if (!supplement) return;
  const doses = await db.getAllAsync<{ dose_index: number; taken_at: string }>(
    'SELECT dose_index, taken_at FROM supplement_doses WHERE supplement_id = ? AND date = ?',
    supplement.id,
    entry.date,
  );
  const dose = doses.find((d) => sameMoment(d.taken_at, entry.created_at));
  if (!dose) return;
  await db.runAsync('DELETE FROM supplement_doses WHERE supplement_id = ? AND date = ? AND dose_index = ?', supplement.id, entry.date, dose.dose_index);
  notifyChange('calendar');
}

/**
 * A dose just ticked: if the supplement is a food, the last amount logged of it goes in the diary
 * that day, in the meal of the time it was taken. Nothing if that food was never logged.
 */
export async function logEntryForDose(db: SQLiteDatabase, supplementId: number, date: DateKey, takenAt: string): Promise<void> {
  const supplement = await db.getFirstAsync<{ name: string; dose: number; unit: string }>('SELECT name, dose, unit FROM supplements WHERE id = ?', supplementId);
  if (!supplement) return;
  const sameDay = await db.getAllAsync<EntryRow>('SELECT * FROM entries WHERE date = ?', date);
  if (sameDay.some((e) => sameProduct(supplement.name, e.name) && sameMoment(e.created_at, takenAt))) return;
  const recent = await db.getAllAsync<EntryRow>('SELECT * FROM entries WHERE food_id IS NOT NULL AND quantity > 0 ORDER BY id DESC LIMIT 400');
  const last = recent.find((e) => sameProduct(supplement.name, e.name)) ?? (await fromFoods(db, supplement));
  if (!last) return;
  await db.runAsync(
    `INSERT INTO entries (date, meal, food_id, name, brand, unit, quantity, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    date,
    mealForClock(clockOf(takenAt)),
    last.food_id,
    last.name,
    last.brand,
    last.unit,
    last.quantity,
    last.kcal,
    last.protein,
    last.carbs,
    last.fat,
    last.sugars,
    last.fiber,
    last.sat_fat,
    last.salt,
    takenAt,
  );
  notifyChange('food');
}

/**
 * Never logged yet: the saved food of the same name, as much as a dose, when the dose is in grams
 * or millilitres or the food says how much a serving is.
 */
async function fromFoods(db: SQLiteDatabase, supplement: { name: string; dose: number; unit: string }): Promise<Omit<EntryRow, 'id' | 'date' | 'meal' | 'created_at'> | null> {
  const first = supplement.name.split(/\s+/).find((w) => w.length >= 3);
  if (!first) return null;
  const rows = await db.getAllAsync<FoodRow>('SELECT * FROM foods WHERE name LIKE ? ORDER BY id DESC LIMIT 50', `%${first}%`);
  const row = rows.find((r) => sameProduct(supplement.name, r.name));
  if (!row) return null;
  const food = foodFromRow(row);
  const quantity = supplement.unit === food.unit ? supplement.dose : food.servingSize;
  if (!quantity) return null;
  const n = scaleNutrients(food.per100, quantity);
  return {
    food_id: food.id,
    name: food.name,
    brand: food.brand,
    unit: food.unit,
    quantity,
    kcal: n.kcal,
    protein: n.protein,
    carbs: n.carbs,
    fat: n.fat,
    sugars: n.sugars,
    fiber: n.fiber,
    sat_fat: n.satFat,
    salt: n.salt,
  };
}

/** A dose unticked: the food it put in the diary goes. */
export async function removeEntryForDose(db: SQLiteDatabase, supplementId: number, date: DateKey, takenAt: string): Promise<void> {
  const supplement = await db.getFirstAsync<{ name: string }>('SELECT name FROM supplements WHERE id = ?', supplementId);
  if (!supplement) return;
  const sameDay = await db.getAllAsync<EntryRow>('SELECT * FROM entries WHERE date = ?', date);
  const entry = sameDay.find((e) => sameProduct(supplement.name, e.name) && sameMoment(e.created_at, takenAt));
  if (!entry) return;
  await db.runAsync('DELETE FROM entries WHERE id = ?', entry.id);
  notifyChange('food');
}
