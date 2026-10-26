import type { SQLiteDatabase } from 'expo-sqlite';

import type { SavedMealItemRow, SavedMealRow } from '@/lib/backup';
import type { DateKey } from '@/lib/dates';
import type { MealKey } from '@/lib/meals';
import type { Nutrients, Unit } from '@/lib/nutrition';

import { notifyChange } from './live';

export type SavedMealItem = {
  id: number;
  foodId: number | null;
  name: string;
  brand: string | null;
  unit: Unit;
  /** 0 for a quick entry (calories typed by hand). */
  quantity: number;
  totals: Nutrients;
};

export type SavedMealSummary = {
  id: number;
  name: string;
  itemCount: number;
  totals: Pick<Nutrients, 'kcal' | 'protein' | 'carbs' | 'fat'>;
};

const ENTRY_VALUE_COLUMNS =
  'food_id, name, brand, unit, quantity, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt';

function itemFromRow(row: SavedMealItemRow): SavedMealItem {
  return {
    id: row.id,
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
  };
}

/** Saves what was logged in one meal of one day, to add it again later with one tap. */
export async function saveMealFromDiary(
  db: SQLiteDatabase,
  input: { date: DateKey; meal: MealKey; name: string },
): Promise<number> {
  let id = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      'INSERT INTO saved_meals (name, created_at) VALUES (?, ?)',
      input.name,
      new Date().toISOString(),
    );
    id = result.lastInsertRowId;
    await tx.runAsync(
      `INSERT INTO saved_meal_items (saved_meal_id, position, ${ENTRY_VALUE_COLUMNS})
       SELECT ?, ROW_NUMBER() OVER (ORDER BY created_at, id) - 1, ${ENTRY_VALUE_COLUMNS}
       FROM entries WHERE date = ? AND meal = ?`,
      id,
      input.date,
      input.meal,
    );
  });
  notifyChange('food');
  return id;
}

export async function getSavedMeals(db: SQLiteDatabase): Promise<SavedMealSummary[]> {
  const rows = await db.getAllAsync<
    SavedMealRow & { item_count: number; kcal: number; protein: number; carbs: number; fat: number }
  >(
    `SELECT m.id, m.name, m.created_at, COUNT(i.id) AS item_count,
       COALESCE(SUM(i.kcal), 0) AS kcal, COALESCE(SUM(i.protein), 0) AS protein,
       COALESCE(SUM(i.carbs), 0) AS carbs, COALESCE(SUM(i.fat), 0) AS fat
     FROM saved_meals m LEFT JOIN saved_meal_items i ON i.saved_meal_id = m.id
     GROUP BY m.id ORDER BY m.name COLLATE NOCASE`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    itemCount: r.item_count,
    totals: { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat },
  }));
}

export async function getSavedMeal(
  db: SQLiteDatabase,
  id: number,
): Promise<{ id: number; name: string; items: SavedMealItem[] } | null> {
  const meal = await db.getFirstAsync<SavedMealRow>('SELECT * FROM saved_meals WHERE id = ?', id);
  if (!meal) return null;
  const rows = await db.getAllAsync<SavedMealItemRow>(
    'SELECT * FROM saved_meal_items WHERE saved_meal_id = ? ORDER BY position, id',
    id,
  );
  return { id: meal.id, name: meal.name, items: rows.map(itemFromRow) };
}

/** Logs every item of a saved meal into a meal of a day. Returns how many entries were added. */
export async function addSavedMealToDiary(
  db: SQLiteDatabase,
  id: number,
  target: { date: DateKey; meal: MealKey },
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO entries (date, meal, ${ENTRY_VALUE_COLUMNS}, created_at)
     SELECT ?, ?, ${ENTRY_VALUE_COLUMNS}, ? FROM saved_meal_items WHERE saved_meal_id = ? ORDER BY position, id`,
    target.date,
    target.meal,
    new Date().toISOString(),
    id,
  );
  notifyChange('food');
  return result.changes;
}

export async function renameSavedMeal(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE saved_meals SET name = ? WHERE id = ?', name, id);
  notifyChange('food');
}

export async function deleteSavedMeal(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM saved_meal_items WHERE saved_meal_id = ?', id);
  await db.runAsync('DELETE FROM saved_meals WHERE id = ?', id);
  notifyChange('food');
}

export async function deleteSavedMealItem(db: SQLiteDatabase, itemId: number): Promise<void> {
  await db.runAsync('DELETE FROM saved_meal_items WHERE id = ?', itemId);
  notifyChange('food');
}
