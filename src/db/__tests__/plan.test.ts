import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expandActivities } from '@/lib/calendar';
import { DEFAULT_WEIGH_IN, buildDay, dayProgress } from '@/lib/plan';
import { dosesDue } from '@/lib/supplements';

import { addPlan, getActivityTypes, getCalendar, moveOccurrence, skipOccurrence } from '../calendar';
import { getWeighInPlan, giveSupplementsTheirTimes, makeRegular, seedStartingPlan, setWeekday } from '../plan';
import { migrateDatabase } from '../schema';
import { setSetting } from '../settings';
import { addSupplement, deleteSupplement, getDoseChanges, getDoseTimes, getSupplements, setDoseSkipped, setDoseTaken, setDoseTime, setUsualTime } from '../supplements';

import { createTestDatabase } from './test-database';

vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

let db: SQLiteDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrateDatabase(db);
});

describe('starting plan', () => {
  it('puts the agreed supplements and week in the calendar once', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const supplements = await getSupplements(db);
    expect(supplements.map((s) => [s.name, s.schedule, s.everyDays, s.times])).toEqual([
      ['Creatina', 'daily', null, ['07:30']],
      ['Omega 3', 'daily', null, ['13:00']],
      ['Vitamina D3 + K2', 'every', 2, ['13:00']],
      ['Whey', 'active', null, ['23:00']],
      ['Magnesio', 'daily', null, ['23:30']],
    ]);
    const { plans } = await getCalendar(db, '2026-11-02', '2026-11-08');
    expect(plans.map((p) => [p.weekdays, p.time, p.note])).toEqual([
      [[2], '21:00', null],
      [[4], '21:00', null],
      [[3], '21:00', 'Push'],
      [[5], '21:00', 'Pull'],
      [[0], '17:00', 'Gambe'],
    ]);

    // Deleted things are not put back.
    await deleteSupplement(db, supplements[0].id);
    await seedStartingPlan(db, '2026-11-03');
    expect((await getSupplements(db)).map((s) => s.name)).not.toContain('Creatina');
  });

  it('changes one day of the week without touching the others', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const volleyball = (await getActivityTypes(db)).find((t) => t.ref === 'volleyball')!.id;
    await setWeekday(db, 3, { typeId: volleyball, time: '20:00', minutes: 60, dayId: null, note: null }, '2026-11-02');
    await setWeekday(db, 5, null, '2026-11-02');
    const { plans, records } = await getCalendar(db, '2026-11-02', '2026-11-08');
    const days = expandActivities(plans, records, '2026-11-02', '2026-11-08').map((o) => [o.date, o.time]);
    expect(days).toEqual([
      ['2026-11-03', '21:00'],
      ['2026-11-04', '20:00'],
      ['2026-11-05', '21:00'],
      ['2026-11-08', '17:00'],
    ]);
  });
});

describe('the day', () => {
  const base = { weekdays: [], timesPerDay: 1, startedOn: '2026-11-02', everyDays: null, onceOn: null };

  it('takes a supplement every so many days, or once, from when it was added', () => {
    const every2 = { ...base, schedule: 'every' as const, everyDays: 2 };
    const every3 = { ...base, schedule: 'every' as const, everyDays: 3 };
    const once = { ...base, schedule: 'once' as const, onceOn: '2026-11-04' };
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    expect(days.map((d) => dosesDue(every2, d, new Set()))).toEqual([1, 0, 1, 0]);
    expect(days.map((d) => dosesDue(every3, d, new Set()))).toEqual([1, 0, 0, 1]);
    expect(days.map((d) => dosesDue(once, d, new Set()))).toEqual([0, 0, 1, 0]);
  });

  const day = async (date: string, active: string[] = [date]) =>
    buildDay({
      date,
      supplements: await getSupplements(db),
      taken: await getDoseTimes(db, date),
      changes: await getDoseChanges(db, date, date),
      active: new Set(active),
      weighIn: DEFAULT_WEIGH_IN,
      weight: null,
    });
  const shown = (entries: Awaited<ReturnType<typeof day>>) => entries.map((e) => `${e.at} ${e.kind === 'weighIn' ? 'Pesata' : e.supplement.name}`);

  it('puts each thing at its own time, in order', async () => {
    await seedStartingPlan(db, '2026-11-02');
    expect(shown(await day('2026-11-04'))).toEqual(['07:05 Pesata', '07:30 Creatina', '13:00 Omega 3', '13:00 Vitamina D3 + K2', '23:00 Whey', '23:30 Magnesio']);
    // Whey only on a day with an activity, the capsule every other day.
    expect(shown(await day('2026-11-03', []))).toEqual(['07:05 Pesata', '07:30 Creatina', '13:00 Omega 3', '23:30 Magnesio']);
  });

  it('puts what was done where it was done, and a dose moved where it was moved to', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const [creatine, omega] = await getSupplements(db);
    const at = new Date(2026, 10, 4, 15, 0).toISOString();
    await setDoseTaken(db, creatine.id, '2026-11-04', 0, true, at);
    await setDoseTime(db, omega.id, '2026-11-04', 0, '14:15');
    const entries = await day('2026-11-04');
    expect(shown(entries)).toEqual(['07:05 Pesata', '13:00 Vitamina D3 + K2', '14:15 Omega 3', '15:00 Creatina', '23:00 Whey', '23:30 Magnesio']);
    expect(entries.find((e) => e.kind === 'supplement' && e.supplement.id === creatine.id)?.done).toBe(true);
    // Another day stays as it was.
    expect(shown(await day('2026-11-05', []))).toContain('07:30 Creatina');
    expect(shown(await day('2026-11-05', []))).toContain('13:00 Omega 3');
  });

  it('counts what was skipped neither as done nor as to do', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const [creatine] = await getSupplements(db);
    await setDoseSkipped(db, creatine.id, '2026-11-03', 0, true);
    expect(dayProgress(await day('2026-11-03', []), { done: 0, total: 0 })).toEqual({ done: 0, total: 3 });
    await setDoseTaken(db, creatine.id, '2026-11-03', 0, true);
    expect(dayProgress(await day('2026-11-03', []), { done: 0, total: 0 })).toEqual({ done: 1, total: 4 });
  });

  it('shows one taken when needed only once taken', async () => {
    const id = await addSupplement(db, { name: 'Proteine', dose: 30, unit: 'g', schedule: 'asNeeded', weekdays: [], times: [], packageAmount: null, packagePrice: null }, '2026-11-01');
    expect(shown(await day('2026-11-03'))).toEqual(['07:05 Pesata']);
    await setDoseTaken(db, id, '2026-11-03', 0, true, new Date(2026, 10, 3, 10, 30).toISOString());
    expect(shown(await day('2026-11-03'))).toEqual(['07:05 Pesata', '10:30 Proteine']);
  });

  it('changes the usual time for good', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const [creatine] = await getSupplements(db);
    await setUsualTime(db, creatine.id, 0, '08:15');
    expect((await getSupplements(db))[0].times).toEqual(['08:15']);
  });

  it('gives its time to what was in a moment, as it stood', async () => {
    const now = new Date().toISOString();
    const add = (name: string, schedule: string, moment: string | null, reminder: string | null) =>
      db.runAsync(
        `INSERT INTO supplements (name, dose, unit, times_per_day, schedule, weekdays, moment, reminder, position, started_on, created_at)
         VALUES (?, 1, 'g', 1, ?, '', ?, ?, 0, '2026-11-01', ?)`,
        name,
        schedule,
        moment,
        reminder,
        now,
      );
    await add('Creatina', 'daily', 'morning', null);
    await add('Omega', 'alternate', 'lunch', null);
    await add('Whey', 'active', 'after', null);
    await add('Sera', 'daily', 'evening', null);
    await add('Mio', 'daily', null, '10:10');
    await add('Bisogno', 'asNeeded', null, null);
    await add('Cambiato', 'daily', 'lunch', null);
    await setSetting(db, 'moments' as never, [{ id: 'evening', time: '22:45' }] as never);
    await giveSupplementsTheirTimes(db);
    const list = await getSupplements(db);
    expect(list.map((s) => [s.name, s.schedule, s.everyDays, s.times])).toEqual([
      ['Creatina', 'daily', null, ['07:30']],
      ['Omega', 'every', 2, ['13:00']],
      ['Whey', 'active', null, ['23:00']],
      ['Sera', 'daily', null, ['22:45']],
      ['Mio', 'daily', null, ['10:10']],
      ['Bisogno', 'asNeeded', null, []],
      ['Cambiato', 'daily', null, ['13:00']],
    ]);
  });

  it('keeps a weigh-in plan saved with a moment', async () => {
    await setSetting(db, 'weighInPlan', { enabled: true, schedule: 'daily', weekdays: [], moment: 'morning' } as never);
    expect((await getWeighInPlan(db)).time).toBe('07:05');
  });
});

describe('moving an activity', () => {
  const FRIDAY = '2026-11-06';
  const pull = async () => {
    const gym = (await getActivityTypes(db)).find((t) => t.ref === 'gym')!.id;
    const id = await addPlan(db, { typeId: gym, weekdays: [5], time: '21:00', minutes: 90, dayId: null, note: 'Pull', startDate: '2026-11-02' });
    return { gym, id };
  };
  const on = async (date: string) => {
    const { plans, records } = await getCalendar(db, date, date);
    return expandActivities(plans, records, date, date).map((o) => [o.time, o.note, o.status]);
  };
  const occurrence = async (date: string) => {
    const { plans, records } = await getCalendar(db, date, date);
    return expandActivities(plans, records, date, date)[0];
  };

  it('moves a day of a plan to another time, and back', async () => {
    await pull();
    const undo = await moveOccurrence(db, await occurrence(FRIDAY), { date: FRIDAY, time: '19:00', minutes: 90 });
    expect(await on(FRIDAY)).toEqual([['19:00', 'Pull', 'planned']]);
    expect(await on('2026-11-13')).toEqual([['21:00', 'Pull', 'planned']]);
    await undo();
    expect(await on(FRIDAY)).toEqual([['21:00', 'Pull', 'planned']]);
  });

  it('moves it to another day by itself, and back', async () => {
    await pull();
    const undo = await moveOccurrence(db, await occurrence(FRIDAY), { date: '2026-11-07', time: '21:00', minutes: 90 });
    expect(await on(FRIDAY)).toEqual([]);
    expect(await on('2026-11-07')).toEqual([['21:00', 'Pull', 'planned']]);
    expect(await on('2026-11-13')).toEqual([['21:00', 'Pull', 'planned']]);
    await undo();
    expect(await on(FRIDAY)).toEqual([['21:00', 'Pull', 'planned']]);
    expect(await on('2026-11-07')).toEqual([]);
  });

  it('makes it regular, leaving what else is on those days', async () => {
    const { gym } = await pull();
    const volleyball = (await getActivityTypes(db)).find((t) => t.ref === 'volleyball')!.id;
    await addPlan(db, { typeId: volleyball, weekdays: [1], time: '21:00', minutes: 120, dayId: null, note: null, startDate: '2026-11-02' });
    await makeRegular(db, await occurrence(FRIDAY), { date: '2026-11-09', time: '18:30', minutes: 90 });
    expect(await on('2026-11-13')).toEqual([]);
    const monday = await getCalendar(db, '2026-11-16', '2026-11-16');
    const list = expandActivities(monday.plans, monday.records, '2026-11-16', '2026-11-16');
    expect(list.map((o) => [o.typeId === gym ? 'gym' : 'volley', o.time]).sort()).toEqual([
      ['gym', '18:30'],
      ['volley', '21:00'],
    ]);
  });

  it('skips one, and puts it back', async () => {
    await pull();
    const undo = await skipOccurrence(db, await occurrence(FRIDAY));
    expect(await on(FRIDAY)).toEqual([['21:00', 'Pull', 'skipped']]);
    await undo();
    expect(await on(FRIDAY)).toEqual([['21:00', 'Pull', 'planned']]);
  });
});
