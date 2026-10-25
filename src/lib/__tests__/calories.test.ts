import { describe, expect, it } from 'vitest';

import { calorieStatus, remainingKcal, RING_STOPS, RING_TONES } from '../calories';

describe('calorieStatus', () => {
  it('is red far from the goal, orange closer, green within 10% and red again when over', () => {
    expect(calorieStatus(17, 2600)).toBe('far');
    expect(calorieStatus(1300, 2600)).toBe('closer');
    expect(calorieStatus(2340, 2600)).toBe('onTarget');
    expect(calorieStatus(2860, 2600)).toBe('onTarget');
    expect(calorieStatus(2861, 2600)).toBe('over');
  });

  it('treats a missing goal as no progress', () => {
    expect(calorieStatus(500, 0)).toBe('far');
  });
});

describe('ring colours', () => {
  it('has one tone per stop, in increasing order', () => {
    expect(RING_TONES).toHaveLength(RING_STOPS.length);
    expect([...RING_STOPS].sort((a, b) => a - b)).toEqual(RING_STOPS);
  });
});

describe('remainingKcal', () => {
  it('reports what is left or how much is over', () => {
    expect(remainingKcal(1240, 2600)).toEqual({ kcal: 1360, over: false });
    expect(remainingKcal(2900, 2600)).toEqual({ kcal: 300, over: true });
  });
});
