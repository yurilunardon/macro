import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BACKUP_APP,
  BACKUP_VERSION,
  BackupFormatError,
  backupFileName,
  parseBackup,
  type BackupData,
  type DayTypeRow,
  type EntryRow,
  type FoodRow,
  type MeasurementRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type SavedMealItemRow,
  type SavedMealRow,
  type SettingRow,
  type WeightRow,
} from '@/lib/backup';

import { refreshSearchText } from './foods';
import { seedGenericFoods } from './generic';
import { notifyChange } from './live';
import { setSetting } from './settings';

const FOOD_COLUMNS = [
  'id', 'barcode', 'name', 'brand', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'sugars', 'fiber', 'sat_fat',
  'salt', 'serving_size', 'serving_label', 'image_url', 'source', 'favorite', 'created_at', 'updated_at', 'ref',
  'category',
] as const satisfies readonly (keyof FoodRow)[];

const ENTRY_COLUMNS = [
  'id', 'date', 'meal', 'food_id', 'name', 'brand', 'unit', 'quantity', 'kcal', 'protein', 'carbs', 'fat',
  'sugars', 'fiber', 'sat_fat', 'salt', 'created_at',
] as const satisfies readonly (keyof EntryRow)[];

const NUTRIENT_COLUMNS = ['kcal', 'protein', 'carbs', 'fat', 'sugars', 'fiber', 'sat_fat', 'salt'] as const;

const RECIPE_COLUMNS = ['food_id', 'cooked_weight', 'servings'] as const satisfies readonly (keyof RecipeRow)[];

const RECIPE_INGREDIENT_COLUMNS = [
  'id', 'recipe_id', 'position', 'food_id', 'name', 'brand', 'unit', 'quantity', ...NUTRIENT_COLUMNS,
] as const satisfies readonly (keyof RecipeIngredientRow)[];

const SAVED_MEAL_COLUMNS = ['id', 'name', 'created_at'] as const satisfies readonly (keyof SavedMealRow)[];

const SAVED_MEAL_ITEM_COLUMNS = [
  'id', 'saved_meal_id', 'position', 'food_id', 'name', 'brand', 'unit', 'quantity', ...NUTRIENT_COLUMNS,
] as const satisfies readonly (keyof SavedMealItemRow)[];

function select(columns: readonly string[], table: string, order: string): string {
  return `SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${order}`;
}

export async function readBackup(db: SQLiteDatabase): Promise<BackupData> {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    foods: await db.getAllAsync<FoodRow>(select(FOOD_COLUMNS, 'foods', 'id')),
    entries: await db.getAllAsync<EntryRow>(select(ENTRY_COLUMNS, 'entries', 'id')),
    weights: await db.getAllAsync<WeightRow>('SELECT date, kg FROM weights ORDER BY date'),
    // These describe this phone, not the data.
    settings: await db.getAllAsync<SettingRow>(
      `SELECT key, value FROM settings WHERE key NOT IN ('lastBackupAt', 'genericFoodsVersion')`,
    ),
    recipes: await db.getAllAsync<RecipeRow>(select(RECIPE_COLUMNS, 'recipes', 'food_id')),
    recipe_ingredients: await db.getAllAsync<RecipeIngredientRow>(
      select(RECIPE_INGREDIENT_COLUMNS, 'recipe_ingredients', 'id'),
    ),
    saved_meals: await db.getAllAsync<SavedMealRow>(select(SAVED_MEAL_COLUMNS, 'saved_meals', 'id')),
    saved_meal_items: await db.getAllAsync<SavedMealItemRow>(
      select(SAVED_MEAL_ITEM_COLUMNS, 'saved_meal_items', 'id'),
    ),
    day_types: await db.getAllAsync<DayTypeRow>('SELECT date, type FROM day_types ORDER BY date'),
    measurements: await db.getAllAsync<MeasurementRow>('SELECT date, kind, value FROM measurements ORDER BY date, kind'),
  };
}

/** Writes a backup file and opens the share sheet, where "Salva su File" puts it in iCloud Drive. */
export async function shareBackup(db: SQLiteDatabase): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const now = new Date();
  const data = await readBackup(db);
  const file = new File(Paths.cache, backupFileName(now));
  file.create({ overwrite: true });
  await file.write(JSON.stringify(data));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
  await setSetting(db, 'lastBackupAt', now.toISOString());
  return 'shared';
}

async function insertRows<T extends Record<string, unknown>>(
  db: SQLiteDatabase,
  table: string,
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  const statement = await db.prepareAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  try {
    for (const row of rows) {
      await statement.executeAsync(columns.map((c) => row[c] as string | number | null));
    }
  } finally {
    await statement.finalizeAsync();
  }
}

/**
 * Replaces everything in the database with the backup, in one transaction: all or nothing.
 * Basic foods missing from the backup (for example in an old one) are added back afterwards.
 */
export async function restoreBackup(db: SQLiteDatabase, backup: BackupData): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    // Children before parents, so foreign keys never point at a missing row.
    await tx.execAsync(`
      DELETE FROM saved_meal_items; DELETE FROM saved_meals;
      DELETE FROM recipe_ingredients; DELETE FROM recipes;
      DELETE FROM entries; DELETE FROM foods;
      DELETE FROM weights; DELETE FROM day_types; DELETE FROM measurements;
      DELETE FROM settings;
    `);
    await insertRows<FoodRow>(tx, 'foods', FOOD_COLUMNS, backup.foods);
    await insertRows<RecipeRow>(tx, 'recipes', RECIPE_COLUMNS, backup.recipes);
    await insertRows<RecipeIngredientRow>(tx, 'recipe_ingredients', RECIPE_INGREDIENT_COLUMNS, backup.recipe_ingredients);
    await insertRows<EntryRow>(tx, 'entries', ENTRY_COLUMNS, backup.entries);
    await insertRows<SavedMealRow>(tx, 'saved_meals', SAVED_MEAL_COLUMNS, backup.saved_meals);
    await insertRows<SavedMealItemRow>(tx, 'saved_meal_items', SAVED_MEAL_ITEM_COLUMNS, backup.saved_meal_items);
    await insertRows<WeightRow>(tx, 'weights', ['date', 'kg'], backup.weights);
    await insertRows<DayTypeRow>(tx, 'day_types', ['date', 'type'], backup.day_types);
    await insertRows<MeasurementRow>(tx, 'measurements', ['date', 'kind', 'value'], backup.measurements);
    await insertRows<SettingRow>(tx, 'settings', ['key', 'value'], backup.settings);
    await refreshSearchText(tx);
  });
  await seedGenericFoods(db, { force: true });
  notifyChange();
}

export type PickedBackup = { backup: BackupData; fileName: string };

/** Lets the user pick a backup file and validates it. Returns null if they cancel. */
export async function pickBackup(): Promise<PickedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  let json: unknown;
  try {
    json = JSON.parse(await new File(asset.uri).text());
  } catch {
    throw new BackupFormatError('Il file non è un JSON valido');
  }
  return { backup: parseBackup(json), fileName: asset.name };
}
