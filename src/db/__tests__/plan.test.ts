import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expandActivities } from '@/lib/calendar';
import { DEFAULT_MOMENTS, DEFAULT_WEIGH_IN, buildDay, momentOf, sortMoments, trainingTimes } from '@/lib/plan';
import { dosesDue } from '@/lib/supplements';

import { getActivityTypes, getCalendar } from '../calendar';
import { seedStartingPlan, setWeekday } from '../plan';
import { migrateDatabase } from '../schema';
import { deleteSupplement, getSupplements } from '../supplements';

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
    expect(supplements.map((s) => [s.name, s.schedule, s.moment])).toEqual([
      ['Creatina', 'daily', 'morning'],
      ['Omega 3', 'daily', 'lunch'],
      ['Vitamina D3 + K2', 'alternate', 'lunch'],
      ['Whey', 'active', 'after'],
      ['Magnesio', 'daily', 'evening'],
    ]);
    const { plans } = await getCalendar(db, '2026-11-02', '2026-11-08');
    expect(plans.map((p) => [p.weekdays, p.time, p.note])).toEqual([
      [[2], '21:00', null],
      [[4], '21:00', null],
      [[6], '19:30', null],
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
      ['2026-11-07', '19:30'],
      ['2026-11-08', '17:00'],
    ]);
  });
});

describe('the day', () => {
  it('takes a supplement every other day from when it was added', async () => {
    const s = { schedule: 'alternate' as const, weekdays: [], timesPerDay: 1, startedOn: '2026-11-02' };
    expect(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => dosesDue(s, d, new Set()))).toEqual([1, 0, 1, 0]);
  });

  it('puts each thing in its moment, the ones tied to training at its times', async () => {
    await seedStartingPlan(db, '2026-11-02');
    const supplements = await getSupplements(db);
    const training = { start: '21:00', end: '22:30' };
    const sections = buildDay({
      date: '2026-11-04',
      moments: DEFAULT_MOMENTS,
      training,
      supplements,
      taken: new Map([[`${supplements[0].id}:0`, '2026-11-04T07:34:00.000Z']]),
      active: new Set(['2026-11-04']),
      weighIn: DEFAULT_WEIGH_IN,
      weight: null,
    });
    expect(sections.map((s) => [s.moment.id, s.time, s.entries.map((e) => (e.kind === 'weighIn' ? 'Pesata' : e.supplement.name))])).toEqual([
      ['morning', '07:00', ['Pesata', 'Creatina']],
      ['lunch', '13:00', ['Omega 3', 'Vitamina D3 + K2']],
      ['after', '22:30', ['Whey']],
      ['evening', '23:30', ['Magnesio']],
    ]);
    expect(sections[0].entries[1].done).toBe(true);
  });

  it('places a supplement with its own time in the last moment before it', () => {
    const sorted = sortMoments(DEFAULT_MOMENTS, null);
    expect(momentOf({ moment: null, reminder: '15:00' }, sorted, null)?.id).toBe('lunch');
    expect(momentOf({ moment: null, reminder: '06:00' }, sorted, null)?.id).toBe('morning');
  });

  it('reads the training times from the day', () => {
    const types = new Map([[1, { id: 1, ref: 'volleyball', name: 'Pallavolo', symbol: 'figure.volleyball', color: 'orange' as const, minutes: 90, archived: false }]]);
    const occurrence = { key: 'p1:2026-11-03', recordId: null, planId: 1, typeId: 1, date: '2026-11-03', time: '21:00', minutes: 120, dayId: null, note: null, status: 'planned' as const };
    expect(trainingTimes([{ kind: 'activity', key: 'x', occurrence, status: 'planned', dayId: null }], types)).toEqual({ start: '21:00', end: '23:00' });
    expect(trainingTimes([], types)).toBeNull();
  });
});
