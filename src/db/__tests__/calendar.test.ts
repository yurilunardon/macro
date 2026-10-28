import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBackup } from '@/lib/backup';
import { buildAgenda, expandActivities } from '@/lib/calendar';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { readBackup, restoreBackup } from '../backup';
import {
  addActivity,
  addActivityType,
  addPlan,
  deleteActivityType,
  endPlan,
  getActivityDates,
  getActivityTypes,
  getCalendar,
  setPlanDay,
  updatePlan,
} from '../calendar';
import { getDayPlan, setTrainingSettings } from '../days';
import { createProgramFromTemplate, getPrograms } from '../programs';
import { migrateDatabase } from '../schema';
import {
  addPurchase,
  addSupplement,
  deleteSupplement,
  getDosesOn,
  getDosesTaken,
  getSupplements,
  getSupplementStock,
  setDoseTaken,
  type SupplementInput,
} from '../supplements';
import { finishWorkout, getWorkout, startWorkout, updateSet } from '../workouts';

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

const typeId = async (ref: string) => (await getActivityTypes(db)).find((t) => t.ref === ref)!.id;

const creatine: SupplementInput = {
  name: 'Creatina',
  dose: 5,
  unit: 'g',
  timesPerDay: 1,
  schedule: 'daily',
  weekdays: [],
  reminder: '08:00',
  packageAmount: 500,
  packagePrice: 25,
};

// 2026-10-26 is a Monday.
describe('activity types', () => {
  it('starts with the gym, volleyball and matches, and adds them back after a restore', async () => {
    expect((await getActivityTypes(db)).map((t) => [t.ref, t.name])).toEqual([
      ['gym', 'Palestra'],
      ['volleyball', 'Pallavolo'],
      ['match', 'Partita'],
    ]);
    const old = parseBackup({ ...(await readBackup(db)), version: 6, activity_types: undefined });
    await restoreBackup(db, old);
    expect(await getActivityTypes(db)).toHaveLength(3);
  });

  it('deletes a kind never used, and only hides one with a past', async () => {
    const padel = await addActivityType(db, { name: 'Padel', symbol: 'figure.pickleball', color: 'blue', minutes: 60 });
    const run = await addActivityType(db, { name: 'Corsa', symbol: 'figure.run', color: 'teal', minutes: 40 });
    await addActivity(db, { typeId: run, date: '2026-10-20', time: null, minutes: null, dayId: null, note: null });
    const plan = await addPlan(db, { typeId: run, weekdays: [6], time: null, minutes: null, dayId: null, note: null, startDate: '2026-10-01' });
    await deleteActivityType(db, padel, '2026-10-28');
    await deleteActivityType(db, run, '2026-10-28');
    await deleteActivityType(db, await typeId('gym'), '2026-10-28');
    const types = await getActivityTypes(db);
    expect(types.map((t) => [t.name, t.archived])).toEqual([
      ['Palestra', false],
      ['Pallavolo', false],
      ['Partita', false],
      ['Corsa', true],
    ]);
    const data = await getCalendar(db, '2026-10-01', '2026-11-30');
    expect(data.plans.find((p) => p.id === plan)?.endDate).toBe('2026-10-27');
  });
});

describe('plans', () => {
  it('changes a plan from a day on, keeping the days before', async () => {
    const volley = await typeId('volleyball');
    const id = await addPlan(db, { typeId: volley, weekdays: [2, 4], time: '20:00', minutes: 90, dayId: null, note: null, startDate: '2026-10-01' });
    await setPlanDay(db, id, '2026-10-29', { status: 'skipped' });
    await setPlanDay(db, id, '2026-10-22', { time: '21:00' });
    const next = await updatePlan(db, id, { typeId: volley, weekdays: [3], time: '19:00', minutes: 90, dayId: null, note: null, startDate: '2026-10-01' }, '2026-10-26');
    expect(next).not.toBe(id);
    const data = await getCalendar(db, '2026-10-19', '2026-11-01');
    const list = expandActivities(data.plans, data.records, '2026-10-19', '2026-11-01');
    expect(list.map((o) => [o.date, o.time])).toEqual([
      ['2026-10-20', '20:00'],
      ['2026-10-22', '21:00'],
      ['2026-10-28', '19:00'],
    ]);
  });

  it('edits in place a plan that has not started yet', async () => {
    const volley = await typeId('volleyball');
    const id = await addPlan(db, { typeId: volley, weekdays: [2], time: null, minutes: null, dayId: null, note: null, startDate: '2026-11-03' });
    expect(await updatePlan(db, id, { typeId: volley, weekdays: [4], time: null, minutes: null, dayId: null, note: 'Palestra comunale', startDate: '2026-11-03' }, '2026-10-28')).toBe(id);
    const data = await getCalendar(db, '2026-11-01', '2026-11-08');
    expect(expandActivities(data.plans, data.records, '2026-11-01', '2026-11-08').map((o) => [o.date, o.note])).toEqual([
      ['2026-11-05', 'Palestra comunale'],
    ]);
  });

  it('ends a plan from a day on, or deletes it if it had not started', async () => {
    const volley = await typeId('volleyball');
    const started = await addPlan(db, { typeId: volley, weekdays: [2], time: null, minutes: null, dayId: null, note: null, startDate: '2026-10-01' });
    const future = await addPlan(db, { typeId: volley, weekdays: [4], time: null, minutes: null, dayId: null, note: null, startDate: '2026-11-01' });
    await setPlanDay(db, started, '2026-11-03', { time: '21:00' });
    await endPlan(db, started, '2026-10-28');
    await endPlan(db, future, '2026-10-28');
    const data = await getCalendar(db, '2026-10-01', '2026-12-31');
    expect(data.plans.map((p) => [p.id, p.endDate])).toEqual([[started, '2026-10-27']]);
    expect(data.records).toEqual([]);
  });

  it('takes one day of a plan off the calendar', async () => {
    const volley = await typeId('volleyball');
    const id = await addPlan(db, { typeId: volley, weekdays: [2, 4], time: null, minutes: null, dayId: null, note: null, startDate: '2026-10-01' });
    await setPlanDay(db, id, '2026-10-27', { status: 'cancelled' });
    await setPlanDay(db, id, '2026-10-27', { status: 'cancelled' });
    const data = await getCalendar(db, '2026-10-26', '2026-11-01');
    expect(expandActivities(data.plans, data.records, '2026-10-26', '2026-11-01').map((o) => o.date)).toEqual(['2026-10-29']);
  });
});

describe('calendar data', () => {
  it('lays out the gym days with the workouts done and the program days to come', async () => {
    await createProgramFromTemplate(db, PROGRAM_TEMPLATES.find((t) => t.key === 'ppl')!);
    const [push, pull, legs] = (await getPrograms(db))[0].days;
    const gym = await typeId('gym');
    await addPlan(db, { typeId: gym, weekdays: [1, 3, 5], time: null, minutes: null, dayId: null, note: null, startDate: '2026-10-01' });
    const id = await startWorkout(db, { dayId: push.id, now: new Date(2026, 9, 26, 18) });
    const first = (await getWorkout(db, id))!.exercises[0].sets[0];
    await updateSet(db, first.id, { weight: 60, reps: 8, done: true });
    expect(await finishWorkout(db, id, new Date(2026, 9, 26, 19))).toBe(true);

    const data = await getCalendar(db, '2026-10-26', '2026-11-01');
    expect(data.rotation).toEqual({ dayIds: [push.id, pull.id, legs.id], next: pull.id });
    const agenda = buildAgenda({
      occurrences: expandActivities(data.plans, data.records, '2026-10-26', '2026-11-01'),
      workouts: data.workouts,
      gymTypeId: data.gymTypeId,
      today: '2026-10-27',
      rotation: data.rotation,
    });
    expect(agenda.get('2026-10-26')?.[0]).toMatchObject({ kind: 'workout', workout: { name: 'Push', endedAt: expect.any(String) } });
    const later = ['2026-10-28', '2026-10-30'].map((d) => {
      const item = agenda.get(d)?.[0];
      return item?.kind === 'activity' ? data.dayNames.get(item.dayId ?? -1) : null;
    });
    expect(later).toEqual(['Pull', 'Legs']);
  });

  it('makes days with an activity training days, but not a gym day missed', async () => {
    await setTrainingSettings(db, { restTargets: { kcal: 2200, protein: 170, carbs: 200, fat: 70 }, trainingWeekdays: [] });
    const volley = await typeId('volleyball');
    const gym = await typeId('gym');
    await addPlan(db, { typeId: volley, weekdays: [2], time: null, minutes: null, dayId: null, note: null, startDate: '2026-10-01' });
    await addActivity(db, { typeId: gym, date: '2026-10-26', time: null, minutes: null, dayId: null, note: null });
    const dates = await getActivityDates(db, '2026-10-26', '2026-11-08', '2026-10-28');
    expect([...dates].sort()).toEqual(['2026-10-27', '2026-11-03']);
    expect((await getDayPlan(db, '2026-10-27')).dayType).toBe('training');
    expect((await getDayPlan(db, '2026-10-28')).dayType).toBe('rest');
  });
});

describe('supplements', () => {
  it('ticks doses and knows what was taken', async () => {
    const id = await addSupplement(db, { ...creatine, timesPerDay: 2 }, '2026-10-20');
    await setDoseTaken(db, id, '2026-10-27', 0, true);
    await setDoseTaken(db, id, '2026-10-27', 1, true);
    await setDoseTaken(db, id, '2026-10-27', 1, true);
    await setDoseTaken(db, id, '2026-10-28', 0, true);
    await setDoseTaken(db, id, '2026-10-28', 0, false);
    expect(await getDosesTaken(db, '2026-10-01', '2026-10-31')).toEqual(new Map([[`${id}:2026-10-27`, 2]]));
    expect(await getDosesOn(db, '2026-10-27')).toEqual(new Map([[id, new Set([0, 1])]]));
    expect((await getSupplements(db))[0]).toMatchObject({ name: 'Creatina', timesPerDay: 2, startedOn: '2026-10-20', reminder: '08:00' });
  });

  it('counts what is left and what a month costs', async () => {
    const id = await addSupplement(db, creatine, '2026-10-01');
    await addPurchase(db, { supplementId: id, date: '2026-10-10', amount: 500, price: 25 });
    for (let day = 10; day < 20; day++) await setDoseTaken(db, id, `2026-10-${day}`, 0, true);
    await setDoseTaken(db, id, '2026-10-05', 0, true);
    const stock = (await getSupplementStock(db, await getSupplements(db), '2026-10-28')).get(id);
    expect(stock).toEqual({ left: 450, daysLeft: 90, monthly: 7.5 });
  });

  it('deletes a supplement never used, and keeps one with a past for the reports', async () => {
    const unused = await addSupplement(db, { ...creatine, name: 'Zinco' }, '2026-10-01');
    const used = await addSupplement(db, creatine, '2026-10-01');
    await setDoseTaken(db, used, '2026-10-02', 0, true);
    await deleteSupplement(db, unused);
    await deleteSupplement(db, used);
    expect(await getSupplements(db)).toEqual([]);
    expect((await getSupplements(db, { archived: true })).map((s) => [s.name, s.archived, s.reminder])).toEqual([['Creatina', true, null]]);
  });
});

describe('backup', () => {
  it('keeps the calendar and the supplements', async () => {
    await createProgramFromTemplate(db, PROGRAM_TEMPLATES.find((t) => t.key === 'ppl')!);
    const push = (await getPrograms(db))[0].days[0];
    const gym = await typeId('gym');
    const plan = await addPlan(db, { typeId: gym, weekdays: [1], time: '18:00', minutes: 75, dayId: push.id, note: null, startDate: '2026-10-01' });
    await setPlanDay(db, plan, '2026-10-26', { status: 'skipped' });
    await addActivityType(db, { name: 'Corsa', symbol: 'figure.run', color: 'teal', minutes: 40 });
    const id = await addSupplement(db, creatine, '2026-10-01');
    await setDoseTaken(db, id, '2026-10-02', 0, true);
    await addPurchase(db, { supplementId: id, date: '2026-10-01', amount: 500, price: 24.9 });

    const exported = await readBackup(db);
    const phone = await freshDatabase();
    await restoreBackup(phone, parseBackup(JSON.parse(JSON.stringify(exported))));
    expect({ ...(await readBackup(phone)), exportedAt: '' }).toEqual({ ...exported, exportedAt: '' });
    expect(exported.activity_plans).toHaveLength(1);
    expect(exported.supplement_doses).toHaveLength(1);
  });
});
