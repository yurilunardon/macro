import { describe, expect, it } from 'vitest';

import { nextDose, sameMoment, sameProduct } from '../links';

describe('sameProduct', () => {
  it('matches a food named like the supplement', () => {
    expect(sameProduct('Impact Whey', 'Impact Whey Protein · Cioccolato')).toBe(true);
    expect(sameProduct('Proteine Whey', 'Whey')).toBe(true);
    expect(sameProduct('Creatina monoidrato', 'Creatina')).toBe(true);
  });
  it('does not match other foods', () => {
    expect(sameProduct('Creatina', 'Crema spalmabile')).toBe(false);
    expect(sameProduct('Impact Whey', 'Yogurt greco')).toBe(false);
    expect(sameProduct('D3', 'Uova')).toBe(false);
  });
});

describe('nextDose', () => {
  it('takes the first dose not ticked', () => {
    expect(nextDose([], 1, false)).toBe(0);
    expect(nextDose([0], 2, false)).toBe(1);
    expect(nextDose([0], 1, false)).toBeNull();
    expect(nextDose([0, 1], 1, true)).toBe(2);
  });
});

describe('sameMoment', () => {
  it('is within ten minutes', () => {
    expect(sameMoment('2025-11-21T20:00:00Z', '2025-11-21T20:09:00Z')).toBe(true);
    expect(sameMoment('2025-11-21T20:00:00Z', '2025-11-21T20:30:00Z')).toBe(false);
  });
});
