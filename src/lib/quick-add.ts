import { parseDecimal } from './format';
import { kcalFromMacros, type Nutrients } from './nutrition';

/** The text of the "quick add" form: energy and macros typed directly, without a food. */
export type QuickFields = { name: string; kcal: string; protein: string; carbs: string; fat: string };

export const EMPTY_QUICK_FIELDS: QuickFields = { name: '', kcal: '', protein: '', carbs: '', fat: '' };

export const QUICK_ADD_NAME = 'Aggiunta rapida';

export type QuickAdd = { name: string; totals: Nutrients };

function optional(text: string, max: number): number | null | undefined {
  if (text.trim() === '') return null;
  const value = parseDecimal(text);
  return value === null || value < 0 || value > max ? undefined : value;
}

/** Validates the form. Without kcal, energy is computed from the macros. */
export function parseQuickAdd(f: QuickFields) {
  const invalid = new Set<keyof QuickFields>();
  const read = (key: 'kcal' | 'protein' | 'carbs' | 'fat', max: number) => {
    const value = optional(f[key], max);
    if (value === undefined) invalid.add(key);
    return value ?? null;
  };
  const kcalInput = read('kcal', 10000);
  const protein = read('protein', 1000) ?? 0;
  const carbs = read('carbs', 1000) ?? 0;
  const fat = read('fat', 1000) ?? 0;
  const estimatedKcal = protein + carbs + fat > 0 ? kcalFromMacros(protein, carbs, fat) : null;
  const kcal = kcalInput ?? estimatedKcal;
  if (!invalid.has('kcal') && (kcal === null || kcal <= 0)) invalid.add('kcal');

  const result: QuickAdd | null =
    invalid.size === 0 && kcal !== null
      ? {
          name: f.name.trim() === '' ? QUICK_ADD_NAME : f.name.trim(),
          totals: { kcal, protein, carbs, fat, sugars: null, fiber: null, satFat: null, salt: null },
        }
      : null;
  return { result, invalid, estimatedKcal };
}
