import { describe, expect, it } from 'vitest';

import genericFoods from '@/data/generic-foods.json';

type Item = (typeof genericFoods)[number];

const CATEGORIES = [
  'Frutta',
  'Verdura',
  'Legumi',
  'Cereali e pasta',
  'Pane e prodotti da forno',
  'Carne',
  'Salumi',
  'Uova',
  'Pesce',
  'Latte e yogurt',
  'Formaggi',
  'Grassi e condimenti',
  'Frutta secca e semi',
  'Dolci e snack',
  'Bevande',
];

// USDA uses food-specific energy factors and counts organic acids, so a few foods are far
// from the 4/4/9 estimate. They were checked by hand against the USDA record.
const ENERGY_EXCEPTIONS = new Set(['Limone', 'Funghi champignon, crudi', 'Aceto balsamico', 'Cacao amaro in polvere']);

describe('basic foods data', () => {
  const foods = genericFoods as Item[];

  it('has unique references and names in known categories', () => {
    expect(new Set(foods.map((f) => f.ref)).size).toBe(foods.length);
    expect(new Set(foods.map((f) => f.name.toLowerCase())).size).toBe(foods.length);
    for (const f of foods) {
      expect(f.ref).toMatch(/^usda:\d+$/);
      expect(CATEGORIES).toContain(f.category);
      expect(['g', 'ml']).toContain(f.unit);
    }
  });

  it('has plausible values per 100', () => {
    for (const f of foods) {
      const n = f.per100;
      expect(n.kcal, f.name).toBeGreaterThanOrEqual(0);
      expect(n.kcal, f.name).toBeLessThanOrEqual(900);
      expect(n.protein + n.carbs + n.fat, f.name).toBeLessThanOrEqual(101);
      if (n.sugars !== null) expect(n.sugars, f.name).toBeLessThanOrEqual(n.carbs + 0.01);
      if (n.satFat !== null) expect(n.satFat, f.name).toBeLessThanOrEqual(n.fat + 0.01);
    }
  });

  it('has energy consistent with the macros, except for alcohol and known cases', () => {
    for (const f of foods) {
      const n = f.per100;
      if (n.kcal < 25 || f.category === 'Bevande' || ENERGY_EXCEPTIONS.has(f.name)) continue;
      const estimate = n.protein * 4 + n.carbs * 4 + n.fat * 9 + (n.fiber ?? 0) * 2;
      expect(Math.abs(estimate - n.kcal) / n.kcal, f.name).toBeLessThan(0.15);
    }
  });

  it('has positive serving sizes with a label', () => {
    for (const f of foods) {
      if (f.servingSize === null) {
        expect(f.servingLabel, f.name).toBeNull();
      } else {
        expect(f.servingSize, f.name).toBeGreaterThan(0);
        expect(f.servingLabel, f.name).toBeTruthy();
      }
    }
  });

  it('contains the staples someone will look for first', () => {
    const names = new Set(foods.map((f) => f.name));
    for (const name of ['Mela', 'Banana', 'Petto di pollo, crudo', 'Uovo intero', 'Pasta di semola, cruda', 'Riso bianco, crudo', 'Olio extravergine di oliva', 'Latte parzialmente scremato']) {
      expect(names.has(name), name).toBe(true);
    }
  });
});
