import { describe, expect, it } from 'vitest';

import type { Muscle } from '../exercises';
import { checkMuscles, dayFor, dayHints, levelOf, missingLabel, weakestPart, weeklyTimes, worseLevel, type CheckDay, type CheckExercise } from '../program-check';

let plan = 0;
const ex = (muscle: Muscle, secondary: Muscle[] = [], sets = 3, ref: string | null = null) => ({ planId: ++plan, exerciseId: plan, ref, muscle, secondary, sets });
const day = (id: number, name: string, exercises: CheckDay['exercises'], perWeek = 1): CheckDay => ({ id, name, perWeek, exercises });

describe('weeklyTimes', () => {
  it('counts each day once when the calendar has no gym day', () => {
    const { times, assumed } = weeklyTimes([1, 2, 3], [], 4);
    expect(assumed).toBe(true);
    expect([...times.values()]).toEqual([1, 1, 1]);
  });

  it('gives a tied gym day to its day of the program', () => {
    const week = [{ dayId: 1 }, { dayId: 2 }, { dayId: 3 }];
    const { times, assumed } = weeklyTimes([1, 2, 3], [...week, ...week, ...week, ...week], 4);
    expect(assumed).toBe(false);
    expect([...times.values()]).toEqual([1, 1, 1]);
  });

  it('takes the days in turn on gym days that follow the rotation', () => {
    const gym = Array.from({ length: 8 }, () => ({ dayId: null }));
    const { times } = weeklyTimes([1, 2, 3], gym, 4, 2);
    // Two slots a week for three days: 8 over 4 weeks, starting from the second.
    expect(times.get(1)).toBeCloseTo(0.5);
    expect(times.get(2)).toBeCloseTo(0.75);
    expect(times.get(3)).toBeCloseTo(0.75);
  });

  it('treats a gym day tied to another program as one that rotates', () => {
    const { times } = weeklyTimes([1, 2], [{ dayId: 99 }, { dayId: 99 }], 1);
    expect([...times.values()]).toEqual([1, 1]);
  });
});

describe('checkMuscles', () => {
  const push = day(1, 'Push', [ex('chest', ['triceps', 'shoulders']), ex('chest', ['shoulders', 'triceps']), ex('shoulders'), ex('triceps')]);
  const legs = day(2, 'Legs', [ex('quads', ['glutes', 'hamstrings']), ex('hamstrings', ['glutes'])]);

  it('counts a set in full for the main muscle and half where it helps', () => {
    const muscles = new Map(checkMuscles([push, legs]).map((m) => [m.muscle, m]));
    expect(muscles.get('chest')).toMatchObject({ sets: 6, shown: 6, level: 'low', missing: 4 });
    expect(muscles.get('triceps')).toMatchObject({ sets: 6, level: 'low' });
    expect(muscles.get('glutes')).toMatchObject({ sets: 3, level: 'bad', missing: 7, direct: [] });
    expect(muscles.get('glutes')?.indirect).toHaveLength(2);
    expect(muscles.get('calves')).toMatchObject({ sets: 0, level: 'bad', missing: 10 });
  });

  it('multiplies by how often the day comes up', () => {
    const twice = checkMuscles([{ ...push, perWeek: 2 }]).find((m) => m.muscle === 'chest');
    expect(twice).toMatchObject({ sets: 12, level: 'good', missing: 0 });
  });

  it('shows whole numbers and judges by them', () => {
    expect(levelOf(10)).toBe('good');
    expect(levelOf(9)).toBe('low');
    expect(levelOf(4)).toBe('bad');
    const half = checkMuscles([day(1, 'A', [ex('chest', [], 3), ex('back', ['chest'], 13)])]).find((m) => m.muscle === 'chest');
    expect(half).toMatchObject({ sets: 9.5, shown: 10, level: 'good', missing: 0 });
  });
});

describe('dayFor', () => {
  const push = day(1, 'Push', [ex('chest', ['triceps'])]);
  const pull = day(2, 'Pull', [ex('back', ['biceps'])]);
  const legs = day(3, 'Legs', [ex('quads', ['glutes'], 4), ex('hamstrings', [], 4)]);

  it('picks the day that already trains the muscle', () => {
    expect(dayFor('glutes', [push, pull, legs])).toBe(3);
    expect(dayFor('biceps', [push, pull, legs])).toBe(2);
  });

  it('falls back on the day of the muscles it goes with', () => {
    expect(dayFor('calves', [push, pull, legs])).toBe(3);
    expect(dayFor('forearms', [push, pull, legs])).toBe(2);
    expect(dayFor('shoulders', [push, pull, legs])).toBe(1);
  });

  it('otherwise the lightest day', () => {
    expect(dayFor('calves', [push, pull])).toBe(1);
    expect(dayFor('calves', [])).toBeNull();
  });
});

describe('missingLabel', () => {
  it('agrees with the number', () => {
    expect(missingLabel(1)).toBe('manca 1 serie');
    expect(missingLabel(4)).toBe('mancano 4 serie');
    expect(missingLabel(4, { short: true })).toBe('mancano 4');
  });
});

describe('parts', () => {
  const shoulders = (days: CheckDay[]) => checkMuscles(days).find((m) => m.muscle === 'shoulders');

  it('counts each set for the parts the exercise names, half where the muscle only helps', () => {
    const push = day(1, 'Push', [ex('chest', ['triceps', 'shoulders'], 3, 'bench-press'), ex('shoulders', ['triceps'], 3, 'overhead-press'), ex('shoulders', [], 3, 'lateral-raise')]);
    const parts = new Map(shoulders([push])?.parts.map((p) => [p.part, p]));
    expect(parts.get('front-delts')?.sets).toBe(4.5);
    expect(parts.get('side-delts')?.sets).toBe(3);
    expect(parts.get('rear-delts')).toMatchObject({ sets: 0, level: 'bad' });
  });

  it('counts an exercise made in the app for every part of its muscle', () => {
    const parts = shoulders([day(1, 'A', [ex('shoulders', [], 4)])])?.parts;
    expect(parts?.map((p) => p.sets)).toEqual([4, 4, 4]);
  });

  it('names the part that lacks most, and draws a part no better than its muscle', () => {
    const check = shoulders([day(1, 'A', [ex('shoulders', [], 6, 'overhead-press'), ex('shoulders', [], 4, 'lateral-raise')], 2)]);
    expect(check?.level).toBe('good');
    expect(weakestPart(check!)?.part).toBe('rear-delts');
    expect(worseLevel('good', 'low')).toBe('low');
    expect(worseLevel('bad', 'good')).toBe('bad');
  });

  it('leaves muscles without parts with none', () => {
    expect(checkMuscles([]).find((m) => m.muscle === 'biceps')?.parts).toEqual([]);
  });
});

describe('dayHints', () => {
  const ex = (planId: number, muscle: CheckExercise['muscle'], sets: number): CheckExercise => ({ planId, exerciseId: planId, ref: null, muscle, secondary: [], sets });

  it('adds a short muscle on its day and trims one past what helps', () => {
    const days: CheckDay[] = [
      { id: 1, name: 'Push', perWeek: 1, exercises: [ex(1, 'chest', 5), ex(2, 'chest', 5), ex(3, 'chest', 5), ex(4, 'chest', 6), ex(5, 'shoulders', 4)] },
      { id: 2, name: 'Legs', perWeek: 1, exercises: [ex(6, 'quads', 6), ex(7, 'calves', 3)] },
    ];
    const muscles = checkMuscles(days);
    const push = dayHints(days, muscles, 1);
    const trim = push.find((h) => h.kind === 'trim');
    expect(trim).toMatchObject({ muscle: 'chest', planId: 4, remove: 1 });
    const legs = dayHints(days, muscles, 2);
    expect(legs.some((h) => h.kind === 'add' && h.muscle === 'calves')).toBe(true);
    expect(push.some((h) => h.kind === 'add' && h.muscle === 'calves')).toBe(false);
  });
});
