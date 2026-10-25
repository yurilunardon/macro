import { describe, expect, it } from 'vitest';

import { EMPTY_FOOD_FIELDS, fieldsFromFood, validateFoodFields, type FoodFields } from '../food-validation';
import type { Food } from '../nutrition';

const yogurt: FoodFields = {
  ...EMPTY_FOOD_FIELDS,
  name: ' Yogurt greco ',
  brand: 'Fage',
  barcode: '5201054017227',
  servingSize: '170',
  kcal: '97',
  protein: '9',
  carbs: '3,8',
  sugars: '3,8',
  fat: '5',
  satFat: '3,4',
  salt: '0,1',
};

describe('validateFoodFields', () => {
  it('builds a draft from valid fields', () => {
    const { draft, errors } = validateFoodFields(yogurt, null);
    expect(errors).toEqual([]);
    expect(draft).toMatchObject({
      name: 'Yogurt greco',
      brand: 'Fage',
      barcode: '5201054017227',
      unit: 'g',
      servingSize: 170,
      source: 'custom',
      per100: { kcal: 97, protein: 9, carbs: 3.8, fat: 5, sugars: 3.8, satFat: 3.4, fiber: null, salt: 0.1 },
    });
  });

  it('estimates kcal from macros when energy is empty', () => {
    const { draft, estimatedKcal } = validateFoodFields({ ...yogurt, kcal: '' }, null);
    expect(estimatedKcal).toBeCloseTo(9 * 4 + 3.8 * 4 + 5 * 9);
    expect(draft?.per100.kcal).toBeCloseTo(96.2);
  });

  it('requires a name and some energy information', () => {
    const { draft, invalid } = validateFoodFields({ ...EMPTY_FOOD_FIELDS }, null);
    expect(draft).toBeNull();
    expect(invalid.has('name')).toBe(true);
    expect(invalid.has('kcal')).toBe(true);
  });

  it('rejects text, negative numbers and impossible values', () => {
    expect(validateFoodFields({ ...yogurt, protein: 'tanti' }, null).invalid.has('protein')).toBe(true);
    expect(validateFoodFields({ ...yogurt, fat: '-2' }, null).invalid.has('fat')).toBe(true);
    expect(validateFoodFields({ ...yogurt, sugars: '10' }, null).invalid.has('sugars')).toBe(true);
    expect(validateFoodFields({ ...yogurt, satFat: '6' }, null).invalid.has('satFat')).toBe(true);
    expect(validateFoodFields({ ...yogurt, carbs: '80', protein: '30' }, null).draft).toBeNull();
    expect(validateFoodFields({ ...yogurt, barcode: '12ab' }, null).invalid.has('barcode')).toBe(true);
    expect(validateFoodFields({ ...yogurt, servingSize: '0' }, null).invalid.has('servingSize')).toBe(true);
  });

  it('keeps source and image of the food being edited', () => {
    const base: Food = {
      id: 3,
      favorite: true,
      barcode: '5201054017227',
      name: 'Yogurt',
      brand: null,
      unit: 'g',
      per100: { kcal: 1, protein: 0, carbs: 0, fat: 0, sugars: null, fiber: null, satFat: null, salt: null },
      servingSize: null,
      servingLabel: '1 vasetto',
      imageUrl: 'https://img',
      source: 'off',
      category: null,
    };
    const { draft } = validateFoodFields(yogurt, base);
    expect(draft).toMatchObject({ source: 'off', imageUrl: 'https://img', servingLabel: '1 vasetto' });
  });

  it('round-trips a saved food through the form fields', () => {
    const { draft } = validateFoodFields(yogurt, null);
    if (!draft) throw new Error('expected a draft');
    const again = validateFoodFields(fieldsFromFood({ ...draft, id: 1, favorite: false, category: null }), null);
    expect(again.draft).toEqual(draft);
  });
});
