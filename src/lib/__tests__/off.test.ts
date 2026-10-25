import { describe, expect, it } from 'vitest';

import { barcodeCandidates, parseOffProduct, sanitizeQuery } from '../off';

describe('parseOffProduct', () => {
  it('reads an Italian product with complete nutrition facts', () => {
    const food = parseOffProduct({
      code: '8076800195057',
      product_name: 'Spaghetti n.5',
      product_name_it: 'Spaghetti n°5',
      brands: 'Barilla, Barilla G. e R. Fratelli',
      quantity: '500 g',
      serving_size: '85 g',
      serving_quantity: 85,
      nutriments: {
        'energy-kcal_100g': 359,
        proteins_100g: 13,
        carbohydrates_100g: 71,
        sugars_100g: 3.5,
        fat_100g: 2,
        'saturated-fat_100g': 0.5,
        fiber_100g: 3,
        salt_100g: 0.01,
      },
      image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
    });
    expect(food).toEqual({
      barcode: '8076800195057',
      name: 'Spaghetti n°5',
      brand: 'Barilla',
      unit: 'g',
      per100: { kcal: 359, protein: 13, carbs: 71, fat: 2, sugars: 3.5, fiber: 3, satFat: 0.5, salt: 0.01 },
      servingSize: 85,
      servingLabel: '85 g',
      imageUrl: 'https://images.openfoodfacts.org/x.jpg',
      source: 'off',
    });
  });

  it('accepts brands as a list, as the search API returns them', () => {
    const food = parseOffProduct({ product_name: 'Yogurt', brands: ['Danone', 'Oikos'], nutriments: { 'energy-kcal_100g': 86 } });
    expect(food?.brand).toBe('Danone');
  });

  it('converts kJ when kcal are missing', () => {
    const food = parseOffProduct({ product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } });
    expect(food?.per100.kcal).toBeCloseTo(100);
  });

  it('derives per-100 values from per-serving ones', () => {
    const food = parseOffProduct({
      product_name: 'Barretta',
      serving_quantity: '40',
      nutriments: { 'energy-kcal_serving': 180, proteins_serving: 8 },
    });
    expect(food?.per100.kcal).toBeCloseTo(450);
    expect(food?.per100.protein).toBeCloseTo(20);
  });

  it('detects drinks measured in millilitres', () => {
    expect(parseOffProduct({ product_name: 'Latte', quantity: '1 l', nutriments: { 'energy-kcal_100g': 64 } })?.unit).toBe('ml');
    expect(
      parseOffProduct({ product_name: 'Succo', product_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 45 } })?.unit,
    ).toBe('ml');
  });

  it('returns null without an energy value', () => {
    expect(parseOffProduct({ product_name: 'Petto di pollo', nutriments: {} })).toBeNull();
    expect(parseOffProduct({ product_name: 'Niente' })).toBeNull();
  });

  it('falls back to a placeholder name and clamps negative values', () => {
    const food = parseOffProduct({ product_name: '  ', nutriments: { 'energy-kcal_100g': 10, fat_100g: -1 } });
    expect(food?.name).toBe('Senza nome');
    expect(food?.per100.fat).toBe(0);
  });
});

describe('barcodeCandidates', () => {
  it('also tries the UPC-A form of a 13-digit code starting with 0', () => {
    expect(barcodeCandidates('0012345678905')).toEqual(['0012345678905', '012345678905']);
    expect(barcodeCandidates('012345678905')).toEqual(['012345678905', '0012345678905']);
    expect(barcodeCandidates('8076800195057')).toEqual(['8076800195057']);
    expect(barcodeCandidates('abc')).toEqual([]);
  });
});

describe('sanitizeQuery', () => {
  it('strips query syntax characters', () => {
    expect(sanitizeQuery('  yogurt "greco"  ')).toBe('yogurt greco');
    expect(sanitizeQuery('brand:ferrero (nutella)')).toBe('brand ferrero nutella');
    expect(sanitizeQuery("dell'orto")).toBe('dell orto');
  });
});
