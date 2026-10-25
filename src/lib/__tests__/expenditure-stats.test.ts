import { describe, expect, it } from 'vitest';

import { addDays, lastDays } from '../dates';
import { estimateExpenditure, forecastGoal, isCompleteDay, weightSlope, type DayIntake } from '../expenditure';
import { summarizePeriod, type StatDay } from '../stats';

const END = '2026-10-31';

/** 28 days eating `kcal` while weight moves linearly by `kgPerWeek`, weighing every other day. */
function scenario(kcal: number, kgPerWeek: number, startKg = 80) {
  const dates = lastDays(END, 28);
  const intake: DayIntake[] = dates.map((date) => ({ date, kcal, target: 2500 }));
  const weights = dates
    .filter((_, i) => i % 2 === 0)
    .map((date) => ({ date, kg: startKg + (kgPerWeek / 7) * dates.indexOf(date) }));
  return { intake, weights };
}

describe('weightSlope', () => {
  it('fits a straight line through the weigh-ins', () => {
    expect(weightSlope([{ date: '2026-10-01', kg: 80 }, { date: '2026-10-08', kg: 79.3 }])).toBeCloseTo(-0.1);
    const noisy = [
      { date: '2026-10-01', kg: 80.4 },
      { date: '2026-10-02', kg: 79.6 },
      { date: '2026-10-03', kg: 80.2 },
      { date: '2026-10-04', kg: 79.8 },
    ];
    expect(Math.abs(weightSlope(noisy) ?? 1)).toBeLessThan(0.15);
    expect(weightSlope([{ date: '2026-10-01', kg: 80 }])).toBeNull();
  });
});

describe('estimateExpenditure', () => {
  it('equals intake when weight is stable', () => {
    const { intake, weights } = scenario(2600, 0);
    const result = estimateExpenditure(intake, weights, END);
    expect(result.ok && result.estimate.tdee).toBe(2600);
  });

  it('adds the deficit implied by weight loss', () => {
    // −0,5 kg a week is 550 kcal a day under maintenance.
    const { intake, weights } = scenario(2200, -0.5);
    const result = estimateExpenditure(intake, weights, END);
    if (!result.ok) throw new Error(result.reason);
    expect(result.estimate.tdee).toBe(2750);
    expect(result.estimate.weeklyChange).toBeCloseTo(-0.5);
    expect(result.estimate.confidence).toBe('high');
  });

  it('subtracts the surplus implied by weight gain', () => {
    const { intake, weights } = scenario(3000, 0.25);
    const result = estimateExpenditure(intake, weights, END);
    expect(result.ok && result.estimate.tdee).toBe(2725);
  });

  it('ignores days logged only in part', () => {
    const { intake, weights } = scenario(2600, 0);
    intake[3] = { ...intake[3], kcal: 400 };
    intake[9] = { ...intake[9], kcal: 900 };
    const result = estimateExpenditure(intake, weights, END);
    expect(result.ok && result.estimate).toMatchObject({ tdee: 2600, loggedDays: 26 });
    expect(isCompleteDay({ date: END, kcal: 1300, target: 2500 })).toBe(true);
    expect(isCompleteDay({ date: END, kcal: 900, target: 0 })).toBe(false);
  });

  it('explains what is missing', () => {
    const { intake, weights } = scenario(2600, 0);
    expect(estimateExpenditure(intake.slice(0, 5), weights, END)).toMatchObject({ ok: false, reason: expect.stringMatching(/10 giorni/) });
    expect(estimateExpenditure(intake, weights.slice(0, 3), END)).toMatchObject({ ok: false, reason: expect.stringMatching(/4 pesate/) });
    const close = [0, 1, 2, 3].map((i) => ({ date: addDays(END, -i), kg: 80 }));
    expect(estimateExpenditure(intake, close, END)).toMatchObject({ ok: false, reason: expect.stringMatching(/2 settimane/) });
  });
});

describe('forecastGoal', () => {
  const today = { date: '2026-10-31', kg: 80 };
  it('projects the date the goal is reached', () => {
    expect(forecastGoal(today, 78, -0.5 / 7)).toEqual({ kind: 'eta', date: '2026-11-28', weeks: 4 });
  });
  it('recognises goals reached, a flat trend and the wrong direction', () => {
    expect(forecastGoal(today, 80.2, -0.1)).toEqual({ kind: 'reached' });
    expect(forecastGoal(today, 75, 0)).toEqual({ kind: 'flat' });
    expect(forecastGoal(today, 75, 0.05)).toEqual({ kind: 'wrong-way' });
  });
});

describe('summarizePeriod', () => {
  const day = (date: string, kcal: number, protein: number): StatDay => ({
    date,
    kcal,
    protein,
    carbs: 250,
    fat: 70,
    targetKcal: 2500,
    targetProtein: 160,
  });

  it('averages logged days and measures adherence', () => {
    const summary = summarizePeriod([
      day('2026-10-28', 2450, 165),
      day('2026-10-29', 2900, 120),
      day('2026-10-30', 0, 0),
      day('2026-10-31', 2300, 150),
    ])!;
    expect(summary.loggedDays).toBe(3);
    expect(summary.average.kcal).toBeCloseTo(2550);
    expect(summary.onTarget).toBe(67);
    expect(summary.proteinReached).toBe(67);
    expect(summary.split.protein + summary.split.carbs + summary.split.fat).toBeCloseTo(100);
  });

  it('returns null when nothing was logged', () => {
    expect(summarizePeriod([day('2026-10-30', 0, 0)])).toBeNull();
  });
});
