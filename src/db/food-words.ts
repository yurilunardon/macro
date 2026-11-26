import type { SQLiteDatabase } from 'expo-sqlite';

import { COACH_BRAND, type CatalogFood, type WordsItem } from '@/lib/food-words';
import type { Food } from '@/lib/nutrition';

import { getFood, insertFood } from './foods';

/**
 * The foods the coach chooses from: the basic ones, the user's own and recipes, favourites and
 * the ones logged lately. Packaged products seen once in a search are left out.
 */
export async function getWordsCatalog(db: SQLiteDatabase): Promise<CatalogFood[]> {
  return db.getAllAsync<CatalogFood>(
    `SELECT id, name, brand, unit FROM foods
     WHERE source IN ('generic', 'custom', 'recipe') OR favorite = 1
       OR id IN (SELECT food_id FROM entries WHERE food_id IS NOT NULL GROUP BY food_id ORDER BY MAX(created_at) DESC LIMIT 80)
     ORDER BY CASE source WHEN 'generic' THEN 1 ELSE 0 END, id
     LIMIT 700`,
  );
}

/** The food of each item; those the coach made up become the user's own, found again next time. */
export async function resolveWords(db: SQLiteDatabase, items: readonly WordsItem[]): Promise<{ food: Food; amount: number }[]> {
  const out: { food: Food; amount: number }[] = [];
  for (const item of items) {
    let food: Food | null = null;
    if (item.food.kind === 'known') {
      food = await getFood(db, item.food.id);
    } else {
      const same = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM foods WHERE source = 'custom' AND brand = ? AND name = ? COLLATE NOCASE`,
        COACH_BRAND,
        item.food.name,
      );
      const id =
        same?.id ??
        (await insertFood(db, {
          barcode: null,
          name: item.food.name,
          brand: COACH_BRAND,
          unit: item.food.unit,
          per100: item.food.per100,
          servingSize: null,
          servingLabel: null,
          imageUrl: null,
          source: 'custom',
        }));
      food = await getFood(db, id);
    }
    if (food) out.push({ food, amount: item.amount });
  }
  return out;
}
