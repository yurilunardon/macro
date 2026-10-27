import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_TARGETS, type Profile, type Targets } from '@/lib/goals';
import type { ReminderSettings } from '@/lib/reminders';

import { notifyChange } from './live';

/** Settings are stored as JSON values under these keys. */
type SettingsMap = {
  targets: Targets;
  profile: Profile;
  /** Present when rest days have their own targets; `targets` is then for training days. */
  restTargets: Targets;
  /** Days of the week (Date.getDay(), 0 = Sunday) that are training days. */
  trainingWeekdays: number[];
  /** Weight to reach, in kg, for the forecast in Progressi. */
  goalWeight: number;
  reminders: ReminderSettings;
  lastBackupAt: string;
  /** Which version of the shipped basic foods has been added to this phone. */
  genericFoodsVersion: number;
  /** Which version of the shipped exercise library has been added to this phone. */
  exercisesVersion: number;
  /** End of a rest: a silent banner, or with the system sound (only a vibration in silent mode). */
  restAlert: 'silent' | 'sound';
  /** Which name of the exercises comes first. */
  exerciseNames: 'en' | 'it';
  /** The day picked as the next workout, until a workout starts after `chosenAt`. */
  nextDay: { dayId: number; chosenAt: string };
  /** Meals folded in the diary. */
  collapsedMeals: ('breakfast' | 'lunch' | 'dinner' | 'snack')[];
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
  notifyChange('settings');
}

/** Targets plus whether the user has set them (otherwise defaults are shown). */
export async function getTargets(db: SQLiteDatabase): Promise<{ targets: Targets; isDefault: boolean }> {
  const targets = await getSetting(db, 'targets');
  return targets ? { targets, isDefault: false } : { targets: DEFAULT_TARGETS, isDefault: true };
}

export async function deleteSetting(db: SQLiteDatabase, key: SettingKey): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', key);
  notifyChange('settings');
}
