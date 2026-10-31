import type { SQLiteDatabase } from 'expo-sqlite';

import type { Muscle } from '@/lib/exercises';
import type { ProgramTemplate } from '@/lib/templates';
import { dayIcon, nextInRotation, type DayIcon } from '@/lib/training';

import { exerciseFromRow, type Exercise, type ExerciseRow } from './exercises';
import { notifyChange } from './live';
import { moveRow, setOrder } from './ordering';
import { getSetting, setSetting } from './settings';

/** An exercise as planned in a day of a program: how many sets, in what rep range. */
export type PlannedExercise = {
  id: number;
  exercise: Exercise;
  sets: number;
  /** For holds such as the plank, seconds instead of reps. */
  repMin: number;
  repMax: number;
  /** Rest for this exercise in this day; null uses the exercise's own. */
  restSeconds: number | null;
  note: string | null;
};

export type ProgramDay = { id: number; programId: number; name: string; icon: DayIcon; exercises: PlannedExercise[] };

export type DaySummary = { id: number; name: string; icon: DayIcon; exerciseCount: number; muscles: Muscle[] };

/** A draft is a template being looked at: it is not listed until added to the user's programs. */
export type Program = { id: number; name: string; active: boolean; draft: boolean; days: DaySummary[] };

export type PlanFields = Pick<PlannedExercise, 'sets' | 'repMin' | 'repMax' | 'restSeconds' | 'note'>;

export const DEFAULT_PLAN: PlanFields = { sets: 3, repMin: 8, repMax: 12, restSeconds: null, note: null };

const EXERCISE_COLUMNS =
  'e.id, e.ref, e.name, e.name_en, e.muscle, e.secondary, e.equipment, e.kind, e.track_rir, e.rest_seconds, e.note';

/** Every program, the active one first, with a summary of its days. Drafts only if asked. */
export async function getPrograms(db: SQLiteDatabase, { drafts = false }: { drafts?: boolean } = {}): Promise<Program[]> {
  const programs = await db.getAllAsync<{ id: number; name: string; active: number; draft: number }>(
    `SELECT id, name, active, draft FROM programs ${drafts ? '' : 'WHERE draft = 0'}
     ORDER BY active DESC, created_at DESC, id DESC`,
  );
  const days = await db.getAllAsync<{ id: number; program_id: number; name: string; icon: string | null; muscles: string | null; n: number }>(
    `SELECT d.id, d.program_id, d.name, d.icon, COUNT(x.id) AS n,
       (SELECT GROUP_CONCAT(muscle) FROM (
          SELECT e.muscle AS muscle FROM day_exercises x2 JOIN exercises e ON e.id = x2.exercise_id
          WHERE x2.day_id = d.id GROUP BY e.muscle ORDER BY SUM(x2.sets) DESC, MIN(x2.position) LIMIT 3)) AS muscles
     FROM program_days d LEFT JOIN day_exercises x ON x.day_id = d.id
     GROUP BY d.id ORDER BY d.position, d.id`,
  );
  return programs.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active === 1,
    draft: p.draft === 1,
    days: days
      .filter((d) => d.program_id === p.id)
      .map((d) => ({
        id: d.id,
        name: d.name,
        icon: dayIcon(d.name, d.icon),
        exerciseCount: d.n,
        muscles: (d.muscles ?? '').split(',').filter(Boolean) as Muscle[],
      })),
  }));
}

export async function getProgram(db: SQLiteDatabase, id: number): Promise<Program | null> {
  return (await getPrograms(db, { drafts: true })).find((p) => p.id === id) ?? null;
}

/** The first program becomes the active one: its next day is offered on the training page. */
export async function createProgram(db: SQLiteDatabase, name: string): Promise<number> {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM programs WHERE draft = 0');
  const result = await db.runAsync(
    'INSERT INTO programs (name, active, created_at) VALUES (?, ?, ?)',
    name.trim(),
    (existing?.n ?? 0) === 0 ? 1 : 0,
    new Date().toISOString(),
  );
  notifyChange('training');
  return result.lastInsertRowId;
}

/**
 * Copies a template into a new program, made active. Unknown exercises are skipped. As a
 * `draft` it is only there to be looked at and changed: it touches nothing else until added
 * with addDraft, and is dropped with discardDraft.
 */
export async function createProgramFromTemplate(
  db: SQLiteDatabase,
  template: ProgramTemplate,
  { draft = false }: { draft?: boolean } = {},
): Promise<number> {
  const refs = await db.getAllAsync<{ id: number; ref: string }>('SELECT id, ref FROM exercises WHERE ref IS NOT NULL');
  const idByRef = new Map(refs.map((r) => [r.ref, r.id]));
  let programId = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!draft) await tx.runAsync('UPDATE programs SET active = 0');
    const program = await tx.runAsync(
      'INSERT INTO programs (name, active, draft, created_at) VALUES (?, ?, ?, ?)',
      template.name,
      draft ? 0 : 1,
      draft ? 1 : 0,
      new Date().toISOString(),
    );
    programId = program.lastInsertRowId;
    for (const [dayIndex, day] of template.days.entries()) {
      const inserted = await tx.runAsync(
        'INSERT INTO program_days (program_id, name, position) VALUES (?, ?, ?)',
        programId,
        day.name,
        dayIndex,
      );
      let position = 0;
      for (const ex of day.exercises) {
        const exerciseId = idByRef.get(ex.ref);
        if (exerciseId === undefined) continue;
        await tx.runAsync(
          `INSERT INTO day_exercises (day_id, exercise_id, position, sets, rep_min, rep_max, rest_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          inserted.lastInsertRowId,
          exerciseId,
          position++,
          ex.sets,
          ex.repMin,
          ex.repMax,
          ex.rest,
        );
      }
    }
  });
  notifyChange('training');
  return programId;
}

export async function renameProgram(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE programs SET name = ? WHERE id = ?', name.trim(), id);
  notifyChange('training');
}

/** Adds a draft to the user's programs; it is put in use if no other is. */
export async function addDraft(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    `UPDATE programs SET draft = 0, created_at = ?,
       active = NOT EXISTS (SELECT 1 FROM programs WHERE active = 1 AND draft = 0)
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
  notifyChange('training');
}

export async function discardDraft(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM programs WHERE id = ? AND draft = 1', id);
  notifyChange('training');
}

/** Everything that can be changed in a program, as text: two equal ones mean nothing changed. */
export async function programSnapshot(db: SQLiteDatabase, id: number): Promise<string> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT p.name AS program, d.id AS day, d.name, d.icon, d.position AS dp, x.exercise_id, x.position AS xp,
       x.sets, x.rep_min, x.rep_max, x.rest_seconds, x.note
     FROM programs p LEFT JOIN program_days d ON d.program_id = p.id LEFT JOIN day_exercises x ON x.day_id = d.id
     WHERE p.id = ? ORDER BY d.position, d.id, x.position, x.id`,
    id,
  );
  return JSON.stringify(rows);
}

/** Deletes a program and its days. Workouts already done stay in the history. */
export async function deleteProgram(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM programs WHERE id = ?', id);
  // Keep one program active if any is left.
  await db.runAsync(
    `UPDATE programs SET active = 1 WHERE id = (SELECT id FROM programs WHERE draft = 0 ORDER BY created_at DESC LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM programs WHERE active = 1)`,
  );
  notifyChange('training');
}

export async function setActiveProgram(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE programs SET active = CASE WHEN id = ? THEN 1 ELSE 0 END', id);
  notifyChange('training');
}

export async function addDay(db: SQLiteDatabase, programId: number, name: string): Promise<number> {
  const last = await db.getFirstAsync<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM program_days WHERE program_id = ?',
    programId,
  );
  const result = await db.runAsync(
    'INSERT INTO program_days (program_id, name, position) VALUES (?, ?, ?)',
    programId,
    name.trim(),
    (last?.p ?? -1) + 1,
  );
  notifyChange('training');
  return result.lastInsertRowId;
}

export async function renameDay(db: SQLiteDatabase, dayId: number, name: string): Promise<void> {
  await db.runAsync('UPDATE program_days SET name = ? WHERE id = ?', name.trim(), dayId);
  notifyChange('training');
}

/** The symbol of a day, picked by hand. */
export async function setDayIcon(db: SQLiteDatabase, dayId: number, icon: DayIcon): Promise<void> {
  await db.runAsync('UPDATE program_days SET icon = ? WHERE id = ?', icon, dayId);
  notifyChange('training');
}

export async function deleteDay(db: SQLiteDatabase, dayId: number): Promise<void> {
  await db.runAsync('DELETE FROM program_days WHERE id = ?', dayId);
  notifyChange('training');
}

export function moveDay(db: SQLiteDatabase, dayId: number, direction: -1 | 1): Promise<void> {
  return moveRow(db, 'program_days', 'program_id', dayId, direction);
}

export function moveDayExercise(db: SQLiteDatabase, id: number, direction: -1 | 1): Promise<void> {
  return moveRow(db, 'day_exercises', 'day_id', id, direction);
}

/** Saves the days of a program in the order they were dragged into. */
export function reorderDays(db: SQLiteDatabase, dayIds: readonly number[]): Promise<void> {
  return setOrder(db, 'program_days', dayIds);
}

export function reorderDayExercises(db: SQLiteDatabase, ids: readonly number[]): Promise<void> {
  return setOrder(db, 'day_exercises', ids);
}

type PlannedRow = ExerciseRow & {
  plan_id: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  plan_rest: number | null;
  plan_note: string | null;
};

function plannedFromRow(row: PlannedRow): PlannedExercise {
  return {
    id: row.plan_id,
    exercise: exerciseFromRow(row),
    sets: row.sets,
    repMin: row.rep_min,
    repMax: row.rep_max,
    restSeconds: row.plan_rest,
    note: row.plan_note,
  };
}

export async function getDay(db: SQLiteDatabase, dayId: number): Promise<ProgramDay | null> {
  const day = await db.getFirstAsync<{ id: number; program_id: number; name: string; icon: string | null }>(
    'SELECT id, program_id, name, icon FROM program_days WHERE id = ?',
    dayId,
  );
  if (!day) return null;
  const rows = await db.getAllAsync<PlannedRow>(
    `SELECT x.id AS plan_id, x.sets, x.rep_min, x.rep_max, x.rest_seconds AS plan_rest, x.note AS plan_note,
       ${EXERCISE_COLUMNS}
     FROM day_exercises x JOIN exercises e ON e.id = x.exercise_id
     WHERE x.day_id = ? ORDER BY x.position, x.id`,
    dayId,
  );
  return { id: day.id, programId: day.program_id, name: day.name, icon: dayIcon(day.name, day.icon), exercises: rows.map(plannedFromRow) };
}

export async function getPlannedExercise(db: SQLiteDatabase, id: number): Promise<PlannedExercise | null> {
  const row = await db.getFirstAsync<PlannedRow>(
    `SELECT x.id AS plan_id, x.sets, x.rep_min, x.rep_max, x.rest_seconds AS plan_rest, x.note AS plan_note,
       ${EXERCISE_COLUMNS}
     FROM day_exercises x JOIN exercises e ON e.id = x.exercise_id WHERE x.id = ?`,
    id,
  );
  return row ? plannedFromRow(row) : null;
}

export async function addDayExercise(
  db: SQLiteDatabase,
  dayId: number,
  exerciseId: number,
  plan: PlanFields = DEFAULT_PLAN,
): Promise<number> {
  const last = await db.getFirstAsync<{ p: number | null }>('SELECT MAX(position) AS p FROM day_exercises WHERE day_id = ?', dayId);
  const result = await db.runAsync(
    `INSERT INTO day_exercises (day_id, exercise_id, position, sets, rep_min, rep_max, rest_seconds, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    dayId,
    exerciseId,
    (last?.p ?? -1) + 1,
    plan.sets,
    plan.repMin,
    plan.repMax,
    plan.restSeconds,
    plan.note,
  );
  notifyChange('training');
  return result.lastInsertRowId;
}

export async function updateDayExercise(db: SQLiteDatabase, id: number, plan: PlanFields): Promise<void> {
  await db.runAsync(
    'UPDATE day_exercises SET sets = ?, rep_min = ?, rep_max = ?, rest_seconds = ?, note = ? WHERE id = ?',
    plan.sets,
    Math.min(plan.repMin, plan.repMax),
    Math.max(plan.repMin, plan.repMax),
    plan.restSeconds,
    plan.note && plan.note.trim() !== '' ? plan.note.trim() : null,
    id,
  );
  notifyChange('training');
}

export async function removeDayExercise(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM day_exercises WHERE id = ?', id);
  notifyChange('training');
}

/** The day of the active program to do next: the one after the last finished workout. */
export async function getNextDay(db: SQLiteDatabase): Promise<{ program: Program; day: DaySummary } | null> {
  const program = (await getPrograms(db)).find((p) => p.active);
  if (!program || program.days.length === 0) return null;
  const [last, chosen] = await Promise.all([
    db.getFirstAsync<{ day_id: number; started_at: string }>(
      `SELECT w.day_id, w.started_at FROM workouts w JOIN program_days d ON d.id = w.day_id
       WHERE d.program_id = ? AND w.ended_at IS NOT NULL ORDER BY w.started_at DESC LIMIT 1`,
      program.id,
    ),
    getSetting(db, 'nextDay'),
  ]);
  // A day picked by hand stays next until a workout of this program starts after the choice.
  const picked = chosen && (!last || last.started_at < chosen.chosenAt) ? program.days.find((d) => d.id === chosen.dayId) : undefined;
  if (picked) return { program, day: picked };
  const ids = program.days.map((d) => d.id);
  const nextId = nextInRotation(ids, last?.day_id ?? null);
  const day = program.days.find((d) => d.id === nextId);
  return day ? { program, day } : null;
}

/** Makes a day the next workout, without starting it. */
export async function setNextDay(db: SQLiteDatabase, dayId: number, now = new Date()): Promise<void> {
  await setSetting(db, 'nextDay', { dayId, chosenAt: now.toISOString() });
  notifyChange('training');
}
