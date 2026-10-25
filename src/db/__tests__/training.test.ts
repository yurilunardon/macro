import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_EXERCISES } from '@/data/exercises';
import { parseBackup } from '@/lib/backup';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { readBackup, restoreBackup } from '../backup';
import { getDayPlan, setTrainingSettings } from '../days';
import { deleteExercise, insertExercise, searchExercises, seedExercises, updateExerciseOptions } from '../exercises';
import {
  addDay,
  addDayExercise,
  createProgram,
  createProgramFromTemplate,
  deleteProgram,
  getDay,
  getNextDay,
  getPrograms,
  moveDayExercise,
} from '../programs';
import { migrateDatabase } from '../schema';
import { setSetting } from '../settings';
import {
  addSet,
  addWorkoutExercise,
  finishWorkout,
  getActiveWorkout,
  getExerciseHistory,
  getRecords,
  getWorkSetsBetween,
  getWorkout,
  getWorkoutHistory,
  startWorkout,
  updateSet,
} from '../workouts';

import { createTestDatabase } from './test-database';

vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));

async function freshDatabase(): Promise<SQLiteDatabase> {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDatabase();
});

const ppl = PROGRAM_TEMPLATES.find((t) => t.key === 'ppl')!;

/** Ticks every set of a workout with the given load and reps. */
async function doAllSets(workoutId: number, weight: number, reps: number) {
  const workout = (await getWorkout(db, workoutId))!;
  for (const ex of workout.exercises) for (const set of ex.sets) await updateSet(db, set.id, { weight, reps, done: true });
}

describe('exercise library', () => {
  it('ships every exercise once and finds them by name, muscle or equipment', async () => {
    await seedExercises(db, { force: true });
    expect(await searchExercises(db)).toHaveLength(BUILT_IN_EXERCISES.length);
    expect((await searchExercises(db, { query: 'panca manubri' })).map((e) => e.name)).toEqual(
      expect.arrayContaining(['Panca piana con manubri', 'Panca inclinata con manubri']),
    );
    expect((await searchExercises(db, { muscle: 'calves' })).every((e) => e.muscle === 'calves')).toBe(true);
    expect((await searchExercises(db, { query: 'petto bilanciere' })).length).toBeGreaterThan(0);
    expect((await searchExercises(db, { query: 'bench press' }))[0]).toMatchObject({
      name: 'Panca piana con bilanciere',
      nameEn: 'Bench press',
    });
  });

  it('keeps custom exercises, options and hides deleted ones', async () => {
    const id = await insertExercise(db, { name: 'Panca Technogym', muscle: 'chest', secondary: [], equipment: 'machine', kind: 'weight' });
    await updateExerciseOptions(db, id, { trackRir: true, restSeconds: 150, note: 'Sedile 4' });
    const [found] = await searchExercises(db, { query: 'technogym' });
    expect(found).toMatchObject({ id, trackRir: true, restSeconds: 150, note: 'Sedile 4', ref: null });
    await deleteExercise(db, id);
    expect(await searchExercises(db, { query: 'technogym' })).toEqual([]);
  });
});

describe('programs', () => {
  it('copies a template, active, with its days and planned exercises', async () => {
    const id = await createProgramFromTemplate(db, ppl);
    const [program] = await getPrograms(db);
    expect(program).toMatchObject({ id, name: 'Push Pull Legs', active: true });
    expect(program.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
    const push = (await getDay(db, program.days[0].id))!;
    expect(push.exercises[0]).toMatchObject({ sets: 3, repMin: 6, repMax: 10, restSeconds: 180 });
    expect(push.exercises[0].exercise.name).toBe('Panca piana con bilanciere');
    expect(program.days[0].muscles[0]).toBe('chest');
  });

  it('builds a program by hand and reorders its exercises', async () => {
    const programId = await createProgram(db, 'Mia scheda');
    const dayId = await addDay(db, programId, 'Giorno A');
    const [bench, row] = await searchExercises(db, { query: 'panca piana bilanciere' }).then(async (a) => [
      a[0],
      (await searchExercises(db, { query: 'rematore bilanciere' }))[0],
    ]);
    const first = await addDayExercise(db, dayId, bench.id);
    await addDayExercise(db, dayId, row.id, { sets: 4, repMin: 6, repMax: 8, restSeconds: null, note: null });
    await moveDayExercise(db, first, 1);
    const day = (await getDay(db, dayId))!;
    expect(day.exercises.map((e) => [e.exercise.name, e.sets])).toEqual([
      ['Rematore con bilanciere', 4],
      ['Panca piana con bilanciere', 3],
    ]);
    expect((await getPrograms(db))[0].active).toBe(true);
    await deleteProgram(db, programId);
    expect(await getPrograms(db)).toEqual([]);
  });
});

describe('workouts', () => {
  it('starts the next day of the program with its sets, then suggests progress', async () => {
    await createProgramFromTemplate(db, ppl);
    const next = (await getNextDay(db))!;
    expect(next.day.name).toBe('Push');

    const firstId = await startWorkout(db, { dayId: next.day.id, now: new Date('2026-10-26T17:00:00Z') });
    expect(await startWorkout(db)).toBe(firstId);
    const first = (await getWorkout(db, firstId))!;
    expect(first.exercises).toHaveLength(6);
    expect(first.exercises[0].sets).toHaveLength(3);
    expect(first.exercises[0].sets[0]).toMatchObject({ targetWeight: null, done: false });

    // Bench at the top of its 6-10 range on every set: next time, +2.5 kg and back to 6.
    await doAllSets(firstId, 80, 10);
    expect(await finishWorkout(db, firstId, new Date('2026-10-26T18:00:00Z'))).toBe(true);
    expect(await getActiveWorkout(db)).toBeNull();
    expect((await getNextDay(db))!.day.name).toBe('Pull');

    const pushId = (await getPrograms(db))[0].days[0].id;
    const secondId = await startWorkout(db, { dayId: pushId, now: new Date('2026-10-29T17:00:00Z') });
    const bench = (await getWorkout(db, secondId))!.exercises[0];
    expect(bench.previous.map((s) => [s.weight, s.reps])).toEqual([[80, 10], [80, 10], [80, 10]]);
    expect(bench.sets[0]).toMatchObject({ targetWeight: 82.5, targetReps: 6 });

    await updateSet(db, bench.sets[0].id, { weight: 85, reps: 8, done: true });
    await finishWorkout(db, secondId, new Date('2026-10-29T18:00:00Z'));
    expect((await getRecords(db, secondId)).map((r) => [r.exercise.name, r.oneRepMax])).toEqual([['Panca piana con bilanciere', expect.closeTo(107.67, 1)]]);

    const history = await getWorkoutHistory(db);
    expect(history.map((w) => [w.name, w.workSets])).toEqual([
      ['Push', 1],
      ['Push', 17],
    ]);
    const benchHistory = await getExerciseHistory(db, bench.exercise.id);
    expect(benchHistory.map((s) => s.sets.length)).toEqual([1, 3]);
  });

  it('drops unticked sets on finish, and deletes a workout with nothing done', async () => {
    const id = await startWorkout(db, { now: new Date('2026-10-26T17:00:00Z') });
    const [squat] = await searchExercises(db, { query: 'squat con bilanciere' });
    const we = await addWorkoutExercise(db, id, squat.id);
    await addSet(db, we);
    const sets = (await getWorkout(db, id))!.exercises[0].sets;
    expect(sets).toHaveLength(4);
    await updateSet(db, sets[0].id, { weight: 60, reps: 10, type: 'warmup', done: true });
    await updateSet(db, sets[1].id, { weight: 100, reps: 5, done: true });
    await finishWorkout(db, id);
    expect((await getWorkout(db, id))!.exercises[0].sets).toHaveLength(2);

    const empty = await startWorkout(db);
    expect(await finishWorkout(db, empty)).toBe(false);
    expect(await getWorkout(db, empty)).toBeNull();
  });

  it('counts work sets per muscle and makes the day a training day', async () => {
    await setSetting(db, 'targets', { kcal: 2600, protein: 170, carbs: 300, fat: 75 });
    await setTrainingSettings(db, { restTargets: { kcal: 2200, protein: 170, carbs: 230, fat: 70 }, trainingWeekdays: [] });
    expect((await getDayPlan(db, '2026-10-26')).dayType).toBe('rest');

    const id = await startWorkout(db, { now: new Date('2026-10-26T09:00:00') });
    const [bench] = await searchExercises(db, { query: 'panca piana bilanciere' });
    await addWorkoutExercise(db, id, bench.id);
    await doAllSets(id, 60, 10);
    await finishWorkout(db, id);

    const volume = await getWorkSetsBetween(db, '2026-10-26', '2026-11-01');
    expect(volume).toEqual([{ muscle: 'chest', secondary: ['triceps', 'shoulders'], count: 3 }]);
    expect((await getDayPlan(db, '2026-10-26')).dayType).toBe('training');
  });
});

describe('training backup', () => {
  it('round-trips programs and workouts', async () => {
    await createProgramFromTemplate(db, ppl);
    const day = (await getPrograms(db))[0].days[0];
    const id = await startWorkout(db, { dayId: day.id, now: new Date('2026-10-26T17:00:00Z') });
    await doAllSets(id, 50, 8);
    await finishWorkout(db, id);
    const custom = await insertExercise(db, { name: 'Mio esercizio', muscle: 'abs', secondary: [], equipment: 'other', kind: 'time' });
    await updateExerciseOptions(db, custom, { note: 'Nota' });

    const exported = await readBackup(db);
    const phone = await freshDatabase();
    await restoreBackup(phone, parseBackup(JSON.parse(JSON.stringify(exported))));
    const restored = await readBackup(phone);
    expect({ ...restored, exportedAt: '' }).toEqual({ ...exported, exportedAt: '' });
    expect((await getWorkoutHistory(phone))[0].workSets).toBe(17);
    expect((await searchExercises(phone, { query: 'mio esercizio' }))[0].note).toBe('Nota');
  });
});
