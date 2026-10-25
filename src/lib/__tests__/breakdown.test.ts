import { describe, expect, it } from 'vitest';

import { fiberTarget } from '../calories';
import { nutrientBreakdown } from '../breakdown';
import { weekOf } from '../dates';

const n = (protein: number, fiber: number | null = null) => ({
  kcal: 0, protein, carbs: 0, fat: 0, sugars: null, fiber, satFat: null, salt: null,
});

describe('nutrientBreakdown', () => {
  it('lists the sources of a nutrient, largest first, with their share', () => {
    const result = nutrientBreakdown(
      [
        { id: 1, totals: n(10) },
        { id: 2, totals: n(30) },
        { id: 3, totals: n(0) },
      ],
      'protein',
    );
    expect(result.total).toBe(40);
    expect(result.items.map((i) => [i.entry.id, i.share])).toEqual([
      [2, 0.75],
      [1, 0.25],
    ]);
  });

  it('treats unknown fibre as none', () => {
    expect(nutrientBreakdown([{ id: 1, totals: n(5, null) }], 'fiber')).toEqual({ total: 0, items: [] });
  });
});

describe('fiberTarget', () => {
  it('scales with calories but never goes below 25 g', () => {
    expect(fiberTarget(2600)).toBe(36);
    expect(fiberTarget(1500)).toBe(25);
  });
});

describe('weekOf', () => {
  it('starts on Monday', () => {
    expect(weekOf('2026-10-25')).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(weekOf('2026-10-26')[0]).toBe('2026-10-26');
  });
});
