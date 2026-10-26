import type { SQLiteDatabase } from 'expo-sqlite';

import type { FoodRow, RecipeIngredientRow, RecipeRow } from '@/lib/backup';
import type { Food, Nutrients } from '@/lib/nutrition';
import { computeRecipe, type RecipeIngredient } from '@/lib/recipes';
import { foodSearchText } from '@/lib/search';

import { foodFromRow } from './foods';
import { notifyChange } from './live';

/** Recipes are foods in this category, so search and lists can tell them apart. */
export const RECIPE_CATEGORY = 'Ricetta';

export type Recipe = {
  food: Food;
  cookedWeight: number | null;
  servings: number | null;
  ingredients: RecipeIngredient[];
};

function ingredientFromRow(row: RecipeIngredientRow): RecipeIngredient {
  return {
    foodId: row.food_id,
    name: row.name,
    brand: row.brand,
    unit: row.unit === 'ml' ? 'ml' : 'g',
    quantity: row.quantity,
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
  };
}

function nutrientParams(n: Nutrients) {
  return [n.kcal, n.protein, n.carbs, n.fat, n.sugars, n.fiber, n.satFat, n.salt];
}

export async function getRecipe(db: SQLiteDatabase, foodId: number): Promise<Recipe | null> {
  const food = await db.getFirstAsync<FoodRow>(`SELECT * FROM foods WHERE id = ? AND source = 'recipe'`, foodId);
  const recipe = await db.getFirstAsync<RecipeRow>('SELECT * FROM recipes WHERE food_id = ?', foodId);
  if (!food || !recipe) return null;
  const rows = await db.getAllAsync<RecipeIngredientRow>(
    'SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position, id',
    foodId,
  );
  return {
    food: foodFromRow(food),
    cookedWeight: recipe.cooked_weight,
    servings: recipe.servings,
    ingredients: rows.map(ingredientFromRow),
  };
}

/** All recipes with how many ingredients they have, by name. */
export async function getRecipes(db: SQLiteDatabase): Promise<{ food: Food; ingredientCount: number }[]> {
  const rows = await db.getAllAsync<FoodRow & { ingredient_count: number }>(
    `SELECT foods.*, (SELECT COUNT(*) FROM recipe_ingredients i WHERE i.recipe_id = foods.id) AS ingredient_count
     FROM foods JOIN recipes ON recipes.food_id = foods.id
     ORDER BY foods.name COLLATE NOCASE`,
  );
  return rows.map((row) => ({ food: foodFromRow(row), ingredientCount: row.ingredient_count }));
}

export type RecipeInput = {
  /** The recipe's food id when editing, null to create one. */
  id: number | null;
  name: string;
  cookedWeight: number | null;
  servings: number | null;
  ingredients: RecipeIngredient[];
};

/**
 * Saves a recipe as a food with values per 100 g of the finished dish, so it can be searched,
 * starred and logged like any other food. Diary entries already logged keep their values.
 */
export async function saveRecipe(db: SQLiteDatabase, input: RecipeInput): Promise<number> {
  const result = computeRecipe(input.ingredients, input.cookedWeight, input.servings);
  if (!result) throw new Error('Una ricetta ha bisogno di almeno un ingrediente');
  const now = new Date().toISOString();
  const servingLabel = input.servings ? `1 porzione su ${input.servings}` : null;
  let id = input.id;

  await db.withExclusiveTransactionAsync(async (tx) => {
    if (id === null) {
      const inserted = await tx.runAsync(
        `INSERT INTO foods (barcode, name, brand, unit, kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt,
           serving_size, serving_label, image_url, source, favorite, created_at, updated_at, category, search_text)
         VALUES (NULL, ?, NULL, 'g', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'recipe', 0, ?, ?, ?, ?)`,
        input.name,
        ...nutrientParams(result.per100),
        result.servingSize,
        servingLabel,
        now,
        now,
        RECIPE_CATEGORY,
        foodSearchText({ name: input.name, brand: null, category: RECIPE_CATEGORY }),
      );
      id = inserted.lastInsertRowId;
      await tx.runAsync(
        'INSERT INTO recipes (food_id, cooked_weight, servings) VALUES (?, ?, ?)',
        id,
        input.cookedWeight,
        input.servings,
      );
    } else {
      await tx.runAsync(
        `UPDATE foods SET name = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, sugars = ?, fiber = ?, sat_fat = ?,
           salt = ?, serving_size = ?, serving_label = ?, updated_at = ?, search_text = ?
         WHERE id = ? AND source = 'recipe'`,
        input.name,
        ...nutrientParams(result.per100),
        result.servingSize,
        servingLabel,
        now,
        foodSearchText({ name: input.name, brand: null, category: RECIPE_CATEGORY }),
        id,
      );
      await tx.runAsync(
        'UPDATE recipes SET cooked_weight = ?, servings = ? WHERE food_id = ?',
        input.cookedWeight,
        input.servings,
        id,
      );
      await tx.runAsync('DELETE FROM recipe_ingredients WHERE recipe_id = ?', id);
    }

    const statement = await tx.prepareAsync(
      `INSERT INTO recipe_ingredients (recipe_id, position, food_id, name, brand, unit, quantity,
         kcal, protein, carbs, fat, sugars, fiber, sat_fat, salt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const [position, ing] of input.ingredients.entries()) {
        await statement.executeAsync([
          id,
          position,
          ing.foodId,
          ing.name,
          ing.brand,
          ing.unit,
          ing.quantity,
          ...nutrientParams(ing.per100),
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
  notifyChange('food');
  return id as number;
}

/** Deletes a recipe and its ingredients. Diary entries keep their own values. */
export async function deleteRecipe(db: SQLiteDatabase, foodId: number): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM recipe_ingredients WHERE recipe_id = ?', foodId);
    await tx.runAsync('DELETE FROM recipes WHERE food_id = ?', foodId);
    await tx.runAsync('UPDATE entries SET food_id = NULL WHERE food_id = ?', foodId);
    await tx.runAsync('UPDATE saved_meal_items SET food_id = NULL WHERE food_id = ?', foodId);
    await tx.runAsync('UPDATE recipe_ingredients SET food_id = NULL WHERE food_id = ?', foodId);
    await tx.runAsync(`DELETE FROM foods WHERE id = ? AND source = 'recipe'`, foodId);
  });
  notifyChange('food');
}
