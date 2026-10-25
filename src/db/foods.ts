import type { SQLiteDatabase } from 'expo-sqlite';

import type { FoodRow } from '@/lib/backup';
import type { Food, FoodDraft, FoodSource, Nutrients } from '@/lib/nutrition';
import { foodSearchText, normalizeSearch } from '@/lib/search';

import { notifyChange } from './live';

const SOURCES: readonly FoodSource[] = ['off', 'custom', 'generic'];

export function foodFromRow(row: FoodRow): Food {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    unit: row.unit === 'ml' ? 'ml' : 'g',
    per100: {
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      sugars: row.sugars,
      fiber: row.fiber,
      satFat: row.sat_fat,
      salt: row.salt,
    },
    servingSize: row.serving_size,
    servingLabel: row.serving_label,
    imageUrl: row.image_url,
    source: SOURCES.includes(row.source as FoodSource) ? (row.source as FoodSource) : 'custom',
    favorite: row.favorite === 1,
    category: row.category ?? null,
  };
}

function nutrientParams(n: Nutrients) {
  return [n.kcal, n.protein, n.carbs, n.fat, n.sugars, n.fiber, n.satFat, n.salt];
}

export async function getFood(db: SQLiteDatabase, id: number): Promise<Food | null> {
  const row = await db.getFirstAsync<FoodRow>('SELECT * FROM foods WHERE id = ?', id);
  return row ? foodFromRow(row) : null;
}

export async function getFoodByBarcode(db: SQLiteDatabase, barcode: string): Promise<Food | null> {
  const row = await db.getFirstAsync<FoodRow>('SELECT * FROM foods WHERE barcode = ?', barcode);
  return row ? foodFromRow(row) : null;
}

export async function insertFood(db: SQLiteDatabase, draft: FoodDraft): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO foods (barcode, name, brand, unit, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt,
       serving_size, serving_label, image_url, source, favorite, created_at, updated_at, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    draft.barcode,
    draft.name,
    draft.brand,
    draft.unit,
    ...nutrientParams(draft.per100),
    draft.servingSize,
    draft.servingLabel,
    draft.imageUrl,
    draft.source,
    now,
    now,
    foodSearchText(draft),
  );
  notifyChange();
  return result.lastInsertRowId;
}

/** Saves corrected values. A basic food keeps its reference and category. */
export async function updateFood(db: SQLiteDatabase, id: number, draft: FoodDraft): Promise<void> {
  const current = await db.getFirstAsync<{ category: string | null }>('SELECT category FROM foods WHERE id = ?', id);
  await db.runAsync(
    `UPDATE foods SET barcode = ?, name = ?, brand = ?, unit = ?, kcal = ?, protein = ?, carbs = ?, fat = ?,
       sugars = ?, fiber = ?, sat_fat = ?, salt = ?, serving_size = ?, serving_label = ?, image_url = ?,
       source = ?, updated_at = ?, search_text = ?
     WHERE id = ?`,
    draft.barcode,
    draft.name,
    draft.brand,
    draft.unit,
    ...nutrientParams(draft.per100),
    draft.servingSize,
    draft.servingLabel,
    draft.imageUrl,
    draft.source,
    new Date().toISOString(),
    foodSearchText({ ...draft, category: current?.category ?? null }),
    id,
  );
  notifyChange();
}

/** Recomputes the search text of every food, after a migration or a restore. */
export async function refreshSearchText(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: number; name: string; brand: string | null; category: string | null }>(
    'SELECT id, name, brand, category FROM foods',
  );
  for (const row of rows) {
    await db.runAsync('UPDATE foods SET search_text = ? WHERE id = ?', foodSearchText(row), row.id);
  }
}

/**
 * Saves a product downloaded from Open Food Facts. If the barcode is already known the
 * local copy wins, because the user may have corrected it.
 */
export async function saveOffFood(db: SQLiteDatabase, draft: FoodDraft): Promise<Food> {
  if (draft.barcode) {
    const existing = await getFoodByBarcode(db, draft.barcode);
    if (existing) return existing;
  }
  const id = await insertFood(db, draft);
  return { ...draft, id, favorite: false, category: null };
}

export async function setFavorite(db: SQLiteDatabase, id: number, favorite: boolean): Promise<void> {
  await db.runAsync('UPDATE foods SET favorite = ? WHERE id = ?', favorite ? 1 : 0, id);
  notifyChange();
}

/** Deletes a food. Diary entries keep their own copy of the values, so history is unchanged. */
export async function deleteFood(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM foods WHERE id = ?', id);
  notifyChange();
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Foods on the phone whose name, brand or category contains every word of the query,
 * ignoring case and accents. Favourites and often used foods come first.
 */
export async function searchLocalFoods(db: SQLiteDatabase, query: string, limit = 40): Promise<Food[]> {
  const words = normalizeSearch(query).split(' ').filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];
  const where = words.map(() => `foods.search_text LIKE ? ESCAPE '\\'`).join(' AND ');
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT foods.* FROM foods
     LEFT JOIN (SELECT food_id, COUNT(*) AS uses FROM entries GROUP BY food_id) u ON u.food_id = foods.id
     WHERE ${where}
     ORDER BY foods.favorite DESC, COALESCE(u.uses, 0) DESC,
       CASE WHEN foods.search_text LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
       length(foods.name), foods.name COLLATE NOCASE
     LIMIT ?`,
    ...words.map((w) => `%${escapeLike(w)}%`),
    `${escapeLike(words[0])}%`,
    limit,
  );
  return rows.map(foodFromRow);
}

/** Foods used most recently, newest first. */
export async function getRecentFoods(db: SQLiteDatabase, limit = 40): Promise<Food[]> {
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT foods.* FROM foods
     JOIN (SELECT food_id, MAX(created_at) AS last_used FROM entries WHERE food_id IS NOT NULL GROUP BY food_id) r
       ON r.food_id = foods.id
     ORDER BY r.last_used DESC
     LIMIT ?`,
    limit,
  );
  return rows.map(foodFromRow);
}

export async function getFavoriteFoods(db: SQLiteDatabase): Promise<Food[]> {
  const rows = await db.getAllAsync<FoodRow>(
    'SELECT * FROM foods WHERE favorite = 1 ORDER BY name COLLATE NOCASE',
  );
  return rows.map(foodFromRow);
}

export async function getCustomFoods(db: SQLiteDatabase): Promise<Food[]> {
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT * FROM foods WHERE source = 'custom' ORDER BY name COLLATE NOCASE`,
  );
  return rows.map(foodFromRow);
}

/** Basic foods grouped by category, in the order the categories were shipped. */
export async function getGenericFoods(db: SQLiteDatabase): Promise<{ category: string; foods: Food[] }[]> {
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT * FROM foods WHERE source = 'generic' ORDER BY id`,
  );
  const groups = new Map<string, Food[]>();
  for (const row of rows) {
    const food = foodFromRow(row);
    const key = food.category ?? 'Altro';
    groups.set(key, [...(groups.get(key) ?? []), food]);
  }
  return [...groups].map(([category, foods]) => ({
    category,
    foods: foods.sort((a, b) => a.name.localeCompare(b.name, 'it')),
  }));
}

/** The quantity used the last time this food was logged, to prefill the next entry. */
export async function getLastQuantity(db: SQLiteDatabase, foodId: number): Promise<number | null> {
  const row = await db.getFirstAsync<{ quantity: number }>(
    'SELECT quantity FROM entries WHERE food_id = ? AND quantity > 0 ORDER BY created_at DESC LIMIT 1',
    foodId,
  );
  return row?.quantity ?? null;
}
