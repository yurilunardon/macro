import type { SQLiteDatabase } from 'expo-sqlite';

import { expandActivities } from '@/lib/calendar';
import { addDays, type DateKey } from '@/lib/dates';
import { isWarmUp, type Muscle } from '@/lib/exercises';
import { exerciseParts, type MusclePart } from '@/lib/muscle-parts';
import { checkMuscles, weeklyTimes, type CheckDay, type MuscleCheck } from '@/lib/program-check';

import { getCalendar } from './calendar';
import { searchExercises, type Exercise } from './exercises';
import type { LiveQuery } from './live';
import { getDay, getProgram, type PlannedExercise } from './programs';

/** The calendar weeks looked at to know how often each day comes up. */
const WEEKS = 4;

export type ProgramCheck = {
  program: { id: number; name: string };
  days: CheckDay[];
  muscles: MuscleCheck[];
  /** Every exercise planned in the program, by the row of its day. */
  planned: Map<number, PlannedExercise & { dayId: number }>;
  /** No gym day in the calendar: each day was counted once a week. */
  assumed: boolean;
};

/** A program against the weekly sets each muscle needs, with the gym days of the calendar. */
export async function getProgramCheck(db: SQLiteDatabase, programId: number, today: DateKey): Promise<ProgramCheck | null> {
  const program = await getProgram(db, programId);
  if (!program) return null;
  const to = addDays(today, WEEKS * 7 - 1);
  const [calendar, ...loaded] = await Promise.all([getCalendar(db, today, to), ...program.days.map((d) => getDay(db, d.id))]);
  const days = loaded.filter((d) => d !== null);
  const gym = expandActivities(calendar.plans, calendar.records, today, to).filter(
    (o) => o.typeId === calendar.gymTypeId && o.status !== 'skipped',
  );
  const { times, assumed } = weeklyTimes(
    days.map((d) => d.id),
    gym,
    WEEKS,
    program.active ? (calendar.rotation?.next ?? null) : null,
  );
  const planned = new Map<number, PlannedExercise & { dayId: number }>();
  const checkDays: CheckDay[] = days.map((d) => ({
    id: d.id,
    name: d.name,
    perWeek: times.get(d.id) ?? 0,
    exercises: d.exercises
      .filter((p) => !isWarmUp(p.exercise))
      .map((p) => {
        planned.set(p.id, { ...p, dayId: d.id });
        return { planId: p.id, exerciseId: p.exercise.id, ref: p.exercise.ref, muscle: p.exercise.muscle, secondary: p.exercise.secondary, sets: p.sets };
      }),
  }));
  return { program: { id: program.id, name: program.name }, days: checkDays, muscles: checkMuscles(checkDays), planned, assumed };
}

export function programCheckScreen(programId: number, today: DateKey): LiveQuery<ProgramCheck | null> {
  return { key: `program-check:${programId}:${today}`, query: (db) => getProgramCheck(db, programId, today), topics: ['training', 'calendar'] };
}

/**
 * Exercises for a muscle that the program does not have yet, the most used first; for a part, the
 * ones that name it.
 */
export async function getMuscleSuggestions(
  db: SQLiteDatabase,
  programId: number,
  muscle: Muscle,
  { count = 3, part = null }: { count?: number; part?: MusclePart | null } = {},
): Promise<Exercise[]> {
  const [all, inProgram] = await Promise.all([
    searchExercises(db, { muscle }),
    db.getAllAsync<{ exercise_id: number }>(
      'SELECT x.exercise_id FROM day_exercises x JOIN program_days d ON d.id = x.day_id WHERE d.program_id = ?',
      programId,
    ),
  ]);
  const there = new Set(inProgram.map((r) => r.exercise_id));
  return all.filter((e) => !there.has(e.id) && (part === null || exerciseParts(e).includes(part))).slice(0, count);
}
