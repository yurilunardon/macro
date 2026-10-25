import { parseDecimal } from './format';
import { scaleNutrients, sumNutrients, type Nutrients, type Unit } from './nutrition';

/** An ingredient keeps a copy of the food's values, so later edits to the food do not change the recipe. */
export type RecipeIngredient = {
  foodId: number | null;
  name: string;
  brand: string | null;
  unit: Unit;
  quantity: number;
  per100: Nutrients;
};

export type RecipeComputation = {
  totals: Nutrients;
  /** Sum of the ingredient quantities (ml counted as g). */
  rawWeight: number;
  /** Cooked weight if given, otherwise the raw weight. */
  weight: number;
  per100: Nutrients;
  servingSize: number | null;
};

/**
 * Values of the finished dish per 100 g. Cooking changes the weight (pasta absorbs water,
 * meat loses it), so the cooked weight, when known, gives much better numbers.
 */
export function computeRecipe(
  ingredients: readonly Pick<RecipeIngredient, 'quantity' | 'per100'>[],
  cookedWeight: number | null,
  servings: number | null,
): RecipeComputation | null {
  if (ingredients.length === 0) return null;
  const totals = sumNutrients(ingredients.map((i) => scaleNutrients(i.per100, i.quantity)));
  const rawWeight = ingredients.reduce((sum, i) => sum + i.quantity, 0);
  const weight = cookedWeight && cookedWeight > 0 ? cookedWeight : rawWeight;
  if (weight <= 0) return null;
  return {
    totals,
    rawWeight,
    weight,
    per100: scaleNutrients(totals, 10_000 / weight),
    servingSize: servings && servings > 0 ? weight / servings : null,
  };
}

export type RecipeFields = { name: string; cookedWeight: string; servings: string };

/** Validates the recipe form; empty cooked weight and servings are allowed. */
export function parseRecipeFields(f: RecipeFields, ingredientCount: number) {
  const invalid = new Set<keyof RecipeFields | 'ingredients'>();
  const name = f.name.trim();
  if (name === '') invalid.add('name');
  if (ingredientCount === 0) invalid.add('ingredients');

  const optional = (text: string, max: number) => {
    if (text.trim() === '') return null;
    const value = parseDecimal(text);
    return value !== null && value > 0 && value <= max ? value : undefined;
  };
  const cookedWeight = optional(f.cookedWeight, 50_000);
  if (cookedWeight === undefined) invalid.add('cookedWeight');
  const servings = optional(f.servings, 100);
  if (servings === undefined) invalid.add('servings');

  return {
    invalid,
    values:
      invalid.size === 0
        ? { name, cookedWeight: cookedWeight ?? null, servings: servings ?? null }
        : null,
  };
}
