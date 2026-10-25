import { describe, expect, it } from 'vitest';

import { defaultRestSeconds, exerciseNames, exerciseSearchText, loadIncrement } from '../exercises';
import {
  bestOneRepMax,
  estimateOneRepMax,
  formatDuration,
  formatSet,
  formatWorkoutLength,
  nextInRotation,
  setsPerMuscle,
  suggestNext,
  tonnage,
  type LoggedSet,
} from '../training';

const set = (weight: number | null, reps: number | null, extra: Partial<LoggedSet> = {}): LoggedSet => ({
  type: 'normal',
  weight,
  reps,
  seconds: null,
  rir: null,
  done: true,
  ...extra,
});

const plan = { sets: 3, repMin: 8, repMax: 12 };

describe('suggestNext', () => {
  it('adds load once every set reaches the top of the range', () => {
    expect(suggestNext(plan, [set(80, 12), set(80, 12), set(80, 12)], 2.5, 'weight')).toEqual({
      kind: 'increase',
      weight: 82.5,
      reps: 8,
    });
  });

  it('otherwise keeps the weight and asks for one more rep than the weakest set', () => {
    expect(suggestNext(plan, [set(80, 10), set(80, 9), set(80, 8)], 2.5, 'weight')).toEqual({
      kind: 'repeat',
      weight: 80,
      reps: 9,
    });
  });

  it('ignores warm-ups and sets that were not done', () => {
    const last = [set(40, 10, { type: 'warmup' }), set(80, 12), set(80, 12), set(80, 12), set(90, 3, { done: false })];
    expect(suggestNext(plan, last, 2.5, 'weight')).toMatchObject({ kind: 'increase', weight: 82.5 });
  });

  it('never asks for fewer reps than the bottom of the range', () => {
    expect(suggestNext(plan, [set(100, 5), set(100, 4)], 2.5, 'weight')).toMatchObject({ kind: 'repeat', reps: 8 });
  });

  it('adds reps on bodyweight exercises and time on holds', () => {
    expect(suggestNext(plan, [set(null, 9), set(null, 8)], 2.5, 'bodyweight')).toEqual({ kind: 'repeat', weight: null, reps: 9 });
    expect(suggestNext(plan, [set(null, null, { seconds: 40 })], 2.5, 'time')).toEqual({ kind: 'hold', seconds: 45 });
    expect(suggestNext(plan, [], 2.5, 'weight')).toEqual({ kind: 'first' });
  });
});

describe('one-rep max', () => {
  it('uses Epley up to 12 reps', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(80, 6)).toBeCloseTo(96);
    expect(estimateOneRepMax(50, 15)).toBeNull();
    expect(bestOneRepMax([set(80, 6), set(85, 3), set(60, 10, { type: 'warmup' })])).toBeCloseTo(96);
  });
});

describe('formatting', () => {
  it('writes sets the way they are said in the gym', () => {
    expect(formatSet({ weight: 80, reps: 8, seconds: null }, 'weight')).toBe('80 kg × 8');
    expect(formatSet({ weight: 22.5, reps: 10, seconds: null }, 'weight')).toBe('22,5 kg × 10');
    expect(formatSet({ weight: null, reps: 12, seconds: null }, 'bodyweight')).toBe('× 12');
    expect(formatSet({ weight: 10, reps: 6, seconds: null }, 'bodyweight')).toBe('+10 kg × 6');
    expect(formatSet({ weight: null, reps: null, seconds: 45 }, 'time')).toBe('45 s');
  });

  it('formats rests, running and finished workouts', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatWorkoutLength(48 * 60)).toBe('48 min');
    expect(formatWorkoutLength(65 * 60)).toBe('1 h 05 min');
  });
});

describe('volume', () => {
  it('sums kg × reps of the work sets', () => {
    expect(tonnage([set(80, 10), set(80, 8), set(40, 10, { type: 'warmup' })])).toBe(1440);
  });

  it('counts a set fully for the main muscle and half for the secondary ones', () => {
    const totals = setsPerMuscle([
      { muscle: 'chest', secondary: ['triceps', 'shoulders'], count: 3 },
      { muscle: 'triceps', secondary: [], count: 2 },
    ]);
    expect(totals.get('chest')).toBe(3);
    expect(totals.get('triceps')).toBe(3.5);
    expect(totals.get('shoulders')).toBe(1.5);
  });
});

describe('rotation and exercises', () => {
  it('goes to the day after the last one done, and back to the first', () => {
    expect(nextInRotation(['push', 'pull', 'legs'], null)).toBe('push');
    expect(nextInRotation(['push', 'pull', 'legs'], 'pull')).toBe('legs');
    expect(nextInRotation(['push', 'pull', 'legs'], 'legs')).toBe('push');
    expect(nextInRotation([], null)).toBeNull();
  });

  it('knows sensible increments, rests and search text', () => {
    expect(loadIncrement('barbell')).toBe(2.5);
    expect(loadIncrement('dumbbell')).toBe(2);
    expect(defaultRestSeconds('chest', 'barbell')).toBe(180);
    expect(defaultRestSeconds('biceps', 'cable')).toBe(90);
    expect(exerciseSearchText('Panca piana con bilanciere', 'Bench press', 'chest', 'barbell')).toContain('bench press');
  });

  it('shows the chosen name first and the other one under it', () => {
    const bench = { name: 'Panca piana con bilanciere', nameEn: 'Bench press' };
    expect(exerciseNames(bench, 'en')).toEqual({ title: 'Bench press', subtitle: 'Panca piana con bilanciere' });
    expect(exerciseNames(bench, 'it')).toEqual({ title: 'Panca piana con bilanciere', subtitle: 'Bench press' });
    expect(exerciseNames({ name: 'Panca Technogym', nameEn: null }, 'en')).toEqual({ title: 'Panca Technogym', subtitle: null });
  });
});

describe('program templates', () => {
  it('only uses exercises that ship with the app, once per day', async () => {
    const { BUILT_IN_EXERCISES } = await import('@/data/exercises');
    const { PROGRAM_TEMPLATES } = await import('../templates');
    const refs = new Set(BUILT_IN_EXERCISES.map((e) => e.ref));
    expect(refs.size).toBe(BUILT_IN_EXERCISES.length);
    for (const template of PROGRAM_TEMPLATES) {
      for (const day of template.days) {
        const dayRefs = day.exercises.map((e) => e.ref);
        expect(new Set(dayRefs).size).toBe(dayRefs.length);
        for (const ex of day.exercises) {
          expect(refs.has(ex.ref), ex.ref).toBe(true);
          expect(ex.repMin).toBeLessThanOrEqual(ex.repMax);
        }
      }
    }
  });
});
