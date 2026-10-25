/**
 * Reads the values per 100 g/ml from the text recognised in a photo of a nutrition label.
 * The recogniser returns pieces of text with their position; rows are rebuilt from the
 * vertical position, then each row is matched by its label (Italian or English). On EU
 * labels the first number after the label is the value per 100.
 */

import { foldAccents } from './search';

/** A piece of recognised text. Coordinates are 0…1 with the origin at the top left. */
export type TextBox = { text: string; x: number; y: number; width: number; height: number };

export type LabelValues = {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  sugars: number | null;
  fat: number | null;
  satFat: number | null;
  fiber: number | null;
  salt: number | null;
  unit: 'g' | 'ml' | null;
};

type NutrientKey = Exclude<keyof LabelValues, 'unit' | 'kcal'>;

/** Checked in order: "di cui saturi" before "grassi", "di cui zuccheri" before "carboidrati". */
const ROW_PATTERNS: readonly [NutrientKey, RegExp][] = [
  ['satFat', /saturi|saturat|satures|gesattigte/],
  ['sugars', /zuccheri|sugars|sucres|zucker/],
  ['fat', /grassi|lipidi|\bfat\b|matieres grasses|\bfett\b/],
  ['carbs', /carboidrati|carbohydrate|glucides|kohlenhydrate/],
  ['fiber', /fibre|fibra|fiber|fibres|ballaststoffe/],
  ['protein', /proteine|protein|proteines|eiweiss/],
  ['salt', /\bsale\b|\bsalt\b|\bsel\b|\bsalz\b/],
];

const normalize = foldAccents;

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

/** Groups boxes whose vertical centres are close into rows, read left to right. */
export function groupRows(boxes: readonly TextBox[]): string[] {
  const sorted = [...boxes].filter((b) => b.text.trim() !== '').sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows: { center: number; height: number; boxes: TextBox[] }[] = [];
  for (const box of sorted) {
    const center = box.y + box.height / 2;
    const row = rows.find((r) => Math.abs(r.center - center) < Math.max(r.height, box.height) * 0.6);
    if (row) {
      row.boxes.push(box);
      row.center = (row.center * (row.boxes.length - 1) + center) / row.boxes.length;
      row.height = Math.max(row.height, box.height);
    } else {
      rows.push({ center, height: box.height, boxes: [box] });
    }
  }
  return rows.map((r) => r.boxes.sort((a, b) => a.x - b.x).map((b) => b.text.trim()).join(' '));
}

const NUMBER = /(\d+(?:[.,]\d+)?)/;

/** The first number that follows the label in a row, skipping words such as "di cui". */
function firstValue(row: string, label: RegExp): number | null {
  const match = label.exec(row);
  const after = match ? row.slice(match.index + match[0].length) : row;
  const number = NUMBER.exec(after);
  return number ? toNumber(number[1]) : null;
}

export function parseNutritionLabel(boxes: readonly TextBox[]): LabelValues {
  const rows = groupRows(boxes).map(normalize);
  const all = rows.join('\n');
  const values: LabelValues = {
    kcal: null,
    protein: null,
    carbs: null,
    sugars: null,
    fat: null,
    satFat: null,
    fiber: null,
    salt: null,
    unit: /100\s*ml/.test(all) ? 'ml' : /100\s*g/.test(all) ? 'g' : null,
  };

  // Energy is often split across rows ("1521 kJ" above "359 kcal"): the first kcal value wins.
  const kcal = /(\d+(?:[.,]\d+)?)\s*kcal/.exec(all);
  if (kcal) {
    values.kcal = toNumber(kcal[1]);
  } else {
    const kj = /(\d+(?:[.,]\d+)?)\s*kj/.exec(all);
    if (kj) values.kcal = Math.round(toNumber(kj[1]) / 4.184);
  }

  for (const row of rows) {
    for (const [key, pattern] of ROW_PATTERNS) {
      if (!pattern.test(row)) continue;
      if (values[key] === null) values[key] = firstValue(row, pattern);
      break;
    }
  }
  return values;
}

/** How many values were found, to tell a good photo from a useless one. */
export function countFound(values: LabelValues): number {
  return (['kcal', 'protein', 'carbs', 'sugars', 'fat', 'satFat', 'fiber', 'salt'] as const).filter(
    (key) => values[key] !== null,
  ).length;
}
