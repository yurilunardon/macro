import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBackup } from '@/lib/backup';
import type { FoodDraft } from '@/lib/nutrition';

import { readBackup, restoreBackup } from '../backup';
import { addWater, getLatestWeight, getWater, getWeightsSince, setWeight } from '../body';
import {
  addEntry,
  addQuickEntry,
  copyMeal,
  deleteEntry,
  getDailyTotals,
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
    expect(tables.map((t) => t.name)).toEqual(['entries', 'foods', 'settings', 'water', 'weights']);
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

  it('adds water without going below zero', async () => {
    await addWater(db, '2026-10-25', -250);
    expect(await getWater(db, '2026-10-25')).toBe(0);
    await addWater(db, '2026-10-25', 250);
    await addWater(db, '2026-10-25', 250);
    await addWater(db, '2026-10-25', -100);
    expect(await getWater(db, '2026-10-25')).toBe(400);
  });

  it('stores settings as JSON and falls back to default targets', async () => {
    expect(await getTargets(db)).toMatchObject({ isDefault: true });
    await setSetting(db, 'targets', { kcal: 2600, protein: 170, carbs: 300, fat: 75 });
    expect(await getTargets(db)).toEqual({ targets: { kcal: 2600, protein: 170, carbs: 300, fat: 75 }, isDefault: false });
    expect(await getSetting(db, 'profile')).toBeNull();
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
    await addWater(db, '2026-10-25', 750);
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
    expect(await getWater(phone, '2026-10-25')).toBe(750);
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
      water: [],
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
