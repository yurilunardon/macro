/** What is better kept under a ceiling each day, rather than reached like a goal. */
export type LimitKey = 'sugars' | 'satFat' | 'salt';

/** A ceiling in grams, or as a share of the day's calories. */
export type NutrientLimit = { unit: 'grams' | 'percent'; value: number };
export type NutrientLimits = Record<LimitKey, NutrientLimit>;

export const LIMIT_KEYS: readonly LimitKey[] = ['sugars', 'satFat', 'salt'];

export const LIMIT_LABELS: Record<LimitKey, string> = {
  sugars: 'Zuccheri',
  satFat: 'Grassi saturi',
  salt: 'Sale',
};

/**
 * The starting values, all editable. Sugars: the EU's reference intake of 90 g, since labels give
 * total sugars; the WHO's 10% of calories counts only added ones, which labels do not tell apart.
 * Saturated fat: the WHO's 10% of calories. Salt: the WHO's 5 g.
 */
export const DEFAULT_LIMITS: NutrientLimits = {
  sugars: { unit: 'grams', value: 90 },
  satFat: { unit: 'percent', value: 10 },
  salt: { unit: 'grams', value: 5 },
};

/** Salt has no calories, so its ceiling can only be in grams. */
export const KCAL_PER_GRAM: Partial<Record<LimitKey, number>> = { sugars: 4, satFat: 9 };

/** A ceiling in grams, for a day with this calorie goal. */
export function limitGrams(key: LimitKey, limit: NutrientLimit, kcal: number): number {
  const perGram = KCAL_PER_GRAM[key];
  if (limit.unit === 'grams' || perGram === undefined) return limit.value;
  return Math.round((kcal * limit.value) / 100 / perGram);
}

/** Valid: more than nothing, and a share of the calories cannot be above all of them. */
export function isValidLimit(limit: NutrientLimit): boolean {
  return Number.isFinite(limit.value) && limit.value > 0 && (limit.unit === 'grams' || limit.value <= 100);
}

/** Stored limits over the starting values, so one missing or broken never leaves a day without. */
export function resolveLimits(stored: Partial<NutrientLimits> | null): NutrientLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of LIMIT_KEYS) {
    const limit = stored?.[key];
    if (limit && (limit.unit === 'grams' || limit.unit === 'percent') && isValidLimit(limit)) limits[key] = limit;
  }
  return limits;
}
