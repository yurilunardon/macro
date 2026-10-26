import type { SQLiteDatabase } from 'expo-sqlite';

import { todayKey, type DateKey } from '@/lib/dates';
import { loadIncrement, type Muscle } from '@/lib/exercises';
import {
  bestOneRepMax,
  isSetType,
  isWorkSet,
  suggestNext,
  tonnage,
  type LoggedSet,
  type SetType,
  type Suggestion,
} from '@/lib/training';

import { exerciseFromRow, type Exercise, type ExerciseRow } from './exercises';
import { notifyChange } from './live';
import { moveRow, setOrder } from './ordering';
import { DEFAULT_PLAN, getDay } from './programs';

export type WorkoutSet = LoggedSet & {
  id: number;
  /** Suggested load and reps, shown greyed in the empty fields. */
  targetWeight: number | null;
  targetReps: number | null;
};

export type WorkoutExercise = {
  id: number;
  exercise: Exercise;
  repMin: number | null;
  repMax: number | null;
  restSeconds: number | null;
  note: string | null;
  sets: WorkoutSet[];
  /** The sets of the last session with this exercise, for the "Precedente" column. */
  previous: LoggedSet[];
  suggestion: Suggestion;
};

export type Workout = {
  id: number;
  dayId: number | null;
  name: string;
  date: DateKey;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  exercises: WorkoutExercise[];
};

type SetRow = {
  id: number;
  workout_exercise_id: number;
  type: string;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  rir: number | null;
  target_weight: number | null;
  target_reps: number | null;
  done: number;
  done_at: string | null;
};

function setFromRow(row: SetRow): WorkoutSet {
  return {
    id: row.id,
    type: isSetType(row.type) ? row.type : 'normal',
    weight: row.weight,
    reps: row.reps,
    seconds: row.seconds,
    rir: row.rir,
    done: row.done === 1,
    targetWeight: row.target_weight,
    targetReps: row.target_reps,
  };
}

const EXERCISE_COLUMNS =
  'e.id, e.ref, e.name, e.name_en, e.muscle, e.secondary, e.equipment, e.kind, e.track_rir, e.rest_seconds, e.note';

/** The sets of the last finished workout with this exercise, started before `before`. */
export async function getLastSets(db: SQLiteDatabase, exerciseId: number, before: string): Promise<LoggedSet[]> {
  const last = await db.getFirstAsync<{ id: number }>(
    `SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.ended_at IS NOT NULL AND w.started_at < ?
     ORDER BY w.started_at DESC, we.position LIMIT 1`,
    exerciseId,
    before,
  );
  if (!last) return [];
  const rows = await db.getAllAsync<SetRow>(
    'SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY position, id',
    last.id,
  );
  return rows.map(setFromRow);
}

function suggestionFor(exercise: Exercise, plan: { sets: number; repMin: number; repMax: number }, previous: LoggedSet[]) {
  return suggestNext(plan, previous, loadIncrement(exercise.equipment), exercise.kind);
}

function targetsOf(suggestion: Suggestion): { weight: number | null; reps: number | null } {
  if (suggestion.kind === 'increase' || suggestion.kind === 'repeat') return { weight: suggestion.weight, reps: suggestion.reps };
  if (suggestion.kind === 'hold') return { weight: null, reps: null };
  return { weight: null, reps: null };
}

async function insertSets(
  db: SQLiteDatabase,
  workoutExerciseId: number,
  count: number,
  target: { weight: number | null; reps: number | null },
  from = 0,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.runAsync(
      `INSERT INTO workout_sets (workout_exercise_id, position, type, target_weight, target_reps)
       VALUES (?, ?, 'normal', ?, ?)`,
      workoutExerciseId,
      from + i,
      target.weight,
      target.reps,
    );
  }
}

/** The workout in progress, if any: there is only ever one. */
export async function getActiveWorkout(
  db: SQLiteDatabase,
): Promise<{ id: number; name: string; startedAt: string } | null> {
  const row = await db.getFirstAsync<{ id: number; name: string; started_at: string }>(
    'SELECT id, name, started_at FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  return row ? { id: row.id, name: row.name, startedAt: row.started_at } : null;
}

/**
 * Starts a workout from a day of a program (its exercises and sets, with the suggested loads)
 * or an empty one. If one is already running, that one is returned instead.
 */
export async function startWorkout(
  db: SQLiteDatabase,
  { dayId = null, now = new Date() }: { dayId?: number | null; now?: Date } = {},
): Promise<number> {
  const active = await getActiveWorkout(db);
  if (active) return active.id;
  const day = dayId !== null ? await getDay(db, dayId) : null;
  const startedAt = now.toISOString();
  const workout = await db.runAsync(
    'INSERT INTO workouts (day_id, name, date, started_at) VALUES (?, ?, ?, ?)',
    day?.id ?? null,
    day?.name ?? 'Allenamento libero',
    todayKey(now),
    startedAt,
  );
  const workoutId = workout.lastInsertRowId;
  for (const [position, planned] of (day?.exercises ?? []).entries()) {
    const inserted = await db.runAsync(
      `INSERT INTO workout_exercises (workout_id, exercise_id, position, rep_min, rep_max, rest_seconds, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      workoutId,
      planned.exercise.id,
      position,
      planned.repMin,
      planned.repMax,
      planned.restSeconds,
      planned.note,
    );
    const previous = await getLastSets(db, planned.exercise.id, startedAt);
    await insertSets(db, inserted.lastInsertRowId, planned.sets, targetsOf(suggestionFor(planned.exercise, planned, previous)));
  }
  notifyChange('training', 'settings');
  return workoutId;
}

export async function getWorkout(db: SQLiteDatabase, id: number): Promise<Workout | null> {
  const row = await db.getFirstAsync<{
    id: number;
    day_id: number | null;
    name: string;
    date: string;
    started_at: string;
    ended_at: string | null;
    notes: string | null;
  }>('SELECT * FROM workouts WHERE id = ?', id);
  if (!row) return null;
  const exerciseRows = await db.getAllAsync<
    ExerciseRow & { we_id: number; rep_min: number | null; rep_max: number | null; plan_rest: number | null; plan_note: string | null }
  >(
    `SELECT we.id AS we_id, we.rep_min, we.rep_max, we.rest_seconds AS plan_rest, we.note AS plan_note, ${EXERCISE_COLUMNS}
     FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id
     WHERE we.workout_id = ? ORDER BY we.position, we.id`,
    id,
  );
  const setRows = await db.getAllAsync<SetRow>(
    `SELECT s.* FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
     WHERE we.workout_id = ? ORDER BY s.position, s.id`,
    id,
  );
  // Last time's sets of every exercise, read together rather than one after the other.
  const previousSets = await Promise.all(exerciseRows.map((r) => getLastSets(db, r.id, row.started_at)));
  const exercises: WorkoutExercise[] = [];
  for (const [index, r] of exerciseRows.entries()) {
    const exercise = exerciseFromRow(r);
    const previous = previousSets[index];
    const sets = setRows.filter((s) => s.workout_exercise_id === r.we_id).map(setFromRow);
    const plan = {
      sets: sets.length || DEFAULT_PLAN.sets,
      repMin: r.rep_min ?? DEFAULT_PLAN.repMin,
      repMax: r.rep_max ?? DEFAULT_PLAN.repMax,
    };
    exercises.push({
      id: r.we_id,
      exercise,
      repMin: r.rep_min,
      repMax: r.rep_max,
      restSeconds: r.plan_rest,
      note: r.plan_note,
      sets,
      previous,
      suggestion: suggestionFor(exercise, plan, previous),
    });
  }
  return {
    id: row.id,
    dayId: row.day_id,
    name: row.name,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    exercises,
  };
}

/** Adds an exercise at the end, with as many sets as last time (3 the first time). */
export async function addWorkoutExercise(db: SQLiteDatabase, workoutId: number, exerciseId: number): Promise<number> {
  const workout = await db.getFirstAsync<{ started_at: string }>('SELECT started_at FROM workouts WHERE id = ?', workoutId);
  const exercise = await db.getFirstAsync<ExerciseRow>(`SELECT ${EXERCISE_COLUMNS} FROM exercises e WHERE e.id = ?`, exerciseId);
  if (!workout || !exercise) return 0;
  const last = await db.getFirstAsync<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM workout_exercises WHERE workout_id = ?',
    workoutId,
  );
  const inserted = await db.runAsync(
    'INSERT INTO workout_exercises (workout_id, exercise_id, position, rep_min, rep_max) VALUES (?, ?, ?, ?, ?)',
    workoutId,
    exerciseId,
    (last?.p ?? -1) + 1,
    DEFAULT_PLAN.repMin,
    DEFAULT_PLAN.repMax,
  );
  const previous = await getLastSets(db, exerciseId, workout.started_at);
  const count = previous.filter((s) => s.type !== 'warmup').length || DEFAULT_PLAN.sets;
  await insertSets(db, inserted.lastInsertRowId, count, targetsOf(suggestionFor(exerciseFromRow(exercise), { ...DEFAULT_PLAN, sets: count }, previous)));
  notifyChange('training');
  return inserted.lastInsertRowId;
}

export async function removeWorkoutExercise(db: SQLiteDatabase, workoutExerciseId: number): Promise<void> {
  await db.runAsync('DELETE FROM workout_exercises WHERE id = ?', workoutExerciseId);
  notifyChange('training');
}

export function reorderWorkoutExercises(db: SQLiteDatabase, ids: readonly number[]): Promise<void> {
  return setOrder(db, 'workout_exercises', ids);
}

export function moveWorkoutExercise(db: SQLiteDatabase, workoutExerciseId: number, direction: -1 | 1): Promise<void> {
  return moveRow(db, 'workout_exercises', 'workout_id', workoutExerciseId, direction);
}

/** The rest after each set of this exercise in this workout. */
export async function setWorkoutExerciseRest(db: SQLiteDatabase, workoutExerciseId: number, seconds: number): Promise<void> {
  await db.runAsync('UPDATE workout_exercises SET rest_seconds = ? WHERE id = ?', seconds, workoutExerciseId);
  notifyChange('training');
}

/** Swaps the exercise (e.g. the machine is taken), keeping the sets already done. */
export async function replaceWorkoutExercise(db: SQLiteDatabase, workoutExerciseId: number, exerciseId: number): Promise<void> {
  await db.runAsync('UPDATE workout_exercises SET exercise_id = ? WHERE id = ?', exerciseId, workoutExerciseId);
  await db.runAsync(
    'UPDATE workout_sets SET target_weight = NULL, target_reps = NULL WHERE workout_exercise_id = ? AND done = 0',
    workoutExerciseId,
  );
  notifyChange('training');
}

/** Adds a set after the last one, suggesting the same load and reps. */
export async function addSet(db: SQLiteDatabase, workoutExerciseId: number): Promise<void> {
  const last = await db.getFirstAsync<SetRow & { position: number }>(
    'SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY position DESC, id DESC LIMIT 1',
    workoutExerciseId,
  );
  await insertSets(
    db,
    workoutExerciseId,
    1,
    { weight: last?.weight ?? last?.target_weight ?? null, reps: last?.reps ?? last?.target_reps ?? null },
    (last?.position ?? -1) + 1,
  );
  notifyChange('training');
}

export type SetFields = Partial<Pick<LoggedSet, 'type' | 'weight' | 'reps' | 'seconds' | 'rir' | 'done'>>;

export async function updateSet(db: SQLiteDatabase, setId: number, fields: SetFields): Promise<void> {
  const current = await db.getFirstAsync<SetRow>('SELECT * FROM workout_sets WHERE id = ?', setId);
  if (!current) return;
  const next = { ...setFromRow(current), ...fields };
  await db.runAsync(
    'UPDATE workout_sets SET type = ?, weight = ?, reps = ?, seconds = ?, rir = ?, done = ?, done_at = ? WHERE id = ?',
    next.type,
    next.weight,
    next.reps,
    next.seconds,
    next.rir,
    next.done ? 1 : 0,
    next.done ? (current.done === 1 ? current.done_at : new Date().toISOString()) : null,
    setId,
  );
  notifyChange('training');
}

export async function setSetType(db: SQLiteDatabase, setId: number, type: SetType): Promise<void> {
  await updateSet(db, setId, { type });
}

export async function deleteSet(db: SQLiteDatabase, setId: number): Promise<void> {
  await db.runAsync('DELETE FROM workout_sets WHERE id = ?', setId);
  notifyChange('training');
}

export async function updateWorkoutNotes(db: SQLiteDatabase, id: number, notes: string): Promise<void> {
  await db.runAsync('UPDATE workouts SET notes = ? WHERE id = ?', notes.trim() === '' ? null : notes.trim(), id);
  notifyChange('training');
}

/**
 * Ends the workout: sets left unticked and exercises with no sets are dropped. A workout with
 * nothing done is deleted instead. Returns whether it was kept.
 */
export async function finishWorkout(db: SQLiteDatabase, id: number, now = new Date()): Promise<boolean> {
  await db.runAsync(
    `DELETE FROM workout_sets WHERE done = 0 AND workout_exercise_id IN
       (SELECT id FROM workout_exercises WHERE workout_id = ?)`,
    id,
  );
  await db.runAsync(
    `DELETE FROM workout_exercises WHERE workout_id = ?
       AND NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_exercise_id = workout_exercises.id)`,
    id,
  );
  const left = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workout_exercises WHERE workout_id = ?', id);
  if ((left?.n ?? 0) === 0) {
    await db.runAsync('DELETE FROM workouts WHERE id = ?', id);
    notifyChange('training', 'settings');
    return false;
  }
  await db.runAsync('UPDATE workouts SET ended_at = ? WHERE id = ?', now.toISOString(), id);
  notifyChange('training', 'settings');
  return true;
}

export async function deleteWorkout(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM workouts WHERE id = ?', id);
  notifyChange('training', 'settings');
}

export type WorkoutSummary = {
  id: number;
  name: string;
  date: DateKey;
  startedAt: string;
  endedAt: string;
  exerciseNames: string[];
  workSets: number;
  tonnage: number;
};

/** Finished workouts, newest first. */
export async function getWorkoutHistory(db: SQLiteDatabase, limit = 500): Promise<WorkoutSummary[]> {
  const workouts = await db.getAllAsync<{ id: number; name: string; date: string; started_at: string; ended_at: string }>(
    'SELECT id, name, date, started_at, ended_at FROM workouts WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?',
    limit,
  );
  if (workouts.length === 0) return [];
  const ids = workouts.map((w) => w.id);
  const sets = await db.getAllAsync<SetRow & { workout_id: number; name: string; position_ex: number }>(
    `SELECT s.*, we.workout_id, e.name, we.position AS position_ex
     FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
     WHERE we.workout_id IN (${ids.map(() => '?').join(', ')}) ORDER BY we.position, s.position`,
    ...ids,
  );
  return workouts.map((w) => {
    const own = sets.filter((s) => s.workout_id === w.id);
    const logged = own.map(setFromRow);
    return {
      id: w.id,
      name: w.name,
      date: w.date,
      startedAt: w.started_at,
      endedAt: w.ended_at,
      exerciseNames: [...new Set(own.map((s) => s.name))],
      workSets: logged.filter(isWorkSet).length,
      tonnage: tonnage(logged),
    };
  });
}

export type ExerciseSession = { workoutId: number; date: DateKey; startedAt: string; sets: LoggedSet[]; oneRepMax: number | null };

/** Every finished session of one exercise, newest first, with its best estimated 1RM. */
export async function getExerciseHistory(db: SQLiteDatabase, exerciseId: number): Promise<ExerciseSession[]> {
  const rows = await db.getAllAsync<SetRow & { workout_id: number; date: string; started_at: string }>(
    `SELECT s.*, w.id AS workout_id, w.date, w.started_at
     FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.ended_at IS NOT NULL ORDER BY w.started_at DESC, s.position`,
    exerciseId,
  );
  const sessions: ExerciseSession[] = [];
  for (const row of rows) {
    let session = sessions[sessions.length - 1];
    if (!session || session.workoutId !== row.workout_id) {
      session = { workoutId: row.workout_id, date: row.date, startedAt: row.started_at, sets: [], oneRepMax: null };
      sessions.push(session);
    }
    session.sets.push(setFromRow(row));
  }
  for (const session of sessions) session.oneRepMax = bestOneRepMax(session.sets);
  return sessions;
}

/**
 * Exercises of this workout whose best estimated 1RM beats every earlier session: the records
 * to celebrate at the end.
 */
export async function getRecords(db: SQLiteDatabase, workoutId: number): Promise<{ exercise: Exercise; oneRepMax: number }[]> {
  const workout = await getWorkout(db, workoutId);
  if (!workout) return [];
  const records: { exercise: Exercise; oneRepMax: number }[] = [];
  for (const ex of workout.exercises) {
    const now = bestOneRepMax(ex.sets);
    if (now === null) continue;
    const earlier = (await getExerciseHistory(db, ex.exercise.id)).filter((s) => s.startedAt < workout.startedAt);
    const before = Math.max(0, ...earlier.map((s) => s.oneRepMax ?? 0));
    if (earlier.length > 0 && now > before) records.push({ exercise: ex.exercise, oneRepMax: now });
  }
  return records;
}

/** Work sets per exercise between two dates, with their muscles, for the weekly volume. */
export async function getWorkSetsBetween(
  db: SQLiteDatabase,
  from: DateKey,
  to: DateKey,
): Promise<{ muscle: Muscle; secondary: Muscle[]; count: number }[]> {
  const rows = await db.getAllAsync<ExerciseRow & { n: number }>(
    `SELECT ${EXERCISE_COLUMNS}, COUNT(s.id) AS n
     FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
     WHERE w.ended_at IS NOT NULL AND w.date BETWEEN ? AND ? AND s.done = 1 AND s.type != 'warmup'
     GROUP BY e.id`,
    from,
    to,
  );
  return rows.map((r) => {
    const exercise = exerciseFromRow(r);
    return { muscle: exercise.muscle, secondary: exercise.secondary, count: r.n };
  });
}
