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
  type EntryRow,
  type FoodRow,
  type SettingRow,
  type WaterRow,
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

export async function readBackup(db: SQLiteDatabase): Promise<BackupData> {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    foods: await db.getAllAsync<FoodRow>(`SELECT ${FOOD_COLUMNS.join(', ')} FROM foods ORDER BY id`),
    entries: await db.getAllAsync<EntryRow>(`SELECT ${ENTRY_COLUMNS.join(', ')} FROM entries ORDER BY id`),
    weights: await db.getAllAsync<WeightRow>('SELECT date, kg FROM weights ORDER BY date'),
    water: await db.getAllAsync<WaterRow>('SELECT date, ml FROM water ORDER BY date'),
    // These describe this phone, not the data.
    settings: await db.getAllAsync<SettingRow>(
      `SELECT key, value FROM settings WHERE key NOT IN ('lastBackupAt', 'genericFoodsVersion')`,
    ),
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
    await tx.execAsync('DELETE FROM entries; DELETE FROM foods; DELETE FROM weights; DELETE FROM water; DELETE FROM settings;');
    await insertRows<FoodRow>(tx, 'foods', FOOD_COLUMNS, backup.foods);
    await insertRows<EntryRow>(tx, 'entries', ENTRY_COLUMNS, backup.entries);
    await insertRows<WeightRow>(tx, 'weights', ['date', 'kg'], backup.weights);
    await insertRows<WaterRow>(tx, 'water', ['date', 'ml'], backup.water);
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
