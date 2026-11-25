import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotText } from '@/lib/coach';
import { todayKey } from '@/lib/dates';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { addCoachNotes, addCoachWeek, applyCoachProposal, getCoachSnapshot, undoCoachProposal, updateCoachProfile } from '../coach';
import { addEntry, deleteEntry, getEntriesForDate } from '../entries';
import { seedExercises } from '../exercises';
import { getFood, insertFood } from '../foods';
import { createProgramFromTemplate, getPlannedExercise } from '../programs';
import { migrateDatabase } from '../schema';
import { getSetting, setSetting } from '../settings';
import { addSupplement, getDoseTimes, setDoseTaken } from '../supplements';
import { finishWorkout, getWorkout, startWorkout, updateSet } from '../workouts';

import { createTestDatabase } from './test-database';

vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));

let db: SQLiteDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrateDatabase(db);
});

const whey = async () => {
  const id = await insertFood(db, {
    barcode: null,
    name: 'Impact Whey Protein',
    brand: 'Myprotein',
    unit: 'g',
    per100: { kcal: 400, protein: 80, carbs: 6, fat: 7, sugars: null, fiber: null, satFat: null, salt: null },
    servingSize: 25,
    servingLabel: 'misurino',
    imageUrl: null,
    source: 'custom',
  });
  return (await getFood(db, id))!;
};

describe('a supplement that is also a food', () => {
  it('is ticked when logged, and logged when ticked', async () => {
    const today = todayKey();
    const supplement = await addSupplement(db, { name: 'Impact Whey', dose: 25, unit: 'g', schedule: 'asNeeded', weekdays: [], times: [], packageAmount: null, packagePrice: null }, today);
    const food = await whey();

    const entryId = await addEntry(db, { date: today, meal: 'snack', food, quantity: 25 });
    expect((await getDoseTimes(db, today)).has(`${supplement}:0`)).toBe(true);

    await deleteEntry(db, entryId);
    expect((await getDoseTimes(db, today)).size).toBe(0);

    await setDoseTaken(db, supplement, today, 0, true);
    const logged = await getEntriesForDate(db, today);
    expect(logged).toHaveLength(1);
    expect(logged[0].quantity).toBe(25);
    // The food it logged did not tick a second dose.
    expect((await getDoseTimes(db, today)).size).toBe(1);

    await setDoseTaken(db, supplement, today, 0, false);
    expect(await getEntriesForDate(db, today)).toHaveLength(0);
  });

  it('leaves other foods alone', async () => {
    const today = todayKey();
    await addSupplement(db, { name: 'Creatina', dose: 5, unit: 'g', schedule: 'daily', weekdays: [], times: ['08:00'], packageAmount: null, packagePrice: null }, today);
    await addEntry(db, { date: today, meal: 'breakfast', food: await whey(), quantity: 25 });
    expect((await getDoseTimes(db, today)).size).toBe(0);
  });
});

describe('the coach snapshot', () => {
  it('tells the diary, the workouts, the program and the notes', async () => {
    const today = todayKey();
    await seedExercises(db);
    await createProgramFromTemplate(db, PROGRAM_TEMPLATES.find((t) => t.key === 'ppl')!);
    await addEntry(db, { date: today, meal: 'snack', food: await whey(), quantity: 30 });
    const started = new Date(Date.now() - 3_600_000);
    const workoutId = await startWorkout(db, { now: started });
    const workout = (await getWorkout(db, workoutId))!;
    for (const ex of workout.exercises) for (const set of ex.sets) await updateSet(db, set.id, { weight: 60, reps: 10, done: true });
    await finishWorkout(db, workoutId, new Date());
    await addCoachNotes(db, ['Gioca a pallavolo il martedì']);

    const snapshot = await getCoachSnapshot(db, today);
    expect(snapshot.days).toHaveLength(1);
    expect(snapshot.program?.days.length).toBeGreaterThan(0);
    expect(snapshot.notes.map((n) => n.text)).toEqual(['Gioca a pallavolo il martedì']);
    const text = snapshotText(snapshot);
    expect(text).toContain('120 kcal');
    expect(text).toContain('SCHEDA IN USO');
    if (workout.exercises.length > 0) expect(text).toContain('60×10');
  });

  it('applies a proposal of the week and puts it back', async () => {
    const today = todayKey();
    await seedExercises(db);
    await createProgramFromTemplate(db, PROGRAM_TEMPLATES.find((t) => t.key === 'ppl')!);
    await setSetting(db, 'targets', { kcal: 2400, protein: 150, carbs: 260, fat: 70 });
    const snapshot = await getCoachSnapshot(db, today);
    const planned = snapshot.program!.days[0].exercises[0];
    expect(snapshotText(snapshot)).toContain(`[#${planned.id}]`);
    const before = (await getPlannedExercise(db, planned.id))!;

    await addCoachWeek(db, {
      from: '2026-11-16',
      to: '2026-11-22',
      at: 'now',
      summary: ['a'],
      food: '',
      training: '',
      weight: '',
      proposals: [
        { id: 'p0', title: 'Proteine a 170', detail: '', change: { kind: 'targets', day: 'all', kcal: 2500, protein: 170, carbs: null, fat: null }, applied: null },
        { id: 'p1', title: 'Più serie', detail: '', change: { kind: 'exercise', planId: planned.id, sets: 5, repMin: 6, repMax: 8 }, applied: null },
      ],
    });
    await applyCoachProposal(db, '2026-11-16', 'p0');
    await applyCoachProposal(db, '2026-11-16', 'p1');
    expect(await getSetting(db, 'targets')).toEqual({ kcal: 2500, protein: 170, carbs: 260, fat: 70 });
    expect(await getPlannedExercise(db, planned.id)).toMatchObject({ sets: 5, repMin: 6, repMax: 8 });

    await undoCoachProposal(db, '2026-11-16', 'p0');
    await undoCoachProposal(db, '2026-11-16', 'p1');
    expect(await getSetting(db, 'targets')).toEqual({ kcal: 2400, protein: 150, carbs: 260, fat: 70 });
    expect(await getPlannedExercise(db, planned.id)).toMatchObject({ sets: before.sets, repMin: before.repMin, repMax: before.repMax });
    expect((await getSetting(db, 'coachWeeks'))![0].proposals.every((p) => p.applied === null)).toBe(true);
  });

  it('keeps the fields of the card the coach rewrites', async () => {
    await updateCoachProfile(db, { sleep: 'circa 7 ore', body: 'ginocchio delicato' });
    await updateCoachProfile(db, { sleep: 'circa 8 ore', body: '' });
    expect(await getSetting(db, 'coachProfile')).toEqual({ sleep: 'circa 8 ore' });
  });
});
