import { describe, expect, it } from 'vitest';

import {
  activeDates,
  buildAgenda,
  DEFAULT_WORK_HOURS,
  describeVolley,
  duringWork,
  expandActivities,
  formatMinutes,
  formatWeekdays,
  moveChoices,
  rotateGymDays,
  startWarning,
  summarizeActivity,
  volleyClashes,
  volleyInTheWay,
  weekStreak,
  workSpan,
  type ActivityPlan,
  type ActivityRecord,
  type ActivityType,
  type AgendaItem,
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
  everyDays: null,
  onceOn: null,
  times: ['08:00'],
  remind: true,
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
      [supplement({}), omega, supplement({ id: 3, name: 'Caffeina', schedule: 'active', times: ['17:00'], unit: 'tablet', dose: 1 })],
      new Set(['1:2026-10-29:0']),
      new Map(),
      new Set(['2026-10-29']),
      ['2026-10-28', '2026-10-29'],
      { date: '2026-10-28', time: '09:30' },
    );
    expect(list).toEqual([
      { date: '2026-10-29', time: '08:00', title: 'Omega 3', body: '2 capsule', doses: [{ id: 2, index: 0 }], evening: false },
      { date: '2026-10-29', time: '17:00', title: 'Caffeina', body: '1 compressa', doses: [{ id: 3, index: 0 }], evening: false },
    ]);
  });

  it('names them together when they fall at the same time', async () => {
    const { supplementReminders } = await import('../supplements');
    const list = supplementReminders([supplement({}), supplement({ id: 2, name: 'Omega 3', dose: 2, unit: 'capsule' })], new Set(), new Map(), new Set(), ['2026-10-29'], { date: '2026-10-28', time: '09:30' });
    expect(list).toEqual([{ date: '2026-10-29', time: '08:00', title: 'Integratori', body: 'Creatina 5 g · Omega 3 2 capsule', doses: [{ id: 1, index: 0 }, { id: 2, index: 0 }], evening: false }]);
  });

  it('says in the evening what should have been taken by then, not what is still to come', async () => {
    const { supplementReminders } = await import('../supplements');
    const creatine = supplement({ id: 1, name: 'Creatina' });
    const omega = supplement({ id: 2, name: 'Omega 3', times: ['13:00'] });
    const magnesium = supplement({ id: 3, name: 'Magnesio', times: ['23:30'] });
    const protein = supplement({ id: 4, name: 'Proteine', schedule: 'asNeeded', times: [] });
    const list = supplementReminders([creatine, omega, magnesium, protein], new Set(['1:2026-10-29:0']), new Map(), new Set(), ['2026-10-29'], { date: '2026-10-28', time: '21:45' }, '21:30');
    expect(list).toEqual([
      { date: '2026-10-29', time: '13:00', title: 'Omega 3', body: '5 g', doses: [{ id: 2, index: 0 }], evening: false },
      { date: '2026-10-29', time: '21:30', title: 'Non hai ancora preso', body: 'Omega 3', doses: [{ id: 2, index: 0 }], evening: true },
      { date: '2026-10-29', time: '23:30', title: 'Magnesio', body: '5 g', doses: [{ id: 3, index: 0 }], evening: false },
    ]);
  });

  it('leaves out times gone, doses skipped, and those that asked for no reminder; follows a dose moved', async () => {
    const { supplementReminders } = await import('../supplements');
    const list = supplementReminders(
      [supplement({ id: 1 }), supplement({ id: 2, name: 'Zinco', times: ['20:00'] }), supplement({ id: 3, name: 'Muto', remind: false }), supplement({ id: 4, name: 'Spostato', times: ['09:00'] })],
      new Set(),
      new Map([
        ['2:2026-10-28:0', { time: null, skipped: true }],
        ['4:2026-10-28:0', { time: '12:00', skipped: false }],
      ]),
      new Set(),
      ['2026-10-28'],
      { date: '2026-10-28', time: '09:30' },
    );
    expect(list.map((r) => [r.time, r.title])).toEqual([['12:00', 'Spostato']]);
  });
});

describe('the rules of volleyball', () => {
  const kinds = { gym: 1, match: 2, practice: 3 };
  const types = new Map([
    [1, { id: 1, ref: 'gym', name: 'Palestra', symbol: 's', color: 'green' as const, minutes: 90, archived: false }],
    [2, { id: 2, ref: 'match', name: 'Partita', symbol: 's', color: 'red' as const, minutes: 120, archived: false }],
    [3, { id: 3, ref: 'volleyball', name: 'Pallavolo', symbol: 's', color: 'orange' as const, minutes: 120, archived: false }],
  ]);
  const occ = (typeId: number, date: string, time: string | null, minutes = 90): Occurrence => ({ key: `${typeId}:${date}:${time}`, recordId: null, planId: 1, typeId, date, time, minutes, dayId: null, note: null, status: 'planned' });
  const agendaOf = (occurrences: Occurrence[], today = '2026-11-05') => buildAgenda({ occurrences, workouts: [], gymTypeId: 1, today, rotation: null, kinds });

  it('takes the practice off a day with a match, wherever it is', () => {
    const agenda = agendaOf([occ(3, '2026-11-12', '21:00'), occ(2, '2026-11-12', '21:00'), occ(3, '2026-11-10', '21:00')]);
    expect(agenda.get('2026-11-12')?.map((i) => (i.kind === 'activity' ? i.occurrence.typeId : 0))).toEqual([2]);
    expect(agenda.get('2026-11-10')).toHaveLength(1);
  });

  it('finds a workout on a match day, at any time, and one at the same time as a practice', () => {
    const agenda = agendaOf([occ(1, '2026-11-27', '21:00'), occ(2, '2026-11-27', '21:00'), occ(1, '2026-12-05', '10:00'), occ(2, '2026-12-05', '19:30'), occ(1, '2026-11-17', '21:00'), occ(3, '2026-11-17', '21:00', 120), occ(1, '2026-11-19', '18:30'), occ(3, '2026-11-19', '21:00', 120), occ(1, '2026-11-20', '21:00')]);
    const clashes = volleyClashes(agenda, kinds, '2026-11-05', types);
    expect(clashes.map((c) => [c.date, c.match])).toEqual([
      ['2026-11-17', false],
      ['2026-11-27', true],
      ['2026-12-05', true],
    ]);
  });

  it('forgets what is past or skipped', () => {
    const skipped = { ...occ(1, '2026-11-27', '21:00'), status: 'skipped' as const };
    const agenda = agendaOf([skipped, occ(2, '2026-11-27', '21:00'), occ(1, '2026-10-23', '21:00'), occ(2, '2026-10-23', '21:00')]);
    expect(volleyClashes(agenda, kinds, '2026-11-05', types)).toEqual([]);
  });

  it('says what is in the way of a time', () => {
    const items = agendaOf([occ(3, '2026-11-19', '21:00', 120)]).get('2026-11-19') ?? [];
    expect(volleyInTheWay(items, kinds, 21 * 60 + 30, 90)?.match).toBe(false);
    expect(volleyInTheWay(items, kinds, 18 * 60 + 30, 90)).toBeNull();
    expect(describeVolley('2026-11-19', { occurrence: occ(3, '2026-11-19', '21:00'), match: false })).toBe('Giovedì 19 c’è pallavolo alle 21:00');
  });

  it('offers free days first, the first after it before those before it, volleyball last', () => {
    const gym = occ(1, '2026-11-27', '21:00');
    const agenda = agendaOf(
      [gym, occ(2, '2026-11-27', '21:00'), occ(3, '2026-11-24', '21:00', 120), occ(1, '2026-11-25', '21:00'), occ(3, '2026-11-26', '21:00', 120), occ(1, '2026-11-29', '17:00'), occ(2, '2026-12-01', '21:00')],
      '2026-11-23',
    );
    const choices = moveChoices({ agenda, kinds, types, dayNames: new Map(), workHours: DEFAULT_WORK_HOURS, from: '2026-11-27', today: '2026-11-23', time: '21:00', minutes: 90, ignore: gym.key, span: 4 });
    expect(choices.map((c) => [c.date, c.label, c.blocked])).toEqual([
      ['2026-11-28', 'Libero', false],
      ['2026-11-30', 'Libero', false],
      ['2026-11-23', 'Libero', false],
      ['2026-11-29', 'Palestra alle 17:00', false],
      ['2026-11-25', 'Palestra alle 21:00', false],
      ['2026-11-26', 'Pallavolo alle 21:00', true],
      ['2026-11-24', 'Pallavolo alle 21:00', true],
      ['2026-12-01', 'Partita alle 21:00', true],
    ]);
  });
});

describe('work', () => {
  it('knows the hours at work, on working days', () => {
    expect(workSpan(DEFAULT_WORK_HOURS, '2026-11-06')).toEqual({ from: 540, to: 1080 });
    expect(workSpan(DEFAULT_WORK_HOURS, '2026-11-07')).toBeNull();
    expect(workSpan({ ...DEFAULT_WORK_HOURS, enabled: false }, '2026-11-06')).toBeNull();
    expect(duringWork(DEFAULT_WORK_HOURS, '2026-11-06', 17 * 60, 90)).toBe(true);
    expect(duringWork(DEFAULT_WORK_HOURS, '2026-11-06', 18 * 60, 90)).toBe(false);
    expect(duringWork(DEFAULT_WORK_HOURS, '2026-11-07', 10 * 60, 90)).toBe(false);
  });
});

describe('startWarning', () => {
  const GYM = 1;
  const today = '2026-11-04';
  const occurrence = (date: string, time: string | null, typeId = GYM): Occurrence => ({
    key: `${date}${time}`,
    recordId: null,
    planId: 1,
    typeId,
    date,
    time,
    minutes: 60,
    dayId: null,
    note: null,
    status: 'planned',
  });
  const planned = (date: string, time: string | null, typeId = GYM): AgendaItem => ({ kind: 'activity', key: `${date}${time}`, occurrence: occurrence(date, time, typeId), status: 'planned', dayId: null });
  const warn = (items: Record<string, AgendaItem[]>, time: string, hasGymDays = true) =>
    startWarning({ today, time, agenda: new Map(Object.entries(items)), gymTypeId: GYM, hasGymDays });

  it('says nothing without gym days in the calendar', () => {
    expect(warn({}, '11:00', false)).toBeNull();
  });

  it('says nothing within three hours of the planned time, either way', () => {
    expect(warn({ [today]: [planned(today, '18:00')] }, '15:00')).toBeNull();
    expect(warn({ [today]: [planned(today, '18:00')] }, '21:00')).toBeNull();
  });

  it('asks further from it than that, saying when it is planned', () => {
    expect(warn({ [today]: [planned(today, '18:00')] }, '14:59')).toEqual({ title: 'È previsto alle 18:00', message: 'Sono le 14:59. Vuoi iniziarlo lo stesso?' });
    expect(warn({ [today]: [planned(today, '18:00')] }, '21:01')?.title).toBe('È previsto alle 18:00');
  });

  it('takes the nearest of two gym times of a day', () => {
    expect(warn({ [today]: [planned(today, '08:00'), planned(today, '19:00')] }, '17:00')).toBeNull();
  });

  it('takes any time on a gym day with no time set', () => {
    expect(warn({ [today]: [planned(today, null)] }, '03:00')).toBeNull();
  });

  it('asks on a day without the gym, saying when the next is', () => {
    expect(warn({ [today]: [planned(today, '20:00', 2)], '2026-11-05': [planned('2026-11-05', '18:30')] }, '11:00')).toEqual({
      title: 'Oggi non è previsto l’allenamento',
      message: 'Il prossimo è domani alle 18:30. Vuoi iniziarlo lo stesso?',
    });
    expect(warn({ '2026-11-06': [planned('2026-11-06', null)] }, '11:00')?.message).toBe('Il prossimo è venerdì 6 novembre. Vuoi iniziarlo lo stesso?');
  });

  it('asks without a next one when none is planned', () => {
    expect(warn({}, '11:00')?.message).toBe('Vuoi iniziarlo lo stesso?');
  });

  it('says so when today’s workout has been done', () => {
    const done: AgendaItem = { kind: 'workout', key: 'w1', workout: { id: 1, date: today, startedAt: `${today}T09:00:00.000Z`, name: 'Push' } as WorkoutBrief, occurrence: null };
    expect(warn({ [today]: [done] }, '19:00')?.title).toBe('L’allenamento di oggi l’hai già fatto');
  });
});
