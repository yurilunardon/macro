import type { SQLiteDatabase } from 'expo-sqlite';

import genericFoods from '@/data/generic-foods.json';
import type { Nutrients, Unit } from '@/lib/nutrition';
import { foodSearchText } from '@/lib/search';

import { notifyChange } from './live';
import { getSetting, setSetting } from './settings';

/** A basic food shipped with the app (see scripts/generic-foods). */
export type GenericFood = {
  ref: string;
  name: string;
  category: string;
  unit: Unit;
  per100: Nutrients;
  servingSize: number | null;
  servingLabel: string | null;
};

export const GENERIC_FOODS = genericFoods as GenericFood[];

/** Bump when generic-foods.json gains foods, so existing phones receive them. */
export const GENERIC_FOODS_VERSION = 1;

/**
 * Adds the basic foods that are missing. Foods already on the phone are left alone, so the
 * user's corrections and favourites survive app updates.
 */
export async function seedGenericFoods(db: SQLiteDatabase, { force = false } = {}): Promise<void> {
  if (!force) {
    const version = await getSetting(db, 'genericFoodsVersion');
    if (version !== null && version >= GENERIC_FOODS_VERSION) return;
  }
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const statement = await tx.prepareAsync(
      `INSERT INTO foods (barcode, name, brand, unit, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt,
         serving_size, serving_label, image_url, source, favorite, created_at, updated_at, ref, category, search_text)
       VALUES (NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'generic', 0, ?, ?, ?, ?, ?)
       ON CONFLICT (ref) DO NOTHING`,
    );
    try {
      for (const food of GENERIC_FOODS) {
        const n = food.per100;
        await statement.executeAsync([
          food.name,
          food.unit,
          n.kcal,
          n.protein,
          n.carbs,
          n.fat,
          n.sugars,
          n.fiber,
          n.satFat,
          n.salt,
          food.servingSize,
          food.servingLabel,
          now,
          now,
          food.ref,
          food.category,
          foodSearchText({ name: food.name, brand: null, category: food.category }),
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
  await setSetting(db, 'genericFoodsVersion', GENERIC_FOODS_VERSION);
  notifyChange('food');
}
