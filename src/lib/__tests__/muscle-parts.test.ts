import { describe, expect, it } from 'vitest';

import { BUILT_IN_EXERCISES } from '@/data/exercises';

import { isWarmUp } from '../exercises';
import { exerciseParts, partMuscle, partsOfMuscle, partsTrained } from '../muscle-parts';

describe('muscle parts', () => {
  it('gives every exercise of the library a part of each muscle with parts it trains as its main one', () => {
    for (const e of BUILT_IN_EXERCISES) {
      if (isWarmUp(e) || partsOfMuscle(e.muscle).length === 0) continue;
      expect(exerciseParts(e).some((p) => partMuscle(p) === e.muscle), e.ref).toBe(true);
    }
  });

  it('names only parts of muscles the exercise trains', () => {
    for (const e of BUILT_IN_EXERCISES) {
      for (const p of exerciseParts(e)) expect([e.muscle, ...e.secondary], `${e.ref} ${p}`).toContain(partMuscle(p));
    }
  });

  it('counts an exercise without parts for the whole muscle', () => {
    expect(partsTrained({ ref: null }, 'back')).toEqual(['lats', 'upper-back', 'lower-back']);
    expect(partsTrained({ ref: 'lat-pulldown' }, 'back')).toEqual(['lats']);
  });
});
