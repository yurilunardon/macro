import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, isValidLimit, limitGrams, resolveLimits } from '../limits';

describe('limitGrams', () => {
  it('keeps a ceiling in grams as it is', () => {
    expect(limitGrams('sugars', { unit: 'grams', value: 90 }, 2600)).toBe(90);
  });

  it('turns a share of the calories into grams', () => {
    expect(limitGrams('satFat', { unit: 'percent', value: 10 }, 2700)).toBe(30);
    expect(limitGrams('sugars', { unit: 'percent', value: 10 }, 2600)).toBe(65);
  });

  it('follows the calories of the day', () => {
    expect(limitGrams('satFat', { unit: 'percent', value: 10 }, 1800)).toBe(20);
  });

  it('reads salt in grams whatever is stored, as it has no calories', () => {
    expect(limitGrams('salt', { unit: 'percent', value: 5 }, 2600)).toBe(5);
  });
});

describe('isValidLimit', () => {
  it('needs more than nothing and at most all the calories', () => {
    expect(isValidLimit({ unit: 'grams', value: 20 })).toBe(true);
    expect(isValidLimit({ unit: 'grams', value: 0 })).toBe(false);
    expect(isValidLimit({ unit: 'grams', value: Number.NaN })).toBe(false);
    expect(isValidLimit({ unit: 'percent', value: 100 })).toBe(true);
    expect(isValidLimit({ unit: 'percent', value: 101 })).toBe(false);
  });
});

describe('resolveLimits', () => {
  it('starts from the usual values', () => {
    expect(resolveLimits(null)).toEqual(DEFAULT_LIMITS);
  });

  it('keeps what was stored and fills what is missing', () => {
    expect(resolveLimits({ salt: { unit: 'grams', value: 6 } })).toEqual({ ...DEFAULT_LIMITS, salt: { unit: 'grams', value: 6 } });
  });

  it('ignores a broken value', () => {
    expect(resolveLimits({ salt: { unit: 'grams', value: -1 } })).toEqual(DEFAULT_LIMITS);
  });
});
