import type { SQLiteDatabase } from 'expo-sqlite';

import type { Muscle } from '@/lib/exercises';
import type { ProgramTemplate } from '@/lib/templates';
import { nextInRotation } from '@/lib/training';

import { exerciseFromRow, type Exercise, type ExerciseRow } from './exercises';
import { notifyChange } from './live';
import { moveRow } from './ordering';

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

export type ProgramDay = { id: number; programId: number; name: string; exercises: PlannedExercise[] };

export type DaySummary = { id: number; name: string; exerciseCount: number; muscles: Muscle[] };

export type Program = { id: number; name: string; active: boolean; days: DaySummary[] };

export type PlanFields = Pick<PlannedExercise, 'sets' | 'repMin' | 'repMax' | 'restSeconds' | 'note'>;

export const DEFAULT_PLAN: PlanFields = { sets: 3, repMin: 8, repMax: 12, restSeconds: null, note: null };

const EXERCISE_COLUMNS =
  'e.id, e.ref, e.name, e.muscle, e.secondary, e.equipment, e.kind, e.track_rir, e.rest_seconds, e.note';

/** Every program, the active one first, with a summary of its days. */
export async function getPrograms(db: SQLiteDatabase): Promise<Program[]> {
  const programs = await db.getAllAsync<{ id: number; name: string; active: number }>(
    'SELECT id, name, active FROM programs ORDER BY active DESC, created_at DESC, id DESC',
  );
  const days = await db.getAllAsync<{ id: number; program_id: number; name: string; muscles: string | null; n: number }>(
    `SELECT d.id, d.program_id, d.name, COUNT(x.id) AS n,
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
    days: days
      .filter((d) => d.program_id === p.id)
      .map((d) => ({
        id: d.id,
        name: d.name,
        exerciseCount: d.n,
        muscles: (d.muscles ?? '').split(',').filter(Boolean) as Muscle[],
      })),
  }));
}

export async function getProgram(db: SQLiteDatabase, id: number): Promise<Program | null> {
  return (await getPrograms(db)).find((p) => p.id === id) ?? null;
}

/** The first program becomes the active one: its next day is offered on the training page. */
export async function createProgram(db: SQLiteDatabase, name: string): Promise<number> {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM programs');
  const result = await db.runAsync(
    'INSERT INTO programs (name, active, created_at) VALUES (?, ?, ?)',
    name.trim(),
    (existing?.n ?? 0) === 0 ? 1 : 0,
    new Date().toISOString(),
  );
  notifyChange();
  return result.lastInsertRowId;
}

/** Copies a template into a new program, made active. Unknown exercises are skipped. */
export async function createProgramFromTemplate(db: SQLiteDatabase, template: ProgramTemplate): Promise<number> {
  const refs = await db.getAllAsync<{ id: number; ref: string }>('SELECT id, ref FROM exercises WHERE ref IS NOT NULL');
  const idByRef = new Map(refs.map((r) => [r.ref, r.id]));
  let programId = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE programs SET active = 0');
    const program = await tx.runAsync(
      'INSERT INTO programs (name, active, created_at) VALUES (?, 1, ?)',
      template.name,
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
  notifyChange();
  return programId;
}

export async function renameProgram(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE programs SET name = ? WHERE id = ?', name.trim(), id);
  notifyChange();
}

/** Deletes a program and its days. Workouts already done stay in the history. */
export async function deleteProgram(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM programs WHERE id = ?', id);
  // Keep one program active if any is left.
  await db.runAsync(
    `UPDATE programs SET active = 1 WHERE id = (SELECT id FROM programs ORDER BY created_at DESC LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM programs WHERE active = 1)`,
  );
  notifyChange();
}

export async function setActiveProgram(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE programs SET active = CASE WHEN id = ? THEN 1 ELSE 0 END', id);
  notifyChange();
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
  notifyChange();
  return result.lastInsertRowId;
}

export async function renameDay(db: SQLiteDatabase, dayId: number, name: string): Promise<void> {
  await db.runAsync('UPDATE program_days SET name = ? WHERE id = ?', name.trim(), dayId);
  notifyChange();
}

export async function deleteDay(db: SQLiteDatabase, dayId: number): Promise<void> {
  await db.runAsync('DELETE FROM program_days WHERE id = ?', dayId);
  notifyChange();
}

export function moveDay(db: SQLiteDatabase, dayId: number, direction: -1 | 1): Promise<void> {
  return moveRow(db, 'program_days', 'program_id', dayId, direction);
}

export function moveDayExercise(db: SQLiteDatabase, id: number, direction: -1 | 1): Promise<void> {
  return moveRow(db, 'day_exercises', 'day_id', id, direction);
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
  const day = await db.getFirstAsync<{ id: number; program_id: number; name: string }>(
    'SELECT id, program_id, name FROM program_days WHERE id = ?',
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
  return { id: day.id, programId: day.program_id, name: day.name, exercises: rows.map(plannedFromRow) };
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
  notifyChange();
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
  notifyChange();
}

export async function removeDayExercise(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM day_exercises WHERE id = ?', id);
  notifyChange();
}

/** The day of the active program to do next: the one after the last finished workout. */
export async function getNextDay(db: SQLiteDatabase): Promise<{ program: Program; day: DaySummary } | null> {
  const program = (await getPrograms(db)).find((p) => p.active);
  if (!program || program.days.length === 0) return null;
  const last = await db.getFirstAsync<{ day_id: number }>(
    `SELECT w.day_id FROM workouts w JOIN program_days d ON d.id = w.day_id
     WHERE d.program_id = ? AND w.ended_at IS NOT NULL ORDER BY w.started_at DESC LIMIT 1`,
    program.id,
  );
  const ids = program.days.map((d) => d.id);
  const nextId = nextInRotation(ids, last?.day_id ?? null);
  const day = program.days.find((d) => d.id === nextId);
  return day ? { program, day } : null;
}
