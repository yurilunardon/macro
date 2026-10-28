import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, fromDateKey, todayKey, weekdayOf, type DateKey } from '@/lib/dates';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { setTrainingSettings } from './days';
import { addEntry } from './entries';
import { getFood } from './foods';
import { setWeight } from './body';
import { addActivity, addPlan, getActivityTypes, setPlanDay } from './calendar';
import { createProgramFromTemplate, getPrograms } from './programs';
import { setSetting } from './settings';
import { addPurchase, addSupplement, setDoseTaken } from './supplements';
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
  await seedCalendar(db, today);

  const pull = (await getPrograms(db))[0].days[1];
  const current = await startWorkout(db, { dayId: pull.id, now: new Date(Date.now() - 25 * 60_000) });
  const live = await getWorkout(db, current);
  const first = live?.exercises[0];
  if (first) {
    await updateSet(db, first.sets[0].id, { weight: 55, reps: 10, done: true });
    await updateSet(db, first.sets[1].id, { weight: 55, reps: 9, done: true });
  }
}

/** Volleyball twice a week, the gym three times, matches, and four supplements ticked most days. */
async function seedCalendar(db: SQLiteDatabase, today: DateKey): Promise<void> {
  const types = await getActivityTypes(db);
  const id = (ref: string) => types.find((t) => t.ref === ref)!.id;
  const start = addDays(today, -70);
  const volley = await addPlan(db, { typeId: id('volleyball'), weekdays: [2, 4], time: '20:30', minutes: 90, dayId: null, note: 'Palestra comunale', startDate: start });
  await addPlan(db, { typeId: id('gym'), weekdays: [1, 3, 5], time: null, minutes: null, dayId: null, note: null, startDate: start });
  for (let i = 1; i <= 70; i++) {
    const date = addDays(today, -i);
    if (weekdayOf(date) === 6 && i % 2 === 1) {
      await addActivity(db, { typeId: id('match'), date, time: '18:00', minutes: 120, dayId: null, note: i < 10 ? 'Contro Treviso, vinta 3–1' : 'In trasferta' });
    }
    if (i === 9 && weekdayOf(date) === 4) await setPlanDay(db, volley, date, { status: 'skipped' });
  }
  const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  await addActivity(db, { typeId: id('match'), date: saturday, time: '18:00', minutes: 120, dayId: null, note: 'Contro Padova, in casa' });

  // Past workouts on Mondays, Wednesdays and Fridays, in the program's turn.
  const days = (await getPrograms(db))[0].days;
  let turn = 0;
  for (let i = 40; i >= 4; i--) {
    const date = addDays(today, -i);
    if (![1, 3, 5].includes(weekdayOf(date)) || i % 7 === 0) continue;
    const at = fromDateKey(date);
    at.setHours(18, 0, 0, 0);
    const workout = await startWorkout(db, { dayId: days[turn % days.length].id, now: at });
    const full = await getWorkout(db, workout);
    for (const ex of full?.exercises ?? []) {
      for (const set of ex.sets) await updateSet(db, set.id, { weight: ex.exercise.equipment === 'barbell' ? 60 : 18, reps: 10, done: true });
    }
    await finishWorkout(db, workout, new Date(at.getTime() + 62 * 60_000));
    turn += 1;
  }

  const supplements = [
    { name: 'Creatina', dose: 5, unit: 'g', packageAmount: 500, packagePrice: 24.9, reminder: '08:00', bought: [-60, -10] },
    { name: 'Omega 3', dose: 2, unit: 'capsule', packageAmount: 120, packagePrice: 19.9, reminder: '08:00', bought: [-45] },
    { name: 'Vitamina C', dose: 1, unit: 'tablet', packageAmount: 60, packagePrice: 7.5, reminder: null, bought: [-50] },
  ] as const;
  for (const [n, s] of supplements.entries()) {
    const sid = await addSupplement(
      db,
      { name: s.name, dose: s.dose, unit: s.unit, timesPerDay: 1, schedule: 'daily', weekdays: [], reminder: s.reminder, packageAmount: s.packageAmount, packagePrice: s.packagePrice },
      addDays(today, -60),
    );
    await db.runAsync('UPDATE supplements SET started_on = ? WHERE id = ?', addDays(today, -60), sid);
    for (const offset of s.bought) await addPurchase(db, { supplementId: sid, date: addDays(today, offset), amount: s.packageAmount, price: s.packagePrice });
    for (let i = 1; i <= 60; i++) if ((i + n) % 9 !== 0) await setDoseTaken(db, sid, addDays(today, -i), 0, true);
    if (n === 0) await setDoseTaken(db, sid, today, 0, true);
  }
  const protein = await addSupplement(
    db,
    { name: 'Proteine in polvere', dose: 30, unit: 'g', timesPerDay: 1, schedule: 'asNeeded', weekdays: [], reminder: null, packageAmount: 1000, packagePrice: 34.9 },
    addDays(today, -60),
  );
  await addPurchase(db, { supplementId: protein, date: addDays(today, -20), amount: 1000, price: 34.9 });
  for (let i = 1; i <= 20; i += 2) await setDoseTaken(db, protein, addDays(today, -i), 0, true);
}
