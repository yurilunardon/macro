import { describe, expect, it } from 'vitest';

import { BackupFormatError, backupFileName, parseBackup } from '../backup';

function sampleBackup() {
  return {
    app: 'macro',
    version: 1,
    exportedAt: '2026-10-25T10:00:00.000Z',
    foods: [
      {
        id: 1,
        barcode: '8076800195057',
        name: 'Spaghetti',
        brand: 'Barilla',
        unit: 'g',
        kcal: 359,
        protein: 13,
        carbs: 71,
        fat: 2,
        sugars: 3.5,
        fiber: 3,
        sat_fat: 0.5,
        salt: 0.01,
        serving_size: 85,
        serving_label: '85 g',
        image_url: null,
        source: 'off',
        favorite: 1,
        created_at: '2026-10-25T10:00:00.000Z',
        updated_at: '2026-10-25T10:00:00.000Z',
        extra_column: 'ignored',
      },
    ],
    entries: [
      {
        id: 1,
        date: '2026-10-25',
        meal: 'lunch',
        food_id: 1,
        name: 'Spaghetti',
        brand: 'Barilla',
        unit: 'g',
        quantity: 80,
        kcal: 287.2,
        protein: 10.4,
        carbs: 56.8,
        fat: 1.6,
        sugars: 2.8,
        fiber: 2.4,
        sat_fat: 0.4,
        salt: 0.008,
        created_at: '2026-10-25T12:00:00.000Z',
      },
    ],
    weights: [{ date: '2026-10-25', kg: 80.2 }],
    water: [{ date: '2026-10-25', ml: 1500 }],
    settings: [{ key: 'targets', value: '{"kcal":2500}' }],
  };
}

describe('parseBackup', () => {
  it('accepts a valid backup and drops unknown columns', () => {
    const backup = parseBackup(sampleBackup());
    expect(backup.foods).toHaveLength(1);
    expect(backup.foods[0]).not.toHaveProperty('extra_column');
    expect(backup.entries[0].quantity).toBe(80);
  });

  it('survives a JSON round trip', () => {
    const json = JSON.parse(JSON.stringify(parseBackup(sampleBackup())));
    expect(parseBackup(json)).toEqual(parseBackup(sampleBackup()));
  });

  it('rejects files from other apps or newer versions', () => {
    expect(() => parseBackup({ ...sampleBackup(), app: 'other' })).toThrow(BackupFormatError);
    expect(() => parseBackup({ ...sampleBackup(), version: 99 })).toThrow(BackupFormatError);
    expect(() => parseBackup('text')).toThrow(BackupFormatError);
  });

  it('rejects missing tables and wrong types', () => {
    const { weights: _weights, ...noWeights } = sampleBackup();
    expect(() => parseBackup(noWeights)).toThrow(/weights/);
    const bad = sampleBackup();
    (bad.entries[0] as Record<string, unknown>).kcal = 'tanti';
    expect(() => parseBackup(bad)).toThrow(/kcal/);
  });

  it('rejects malformed dates', () => {
    const bad = sampleBackup();
    bad.weights[0].date = '25/10/2026';
    expect(() => parseBackup(bad)).toThrow(/Data non valida/);
  });

  it('unlinks entries that point to a missing food', () => {
    const data = sampleBackup();
    data.entries[0].food_id = 42;
    expect(parseBackup(data).entries[0].food_id).toBeNull();
  });
});

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 9, 5, 23, 30))).toBe('macro-backup-2026-10-05.json');
  });
});

describe('parseBackup version 3', () => {
  const nutrients = { kcal: 100, protein: 10, carbs: 5, fat: 2, sugars: null, fiber: null, sat_fat: null, salt: null };

  function v3() {
    const base = sampleBackup();
    const { water: _water, ...rest } = base;
    return {
      ...rest,
      version: 3,
      foods: [
        ...base.foods,
        { ...base.foods[0], id: 2, barcode: null, name: 'Pollo e riso', source: 'recipe', ref: null, category: null },
      ],
      recipes: [{ food_id: 2, cooked_weight: 1600, servings: 4 }],
      recipe_ingredients: [
        { id: 1, recipe_id: 2, position: 0, food_id: 1, name: 'Spaghetti', brand: null, unit: 'g', quantity: 300, ...nutrients },
        { id: 2, recipe_id: 99, position: 0, food_id: 1, name: 'Orfano', brand: null, unit: 'g', quantity: 1, ...nutrients },
        { id: 3, recipe_id: 2, position: 1, food_id: 42, name: 'Sparito', brand: null, unit: 'g', quantity: 10, ...nutrients },
      ],
      saved_meals: [{ id: 1, name: 'Colazione tipo', created_at: '2026-10-25T08:00:00.000Z' }],
      saved_meal_items: [
        { id: 1, saved_meal_id: 1, position: 0, food_id: 1, name: 'Spaghetti', brand: null, unit: 'g', quantity: 80, ...nutrients },
        { id: 2, saved_meal_id: 7, position: 0, food_id: null, name: 'Orfano', brand: null, unit: 'g', quantity: 0, ...nutrients },
      ],
      day_types: [{ date: '2026-10-25', type: 'rest' }],
    };
  }

  it('reads the new tables and drops rows that point nowhere', () => {
    const backup = parseBackup(v3());
    expect(backup.recipes).toEqual([{ food_id: 2, cooked_weight: 1600, servings: 4 }]);
    expect(backup.recipe_ingredients.map((i) => [i.name, i.food_id])).toEqual([
      ['Spaghetti', 1],
      ['Sparito', null],
    ]);
    expect(backup.saved_meal_items.map((i) => i.name)).toEqual(['Spaghetti']);
    expect(backup.day_types).toEqual([{ date: '2026-10-25', type: 'rest' }]);
    expect(backup).not.toHaveProperty('water');
  });

  it('accepts older files without the new tables, ignoring water', () => {
    const old = parseBackup(sampleBackup());
    expect(old.recipes).toEqual([]);
    expect(old.saved_meals).toEqual([]);
    expect(old.day_types).toEqual([]);
    expect(old).not.toHaveProperty('water');
  });

  it('requires the new tables in a version 3 file and checks day types', () => {
    const { recipes: _recipes, ...noRecipes } = v3();
    expect(() => parseBackup(noRecipes)).toThrow(/recipes/);
    expect(() => parseBackup({ ...v3(), day_types: [{ date: '2026-10-25', type: 'gym' }] })).toThrow(/Tipo di giorno/);
  });
});
