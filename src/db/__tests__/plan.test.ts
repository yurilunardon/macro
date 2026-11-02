import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expandActivities } from '@/lib/calendar';
import { DEFAULT_MOMENTS, DEFAULT_WEIGH_IN, buildDay, momentOf, sortMoments, trainingTimes } from '@/lib/plan';
import { dosesDue } from '@/lib/supplements';
import { PROGRAM_TEMPLATES } from '@/lib/templates';

import { addPlan, getActivityTypes, getCalendar, setPlanProgramDay } from '../calendar';
import { pinGymDays, seedStartingPlan, setWeekday } from '../plan';
import { createProgramFromTemplate, getPrograms, setActiveProgram } from '../programs';
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

describe('pinning the gym days', () => {
  const TODAY = '2026-11-02';

  const useProgram = async () => {
    await createProgramFromTemplate(db, PROGRAM_TEMPLATES[0]);
    const program = (await getPrograms(db))[0];
    await setActiveProgram(db, program.id);
    return new Map(program.days.map((d) => [d.name, d.id]));
  };
  const dayOn = async (weekday: number) => {
    const { plans, gymTypeId } = await getCalendar(db, TODAY, '2026-11-08');
    return plans.find((p) => p.typeId === gymTypeId && p.weekdays.includes(weekday) && (p.endDate === null || p.endDate >= TODAY))?.dayId;
  };

  it('ties Wednesday to Push, Friday to Pull and Sunday to Legs, keeping when and what', async () => {
    await seedStartingPlan(db, TODAY);
    const days = await useProgram();
    await pinGymDays(db, TODAY);
    expect([await dayOn(3), await dayOn(5), await dayOn(0)]).toEqual([days.get('Push'), days.get('Pull'), days.get('Legs')]);
    const { plans, gymTypeId } = await getCalendar(db, TODAY, '2026-11-08');
    const sunday = plans.find((p) => p.typeId === gymTypeId && p.weekdays.includes(0));
    expect(sunday).toMatchObject({ time: '17:00', minutes: 90, note: 'Gambe' });
  });

  it('waits for a program, then does it', async () => {
    await seedStartingPlan(db, TODAY);
    await pinGymDays(db, TODAY);
    expect(await dayOn(3)).toBeNull();
    const days = await useProgram();
    await pinGymDays(db, TODAY);
    expect(await dayOn(3)).toBe(days.get('Push'));
  });

  it('does it only once, so a later change stays', async () => {
    await seedStartingPlan(db, TODAY);
    await useProgram();
    await pinGymDays(db, TODAY);
    const { plans, gymTypeId } = await getCalendar(db, TODAY, '2026-11-08');
    const wednesday = plans.find((p) => p.typeId === gymTypeId && p.weekdays.includes(3));
    await setPlanProgramDay(db, wednesday?.id ?? 0, null);
    await pinGymDays(db, TODAY);
    expect(await dayOn(3)).toBeNull();
  });

  it('leaves alone a day already tied by hand', async () => {
    await seedStartingPlan(db, TODAY);
    const days = await useProgram();
    const { plans, gymTypeId } = await getCalendar(db, TODAY, '2026-11-08');
    const wednesday = plans.find((p) => p.typeId === gymTypeId && p.weekdays.includes(3));
    await setPlanProgramDay(db, wednesday?.id ?? 0, days.get('Legs') ?? null);
    await pinGymDays(db, TODAY);
    expect(await dayOn(3)).toBe(days.get('Legs'));
  });

  it('splits a plan that holds several gym days', async () => {
    const types = await getActivityTypes(db);
    const gym = types.find((t) => t.ref === 'gym');
    await addPlan(db, { typeId: gym?.id ?? 0, weekdays: [0, 3, 5], time: '20:00', minutes: 60, dayId: null, note: null, startDate: '2026-10-01' });
    const days = await useProgram();
    await pinGymDays(db, TODAY);
    expect([await dayOn(3), await dayOn(5), await dayOn(0)]).toEqual([days.get('Push'), days.get('Pull'), days.get('Legs')]);
  });

  it('keeps the tie when the time of the day changes in the plan', async () => {
    await seedStartingPlan(db, TODAY);
    const days = await useProgram();
    await pinGymDays(db, TODAY);
    const { gymTypeId } = await getCalendar(db, TODAY, '2026-11-08');
    await setWeekday(db, 3, { typeId: gymTypeId ?? 0, time: '20:00', minutes: 90, dayId: days.get('Push') ?? null, note: 'Push' }, TODAY);
    expect(await dayOn(3)).toBe(days.get('Push'));
  });
});
