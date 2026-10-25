import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, todayKey } from '@/lib/dates';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { setTrainingSettings } from './days';
import { addEntry } from './entries';
import { getFood } from './foods';
import { setWeight } from './body';
import { createProgramFromTemplate, getPrograms } from './programs';
import { setSetting } from './settings';
import { finishWorkout, getWorkout, startWorkout, updateSet } from './workouts';

/**
 * A realistic week of data for looking at the screens in the web preview (scripts/preview).
 * Only runs when the preview is built with EXPO_PUBLIC_SAMPLE_DATA=1, never in the app.
 */
export async function seedSampleData(db: SQLiteDatabase): Promise<void> {
  const already = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries');
  if ((already?.n ?? 0) > 0) return;
  await setSetting(db, 'targets', { kcal: 2600, protein: 170, carbs: 300, fat: 75 });
  await setTrainingSettings(db, { restTargets: { kcal: 2250, protein: 170, carbs: 220, fat: 75 }, trainingWeekdays: [1, 3, 5] });

  const food = async (name: string) => {
    const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM foods WHERE name = ?', name);
    return row ? getFood(db, row.id) : null;
  };
  const today = todayKey();
  const days = [
    { offset: 0, items: [['breakfast', "Fiocchi d'avena", 60], ['breakfast', 'Yogurt greco 0%', 170], ['breakfast', 'Banana', 120], ['lunch', 'Pasta di semola, cruda', 100], ['lunch', 'Petto di pollo, cotto', 150], ['snack', 'Mela', 180]] },
    { offset: -1, items: [['breakfast', 'Latte parzialmente scremato', 250], ['breakfast', 'Pane integrale', 80], ['lunch', 'Riso bianco, crudo', 90], ['lunch', 'Salmone, cotto', 150], ['dinner', 'Uova strapazzate', 150], ['dinner', 'Zucchine, bollite', 200]] },
    { offset: -2, items: [['lunch', 'Pasta integrale, cruda', 110], ['dinner', 'Petto di pollo, cotto', 200], ['snack', 'Banana', 120]] },
    { offset: -3, items: [['breakfast', "Fiocchi d'avena", 80], ['lunch', 'Riso bianco, crudo', 120], ['dinner', 'Salmone, cotto', 200], ['dinner', 'Pane comune', 100]] },
  ] as const;
  for (const day of days) {
    for (const [meal, name, quantity] of day.items) {
      const f = await food(name);
      if (f) await addEntry(db, { date: addDays(today, day.offset), meal, food: f, quantity });
    }
  }
  for (let i = 0; i < 30; i += 3) await setWeight(db, addDays(today, -i), 81 - i * 0.05 + (i % 2) * 0.3);

  await createProgramFromTemplate(db, PROGRAM_TEMPLATES[0]);
  const push = (await getPrograms(db))[0].days[0];
  const past = await startWorkout(db, { dayId: push.id, now: new Date(Date.now() - 2 * 86_400_000) });
  const pastWorkout = await getWorkout(db, past);
  for (const ex of pastWorkout?.exercises ?? []) {
    for (const set of ex.sets) await updateSet(db, set.id, { weight: ex.exercise.equipment === 'barbell' ? 70 : 20, reps: 9, done: true });
  }
  await finishWorkout(db, past, new Date(Date.now() - 2 * 86_400_000 + 3_600_000));

  const pull = (await getPrograms(db))[0].days[1];
  const current = await startWorkout(db, { dayId: pull.id, now: new Date(Date.now() - 25 * 60_000) });
  const live = await getWorkout(db, current);
  const first = live?.exercises[0];
  if (first) {
    await updateSet(db, first.sets[0].id, { weight: 55, reps: 10, done: true });
    await updateSet(db, first.sets[1].id, { weight: 55, reps: 9, done: true });
  }
}
