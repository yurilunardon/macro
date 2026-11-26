import { describe, expect, it } from 'vitest';

import type { Nutrients } from '../nutrition';
import { computeRecipe, cookingOf, parseRecipeFields } from '../recipes';

const n = (kcal: number, protein: number, carbs: number, fat: number): Nutrients => ({
  kcal, protein, carbs, fat, sugars: null, fiber: null, satFat: null, salt: null,
});

const rice = { quantity: 300, per100: n(365, 7, 80, 0.7) };
const chicken = { quantity: 500, per100: n(120, 22.5, 0, 2.6) };
const oil = { quantity: 20, per100: n(884, 0, 0, 100) };

describe('computeRecipe', () => {
  it('sums ingredients and spreads them over the cooked weight', () => {
    const r = computeRecipe([rice, chicken, oil], 1600, 4)!;
    expect(r.totals.kcal).toBeCloseTo(1095 + 600 + 176.8);
    expect(r.totals.protein).toBeCloseTo(21 + 112.5);
    expect(r.rawWeight).toBe(820);
    expect(r.weight).toBe(1600);
    expect(r.per100.kcal).toBeCloseTo((1095 + 600 + 176.8) / 16);
    expect(r.servingSize).toBe(400);
  });

  it('uses the raw weight when the cooked weight is unknown', () => {
    const r = computeRecipe([rice, chicken], null, null)!;
    expect(r.weight).toBe(800);
    expect(r.per100.kcal).toBeCloseTo((1095 + 600) / 8);
    expect(r.servingSize).toBeNull();
  });

  it('gives back exactly the totals when the whole dish is eaten', () => {
    const r = computeRecipe([rice, chicken, oil], 1234, null)!;
    expect(r.per100.fat * 12.34).toBeCloseTo(r.totals.fat);
  });

  it('needs at least one ingredient with some weight', () => {
    expect(computeRecipe([], 500, 2)).toBeNull();
    expect(computeRecipe([{ quantity: 0, per100: n(100, 1, 1, 1) }], null, null)).toBeNull();
  });
});

describe('cookingOf', () => {
  it('knows what takes water and what loses it', () => {
    expect(cookingOf('Pasta di semola, cruda')?.factor).toBe(2.2);
    expect(cookingOf('Spaghetti n.5')?.factor).toBe(2.2);
    expect(cookingOf("Pasta all'uovo fresca")?.factor).toBe(1.6);
    expect(cookingOf('Riso bianco, crudo')?.factor).toBe(2.6);
    expect(cookingOf('Farina di mais (polenta), cruda')?.factor).toBe(4);
    expect(cookingOf('Fagioli cannellini secchi')?.factor).toBe(2.4);
    expect(cookingOf('Macinato di manzo 15% di grassi, crudo')?.factor).toBe(0.75);
    expect(cookingOf('Petto di pollo, crudo')?.factor).toBe(0.75);
    expect(cookingOf('Filetto di merluzzo')?.factor).toBe(0.8);
  });

  it('leaves alone what is cooked, preserved or not cooked in water', () => {
    for (const name of [
      'Pasta di semola, cotta',
      'Riso bianco, cotto',
      'Fagioli borlotti in scatola',
      'Ceci, lessati',
      "Tonno sott'olio, sgocciolato",
      'Prosciutto cotto',
      'Bresaola',
      'Gallette di riso integrale',
      'Pasta sfoglia',
      'Passata di pomodoro',
      'Olio extravergine di oliva',
      'Mozzarella',
    ]) {
      expect(cookingOf(name), name).toBeNull();
    }
    expect(cookingOf('Riso, crudo', 'ml')).toBeNull();
  });
});

describe('computeRecipe with the cooking', () => {
  it('estimates the cooked weight when it is not given', () => {
    const r = computeRecipe(
      [
        { name: 'Pasta di semola, cruda', quantity: 500, per100: n(371, 13, 75, 1.5) },
        { name: 'Macinato di manzo 15% di grassi, crudo', quantity: 300, per100: n(215, 18.6, 0, 15) },
        { name: 'Passata di pomodoro', quantity: 700, per100: n(33, 1.3, 6, 0.2) },
      ],
      null,
      null,
    )!;
    expect(r.rawWeight).toBe(1500);
    expect(r.weight).toBeCloseTo(1100 + 225 + 700);
    expect(r.estimated).toBe(true);
    expect(r.cooking).toEqual(['pasta ×2,2', 'carne ×0,75']);
  });

  it('trusts the scale over the estimate', () => {
    const r = computeRecipe([{ name: 'Riso bianco, crudo', quantity: 300, per100: n(360, 7, 80, 0.6) }], 700, null)!;
    expect(r.weight).toBe(700);
    expect(r.estimated).toBe(false);
  });
});

describe('parseRecipeFields', () => {
  it('accepts a name with optional weight and servings', () => {
    expect(parseRecipeFields({ name: ' Pollo e riso ', cookedWeight: '1600', servings: '4' }, 3).values).toEqual({
      name: 'Pollo e riso',
      cookedWeight: 1600,
      servings: 4,
    });
    expect(parseRecipeFields({ name: 'Insalata', cookedWeight: '', servings: '' }, 1).values).toEqual({
      name: 'Insalata',
      cookedWeight: null,
      servings: null,
    });
  });

  it('reports missing name, no ingredients and bad numbers', () => {
    const { values, invalid } = parseRecipeFields({ name: '', cookedWeight: '-1', servings: 'tre' }, 0);
    expect(values).toBeNull();
    expect([...invalid].sort()).toEqual(['cookedWeight', 'ingredients', 'name', 'servings']);
  });
});
