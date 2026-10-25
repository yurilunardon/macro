import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_TARGETS, type Profile, type Targets } from '@/lib/goals';

import { notifyChange } from './live';

/** Settings are stored as JSON values under these keys. */
type SettingsMap = {
  targets: Targets;
  profile: Profile;
  /** Present when rest days have their own targets; `targets` is then for training days. */
  restTargets: Targets;
  /** Days of the week (Date.getDay(), 0 = Sunday) that are training days. */
  trainingWeekdays: number[];
  lastBackupAt: string;
  /** Which version of the shipped basic foods has been added to this phone. */
  genericFoodsVersion: number;
};

export type SettingKey = keyof SettingsMap;

export async function getSetting<K extends SettingKey>(db: SQLiteDatabase, key: K): Promise<SettingsMap[K] | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SettingsMap[K];
  } catch {
    return null;
  }
}

export async function setSetting<K extends SettingKey>(db: SQLiteDatabase, key: K, value: SettingsMap[K]): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
  notifyChange();
}

/** Targets plus whether the user has set them (otherwise defaults are shown). */
export async function getTargets(db: SQLiteDatabase): Promise<{ targets: Targets; isDefault: boolean }> {
  const targets = await getSetting(db, 'targets');
  return targets ? { targets, isDefault: false } : { targets: DEFAULT_TARGETS, isDefault: true };
}

export async function deleteSetting(db: SQLiteDatabase, key: SettingKey): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', key);
  notifyChange();
}
