import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBackup } from '@/lib/backup';
import type { FoodDraft } from '@/lib/nutrition';

import { readBackup, restoreBackup } from '../backup';
import { getLatestWeight, getWeightsSince, setWeight } from '../body';
import { getDayPlan, getDayPlans, setDayType, setTrainingSettings } from '../days';
import { deleteFast, endFast, getActiveFast, getFastHistory, setFastStart, startFast } from '../fasts';
import { deleteMeasurementsOn, getMeasurements, setMeasurements } from '../measurements';
import { deleteRecipe, getRecipe, getRecipes, saveRecipe } from '../recipes';
import {
  addSavedMealToDiary,
  deleteSavedMeal,
  deleteSavedMealItem,
  getSavedMeal,
  getSavedMeals,
  renameSavedMeal,
  saveMealFromDiary,
} from '../saved-meals';
import {
  addEntry,
  addQuickEntry,
  copyMeal,
  deleteEntry,
  copyDay,
  copyEntry,
  deleteMealEntries,
  getDailyTotals,
  getEntriesBetween,
  getEntriesForDate,
  getEntry,
  updateEntry,
  updateQuickEntry,
} from '../entries';
import {
  deleteFood,
  getCustomFoods,
  getFavoriteFoods,
  getFood,
  getGenericFoods,
  getLastQuantity,
  getRecentFoods,
  insertFood,
  saveOffFood,
  searchLocalFoods,
  setFavorite,
  updateFood,
} from '../foods';
import { GENERIC_FOODS } from '../generic';
import { MIGRATIONS, SCHEMA_VERSION, migrateDatabase } from '../schema';
import { getSetting, getTargets, setSetting } from '../settings';
import { createTestDatabase } from './test-database';

// Native modules are not available in Node; these tests only touch the database.
vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));

const spaghetti: FoodDraft = {
  barcode: '8076800195057',
  name: 'Spaghetti n.5',
  brand: 'Barilla',
  unit: 'g',
  per100: { kcal: 359, protein: 13, carbs: 71, fat: 2, sugars: 3.5, fiber: 3, satFat: 0.5, salt: 0.01 },
  servingSize: 85,
  servingLabel: '85 g',
  imageUrl: null,
  source: 'off',
};

const skyr: FoodDraft = {
  barcode: null,
  name: 'Skyr bianco 0%',
  brand: 'Fattoria Test',
  unit: 'g',
  per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2, sugars: 4, fiber: null, satFat: 0.1, salt: 0.1 },
  servingSize: 150,
  servingLabel: null,
  imageUrl: null,
  source: 'custom',
};

const pause = () => new Promise((r) => setTimeout(r, 5));

async function freshDatabase(): Promise<SQLiteDatabase> {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDatabase();
});

describe('migrations', () => {
  it('creates the latest schema', async () => {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'day_types',
      'entries',
      'fasts',
      'foods',
      'measurements',
      'recipe_ingredients',
      'recipes',
      'saved_meal_items',
      'saved_meals',
      'settings',
      'weights',
    ]);
  });

  it('upgrades a version 1 diary without losing anything', async () => {
    const old = createTestDatabase();
    await old.execAsync(MIGRATIONS[0] as string);
    await old.execAsync('PRAGMA user_version = 1');
    await old.runAsync(
      `INSERT INTO foods (name, brand, unit, kcal, protein, carbs, fat, source, favorite, created_at, updated_at)
       VALUES ('Caffè d''orzo', 'Bar', 'ml', 10, 0, 2, 0, 'custom', 1, 'x', 'x')`,
    );
    await old.runAsync(
      `INSERT INTO entries (date, meal, food_id, name, unit, quantity, kcal, protein, carbs, fat, created_at)
       VALUES ('2026-10-24', 'breakfast', 1, 'Caffè d''orzo', 'ml', 100, 10, 0, 2, 0, 'x')`,
    );

    await migrateDatabase(old);

    expect((await old.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    expect((await searchLocalFoods(old, 'caffe dorzo')).map((f) => f.name)).toEqual(["Caffè d'orzo"]);
    expect((await getFavoriteFoods(old)).map((f) => f.name)).toEqual(["Caffè d'orzo"]);
    expect(await getEntriesForDate(old, '2026-10-24')).toHaveLength(1);
    expect((await getGenericFoods(old)).flatMap((g) => g.foods)).toHaveLength(GENERIC_FOODS.length);
  });

  it('upgrades a version 2 diary, dropping water but keeping everything else', async () => {
    const old = createTestDatabase();
    await old.execAsync(MIGRATIONS[0] as string);
    await (MIGRATIONS[1] as (db: SQLiteDatabase) => Promise<void>)(old);
    await old.execAsync('PRAGMA user_version = 2');
    await old.runAsync(`INSERT INTO water (date, ml) VALUES ('2026-10-24', 750)`);
    await old.runAsync(`INSERT INTO settings (key, value) VALUES ('waterGoalMl', '2000'), ('targets', '{"kcal":2500,"protein":150,"carbs":300,"fat":70}')`);
    await old.runAsync(`INSERT INTO weights (date, kg) VALUES ('2026-10-24', 80)`);

    await migrateDatabase(old);

    const tables = await old.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map((t) => t.name)).not.toContain('water');
    expect(await old.getFirstAsync(`SELECT * FROM settings WHERE key = 'waterGoalMl'`)).toBeNull();
    expect((await getTargets(old)).targets.kcal).toBe(2500);
    expect(await getLatestWeight(old)).toEqual({ date: '2026-10-24', kg: 80 });
  });

  it('is safe to run again on an existing database', async () => {
    await insertFood(db, skyr);
    await migrateDatabase(db);
    await migrateDatabase(db);
    expect(await searchLocalFoods(db, 'skyr')).toHaveLength(1);
    expect((await getGenericFoods(db)).flatMap((g) => g.foods)).toHaveLength(GENERIC_FOODS.length);
  });
});

describe('basic foods', () => {
  it('ships every basic food once, grouped by category', async () => {
    const groups = await getGenericFoods(db);
    expect(groups[0].category).toBe('Frutta');
    expect(groups.map((g) => g.category)).toContain('Carne');
    const all = groups.flatMap((g) => g.foods);
    expect(all).toHaveLength(GENERIC_FOODS.length);
    expect(all.every((f) => f.source === 'generic' && f.barcode === null)).toBe(true);
  });

  it('is found by name, category and without accents', async () => {
    const pollo = (await searchLocalFoods(db, 'petto pollo crudo')).map((f) => f.name);
    expect(pollo[0]).toBe('Petto di pollo, crudo');
    expect((await searchLocalFoods(db, 'caffe')).map((f) => f.name)).toContain('Caffè espresso');
    expect((await searchLocalFoods(db, 'WURSTEL')).map((f) => f.name)).toContain('Würstel di maiale');
    expect((await searchLocalFoods(db, 'frutta mela')).map((f) => f.name)).toEqual(['Mela']);
    // Names starting with the first word rank before names that only contain it.
    expect((await searchLocalFoods(db, 'banana'))[0].name).toBe('Banana');
  });

  it('keeps the user’s corrections and favourites when seeding again', async () => {
    const mela = (await searchLocalFoods(db, 'mela'))[0];
    await updateFood(db, mela.id, { ...mela, per100: { ...mela.per100, kcal: 60 } });
    await setFavorite(db, mela.id, true);
    await setSetting(db, 'genericFoodsVersion', 0);
    await migrateDatabase(db);
    const again = (await getFood(db, mela.id))!;
    expect(again.per100.kcal).toBe(60);
    expect(again.favorite).toBe(true);
    expect(again.category).toBe('Frutta');
    expect((await getGenericFoods(db)).flatMap((g) => g.foods)).toHaveLength(GENERIC_FOODS.length);
  });

  it('comes back after being deleted only when seeding is forced', async () => {
    const mela = (await searchLocalFoods(db, 'mela'))[0];
    await deleteFood(db, mela.id);
    await migrateDatabase(db);
    expect(await searchLocalFoods(db, 'frutta mela')).toEqual([]);
  });
});

describe('foods', () => {
  it('saves Open Food Facts products once per barcode, keeping local corrections', async () => {
    const first = await saveOffFood(db, spaghetti);
    await updateFood(db, first.id, { ...spaghetti, name: 'Spaghetti corretti' });
    const second = await saveOffFood(db, spaghetti);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Spaghetti corretti');
    expect((await searchLocalFoods(db, 'corretti')).map((f) => f.id)).toEqual([first.id]);
  });

  it('rejects a second food with the same barcode', async () => {
    await insertFood(db, spaghetti);
    await expect(insertFood(db, spaghetti)).rejects.toThrow(/UNIQUE/);
  });

  it('searches every word in name or brand', async () => {
    await insertFood(db, spaghetti);
    await insertFood(db, skyr);
    expect((await searchLocalFoods(db, 'barilla spa')).map((f) => f.name)).toEqual(['Spaghetti n.5']);
    expect((await searchLocalFoods(db, 'SKYR fattoria')).map((f) => f.name)).toEqual(['Skyr bianco 0%']);
    expect(await searchLocalFoods(db, 'skyr barilla')).toEqual([]);
    // LIKE wildcards in the query are matched literally.
    expect((await searchLocalFoods(db, 'skyr 0%')).map((f) => f.name)).toEqual(['Skyr bianco 0%']);
    expect(await searchLocalFoods(db, '_')).toEqual([]);
    expect((await getCustomFoods(db)).map((f) => f.name)).toEqual(['Skyr bianco 0%']);
  });

  it('tracks favourites, recents and the last quantity used', async () => {
    const pasta = await insertFood(db, spaghetti);
    const yog = await insertFood(db, skyr);
    await setFavorite(db, yog, true);
    expect((await getFavoriteFoods(db)).map((f) => f.id)).toEqual([yog]);

    const pastaFood = (await getFood(db, pasta))!;
    const yogFood = (await getFood(db, yog))!;
    await addEntry(db, { date: '2026-10-24', meal: 'lunch', food: pastaFood, quantity: 80 });
    await pause();
    await addEntry(db, { date: '2026-10-25', meal: 'breakfast', food: yogFood, quantity: 170 });
    await pause();
    await addEntry(db, { date: '2026-10-25', meal: 'lunch', food: pastaFood, quantity: 100 });

    expect((await getRecentFoods(db)).map((f) => f.id)).toEqual([pasta, yog]);
    expect(await getLastQuantity(db, pasta)).toBe(100);
    expect(await getLastQuantity(db, 999)).toBeNull();
  });

  it('keeps diary entries when their food is deleted', async () => {
    const id = await insertFood(db, skyr);
    const food = (await getFood(db, id))!;
    const entryId = await addEntry(db, { date: '2026-10-25', meal: 'snack', food, quantity: 150 });
    await deleteFood(db, id);
    const entry = await getEntry(db, entryId);
    expect(entry?.foodId).toBeNull();
    expect(entry?.quick).toBe(false);
    expect(entry?.name).toBe('Skyr bianco 0%');
    expect(entry?.totals.protein).toBeCloseTo(16.5);
  });
});

describe('diary', () => {
  it('stores totals for the quantity and rescales them on edit', async () => {
    const food = (await getFood(db, await insertFood(db, spaghetti)))!;
    const id = await addEntry(db, { date: '2026-10-25', meal: 'lunch', food, quantity: 80 });
    const entry = (await getEntry(db, id))!;
    expect(entry.totals.kcal).toBeCloseTo(287.2);
    expect(entry.totals.carbs).toBeCloseTo(56.8);

    await updateEntry(db, entry, { quantity: 120, meal: 'dinner' });
    const edited = (await getEntry(db, id))!;
    expect(edited.meal).toBe('dinner');
    expect(edited.quantity).toBe(120);
    expect(edited.totals.kcal).toBeCloseTo(430.8);
    expect(edited.totals.fiber).toBeCloseTo(3.6);
  });

  it('does not change past entries when the food is corrected', async () => {
    const id = await insertFood(db, spaghetti);
    const food = (await getFood(db, id))!;
    const entryId = await addEntry(db, { date: '2026-10-25', meal: 'lunch', food, quantity: 100 });
    await updateFood(db, id, { ...spaghetti, per100: { ...spaghetti.per100, kcal: 999 } });
    expect((await getEntry(db, entryId))?.totals.kcal).toBe(359);
  });

  it('logs and edits quick entries without a food', async () => {
    const totals = { kcal: 650, protein: 25, carbs: 80, fat: 22, sugars: null, fiber: null, satFat: null, salt: null };
    const id = await addQuickEntry(db, { date: '2026-10-25', meal: 'lunch', name: 'Pizza', totals });
    const entry = (await getEntry(db, id))!;
    expect(entry).toMatchObject({ quick: true, quantity: 0, foodId: null, name: 'Pizza' });

    await updateQuickEntry(db, id, { meal: 'dinner', name: 'Pizza margherita', totals: { ...totals, kcal: 800 } });
    expect(await getEntry(db, id)).toMatchObject({ meal: 'dinner', name: 'Pizza margherita', totals: { kcal: 800 } });
    expect((await getDailyTotals(db, '2026-10-25', '2026-10-25'))[0].kcal).toBe(800);
    // Quick entries do not count as the "last quantity" of anything.
    expect(await getRecentFoods(db)).toEqual([]);
  });

  it('copies a meal to another day and sums days', async () => {
    const pasta = (await getFood(db, await insertFood(db, spaghetti)))!;
    const yog = (await getFood(db, await insertFood(db, skyr)))!;
    await addEntry(db, { date: '2026-10-24', meal: 'breakfast', food: yog, quantity: 170 });
    await addEntry(db, { date: '2026-10-24', meal: 'lunch', food: pasta, quantity: 100 });

    const copied = await copyMeal(db, { date: '2026-10-24', meal: 'breakfast' }, { date: '2026-10-25', meal: 'breakfast' });
    expect(copied).toBe(1);
    const today = await getEntriesForDate(db, '2026-10-25');
    expect(today.map((e) => [e.meal, e.name, e.quantity])).toEqual([['breakfast', 'Skyr bianco 0%', 170]]);

    const totals = await getDailyTotals(db, '2026-10-20', '2026-10-25');
    expect(totals.map((t) => t.date)).toEqual(['2026-10-24', '2026-10-25']);
    expect(totals[0].kcal).toBeCloseTo(63 * 1.7 + 359);
    expect(totals[1].protein).toBeCloseTo(18.7);

    await deleteEntry(db, today[0].id);
    expect(await getEntriesForDate(db, '2026-10-25')).toEqual([]);
  });
});

describe('body and settings', () => {
  it('keeps one weight per day', async () => {
    await setWeight(db, '2026-10-20', 80.4);
    await setWeight(db, '2026-10-25', 79.8);
    await setWeight(db, '2026-10-25', 79.6);
    expect(await getWeightsSince(db, '2026-10-01')).toEqual([
      { date: '2026-10-20', kg: 80.4 },
      { date: '2026-10-25', kg: 79.6 },
    ]);
    expect(await getLatestWeight(db)).toEqual({ date: '2026-10-25', kg: 79.6 });
  });

  it('stores settings as JSON and falls back to default targets', async () => {
    expect(await getTargets(db)).toMatchObject({ isDefault: true });
    await setSetting(db, 'targets', { kcal: 2600, protein: 170, carbs: 300, fat: 75 });
    expect(await getTargets(db)).toEqual({ targets: { kcal: 2600, protein: 170, carbs: 300, fat: 75 }, isDefault: false });
    expect(await getSetting(db, 'profile')).toBeNull();
  });
});

describe('recipes', () => {
  async function ingredients() {
    const rice = (await searchLocalFoods(db, 'riso bianco crudo'))[0];
    const chicken = (await searchLocalFoods(db, 'petto pollo crudo'))[0];
    const oil = (await searchLocalFoods(db, 'olio extravergine'))[0];
    return [
      { foodId: rice.id, name: rice.name, brand: null, unit: rice.unit, quantity: 300, per100: rice.per100 },
      { foodId: chicken.id, name: chicken.name, brand: null, unit: chicken.unit, quantity: 500, per100: chicken.per100 },
      { foodId: oil.id, name: oil.name, brand: null, unit: oil.unit, quantity: 20, per100: oil.per100 },
    ];
  }

  it('saves a recipe as a food per 100 g of the cooked dish', async () => {
    const ings = await ingredients();
    const id = await saveRecipe(db, { id: null, name: 'Pollo e riso', cookedWeight: 1600, servings: 4, ingredients: ings });
    const recipe = (await getRecipe(db, id))!;
    const totalKcal = ings.reduce((sum, i) => sum + (i.per100.kcal * i.quantity) / 100, 0);
    expect(recipe.food).toMatchObject({ name: 'Pollo e riso', source: 'recipe', servingSize: 400, servingLabel: '1 porzione su 4' });
    expect(recipe.food.per100.kcal).toBeCloseTo(totalKcal / 16);
    expect(recipe.ingredients.map((i) => i.quantity)).toEqual([300, 500, 20]);
    expect((await searchLocalFoods(db, 'pollo riso')).map((f) => f.name)).toContain('Pollo e riso');
    expect((await searchLocalFoods(db, 'ricetta')).map((f) => f.name)).toEqual(['Pollo e riso']);
    expect(await getRecipes(db)).toEqual([{ food: recipe.food, ingredientCount: 3 }]);
  });

  it('edits a recipe without changing what was already logged', async () => {
    const ings = await ingredients();
    const id = await saveRecipe(db, { id: null, name: 'Pollo e riso', cookedWeight: null, servings: null, ingredients: ings });
    const before = (await getRecipe(db, id))!;
    const entryId = await addEntry(db, { date: '2026-10-25', meal: 'lunch', food: before.food, quantity: 400 });

    await saveRecipe(db, { id, name: 'Pollo e riso light', cookedWeight: 1500, servings: 5, ingredients: ings.slice(0, 2) });
    const after = (await getRecipe(db, id))!;
    expect(after.food.name).toBe('Pollo e riso light');
    expect(after.ingredients).toHaveLength(2);
    expect(after.food.servingSize).toBe(300);
    expect((await getEntry(db, entryId))?.totals.kcal).toBeCloseTo(before.food.per100.kcal * 4);
    expect(await getRecipes(db)).toHaveLength(1);
  });

  it('keeps a recipe working when an ingredient food is deleted', async () => {
    const ings = await ingredients();
    const id = await saveRecipe(db, { id: null, name: 'Pollo e riso', cookedWeight: null, servings: null, ingredients: ings });
    await deleteFood(db, ings[2].foodId);
    const recipe = (await getRecipe(db, id))!;
    expect(recipe.ingredients[2]).toMatchObject({ foodId: null, name: 'Olio extravergine di oliva', quantity: 20 });
  });

  it('deletes a recipe and unlinks the diary', async () => {
    const id = await saveRecipe(db, { id: null, name: 'Pollo e riso', cookedWeight: null, servings: null, ingredients: await ingredients() });
    const food = (await getRecipe(db, id))!.food;
    const entryId = await addEntry(db, { date: '2026-10-25', meal: 'lunch', food, quantity: 300 });
    await deleteRecipe(db, id);
    expect(await getRecipe(db, id)).toBeNull();
    expect(await getRecipes(db)).toEqual([]);
    expect(await db.getFirstAsync('SELECT * FROM recipe_ingredients')).toBeNull();
    expect((await getEntry(db, entryId))?.foodId).toBeNull();
  });

  it('refuses a recipe without ingredients', async () => {
    await expect(saveRecipe(db, { id: null, name: 'Vuota', cookedWeight: null, servings: null, ingredients: [] })).rejects.toThrow();
  });
});

describe('saved meals', () => {
  it('saves a logged meal and adds it to another day', async () => {
    const pasta = (await getFood(db, await insertFood(db, spaghetti)))!;
    const yog = (await getFood(db, await insertFood(db, skyr)))!;
    await addEntry(db, { date: '2026-10-24', meal: 'breakfast', food: yog, quantity: 150 });
    await pause();
    await addQuickEntry(db, {
      date: '2026-10-24',
      meal: 'breakfast',
      name: 'Caffè al bar',
      totals: { kcal: 40, protein: 1, carbs: 5, fat: 1, sugars: null, fiber: null, satFat: null, salt: null },
    });
    await addEntry(db, { date: '2026-10-24', meal: 'lunch', food: pasta, quantity: 100 });

    const id = await saveMealFromDiary(db, { date: '2026-10-24', meal: 'breakfast', name: 'Colazione tipo' });
    expect(await getSavedMeals(db)).toEqual([
      { id, name: 'Colazione tipo', itemCount: 2, totals: { kcal: 94.5 + 40, protein: 16.5 + 1, carbs: 6 + 5, fat: 0.3 + 1 } },
    ]);

    expect(await addSavedMealToDiary(db, id, { date: '2026-10-26', meal: 'snack' })).toBe(2);
    const added = await getEntriesForDate(db, '2026-10-26');
    expect(added.map((e) => [e.meal, e.name, e.quantity, e.quick])).toEqual([
      ['snack', 'Skyr bianco 0%', 150, false],
      ['snack', 'Caffè al bar', 0, true],
    ]);
  });

  it('renames, removes items and deletes saved meals', async () => {
    const yog = (await getFood(db, await insertFood(db, skyr)))!;
    await addEntry(db, { date: '2026-10-24', meal: 'dinner', food: yog, quantity: 100 });
    await addEntry(db, { date: '2026-10-24', meal: 'dinner', food: yog, quantity: 200 });
    const id = await saveMealFromDiary(db, { date: '2026-10-24', meal: 'dinner', name: 'Cena' });

    await renameSavedMeal(db, id, 'Cena leggera');
    const meal = (await getSavedMeal(db, id))!;
    expect(meal.name).toBe('Cena leggera');
    await deleteSavedMealItem(db, meal.items[0].id);
    expect((await getSavedMeal(db, id))!.items.map((i) => i.quantity)).toEqual([200]);

    await deleteSavedMeal(db, id);
    expect(await getSavedMeal(db, id)).toBeNull();
    expect(await db.getFirstAsync('SELECT * FROM saved_meal_items')).toBeNull();
  });

  it('empties a meal of one day', async () => {
    const yog = (await getFood(db, await insertFood(db, skyr)))!;
    await addEntry(db, { date: '2026-10-24', meal: 'dinner', food: yog, quantity: 100 });
    await addEntry(db, { date: '2026-10-24', meal: 'lunch', food: yog, quantity: 100 });
    await deleteMealEntries(db, '2026-10-24', 'dinner');
    expect((await getEntriesForDate(db, '2026-10-24')).map((e) => e.meal)).toEqual(['lunch']);
  });
});

describe('training and rest days', () => {
  const training = { kcal: 2800, protein: 160, carbs: 370, fat: 75 };
  const rest = { kcal: 2400, protein: 160, carbs: 270, fat: 75 };

  it('uses the same targets every day until rest days are configured', async () => {
    await setSetting(db, 'targets', training);
    expect(await getDayPlan(db, '2026-10-25')).toEqual({ targets: training, isDefault: false, dayType: null, overridden: false });
  });

  it('follows the weekly schedule, with days set by hand winning', async () => {
    await setSetting(db, 'targets', training);
    await setTrainingSettings(db, { restTargets: rest, trainingWeekdays: [1, 3, 5] });
    // 2026-10-26 is a Monday, 2026-10-27 a Tuesday.
    expect(await getDayPlan(db, '2026-10-26')).toMatchObject({ targets: training, dayType: 'training', overridden: false });
    expect(await getDayPlan(db, '2026-10-27')).toMatchObject({ targets: rest, dayType: 'rest', overridden: false });

    await setDayType(db, '2026-10-27', 'training');
    expect(await getDayPlan(db, '2026-10-27')).toMatchObject({ targets: training, dayType: 'training', overridden: true });
    await setDayType(db, '2026-10-27', null);
    expect(await getDayPlan(db, '2026-10-27')).toMatchObject({ dayType: 'rest', overridden: false });

    const plans = await getDayPlans(db, ['2026-10-26', '2026-10-27', '2026-10-28']);
    expect([...plans.values()].map((p) => p.targets.kcal)).toEqual([2800, 2400, 2800]);
  });

  it('goes back to one set of targets when rest days are turned off', async () => {
    await setSetting(db, 'targets', training);
    await setTrainingSettings(db, { restTargets: rest, trainingWeekdays: [1] });
    await setTrainingSettings(db, { restTargets: null, trainingWeekdays: [1] });
    expect(await getDayPlan(db, '2026-10-27')).toMatchObject({ targets: training, dayType: null });
  });
});

describe('copying days and entries', () => {
  it('copies a whole day and a single entry', async () => {
    const yog = (await getFood(db, await insertFood(db, skyr)))!;
    const first = await addEntry(db, { date: '2026-10-24', meal: 'breakfast', food: yog, quantity: 150 });
    await addEntry(db, { date: '2026-10-24', meal: 'dinner', food: yog, quantity: 200 });

    expect(await copyDay(db, '2026-10-24', '2026-10-25')).toBe(2);
    expect((await getEntriesForDate(db, '2026-10-25')).map((e) => [e.meal, e.quantity])).toEqual([
      ['breakfast', 150],
      ['dinner', 200],
    ]);
    await copyEntry(db, first, '2026-10-26');
    expect((await getEntriesForDate(db, '2026-10-26')).map((e) => [e.meal, e.quantity])).toEqual([['breakfast', 150]]);
    expect((await getEntriesBetween(db, '2026-10-24', '2026-10-25')).map((e) => e.date)).toEqual([
      '2026-10-24',
      '2026-10-24',
      '2026-10-25',
      '2026-10-25',
    ]);
  });
});

describe('measurements', () => {
  it('keeps one value per kind per day and removes cleared values', async () => {
    await setMeasurements(db, '2026-10-24', { waist: 88, arm: 37.5 });
    await setMeasurements(db, '2026-10-25', { waist: 87.5, bodyFat: 16 });
    await setMeasurements(db, '2026-10-25', { waist: 87, bodyFat: null });
    expect(await getMeasurements(db)).toEqual([
      { date: '2026-10-24', kind: 'arm', value: 37.5 },
      { date: '2026-10-24', kind: 'waist', value: 88 },
      { date: '2026-10-25', kind: 'waist', value: 87 },
    ]);
    await deleteMeasurementsOn(db, '2026-10-24');
    expect((await getMeasurements(db)).map((m) => m.date)).toEqual(['2026-10-25']);
  });
});

describe('fasting', () => {
  it('starts, adjusts and ends a fast', async () => {
    const id = await startFast(db, 16, new Date('2026-10-30T20:00:00.000Z'));
    expect(await getActiveFast(db)).toEqual({ id, start: '2026-10-30T20:00:00.000Z', end: null, goalHours: 16 });
    await setFastStart(db, id, new Date('2026-10-30T19:30:00.000Z'));
    await endFast(db, id, new Date('2026-10-31T12:00:00.000Z'));
    expect(await getActiveFast(db)).toBeNull();
    expect(await getFastHistory(db)).toEqual([
      { id, start: '2026-10-30T19:30:00.000Z', end: '2026-10-31T12:00:00.000Z', goalHours: 16 },
    ]);
    await deleteFast(db, id);
    expect(await getFastHistory(db)).toEqual([]);
  });

  it('ends a forgotten fast when a new one starts', async () => {
    const old = await startFast(db, 16, new Date('2026-10-29T20:00:00.000Z'));
    const fresh = await startFast(db, 14, new Date('2026-10-30T20:00:00.000Z'));
    expect((await getActiveFast(db))?.id).toBe(fresh);
    expect((await getFastHistory(db)).map((f) => [f.id, f.end])).toEqual([[old, '2026-10-30T20:00:00.000Z']]);
  });
});

describe('backup', () => {
  it('restores exactly what was exported, after a JSON round trip', async () => {
    const pasta = (await getFood(db, await insertFood(db, spaghetti)))!;
    const mela = (await searchLocalFoods(db, 'mela'))[0];
    await setFavorite(db, mela.id, true);
    await addEntry(db, { date: '2026-10-25', meal: 'lunch', food: pasta, quantity: 90 });
    await addEntry(db, { date: '2026-10-25', meal: 'snack', food: mela, quantity: 180 });
    await setWeight(db, '2026-10-25', 79.6);
    const recipeId = await saveRecipe(db, {
      id: null,
      name: 'Pasta al pomodoro',
      cookedWeight: 500,
      servings: 2,
      ingredients: [{ foodId: pasta.id, name: pasta.name, brand: pasta.brand, unit: 'g', quantity: 200, per100: pasta.per100 }],
    });
    const savedId = await saveMealFromDiary(db, { date: '2026-10-25', meal: 'snack', name: 'Spuntino' });
    await setDayType(db, '2026-10-25', 'rest');
    await setMeasurements(db, '2026-10-25', { waist: 86 });
    const fastId = await startFast(db, 16, new Date('2026-10-25T20:00:00.000Z'));
    await setSetting(db, 'targets', { kcal: 2600, protein: 170, carbs: 300, fat: 75 });
    await setSetting(db, 'lastBackupAt', '2026-10-25T10:00:00.000Z');

    const exported = await readBackup(db);
    expect(exported.settings.map((s) => s.key)).toEqual(['targets']);
    expect(exported.foods[0]).not.toHaveProperty('search_text');
    const fileContents = JSON.stringify(exported);

    const phone = await freshDatabase();
    await insertFood(phone, { ...skyr, name: 'Dato che verrà sostituito' });
    await restoreBackup(phone, parseBackup(JSON.parse(fileContents)));

    const restored = await readBackup(phone);
    expect({ ...restored, exportedAt: '' }).toEqual({ ...exported, exportedAt: '' });
    expect((await getFavoriteFoods(phone)).map((f) => f.name)).toEqual(['Mela']);
    expect(await searchLocalFoods(phone, 'sostituito')).toEqual([]);
    expect((await searchLocalFoods(phone, 'spaghetti')).map((f) => f.name)).toEqual(['Spaghetti n.5']);
    expect((await getRecipe(phone, recipeId))?.ingredients).toHaveLength(1);
    expect((await getSavedMeal(phone, savedId))?.items.map((i) => i.name)).toEqual(['Mela']);
    expect((await searchLocalFoods(phone, 'pasta pomodoro')).map((f) => f.name)).toEqual(['Pasta al pomodoro']);
    expect((await searchLocalFoods(phone, 'ricetta')).map((f) => f.name)).toEqual(['Pasta al pomodoro']);
    expect(await getMeasurements(phone)).toEqual([{ date: '2026-10-25', kind: 'waist', value: 86 }]);
    expect((await getActiveFast(phone))?.id).toBe(fastId);
    // New rows keep counting after the restored ids.
    const nextId = await insertFood(phone, { ...skyr, name: 'Nuovo' });
    expect(nextId).toBeGreaterThan(Math.max(...restored.foods.map((f) => f.id)));
  });

  it('restores a version 1 backup and adds the basic foods it did not have', async () => {
    const v1 = {
      app: 'macro',
      version: 1,
      exportedAt: '2026-10-20T10:00:00.000Z',
      foods: [
        {
          id: 1, barcode: null, name: 'Skyr', brand: null, unit: 'g', kcal: 63, protein: 11, carbs: 4, fat: 0.2,
          sugars: null, fiber: null, sat_fat: null, salt: null, serving_size: null, serving_label: null,
          image_url: null, source: 'custom', favorite: 0, created_at: 'x', updated_at: 'x',
        },
      ],
      entries: [],
      weights: [],
      water: [{ date: '2026-10-20', ml: 500 }],
      settings: [],
    };
    await restoreBackup(db, parseBackup(v1));
    expect((await searchLocalFoods(db, 'skyr')).map((f) => f.name)).toEqual(['Skyr']);
    expect((await getGenericFoods(db)).flatMap((g) => g.foods)).toHaveLength(GENERIC_FOODS.length);
  });

  it('leaves the database untouched when a restore fails', async () => {
    await insertFood(db, skyr);
    const broken = parseBackup(JSON.parse(JSON.stringify(await readBackup(db))));
    broken.foods.push({ ...broken.foods[0] }); // duplicate primary key
    await expect(restoreBackup(db, broken)).rejects.toThrow();
    expect(await searchLocalFoods(db, 'skyr')).toHaveLength(1);
  });
});
