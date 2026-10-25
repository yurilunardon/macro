import { describe, expect, it } from 'vitest';

import { countFound, groupRows, parseNutritionLabel, type TextBox } from '../label-parser';

/** Boxes laid out as on a printed table: one row per line, cells at the given x. */
function table(rows: string[][], columns = [0.05, 0.55, 0.78]): TextBox[] {
  return rows.flatMap((cells, r) =>
    cells.map((text, c) => ({ text, x: columns[c], y: 0.1 + r * 0.05 + (c === 1 ? 0.004 : 0), width: 0.2, height: 0.03 })),
  );
}

describe('groupRows', () => {
  it('rebuilds rows from boxes in any order, left to right', () => {
    const boxes = table([
      ['Grassi', '2,0 g', '1,7 g'],
      ['Proteine', '13 g', '11 g'],
    ]).reverse();
    expect(groupRows(boxes)).toEqual(['Grassi 2,0 g 1,7 g', 'Proteine 13 g 11 g']);
  });
});

describe('parseNutritionLabel', () => {
  it('reads a typical Italian label, per 100 g first', () => {
    const boxes = table([
      ['Valori nutrizionali', 'per 100 g', 'per porzione (85 g)'],
      ['Energia', '1521 kJ', '1293 kJ'],
      ['', '359 kcal', '305 kcal'],
      ['Grassi', '2,0 g', '1,7 g'],
      ['di cui acidi grassi saturi', '0,5 g', '0,4 g'],
      ['Carboidrati', '71 g', '60 g'],
      ['di cui zuccheri', '3,5 g', '3,0 g'],
      ['Fibre', '3,0 g', '2,6 g'],
      ['Proteine', '13 g', '11 g'],
      ['Sale', '0,01 g', '<0,01 g'],
    ]);
    expect(parseNutritionLabel(boxes)).toEqual({
      kcal: 359,
      protein: 13,
      carbs: 71,
      sugars: 3.5,
      fat: 2,
      satFat: 0.5,
      fiber: 3,
      salt: 0.01,
      unit: 'g',
    });
  });

  it('handles whole rows read as one piece of text and drinks per 100 ml', () => {
    const boxes: TextBox[] = [
      'Dichiarazione nutrizionale per 100 ml',
      'Energia 180 kJ / 43 kcal',
      'Grassi 0 g',
      'di cui saturi 0 g',
      'Carboidrati 10,6 g',
      'di cui zuccheri 10,6 g',
      'Proteine 0 g',
      'Sale 0,02 g',
    ].map((text, i) => ({ text, x: 0.05, y: 0.1 + i * 0.06, width: 0.8, height: 0.04 }));
    const values = parseNutritionLabel(boxes);
    expect(values).toMatchObject({ kcal: 43, carbs: 10.6, sugars: 10.6, fat: 0, protein: 0, salt: 0.02, unit: 'ml' });
    expect(values.fiber).toBeNull();
    expect(countFound(values)).toBe(7);
  });

  it('reads English labels and converts kJ when kcal are missing', () => {
    const boxes = table([
      ['Typical values', 'per 100g'],
      ['Energy', '1046 kJ'],
      ['Fat', '9.5 g'],
      ['of which saturates', '6.1 g'],
      ['Carbohydrate', '30 g'],
      ['of which sugars', '27 g'],
      ['Protein', '3.2 g'],
      ['Salt', '0.1 g'],
    ]);
    expect(parseNutritionLabel(boxes)).toMatchObject({
      kcal: 250,
      fat: 9.5,
      satFat: 6.1,
      carbs: 30,
      sugars: 27,
      protein: 3.2,
      salt: 0.1,
      unit: 'g',
    });
  });

  it('finds nothing in a photo that is not a label', () => {
    const values = parseNutritionLabel(table([['Ingredienti: semola di grano duro, acqua'], ['Prodotto in Italia']]));
    expect(countFound(values)).toBe(0);
    expect(values.unit).toBeNull();
  });
});
