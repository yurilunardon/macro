import { describe, expect, it } from 'vitest';

import { remainingKcal, RING_STOPS, RING_TONES } from '../calories';

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
