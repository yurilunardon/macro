import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotText } from '@/lib/coach';
import { todayKey } from '@/lib/dates';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { addCoachNotes, getCoachSnapshot } from '../coach';
import { addEntry, deleteEntry, getEntriesForDate } from '../entries';
import { seedExercises } from '../exercises';
import { getFood, insertFood } from '../foods';
import { createProgramFromTemplate } from '../programs';
import { migrateDatabase } from '../schema';
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
});
