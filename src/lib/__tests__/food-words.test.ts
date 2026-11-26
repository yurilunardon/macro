import { describe, expect, it } from 'vitest';

import { catalogText, looksLikeSeveral, parseWords, type CatalogFood } from '../food-words';

const catalog: CatalogFood[] = [
  { id: 12, name: 'Pasta di semola, cruda', brand: null, unit: 'g' },
  { id: 40, name: 'Latte intero', brand: null, unit: 'ml' },
  { id: 90, name: 'Proteine whey', brand: 'MyProtein', unit: 'g' },
];
const map = new Map(catalog.map((f) => [f.id, f]));

describe('catalogText', () => {
  it('writes one food per line with the brand', () => {
    expect(catalogText(catalog)).toBe('12|Pasta di semola, cruda|g\n40|Latte intero|ml\n90|Proteine whey (MyProtein)|g');
  });
});

describe('parseWords', () => {
  it('keeps the foods of the catalogue with their name and unit, and made-up ones with sane values', () => {
    const json = JSON.stringify({
      title: 'Pasta al forno',
      items: [
        { foodId: 12, name: 'pasta', unit: 'ml', amount: 500, guessed: false },
        { foodId: null, name: 'Mozzarella', unit: 'g', amount: 250, guessed: true, why: '2 da 125 g', kcal: 250, protein: 19, carbs: 2, fat: 18 },
      ],
    });
    const r = parseWords(json, map, 'recipe')!;
    expect(r.title).toBe('Pasta al forno');
    expect(r.items[0]).toEqual({ food: { kind: 'known', id: 12 }, name: 'Pasta di semola, cruda', unit: 'g', amount: 500, guessed: false, why: null, optional: false });
    expect(r.items[1].food).toEqual({ kind: 'new', name: 'Mozzarella', unit: 'g', per100: { kcal: 250, protein: 19, carbs: 2, fat: 18, sugars: null, fiber: null, satFat: null, salt: null } });
    expect(r.items[1].why).toBe('2 da 125 g');
  });

  it('drops what cannot be: unknown ids without values, impossible values and amounts', () => {
    const json = JSON.stringify({
      title: 'x',
      items: [
        { foodId: 999, name: 'Boh', unit: 'g', amount: 100, guessed: false },
        { foodId: null, name: 'Olio', unit: 'g', amount: 10, guessed: true, kcal: 2000, protein: 0, carbs: 0, fat: 100 },
        { foodId: 12, name: 'pasta', unit: 'g', amount: 0, guessed: false },
        { foodId: 40, name: 'latte', unit: 'ml', amount: 125, guessed: true, optional: true },
      ],
    });
    const r = parseWords(json, map, 'meal')!;
    expect(r.items.map((i) => i.name)).toEqual(['Latte intero']);
    expect(r.items[0].optional).toBe(true);
  });

  it('never leaves an ingredient of a recipe unticked, and gives up on nothing', () => {
    const json = JSON.stringify({ title: '', items: [{ foodId: 40, name: 'latte', unit: 'ml', amount: 100, guessed: false, optional: true }] });
    expect(parseWords(json, map, 'recipe')!.items[0].optional).toBe(false);
    expect(parseWords(json, map, 'recipe')!.title).toBe('Ricetta');
    expect(parseWords('{"title":"x","items":[]}', map, 'meal')).toBeNull();
    expect(parseWords('not json', map, 'meal')).toBeNull();
  });
});

describe('looksLikeSeveral', () => {
  it('tells a meal from a food', () => {
    expect(looksLikeSeveral('cornetto e cappuccino')).toBe(true);
    expect(looksLikeSeveral('pasta, tonno')).toBe(true);
    expect(looksLikeSeveral('pane con prosciutto')).toBe(true);
    expect(looksLikeSeveral('petto di pollo')).toBe(false);
    expect(looksLikeSeveral('yogurt greco')).toBe(false);
  });
});
