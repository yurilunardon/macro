/**
 * Backup file format. A backup is a JSON copy of every table, so that the diary survives
 * deleting the app or changing the Apple ID used to sign it.
 */
import { isDateKey } from './dates';

export const BACKUP_APP = 'macro';
/** 2 added `ref` and `category` to foods; version 1 files are still accepted. */
export const BACKUP_VERSION = 2;

export type FoodRow = {
  id: number;
  barcode: string | null;
  name: string;
  brand: string | null;
  unit: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  sat_fat: number | null;
  salt: number | null;
  serving_size: number | null;
  serving_label: string | null;
  image_url: string | null;
  source: string;
  favorite: number;
  created_at: string;
  updated_at: string;
  ref: string | null;
  category: string | null;
};

export type EntryRow = {
  id: number;
  date: string;
  meal: string;
  food_id: number | null;
  name: string;
  brand: string | null;
  unit: string;
  quantity: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  sat_fat: number | null;
  salt: number | null;
  created_at: string;
};

export type WeightRow = { date: string; kg: number };
export type WaterRow = { date: string; ml: number };
export type SettingRow = { key: string; value: string };

export type BackupData = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  foods: FoodRow[];
  entries: EntryRow[];
  weights: WeightRow[];
  water: WaterRow[];
  settings: SettingRow[];
};

export class BackupFormatError extends Error {}

type Check = 'number' | 'string' | 'number?' | 'string?';

const FOOD_COLUMNS: Record<keyof FoodRow, Check> = {
  id: 'number',
  barcode: 'string?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  kcal: 'number',
  protein: 'number',
  carbs: 'number',
  fat: 'number',
  sugars: 'number?',
  fiber: 'number?',
  sat_fat: 'number?',
  salt: 'number?',
  serving_size: 'number?',
  serving_label: 'string?',
  image_url: 'string?',
  source: 'string',
  favorite: 'number',
  created_at: 'string',
  updated_at: 'string',
  ref: 'string?',
  category: 'string?',
};

const ENTRY_COLUMNS: Record<keyof EntryRow, Check> = {
  id: 'number',
  date: 'string',
  meal: 'string',
  food_id: 'number?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  quantity: 'number',
  kcal: 'number',
  protein: 'number',
  carbs: 'number',
  fat: 'number',
  sugars: 'number?',
  fiber: 'number?',
  sat_fat: 'number?',
  salt: 'number?',
  created_at: 'string',
};

const WEIGHT_COLUMNS: Record<keyof WeightRow, Check> = { date: 'string', kg: 'number' };
const WATER_COLUMNS: Record<keyof WaterRow, Check> = { date: 'string', ml: 'number' };
const SETTING_COLUMNS: Record<keyof SettingRow, Check> = { key: 'string', value: 'string' };

function matches(value: unknown, check: Check): boolean {
  if (check.endsWith('?') && (value === null || value === undefined)) return true;
  const type = check.replace('?', '');
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string';
}

function readRows<T>(data: Record<string, unknown>, table: string, columns: Record<string, Check>): T[] {
  const rows = data[table];
  if (!Array.isArray(rows)) throw new BackupFormatError(`Manca la tabella "${table}"`);
  return rows.map((row, index) => {
    if (typeof row !== 'object' || row === null) {
      throw new BackupFormatError(`Riga ${index + 1} di "${table}" non valida`);
    }
    const clean: Record<string, unknown> = {};
    for (const [column, check] of Object.entries(columns)) {
      const value = (row as Record<string, unknown>)[column];
      if (!matches(value, check)) {
        throw new BackupFormatError(`Valore non valido in "${table}", riga ${index + 1}, campo "${column}"`);
      }
      clean[column] = value ?? null;
    }
    return clean as T;
  });
}

/** Validates a parsed backup file and returns only the known columns. Throws BackupFormatError. */
export function parseBackup(json: unknown): BackupData {
  if (typeof json !== 'object' || json === null) throw new BackupFormatError('Il file non è un backup');
  const data = json as Record<string, unknown>;
  if (data.app !== BACKUP_APP) throw new BackupFormatError('Il file non è un backup di Macro');
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupFormatError('Backup creato da una versione più recente dell’app');
  }
  const backup: BackupData = {
    app: BACKUP_APP,
    version: data.version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    foods: readRows<FoodRow>(data, 'foods', FOOD_COLUMNS),
    entries: readRows<EntryRow>(data, 'entries', ENTRY_COLUMNS),
    weights: readRows<WeightRow>(data, 'weights', WEIGHT_COLUMNS),
    water: readRows<WaterRow>(data, 'water', WATER_COLUMNS),
    settings: readRows<SettingRow>(data, 'settings', SETTING_COLUMNS),
  };
  for (const row of [...backup.entries, ...backup.weights, ...backup.water]) {
    if (!isDateKey(row.date)) throw new BackupFormatError(`Data non valida nel backup: ${row.date}`);
  }
  const foodIds = new Set(backup.foods.map((f) => f.id));
  for (const entry of backup.entries) {
    if (entry.food_id !== null && !foodIds.has(entry.food_id)) entry.food_id = null;
  }
  return backup;
}

export function backupFileName(exportedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  return `macro-backup-${stamp}.json`;
}
