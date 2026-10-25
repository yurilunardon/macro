/** Nutrient values. For foods they are per 100 g (or 100 ml); for diary entries they are totals. */
export type Nutrients = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  satFat: number | null;
  salt: number | null;
};

export type Unit = 'g' | 'ml';
/** Open Food Facts, made by the user, a basic food shipped with the app, or a recipe. */
export type FoodSource = 'off' | 'custom' | 'generic' | 'recipe';

/** A food as it comes from Open Food Facts or the "new food" form, before it is saved. */
export type FoodDraft = {
  barcode: string | null;
  name: string;
  brand: string | null;
  unit: Unit;
  per100: Nutrients;
  servingSize: number | null;
  servingLabel: string | null;
  imageUrl: string | null;
  source: FoodSource;
};

export type Food = FoodDraft & {
  id: number;
  favorite: boolean;
  /** Only basic foods have one, e.g. "Frutta". */
  category: string | null;
};

export const EMPTY_NUTRIENTS: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  sugars: null,
  fiber: null,
  satFat: null,
  salt: null,
};

const OPTIONAL_KEYS = ['sugars', 'fiber', 'satFat', 'salt'] as const;

function scaleOptional(value: number | null, factor: number): number | null {
  return value === null ? null : value * factor;
}

/** Nutrients for `quantity` grams (or ml) of a food whose values are per 100. */
export function scaleNutrients(per100: Nutrients, quantity: number): Nutrients {
  const factor = quantity / 100;
  return {
    kcal: per100.kcal * factor,
    protein: per100.protein * factor,
    carbs: per100.carbs * factor,
    fat: per100.fat * factor,
    sugars: scaleOptional(per100.sugars, factor),
    fiber: scaleOptional(per100.fiber, factor),
    satFat: scaleOptional(per100.satFat, factor),
    salt: scaleOptional(per100.salt, factor),
  };
}

/** Rescales totals that were computed for `fromQuantity` to `toQuantity`. */
export function rescaleNutrients(totals: Nutrients, fromQuantity: number, toQuantity: number): Nutrients {
  if (fromQuantity <= 0) return totals;
  return scaleNutrients(totals, (toQuantity / fromQuantity) * 100);
}

/** Sums totals. An optional nutrient stays null only if it is null in every item. */
export function sumNutrients(items: readonly Nutrients[]): Nutrients {
  const total: Nutrients = { ...EMPTY_NUTRIENTS };
  for (const item of items) {
    total.kcal += item.kcal;
    total.protein += item.protein;
    total.carbs += item.carbs;
    total.fat += item.fat;
    for (const key of OPTIONAL_KEYS) {
      const value = item[key];
      if (value !== null) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/** Energy estimated from macros (Atwater factors 4/4/9). */
export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return protein * 4 + carbs * 4 + fat * 9;
}

/** Share of energy coming from each macro, in percent (0 when there is no energy). */
export function macroEnergySplit(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat'>) {
  const protein = n.protein * 4;
  const carbs = n.carbs * 4;
  const fat = n.fat * 9;
  const total = protein + carbs + fat;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (protein / total) * 100,
    carbs: (carbs / total) * 100,
    fat: (fat / total) * 100,
  };
}
