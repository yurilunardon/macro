import { describe, expect, it } from 'vitest';

import { EMPTY_QUICK_FIELDS, parseQuickAdd, QUICK_ADD_NAME } from '../quick-add';

describe('parseQuickAdd', () => {
  it('accepts calories alone and names the entry', () => {
    const { result } = parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '350' });
    expect(result).toEqual({
      name: QUICK_ADD_NAME,
      totals: { kcal: 350, protein: 0, carbs: 0, fat: 0, sugars: null, fiber: null, satFat: null, salt: null },
    });
  });

  it('computes calories from macros when they are missing', () => {
    const { result, estimatedKcal } = parseQuickAdd({ name: ' Pizza a pranzo ', kcal: '', protein: '30', carbs: '100', fat: '25,5' });
    expect(estimatedKcal).toBeCloseTo(30 * 4 + 100 * 4 + 25.5 * 9);
    expect(result?.name).toBe('Pizza a pranzo');
    expect(result?.totals.kcal).toBeCloseTo(749.5);
    expect(result?.totals.fat).toBe(25.5);
  });

  it('keeps typed calories even if macros disagree', () => {
    expect(parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '500', protein: '10' }).result?.totals.kcal).toBe(500);
  });

  it('rejects empty, zero, negative and absurd values', () => {
    expect(parseQuickAdd(EMPTY_QUICK_FIELDS).invalid.has('kcal')).toBe(true);
    expect(parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '0' }).result).toBeNull();
    expect(parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '-5' }).invalid.has('kcal')).toBe(true);
    expect(parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '20000' }).invalid.has('kcal')).toBe(true);
    expect(parseQuickAdd({ ...EMPTY_QUICK_FIELDS, kcal: '200', protein: 'tanti' }).invalid.has('protein')).toBe(true);
  });
});
