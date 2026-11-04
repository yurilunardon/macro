import { describe, expect, it } from 'vitest';

import { compareCounts, howOften, monthWeeks, periodRange, totalsOf, volumeBuckets, workoutsBetween, workoutsPerMonth, compareTimes, restBuckets, timesOf } from '../progress';

const workout = (date: string, tonnage = 1000, workSets = 10) => ({
  date,
  startedAt: `${date}T18:00:00.000Z`,
  endedAt: `${date}T19:00:00.000Z`,
  workSets,
  tonnage,
});

describe('periodRange', () => {
  it('takes the week from Monday, with the one before', () => {
    expect(periodRange('week', '2026-11-04')).toMatchObject({ from: '2026-11-02', to: '2026-11-08', previousFrom: '2026-10-26', previousTo: '2026-11-01' });
  });

  it('takes the month, with the name of the one before', () => {
    expect(periodRange('month', '2026-11-04')).toMatchObject({ from: '2026-11-01', to: '2026-11-30', previousFrom: '2026-10-01', previousTo: '2026-10-31', label: 'Novembre', previousName: 'ottobre' });
  });

  it('crosses the new year', () => {
    expect(periodRange('month', '2026-01-10')).toMatchObject({ previousFrom: '2025-12-01', previousTo: '2025-12-31' });
    expect(periodRange('year', '2026-01-10')).toMatchObject({ from: '2026-01-01', previousTo: '2025-12-31', previousName: 'il 2025' });
  });
});

describe('totalsOf', () => {
  it('adds up the workouts of a period', () => {
    const inside = workoutsBetween([workout('2026-11-02'), workout('2026-11-04', 500, 5), workout('2026-10-30')], '2026-11-01', '2026-11-30');
    expect(totalsOf(inside)).toEqual({ count: 2, seconds: 7200, sets: 15, kg: 1500 });
  });
});

describe('howOften', () => {
  it('counts the days of a week', () => {
    expect(howOften('week', 3, '2026-11-02', '2026-11-08', '2026-11-04')).toBe('3 giorni su 7');
  });

  it('averages over the weeks so far, not the whole period', () => {
    expect(howOften('month', 3, '2026-11-01', '2026-11-30', '2026-11-07')).toBe('In media 3 a settimana');
    expect(howOften('month', 12, '2026-10-01', '2026-10-31', '2026-11-03')).toBe('In media 2,7 a settimana');
  });

  it('does not inflate the first days of a period', () => {
    expect(howOften('month', 1, '2026-11-01', '2026-11-30', '2026-11-01')).toBe('In media 1 a settimana');
  });
});

describe('compareCounts', () => {
  const range = { previousOf: 'di settembre', previousName: 'settembre' };

  it('says how many more, fewer or the same', () => {
    expect(compareCounts(12, 9, range)).toEqual({ text: '3 in più di settembre', trend: 'up' });
    expect(compareCounts(8, 9, range)).toEqual({ text: '1 in meno di settembre', trend: 'down' });
    expect(compareCounts(9, 9, range)).toEqual({ text: 'Come settembre', trend: 'same' });
  });

  it('says nothing with nothing on either side', () => {
    expect(compareCounts(0, 0, range)).toBeNull();
  });
});

describe('volumeBuckets', () => {
  const workouts = [workout('2026-11-02', 100), workout('2026-11-02', 50), workout('2026-11-08', 200), workout('2026-11-09', 300)];

  it('splits a week by day', () => {
    const buckets = volumeBuckets('week', workouts, { from: '2026-11-02', to: '2026-11-08' });
    expect(buckets.map((b) => b.kg)).toEqual([150, 0, 0, 0, 0, 0, 200]);
    expect(buckets[0].title).toBe('Lunedì');
  });

  it('splits a month by its weeks, cut at the month', () => {
    const buckets = volumeBuckets('month', workouts, { from: '2026-11-01', to: '2026-11-30' });
    // 1 November 2026 is a Sunday: the first week of the month is that one day.
    expect(buckets.map((b) => b.label)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(buckets.map((b) => b.kg)).toEqual([0, 350, 300, 0, 0, 0]);
  });

  it('splits a year by month', () => {
    const buckets = volumeBuckets('year', workouts, { from: '2026-01-01', to: '2026-12-31' });
    expect(buckets).toHaveLength(12);
    expect(buckets[10].kg).toBe(650);
  });
});

describe('workoutsPerMonth', () => {
  it('counts each month of the year', () => {
    const months = workoutsPerMonth([workout('2026-11-02'), workout('2026-11-04'), workout('2026-03-01')], '2026-01-01');
    expect(months[10].count).toBe(2);
    expect(months[2].count).toBe(1);
    expect(months[0].count).toBe(0);
  });
});

describe('monthWeeks', () => {
  it('lays the month out from Monday, blank around it', () => {
    const weeks = monthWeeks('2026-11');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks[weeks.length - 1][0]).toBe('2026-11-30');
    expect(weeks[weeks.length - 1][1]).toBeNull();
  });
});

describe('times of a period', () => {
  const range = { previousOf: 'di settembre', previousName: 'settembre' };
  const workout = (date: string, minutes: number, times: { between: number; betweens: number; work?: number; works?: number }) => ({
    date,
    startedAt: `${date}T18:00:00.000Z`,
    endedAt: new Date(new Date(`${date}T18:00:00.000Z`).getTime() + minutes * 60000).toISOString(),
    workSets: 10,
    tonnage: 1000,
    times: { betweenSeconds: times.between * times.betweens, betweens: times.betweens, workSeconds: (times.work ?? 0) * (times.works ?? 0), works: times.works ?? 0 },
  });

  it('counts every set the same, however long each workout', () => {
    const times = timesOf([workout('2026-11-02', 60, { between: 100, betweens: 1 }), workout('2026-11-04', 40, { between: 200, betweens: 3, work: 50, works: 2 })]);
    expect(times).toEqual({ between: 175, work: 50, workout: 3000 });
  });

  it('knows nothing of a time never recorded, nor of an empty period', () => {
    expect(timesOf([{ date: '2026-11-02', startedAt: '2026-11-02T18:00:00.000Z', endedAt: '2026-11-02T19:00:00.000Z', workSets: 1, tonnage: 1 }])).toEqual({ between: null, work: null, workout: 3600 });
    expect(timesOf([])).toEqual({ between: null, work: null, workout: null });
  });

  it('gives the average rest for each stretch of the period', () => {
    const buckets = restBuckets('week', [workout('2026-11-02', 60, { between: 100, betweens: 2 }), workout('2026-11-04', 40, { between: 200, betweens: 3 })], { from: '2026-11-02', to: '2026-11-08' });
    expect(buckets.map((b) => b.value)).toEqual([100, 0, 200, 0, 0, 0, 0]);
  });

  it('says how a time compares', () => {
    expect(compareTimes(120, 132, range)).toBe('12 s in meno di settembre');
    expect(compareTimes(200, 75, range)).toBe('2 min 05 in più di settembre');
    expect(compareTimes(3600, 3000, range)).toBe('10 min in più di settembre');
    expect(compareTimes(90.2, 90, range)).toBe('Come settembre');
  });

  it('says nothing without both to compare', () => {
    expect(compareTimes(null, 90, range)).toBeNull();
    expect(compareTimes(90, null, range)).toBeNull();
  });
});
