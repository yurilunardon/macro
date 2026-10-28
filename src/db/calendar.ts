import type { SQLiteDatabase } from 'expo-sqlite';

import {
  buildAgenda,
  busyDates,
  expandActivities,
  GYM_REF,
  isActivityColor,
  type ActivityPlan,
  type ActivityRecord,
  type ActivityType,
  type Occurrence,
  type Rotation,
  type StoredStatus,
  type WorkoutBrief,
} from '@/lib/calendar';
import { addDays, type DateKey } from '@/lib/dates';

import { notifyChange } from './live';
import { getNextDay } from './programs';

type TypeRow = {
  id: number;
  ref: string | null;
  name: string;
  symbol: string;
  color: string;
  minutes: number | null;
  archived: number;
};

type PlanRow = {
  id: number;
  type_id: number;
  weekdays: string;
  time: string | null;
  minutes: number | null;
  day_id: number | null;
  note: string | null;
  start_date: string;
  end_date: string | null;
};

type RecordRow = {
  id: number;
  type_id: number;
  plan_id: number | null;
  date: string;
  time: string | null;
  minutes: number | null;
  day_id: number | null;
  note: string | null;
  status: string;
};

/** The kinds every calendar starts with. The gym cannot be deleted: it is where the workouts go. */
const BUILT_IN_TYPES = [
  { ref: GYM_REF, name: 'Palestra', symbol: 'dumbbell.fill', color: 'green', minutes: 60 },
  { ref: 'volleyball', name: 'Pallavolo', symbol: 'figure.volleyball', color: 'orange', minutes: 90 },
  { ref: 'match', name: 'Partita', symbol: 'trophy.fill', color: 'red', minutes: 120 },
] as const;

/** Adds the built-in kinds missing, e.g. after restoring a backup made before the calendar. */
export async function seedActivityTypes(db: SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();
  for (const [position, t] of BUILT_IN_TYPES.entries()) {
    await db.runAsync(
      `INSERT OR IGNORE INTO activity_types (ref, name, symbol, color, minutes, position, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      t.ref,
      t.name,
      t.symbol,
      t.color,
      t.minutes,
      position,
      now,
    );
  }
}

function typeFromRow(row: TypeRow): ActivityType {
  return {
    id: row.id,
    ref: row.ref,
    name: row.name,
    symbol: row.symbol,
    color: isActivityColor(row.color) ? row.color : 'blue',
    minutes: row.minutes,
    archived: row.archived === 1,
  };
}

function weekdaysFrom(text: string): number[] {
  return text
    .split(',')
    .filter((d) => d !== '')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function planFromRow(row: PlanRow): ActivityPlan {
  return {
    id: row.id,
    typeId: row.type_id,
    weekdays: weekdaysFrom(row.weekdays),
    time: row.time,
    minutes: row.minutes,
    dayId: row.day_id,
    note: row.note,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function isStoredStatus(value: string): value is StoredStatus {
  return value === 'planned' || value === 'done' || value === 'skipped' || value === 'cancelled';
}

function recordFromRow(row: RecordRow): ActivityRecord {
  return {
    id: row.id,
    typeId: row.type_id,
    planId: row.plan_id,
    date: row.date,
    time: row.time,
    minutes: row.minutes,
    dayId: row.day_id,
    note: row.note,
    status: isStoredStatus(row.status) ? row.status : 'planned',
  };
}

/** Every kind, the deleted ones too (past activities still show with them), in the user's order. */
export async function getActivityTypes(db: SQLiteDatabase): Promise<ActivityType[]> {
  const rows = await db.getAllAsync<TypeRow>(
    'SELECT id, ref, name, symbol, color, minutes, archived FROM activity_types ORDER BY position, id',
  );
  return rows.map(typeFromRow);
}

export type ActivityTypeInput = Pick<ActivityType, 'name' | 'symbol' | 'color' | 'minutes'>;

export async function addActivityType(db: SQLiteDatabase, input: ActivityTypeInput): Promise<number> {
  const last = await db.getFirstAsync<{ p: number | null }>('SELECT MAX(position) AS p FROM activity_types');
  const result = await db.runAsync(
    'INSERT INTO activity_types (name, symbol, color, minutes, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.name.trim(),
    input.symbol,
    input.color,
    input.minutes,
    (last?.p ?? -1) + 1,
    new Date().toISOString(),
  );
  notifyChange('calendar');
  return result.lastInsertRowId;
}

export async function updateActivityType(db: SQLiteDatabase, id: number, input: ActivityTypeInput): Promise<void> {
  await db.runAsync(
    'UPDATE activity_types SET name = ?, symbol = ?, color = ?, minutes = ? WHERE id = ?',
    input.name.trim(),
    input.symbol,
    input.color,
    input.minutes,
    id,
  );
  notifyChange('calendar');
}

/**
 * Takes a kind off the lists. One already used stays in the past (its plans stop from today);
 * one never used is deleted. The gym stays.
 */
export async function deleteActivityType(db: SQLiteDatabase, id: number, today: DateKey): Promise<void> {
  const type = await db.getFirstAsync<{ ref: string | null }>('SELECT ref FROM activity_types WHERE id = ?', id);
  if (!type || type.ref === GYM_REF) return;
  const used = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM activities WHERE type_id = ? AND date < ?) +
            (SELECT COUNT(*) FROM activity_plans WHERE type_id = ? AND start_date < ?) AS n`,
    id,
    today,
    id,
    today,
  );
  await db.withExclusiveTransactionAsync(async (tx) => {
    if ((used?.n ?? 0) === 0) {
      await tx.runAsync('DELETE FROM activity_types WHERE id = ?', id);
      return;
    }
    await tx.runAsync('UPDATE activity_types SET archived = 1 WHERE id = ?', id);
    await tx.runAsync('DELETE FROM activities WHERE type_id = ? AND date >= ?', id, today);
    await tx.runAsync('DELETE FROM activity_plans WHERE type_id = ? AND start_date >= ?', id, today);
    await tx.runAsync(
      'UPDATE activity_plans SET end_date = ? WHERE type_id = ? AND (end_date IS NULL OR end_date >= ?)',
      addDays(today, -1),
      id,
      today,
    );
  });
  notifyChange('calendar', 'settings');
}

export type CalendarData = {
  types: ActivityType[];
  gymTypeId: number | null;
  plans: ActivityPlan[];
  records: ActivityRecord[];
  workouts: WorkoutBrief[];
  rotation: Rotation | null;
  /** Names of the days of every program, for gym days planned on one. */
  dayNames: Map<number, string>;
};

/** Finished and running workouts from `from` to `to`, with their work sets. */
async function getWorkoutBriefs(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<WorkoutBrief[]> {
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    date: string;
    started_at: string;
    ended_at: string | null;
    day_id: number | null;
    work_sets: number;
  }>(
    `SELECT w.id, w.name, w.date, w.started_at, w.ended_at, w.day_id,
       (SELECT COUNT(*) FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
        WHERE we.workout_id = w.id AND s.done = 1 AND s.type != 'warmup') AS work_sets
     FROM workouts w WHERE w.date BETWEEN ? AND ? ORDER BY w.started_at`,
    from,
    to,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    date: r.date,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    dayId: r.day_id,
    workSets: r.work_sets,
  }));
}

/** Everything the calendar needs to lay out the days from `from` to `to`. */
export async function getCalendar(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<CalendarData> {
  const [types, plans, records, workouts, next, days] = await Promise.all([
    getActivityTypes(db),
    db.getAllAsync<PlanRow>(
      'SELECT * FROM activity_plans WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY id',
      to,
      from,
    ),
    db.getAllAsync<RecordRow>('SELECT * FROM activities WHERE date BETWEEN ? AND ? ORDER BY date, id', from, to),
    getWorkoutBriefs(db, from, to),
    getNextDay(db),
    db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM program_days'),
  ]);
  return {
    types,
    gymTypeId: types.find((t) => t.ref === GYM_REF)?.id ?? null,
    plans: plans.map(planFromRow),
    records: records.map(recordFromRow),
    workouts,
    rotation: next ? { dayIds: next.program.days.map((d) => d.id), next: next.day.id } : null,
    dayNames: new Map(days.map((d) => [d.id, d.name])),
  };
}

/**
 * The days with an activity planned or done, for the targets of training days. A gym day that
 * went by without a workout does not count.
 */
export async function getActivityDates(db: SQLiteDatabase, from: DateKey, to: DateKey, today: DateKey): Promise<Set<DateKey>> {
  const [plans, records, types] = await Promise.all([
    db.getAllAsync<PlanRow>('SELECT * FROM activity_plans WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)', to, from),
    db.getAllAsync<RecordRow>('SELECT * FROM activities WHERE date BETWEEN ? AND ?', from, to),
    db.getAllAsync<{ id: number }>('SELECT id FROM activity_types WHERE ref = ?', GYM_REF),
  ]);
  if (plans.length === 0 && records.length === 0) return new Set();
  const occurrences = expandActivities(plans.map(planFromRow), records.map(recordFromRow), from, to);
  const workouts = await getWorkoutBriefs(db, from, to);
  return busyDates(buildAgenda({ occurrences, workouts, gymTypeId: types[0]?.id ?? null, today, rotation: null }));
}

export type ActivityInput = {
  typeId: number;
  date: DateKey;
  time: string | null;
  minutes: number | null;
  dayId: number | null;
  note: string | null;
};

function cleanNote(note: string | null): string | null {
  const text = note?.trim() ?? '';
  return text === '' ? null : text;
}

/** Calendar writes change what counts as a training day, hence `settings` too. */
function changed(): void {
  notifyChange('calendar', 'settings');
}

export async function addActivity(db: SQLiteDatabase, input: ActivityInput): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO activities (type_id, plan_id, date, time, minutes, day_id, note, status, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'planned', ?)`,
    input.typeId,
    input.date,
    input.time,
    input.minutes,
    input.dayId,
    cleanNote(input.note),
    new Date().toISOString(),
  );
  changed();
  return result.lastInsertRowId;
}

export async function updateActivity(db: SQLiteDatabase, id: number, input: ActivityInput): Promise<void> {
  await db.runAsync(
    'UPDATE activities SET type_id = ?, date = ?, time = ?, minutes = ?, day_id = ?, note = ? WHERE id = ?',
    input.typeId,
    input.date,
    input.time,
    input.minutes,
    input.dayId,
    cleanNote(input.note),
    id,
  );
  changed();
}

export async function setActivityStatus(db: SQLiteDatabase, id: number, status: StoredStatus): Promise<void> {
  await db.runAsync('UPDATE activities SET status = ? WHERE id = ?', status, id);
  changed();
}

export async function deleteActivity(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM activities WHERE id = ?', id);
  changed();
}

export async function getActivity(db: SQLiteDatabase, id: number): Promise<ActivityRecord | null> {
  const row = await db.getFirstAsync<RecordRow>('SELECT * FROM activities WHERE id = ?', id);
  return row ? recordFromRow(row) : null;
}

export async function getPlan(db: SQLiteDatabase, id: number): Promise<ActivityPlan | null> {
  const row = await db.getFirstAsync<PlanRow>('SELECT * FROM activity_plans WHERE id = ?', id);
  return row ? planFromRow(row) : null;
}

export type PlanInput = Omit<ActivityInput, 'date'> & { weekdays: number[]; startDate: DateKey };

export async function addPlan(db: SQLiteDatabase, input: PlanInput): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO activity_plans (type_id, weekdays, time, minutes, day_id, note, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    input.typeId,
    [...new Set(input.weekdays)].sort((a, b) => a - b).join(','),
    input.time,
    input.minutes,
    input.dayId,
    cleanNote(input.note),
    input.startDate,
    new Date().toISOString(),
  );
  changed();
  return result.lastInsertRowId;
}

/**
 * Changes a plan from `from` on, as "this and the following" in Calendar: the days before keep
 * the plan as it was. The days changed by hand from then on are dropped with the old plan.
 */
export async function updatePlan(db: SQLiteDatabase, id: number, input: PlanInput, from: DateKey): Promise<number> {
  const plan = await getPlan(db, id);
  if (!plan) return id;
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b).join(',');
  let planId = id;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM activities WHERE plan_id = ? AND date >= ?', id, from);
    if (plan.startDate >= from) {
      await tx.runAsync(
        'UPDATE activity_plans SET type_id = ?, weekdays = ?, time = ?, minutes = ?, day_id = ?, note = ?, start_date = ? WHERE id = ?',
        input.typeId,
        weekdays,
        input.time,
        input.minutes,
        input.dayId,
        cleanNote(input.note),
        input.startDate < from ? from : input.startDate,
        id,
      );
      return;
    }
    await tx.runAsync('UPDATE activity_plans SET end_date = ? WHERE id = ?', addDays(from, -1), id);
    const result = await tx.runAsync(
      `INSERT INTO activity_plans (type_id, weekdays, time, minutes, day_id, note, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.typeId,
      weekdays,
      input.time,
      input.minutes,
      input.dayId,
      cleanNote(input.note),
      from,
      plan.endDate,
      new Date().toISOString(),
    );
    planId = result.lastInsertRowId;
  });
  changed();
  return planId;
}

/** Stops a plan from `from` on; one that had not started yet is deleted. */
export async function endPlan(db: SQLiteDatabase, id: number, from: DateKey): Promise<void> {
  const plan = await getPlan(db, id);
  if (!plan) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (plan.startDate >= from) {
      await tx.runAsync('DELETE FROM activity_plans WHERE id = ?', id);
      return;
    }
    await tx.runAsync('DELETE FROM activities WHERE plan_id = ? AND date >= ?', id, from);
    await tx.runAsync('UPDATE activity_plans SET end_date = ? WHERE id = ?', addDays(from, -1), id);
  });
  changed();
}

export type PlanDayFields = Partial<Pick<ActivityRecord, 'time' | 'minutes' | 'dayId' | 'note' | 'status'>>;

/** Changes one day of a plan only, e.g. a practice moved to 21:00, skipped, or taken off. */
export async function setPlanDay(db: SQLiteDatabase, planId: number, date: DateKey, fields: PlanDayFields): Promise<void> {
  const plan = await getPlan(db, planId);
  if (!plan) return;
  const existing = await db.getFirstAsync<RecordRow>('SELECT * FROM activities WHERE plan_id = ? AND date = ?', planId, date);
  const base = existing ? recordFromRow(existing) : { ...plan, status: 'planned' as StoredStatus };
  const next = { ...base, ...fields };
  await db.runAsync(
    `INSERT INTO activities (type_id, plan_id, date, time, minutes, day_id, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (plan_id, date) WHERE plan_id IS NOT NULL
     DO UPDATE SET time = excluded.time, minutes = excluded.minutes, day_id = excluded.day_id, note = excluded.note, status = excluded.status`,
    plan.typeId,
    planId,
    date,
    next.time,
    next.minutes,
    next.dayId,
    cleanNote(next.note),
    next.status,
    new Date().toISOString(),
  );
  changed();
}

/** One day of a plan as changed by hand, if it was. */
export async function getPlanDay(db: SQLiteDatabase, planId: number, date: DateKey): Promise<ActivityRecord | null> {
  const row = await db.getFirstAsync<RecordRow>('SELECT * FROM activities WHERE plan_id = ? AND date = ?', planId, date);
  return row ? recordFromRow(row) : null;
}

/** Which day of the program a gym day is for, on that date only. */
export async function setOccurrenceDay(
  db: SQLiteDatabase,
  occurrence: Pick<Occurrence, 'recordId' | 'planId' | 'date'>,
  dayId: number | null,
): Promise<void> {
  if (occurrence.planId !== null) {
    await setPlanDay(db, occurrence.planId, occurrence.date, { dayId });
    return;
  }
  if (occurrence.recordId === null) return;
  await db.runAsync('UPDATE activities SET day_id = ? WHERE id = ?', dayId, occurrence.recordId);
  changed();
}
