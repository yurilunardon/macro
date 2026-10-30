import { describe, expect, it } from 'vitest';

import {
  activeDates,
  buildAgenda,
  expandActivities,
  formatMinutes,
  formatWeekdays,
  rotateGymDays,
  summarizeActivity,
  weekStreak,
  type ActivityPlan,
  type ActivityRecord,
  type ActivityType,
  type Occurrence,
  type WorkoutBrief,
} from '../calendar';
import { addMonths, daysFrom, formatMonth, monthGrid, monthRange } from '../dates';
import {
  adherence,
  costPerDose,
  daysLeft,
  dosesDue,
  dosesPerDay,
  formatDose,
  formatEuro,
  formatSchedule,
  monthlyCost,
  percent,
  stockLeft,
  type Supplement,
} from '../supplements';

// 2026-10-26 is a Monday.
const GYM = 1;
const VOLLEY = 2;
const MATCH = 3;

const types: ActivityType[] = [
  { id: GYM, ref: 'gym', name: 'Palestra', symbol: 'dumbbell.fill', color: 'green', minutes: 60, archived: false },
  { id: VOLLEY, ref: 'volleyball', name: 'Pallavolo', symbol: 'figure.volleyball', color: 'orange', minutes: 90, archived: false },
  { id: MATCH, ref: 'match', name: 'Partita', symbol: 'trophy.fill', color: 'red', minutes: 120, archived: false },
];

const plan = (fields: Partial<ActivityPlan>): ActivityPlan => ({
  id: 1,
  typeId: VOLLEY,
  weekdays: [2, 4],
  time: '20:00',
  minutes: null,
  dayId: null,
  note: null,
  startDate: '2026-10-01',
  endDate: null,
  ...fields,
});

const record = (fields: Partial<ActivityRecord>): ActivityRecord => ({
  id: 10,
  typeId: MATCH,
  planId: null,
  date: '2026-10-31',
  time: '18:00',
  minutes: null,
  dayId: null,
  note: 'vs Treviso',
  status: 'planned',
  ...fields,
});

const workout = (fields: Partial<WorkoutBrief>): WorkoutBrief => ({
  id: 100,
  name: 'Push',
  date: '2026-10-26',
  startedAt: '2026-10-26T17:00:00.000Z',
  endedAt: '2026-10-26T18:05:00.000Z',
  dayId: 7,
  workSets: 16,
  ...fields,
});

describe('months', () => {
  it('shows six weeks from the Monday before the first', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-28');
    expect(grid[3]).toBe('2026-10-01');
    expect(grid[41]).toBe('2026-11-08');
  });

  it('moves across years and knows the last day', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(formatMonth('2026-10')).toBe('Ottobre 2026');
    expect(daysFrom('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('expandActivities', () => {
  it('repeats a plan on its weekdays, within its dates', () => {
    const list = expandActivities([plan({ endDate: '2026-10-29' })], [], '2026-10-26', '2026-11-01');
    expect(list.map((o) => o.date)).toEqual(['2026-10-27', '2026-10-29']);
    expect(list[0]).toMatchObject({ key: 'p1:2026-10-27', planId: 1, recordId: null, status: 'planned', time: '20:00' });
  });

  it('puts days changed by hand in place of the plan, and leaves out the ones taken off', () => {
    const list = expandActivities(
      [plan({})],
      [
        record({ id: 11, typeId: VOLLEY, planId: 1, date: '2026-10-27', time: '21:00', status: 'done', note: null }),
        record({ id: 12, typeId: VOLLEY, planId: 1, date: '2026-10-29', status: 'cancelled' }),
        record({}),
      ],
      '2026-10-26',
      '2026-11-01',
    );
    expect(list.map((o) => [o.key, o.time, o.status])).toEqual([
      ['p1:2026-10-27', '21:00', 'done'],
      ['a10', '18:00', 'planned'],
    ]);
  });

  it('sorts untimed activities first on each day', () => {
    const list = expandActivities([], [record({ id: 1, time: '18:00' }), record({ id: 2, time: null })], '2026-10-31', '2026-10-31');
    expect(list.map((o) => o.key)).toEqual(['a2', 'a1']);
  });
});

describe('buildAgenda', () => {
  const gymPlan = plan({ id: 5, typeId: GYM, weekdays: [1, 3, 5], time: null });
  const rotation = { dayIds: [7, 8, 9], next: 8 };

  it('counts activities that are over as done, unless skipped', () => {
    const occurrences = expandActivities(
      [plan({})],
      [record({ id: 11, typeId: VOLLEY, planId: 1, date: '2026-10-29', status: 'skipped' })],
      '2026-10-26',
      '2026-11-01',
    );
    const agenda = buildAgenda({ occurrences, workouts: [], gymTypeId: GYM, today: '2026-10-30', rotation: null });
    expect(agenda.get('2026-10-27')?.[0]).toMatchObject({ kind: 'activity', status: 'done' });
    expect(agenda.get('2026-10-29')?.[0]).toMatchObject({ kind: 'activity', status: 'skipped' });
  });

  it('keeps today and the days to come planned', () => {
    const occurrences = expandActivities([plan({})], [], '2026-10-27', '2026-10-29');
    const agenda = buildAgenda({ occurrences, workouts: [], gymTypeId: GYM, today: '2026-10-27', rotation: null });
    expect(agenda.get('2026-10-27')?.[0]).toMatchObject({ status: 'planned' });
    expect(agenda.get('2026-10-29')?.[0]).toMatchObject({ status: 'planned' });
  });

  it('fulfils a gym day with the workout of that date, and misses one without', () => {
    const occurrences = expandActivities([gymPlan], [], '2026-10-26', '2026-10-28');
    const agenda = buildAgenda({ occurrences, workouts: [workout({})], gymTypeId: GYM, today: '2026-10-29', rotation });
    expect(agenda.get('2026-10-26')).toEqual([
      expect.objectContaining({ kind: 'workout', key: 'w100', occurrence: expect.objectContaining({ key: 'p5:2026-10-26' }) }),
    ]);
    expect(agenda.get('2026-10-28')?.[0]).toMatchObject({ kind: 'activity', status: 'skipped' });
  });

  it('shows a workout on a day with no gym planned', () => {
    const agenda = buildAgenda({ occurrences: [], workouts: [workout({ date: '2026-10-27' })], gymTypeId: GYM, today: '2026-10-29', rotation });
    expect(agenda.get('2026-10-27')?.[0]).toMatchObject({ kind: 'workout', occurrence: null });
  });

  it('gives the gym days to come the program days in turn, from the next one', () => {
    const occurrences = expandActivities([gymPlan], [], '2026-10-28', '2026-11-04');
    const agenda = buildAgenda({ occurrences, workouts: [], gymTypeId: GYM, today: '2026-10-28', rotation });
    const days = ['2026-10-28', '2026-10-30', '2026-11-02', '2026-11-04'].map((d) => {
      const item = agenda.get(d)?.[0];
      return item?.kind === 'activity' ? item.dayId : null;
    });
    expect(days).toEqual([8, 9, 7, 8]);
  });

  it('starts the rotation after today when today’s workout is done', () => {
    const occurrences = expandActivities([gymPlan], [], '2026-10-26', '2026-10-28');
    // The workout of today moved the next day on: getNextDay already says 8.
    const agenda = buildAgenda({ occurrences, workouts: [workout({})], gymTypeId: GYM, today: '2026-10-26', rotation });
    const wednesday = agenda.get('2026-10-28')?.[0];
    expect(wednesday?.kind === 'activity' && wednesday.dayId).toBe(8);
  });

  it('collects the days with something done', () => {
    const occurrences = expandActivities([plan({})], [], '2026-10-26', '2026-11-01');
    const agenda = buildAgenda({ occurrences, workouts: [workout({})], gymTypeId: GYM, today: '2026-10-29', rotation: null });
    expect([...activeDates(agenda)].sort()).toEqual(['2026-10-26', '2026-10-27']);
  });
});

describe('rotateGymDays', () => {
  const at = (date: string, dayId: number | null): Occurrence => ({
    key: date,
    recordId: null,
    planId: 1,
    typeId: GYM,
    date,
    time: null,
    minutes: null,
    dayId,
    note: null,
    status: 'planned',
  });

  it('goes on after a fixed day', () => {
    const days = rotateGymDays([at('2026-10-26', null), at('2026-10-28', 7), at('2026-10-30', null)], { dayIds: [7, 8, 9], next: 9 });
    expect([...days.entries()]).toEqual([
      ['2026-10-26', 9],
      ['2026-10-28', 7],
      ['2026-10-30', 8],
    ]);
  });

  it('leaves days out without a program', () => {
    expect(rotateGymDays([at('2026-10-26', null)], null).size).toBe(0);
  });
});

describe('weekStreak', () => {
  it('counts weeks in a row with an active day', () => {
    const active = new Set(['2026-10-27', '2026-10-21', '2026-10-12']);
    expect(weekStreak(active, '2026-10-29')).toBe(3);
  });

  it('does not break on the week under way', () => {
    expect(weekStreak(new Set(['2026-10-21', '2026-10-14']), '2026-10-27')).toBe(2);
    expect(weekStreak(new Set(['2026-10-14']), '2026-10-27')).toBe(0);
  });
});

describe('summarizeActivity', () => {
  it('counts what was done per kind, the gym from its workouts', () => {
    const occurrences = expandActivities([plan({})], [record({ date: '2026-10-25', minutes: 100, status: 'done' })], '2026-10-01', '2026-10-31');
    const agenda = buildAgenda({
      occurrences,
      workouts: [workout({}), workout({ id: 101, date: '2026-10-28', startedAt: '2026-10-28T17:00:00.000Z', endedAt: '2026-10-28T18:00:00.000Z' })],
      gymTypeId: GYM,
      today: '2026-10-29',
      rotation: null,
    });
    const summary = summarizeActivity(agenda, types, GYM, '2026-10-26', '2026-11-01');
    expect(summary.byType).toEqual([
      { typeId: GYM, count: 2, minutes: 125 },
      { typeId: VOLLEY, count: 1, minutes: 90 },
    ]);
    expect(summary.activeDays).toBe(3);
    expect(summary.minutes).toBe(215);
  });
});

describe('formatting', () => {
  it('formats lengths and weekdays', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatWeekdays([4, 2])).toBe('Mar, Gio');
    expect(formatWeekdays([0])).toBe('Ogni domenica');
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Ogni giorno');
  });
});

const supplement = (fields: Partial<Supplement>): Supplement => ({
  id: 1,
  name: 'Creatina',
  dose: 5,
  unit: 'g',
  timesPerDay: 1,
  schedule: 'daily',
  weekdays: [],
  moment: null,
  reminder: null,
  contents: null,
  note: null,
  packageAmount: 500,
  packagePrice: 25,
  position: 0,
  archived: false,
  startedOn: '2026-10-01',
  ...fields,
});

describe('supplements', () => {
  it('knows the doses due on a day', () => {
    const active = new Set(['2026-10-27']);
    expect(dosesDue(supplement({}), '2026-09-30', active)).toBe(0);
    expect(dosesDue(supplement({ timesPerDay: 2 }), '2026-10-26', active)).toBe(2);
    expect(dosesDue(supplement({ schedule: 'weekdays', weekdays: [1] }), '2026-10-26', active)).toBe(1);
    expect(dosesDue(supplement({ schedule: 'weekdays', weekdays: [1] }), '2026-10-27', active)).toBe(0);
    expect(dosesDue(supplement({ schedule: 'active' }), '2026-10-27', active)).toBe(1);
    expect(dosesDue(supplement({ schedule: 'asNeeded' }), '2026-10-27', active)).toBe(0);
  });

  it('formats doses and schedules', () => {
    expect(formatDose(5, 'g')).toBe('5 g');
    expect(formatDose(2, 'capsule')).toBe('2 capsule');
    expect(formatDose(1, 'tablet')).toBe('1 compressa');
    expect(formatSchedule(supplement({ timesPerDay: 2 }))).toBe('2 volte al giorno');
    expect(formatSchedule(supplement({ schedule: 'weekdays', weekdays: [1, 3, 5] }))).toBe('Lun, Mer, Ven');
    expect(formatEuro(24.9).replace(/\s/g, ' ')).toBe('24,90 €');
  });

  it('prices a dose and a month', () => {
    expect(costPerDose(supplement({}))).toBe(0.25);
    expect(costPerDose(supplement({ packagePrice: null }))).toBeNull();
    expect(monthlyCost(supplement({}), { doses: 0, days: 1 })).toBeCloseTo(7.5);
    expect(dosesPerDay(supplement({ schedule: 'weekdays', weekdays: [1, 3, 5, 0, 2, 4, 6] }), { doses: 0, days: 1 })).toBe(1);
    expect(dosesPerDay(supplement({ schedule: 'active' }), { doses: 12, days: 28 })).toBeCloseTo(12 / 28);
  });

  it('counts what is left from the purchases and the doses since the first', () => {
    const takenSince = (from: string) => (from === '2026-10-10' ? 20 : 0);
    const left = stockLeft(supplement({}), [{ amount: 500, date: '2026-10-10' }, { amount: 500, date: '2026-10-20' }], takenSince);
    expect(left).toBe(900);
    expect(daysLeft(supplement({}), left, 1)).toBe(180);
    expect(stockLeft(supplement({}), [], takenSince)).toBeNull();
    expect(daysLeft(supplement({}), null, 1)).toBeNull();
  });

  it('measures adherence on the days due, up to today', () => {
    const s = supplement({ timesPerDay: 2, startedOn: '2026-10-26' });
    const taken = new Map([
      ['1:2026-10-26', 2],
      ['1:2026-10-27', 3],
      ['1:2026-10-29', 2],
    ]);
    const result = adherence(s, taken, daysFrom('2026-10-25', '2026-10-31'), new Set(), '2026-10-28');
    expect(result).toEqual({ due: 6, taken: 4 });
    expect(percent(result)).toBe(67);
    expect(percent({ due: 0, taken: 0 })).toBeNull();
  });
});

describe('report periods', () => {
  it('finds the week, month and year of a day', async () => {
    const { periodRange, shiftPeriod, formatPeriod, formatDelta, formatPrevious } = await import('../report');
    expect(periodRange('week', '2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange('month', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('year', '2026-10-28')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(shiftPeriod('week', '2026-10-28', -1)).toBe('2026-10-19');
    expect(shiftPeriod('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftPeriod('year', '2026-10-28', 1)).toBe('2027-01-01');
    expect(formatPeriod('month', '2026-10-28')).toBe('Ottobre 2026');
    expect(formatPeriod('year', '2026-10-28')).toBe('2026');
    expect(formatPrevious('month', '2026-10-28')).toBe('settembre');
    expect(formatDelta(5, 3)).toBe('+2');
    expect(formatDelta(3, 5)).toBe('−2');
    expect(formatDelta(3, 3)).toBe('=');
  });

  it('splits a month into its weeks for the chart', async () => {
    const { buckets } = await import('../report');
    expect(buckets('month', '2026-10-10').map((b) => b.label)).toEqual(['1–4', '5–11', '12–18', '19–25', '26–31']);
    expect(buckets('year', '2026-10-10')).toHaveLength(12);
    expect(buckets('week', '2026-10-28')[0]).toEqual({ from: '2026-10-26', to: '2026-10-26', label: 'L' });
  });
});

describe('supplementReminders', () => {
  it('reminds of what is due and not ticked, one notification per time', async () => {
    const { supplementReminders } = await import('../supplements');
    const omega = supplement({ id: 2, name: 'Omega 3', dose: 2, unit: 'capsule' });
    const list = supplementReminders(
      [supplement({ reminder: '08:00' }), { ...omega, reminder: '08:00' }, supplement({ id: 3, name: 'Caffeina', schedule: 'active', reminder: '17:00', unit: 'tablet', dose: 1 })],
      new Map([['1:2026-10-29', 1]]),
      new Set(['2026-10-29']),
      ['2026-10-28', '2026-10-29'],
      { date: '2026-10-28', time: '09:30' },
    );
    expect(list).toEqual([
      { date: '2026-10-29', time: '08:00', title: 'Integratori', body: 'Omega 3 2 capsule', ids: [2] },
      { date: '2026-10-29', time: '17:00', title: 'Integratori', body: 'Caffeina 1 compressa', ids: [3] },
    ]);
  });

  it('lists in the evening every supplement of the day not ticked yet', async () => {
    const { supplementReminders } = await import('../supplements');
    const creatine = supplement({ id: 1, name: 'Creatina' });
    const omega = supplement({ id: 2, name: 'Omega 3', reminder: '08:00' });
    const vitaminC = supplement({ id: 3, name: 'Vitamina C', reminder: '22:00' });
    const protein = supplement({ id: 4, name: 'Proteine', schedule: 'asNeeded' });
    const list = supplementReminders(
      [creatine, omega, vitaminC, protein],
      new Map([['1:2026-10-29', 1]]),
      new Set(),
      ['2026-10-28', '2026-10-29'],
      { date: '2026-10-28', time: '21:45' },
      '21:30',
    );
    // Today's evening reminder is gone, so the one at 22:00 stays; tomorrow the evening covers it.
    expect(list).toEqual([
      { date: '2026-10-28', time: '22:00', title: 'Integratori', body: 'Vitamina C 5 g', ids: [3] },
      { date: '2026-10-29', time: '08:00', title: 'Integratori', body: 'Omega 3 5 g', ids: [2] },
      { date: '2026-10-29', time: '21:30', title: 'Integratori', body: 'Oggi non hai ancora preso Omega 3 e Vitamina C.', ids: [2, 3] },
    ]);
  });
});
