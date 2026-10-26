import type { SQLiteDatabase } from 'expo-sqlite';

import { BUILT_IN_EXERCISES, EXERCISES_VERSION } from '@/data/exercises';
import {
  defaultRestSeconds,
  exerciseSearchText,
  isEquipment,
  isMuscle,
  type Equipment,
  type ExerciseKind,
  type Muscle,
} from '@/lib/exercises';
import { normalizeSearch } from '@/lib/search';

import { notifyChange } from './live';
import { getSetting, setSetting } from './settings';

export type Exercise = {
  id: number;
  /** Set for the exercises shipped with the app, null for the ones created by the user. */
  ref: string | null;
  /** Italian name; for custom exercises, the name they were given. */
  name: string;
  nameEn: string | null;
  muscle: Muscle;
  secondary: Muscle[];
  equipment: Equipment;
  kind: ExerciseKind;
  /** Optional "blocks": reps in reserve for each set, and a note that stays with the exercise. */
  trackRir: boolean;
  /** Rest after each set; null uses the default for the muscle and equipment. */
  restSeconds: number | null;
  note: string | null;
};

export type ExerciseRow = {
  id: number;
  ref: string | null;
  name: string;
  name_en: string | null;
  muscle: string;
  secondary: string;
  equipment: string;
  kind: string;
  track_rir: number;
  rest_seconds: number | null;
  note: string | null;
};

export function exerciseFromRow(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    ref: row.ref,
    name: row.name,
    nameEn: row.name_en,
    muscle: isMuscle(row.muscle) ? row.muscle : 'chest',
    secondary: row.secondary.split(',').filter(isMuscle),
    equipment: isEquipment(row.equipment) ? row.equipment : 'other',
    kind: row.kind === 'bodyweight' || row.kind === 'time' ? row.kind : 'weight',
    trackRir: row.track_rir === 1,
    restSeconds: row.rest_seconds,
    note: row.note,
  };
}

/** The rest to use after a set of this exercise. */
export function restFor(exercise: Pick<Exercise, 'restSeconds' | 'muscle' | 'equipment'>): number {
  return exercise.restSeconds ?? defaultRestSeconds(exercise.muscle, exercise.equipment);
}

const COLUMNS = 'id, ref, name, name_en, muscle, secondary, equipment, kind, track_rir, rest_seconds, note';

/**
 * Adds the shipped exercises that are missing. Existing ones are left alone, so the user's
 * settings on them (rest, notes, RIR) survive updates.
 */
export async function seedExercises(db: SQLiteDatabase, { force = false } = {}): Promise<void> {
  if (!force) {
    const version = await getSetting(db, 'exercisesVersion');
    if (version !== null && version >= EXERCISES_VERSION) return;
  }
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    // Existing rows only get the names and search text: the user's options on them stay.
    const statement = await tx.prepareAsync(
      `INSERT INTO exercises (ref, name, name_en, muscle, secondary, equipment, kind, search_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ref) DO UPDATE SET name_en = excluded.name_en, search_text = excluded.search_text`,
    );
    try {
      for (const e of BUILT_IN_EXERCISES) {
        await statement.executeAsync([
          e.ref,
          e.name,
          e.nameEn,
          e.muscle,
          e.secondary.join(','),
          e.equipment,
          e.kind,
          exerciseSearchText(e.name, e.nameEn, e.muscle, e.equipment),
          now,
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
  await setSetting(db, 'exercisesVersion', EXERCISES_VERSION);
}

export async function getExercise(db: SQLiteDatabase, id: number): Promise<Exercise | null> {
  const row = await db.getFirstAsync<ExerciseRow>(`SELECT ${COLUMNS} FROM exercises WHERE id = ?`, id);
  return row ? exerciseFromRow(row) : null;
}

/**
 * Exercises matching every word of the query (name, muscle or equipment), optionally of one
 * muscle; the ones used most often first, then alphabetically.
 */
export async function searchExercises(
  db: SQLiteDatabase,
  { query = '', muscle = null }: { query?: string; muscle?: Muscle | null } = {},
): Promise<Exercise[]> {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const conditions = ['e.archived = 0', ...words.map(() => "e.search_text LIKE ? ESCAPE '\\'")];
  const params: (string | number)[] = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (muscle) {
    conditions.push('e.muscle = ?');
    params.push(muscle);
  }
  const rows = await db.getAllAsync<ExerciseRow & { uses: number }>(
    `SELECT ${COLUMNS.split(', ').map((c) => `e.${c}`).join(', ')},
       (SELECT COUNT(*) FROM workout_exercises we WHERE we.exercise_id = e.id) AS uses
     FROM exercises e WHERE ${conditions.join(' AND ')}
     ORDER BY uses DESC, COALESCE(e.name_en, e.name) COLLATE NOCASE`,
    ...params,
  );
  return rows.map(exerciseFromRow);
}

export type ExerciseDraft = {
  name: string;
  muscle: Muscle;
  secondary: Muscle[];
  equipment: Equipment;
  kind: ExerciseKind;
};

export async function insertExercise(db: SQLiteDatabase, draft: ExerciseDraft): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO exercises (ref, name, muscle, secondary, equipment, kind, search_text, created_at)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
    draft.name.trim(),
    draft.muscle,
    draft.secondary.join(','),
    draft.equipment,
    draft.kind,
    exerciseSearchText(draft.name.trim(), null, draft.muscle, draft.equipment),
    new Date().toISOString(),
  );
  notifyChange('training');
  return result.lastInsertRowId;
}

/** The optional blocks of an exercise: RIR, its own rest and a note. */
export async function updateExerciseOptions(
  db: SQLiteDatabase,
  id: number,
  options: Partial<Pick<Exercise, 'trackRir' | 'restSeconds' | 'note'>>,
): Promise<void> {
  const current = await getExercise(db, id);
  if (!current) return;
  const next = { ...current, ...options };
  await db.runAsync(
    'UPDATE exercises SET track_rir = ?, rest_seconds = ?, note = ? WHERE id = ?',
    next.trackRir ? 1 : 0,
    next.restSeconds,
    next.note && next.note.trim() !== '' ? next.note.trim() : null,
    id,
  );
  notifyChange('training');
}

/**
 * Removes an exercise from the library. One already in the history, or shipped with the app, is
 * only hidden: past workouts keep their names and numbers, and updates do not bring it back.
 */
export async function deleteExercise(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ ref: string | null; uses: number }>(
    'SELECT ref, (SELECT COUNT(*) FROM workout_exercises WHERE exercise_id = ?) AS uses FROM exercises WHERE id = ?',
    id,
    id,
  );
  if (!row) return;
  if (row.ref !== null || row.uses > 0) await db.runAsync('UPDATE exercises SET archived = 1 WHERE id = ?', id);
  else await db.runAsync('DELETE FROM exercises WHERE id = ?', id);
  notifyChange('training');
}

/** Rebuilds the search text, which backups leave out. */
export async function refreshExerciseSearchText(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<ExerciseRow>(`SELECT ${COLUMNS} FROM exercises`);
  for (const row of rows) {
    const e = exerciseFromRow(row);
    await db.runAsync(
      'UPDATE exercises SET search_text = ? WHERE id = ?',
      exerciseSearchText(e.name, e.nameEn, e.muscle, e.equipment),
      e.id,
    );
  }
}
