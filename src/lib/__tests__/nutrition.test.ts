import { describe, expect, it } from 'vitest';

import {
  EMPTY_NUTRIENTS,
  kcalFromMacros,
  macroEnergySplit,
  rescaleNutrients,
  scaleNutrients,
  sumNutrients,
  type Nutrients,
} from '../nutrition';

const pasta: Nutrients = {
  kcal: 359,
  protein: 13,
  carbs: 71,
  fat: 2,
  sugars: 3.5,
  fiber: 3,
  satFat: 0.5,
  salt: 0.01,
};

describe('scaleNutrients', () => {
  it('scales per-100 values to the eaten quantity', () => {
    const portion = scaleNutrients(pasta, 80);
    expect(portion.kcal).toBeCloseTo(287.2);
    expect(portion.protein).toBeCloseTo(10.4);
    expect(portion.carbs).toBeCloseTo(56.8);
    expect(portion.fat).toBeCloseTo(1.6);
    expect(portion.fiber).toBeCloseTo(2.4);
  });

  it('keeps missing optional values missing', () => {
    const portion = scaleNutrients({ ...pasta, sugars: null }, 50);
    expect(portion.sugars).toBeNull();
  });
});

describe('rescaleNutrients', () => {
  it('turns totals for one quantity into totals for another', () => {
    const totals = scaleNutrients(pasta, 80);
    const doubled = rescaleNutrients(totals, 80, 160);
    expect(doubled.kcal).toBeCloseTo(574.4);
    expect(doubled.carbs).toBeCloseTo(113.6);
  });

  it('leaves totals untouched when the old quantity is zero', () => {
    expect(rescaleNutrients(pasta, 0, 100)).toEqual(pasta);
  });
});

describe('sumNutrients', () => {
  it('adds every value', () => {
    const total = sumNutrients([pasta, pasta]);
    expect(total.kcal).toBe(718);
    expect(total.salt).toBeCloseTo(0.02);
  });

  it('treats an optional value as known when at least one item has it', () => {
    const total = sumNutrients([pasta, { ...EMPTY_NUTRIENTS, kcal: 100 }]);
    expect(total.sugars).toBe(3.5);
    expect(total.kcal).toBe(459);
  });

  it('returns zeros and nulls for an empty list', () => {
    expect(sumNutrients([])).toEqual(EMPTY_NUTRIENTS);
  });
});

describe('energy helpers', () => {
  it('estimates kcal from macros', () => {
    expect(kcalFromMacros(10, 20, 5)).toBe(165);
  });

  it('splits energy by macro', () => {
    const split = macroEnergySplit({ protein: 25, carbs: 25, fat: 0 });
    expect(split).toEqual({ protein: 50, carbs: 50, fat: 0 });
    expect(macroEnergySplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
});
