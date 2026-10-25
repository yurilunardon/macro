import { describe, expect, it } from 'vitest';

import {
  basalMetabolicRate,
  computeTargets,
  dayTypeFor,
  deriveRestTargets,
  parseProfile,
  parseTargets,
  totalDailyEnergy,
  type Profile,
  WEEKDAYS,
} from '../goals';

const profile: Profile = {
  sex: 'male',
  birthYear: 1996,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  proteinPerKg: 2,
  fatPercent: 25,
};

describe('basalMetabolicRate', () => {
  it('follows Mifflin–St Jeor for men and women', () => {
    // 10·80 + 6,25·180 − 5·30 = 1775, +5 for men, −161 for women
    expect(basalMetabolicRate(profile, 30)).toBe(1780);
    expect(basalMetabolicRate({ ...profile, sex: 'female' }, 30)).toBe(1614);
  });
});

describe('totalDailyEnergy', () => {
  it('multiplies by the activity factor', () => {
    expect(totalDailyEnergy(profile, 30)).toBeCloseTo(1780 * 1.55);
  });
});

describe('computeTargets', () => {
  it('derives kcal, protein, fat and carbs', () => {
    const t = computeTargets(profile, 2026);
    expect(t.kcal).toBe(Math.round(1780 * 1.55));
    expect(t.protein).toBe(160);
    expect(t.fat).toBe(Math.round((t.kcal * 0.25) / 9));
    expect(t.carbs).toBe(Math.round((t.kcal - 160 * 4 - t.fat * 9) / 4));
  });

  it('applies the goal factor', () => {
    const maintain = computeTargets(profile, 2026).kcal;
    const lose = computeTargets({ ...profile, goal: 'lose' }, 2026).kcal;
    expect(lose).toBe(Math.round(1780 * 1.55 * 0.8));
    expect(lose).toBeLessThan(maintain);
  });

  it('never returns negative carbs', () => {
    const t = computeTargets({ ...profile, proteinPerKg: 4, fatPercent: 60, goal: 'lose' }, 2026);
    expect(t.carbs).toBe(0);
  });
});

describe('parseProfile', () => {
  const fields = {
    sex: 'female' as const,
    birthYear: '1990',
    heightCm: '165',
    weightKg: '61,5',
    activity: 'light' as const,
    goal: 'lose_slow' as const,
    proteinPerKg: '1,8',
    fatPercent: '30',
  };

  it('reads valid fields', () => {
    const { profile, invalid } = parseProfile(fields, 2026);
    expect(invalid.size).toBe(0);
    expect(profile).toEqual({ ...fields, birthYear: 1990, heightCm: 165, weightKg: 61.5, proteinPerKg: 1.8, fatPercent: 30 });
  });

  it('flags implausible values', () => {
    const { profile, invalid } = parseProfile({ ...fields, heightCm: '1,65', birthYear: '2020', weightKg: '' }, 2026);
    expect(profile).toBeNull();
    expect([...invalid].sort()).toEqual(['birthYear', 'heightCm', 'weightKg']);
    expect(parseProfile({ ...fields, birthYear: '1990,5' }, 2026).invalid.has('birthYear')).toBe(true);
  });
});

describe('parseTargets', () => {
  it('rounds and validates targets', () => {
    expect(parseTargets({ kcal: '2450,6', protein: '160', carbs: '280', fat: '70,4' }).targets).toEqual({
      kcal: 2451,
      protein: 160,
      carbs: 280,
      fat: 70,
    });
    expect([...parseTargets({ kcal: '300', protein: 'x', carbs: '0', fat: '50' }).invalid]).toEqual(['kcal', 'protein']);
  });
});

describe('training and rest days', () => {
  it('follows the weekly schedule unless a day was set by hand', () => {
    const schedule = [1, 3, 5];
    expect(dayTypeFor(1, schedule, null)).toBe('training');
    expect(dayTypeFor(2, schedule, null)).toBe('rest');
    expect(dayTypeFor(2, schedule, 'training')).toBe('training');
    expect(dayTypeFor(5, schedule, 'rest')).toBe('rest');
  });

  it('lists the week from Monday', () => {
    expect(WEEKDAYS.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('derives rest-day targets by taking calories from carbs', () => {
    const rest = deriveRestTargets({ kcal: 2800, protein: 160, carbs: 370, fat: 75 });
    expect(rest).toEqual({ kcal: 2380, protein: 160, carbs: 266, fat: 75 });
    expect(deriveRestTargets({ kcal: 1500, protein: 200, carbs: 50, fat: 80 }).carbs).toBe(0);
  });
});
