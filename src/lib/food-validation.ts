import { numberToInput, parseDecimal } from './format';
import { kcalFromMacros, type Food, type FoodDraft, type Unit } from './nutrition';

/** The text of every input of the food form. */
export type FoodFields = {
  name: string;
  brand: string;
  barcode: string;
  unit: Unit;
  servingSize: string;
  kcal: string;
  protein: string;
  carbs: string;
  sugars: string;
  fat: string;
  satFat: string;
  fiber: string;
  salt: string;
};

export const EMPTY_FOOD_FIELDS: FoodFields = {
  name: '',
  brand: '',
  barcode: '',
  unit: 'g',
  servingSize: '',
  kcal: '',
  protein: '',
  carbs: '',
  sugars: '',
  fat: '',
  satFat: '',
  fiber: '',
  salt: '',
};

export function fieldsFromFood(food: Food): FoodFields {
  return {
    name: food.name,
    brand: food.brand ?? '',
    barcode: food.barcode ?? '',
    unit: food.unit,
    servingSize: numberToInput(food.servingSize),
    kcal: numberToInput(food.per100.kcal, 0),
    protein: numberToInput(food.per100.protein),
    carbs: numberToInput(food.per100.carbs),
    sugars: numberToInput(food.per100.sugars),
    fat: numberToInput(food.per100.fat),
    satFat: numberToInput(food.per100.satFat),
    fiber: numberToInput(food.per100.fiber),
    salt: numberToInput(food.per100.salt, 2),
  };
}

const NUMBER_FIELDS = ['servingSize', 'kcal', 'protein', 'carbs', 'sugars', 'fat', 'satFat', 'fiber', 'salt'] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];

/** Optional number: empty → null, not a non-negative number → undefined. */
function readOptional(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const value = parseDecimal(text);
  return value === null || value < 0 ? undefined : value;
}

export type FoodValidation = {
  draft: FoodDraft | null;
  errors: string[];
  invalid: Set<keyof FoodFields>;
  /** Energy from macros, shown when the kcal field is empty. */
  estimatedKcal: number | null;
};

/**
 * Checks the form and builds the food to save. `base` is the food being edited, whose
 * source, image and serving label are kept.
 */
export function validateFoodFields(f: FoodFields, base: Food | null): FoodValidation {
  const errors: string[] = [];
  const invalid = new Set<keyof FoodFields>();
  const n = {} as Record<NumberField, number | null>;
  for (const key of NUMBER_FIELDS) {
    const value = readOptional(f[key]);
    if (value === undefined) invalid.add(key);
    n[key] = value ?? null;
  }
  if (invalid.size > 0) errors.push('Alcuni valori non sono numeri validi.');

  const name = f.name.trim();
  if (name === '') {
    errors.push('Il nome è obbligatorio.');
    invalid.add('name');
  }
  const barcode = f.barcode.replace(/\s/g, '');
  if (barcode !== '' && !/^\d{6,14}$/.test(barcode)) {
    errors.push('Il codice a barre deve avere da 6 a 14 cifre.');
    invalid.add('barcode');
  }
  if (n.servingSize === 0) {
    errors.push('La porzione deve essere maggiore di zero.');
    invalid.add('servingSize');
  }

  const protein = n.protein ?? 0;
  const carbs = n.carbs ?? 0;
  const fat = n.fat ?? 0;
  const hasMacros = n.protein !== null || n.carbs !== null || n.fat !== null;
  const estimatedKcal = hasMacros ? kcalFromMacros(protein, carbs, fat) : null;
  const kcal = n.kcal ?? estimatedKcal;
  if (kcal === null) {
    errors.push('Inserisci le calorie oppure i macronutrienti.');
    invalid.add('kcal');
  }
  // Labels round each value, so allow a little over 100 g.
  if (protein + carbs + fat > 101) {
    errors.push('Proteine, carboidrati e grassi superano 100 g su 100 g.');
    invalid.add('protein').add('carbs').add('fat');
  }
  if (n.sugars !== null && n.sugars > carbs + 0.05) {
    errors.push('Gli zuccheri non possono superare i carboidrati.');
    invalid.add('sugars');
  }
  if (n.satFat !== null && n.satFat > fat + 0.05) {
    errors.push('I grassi saturi non possono superare i grassi.');
    invalid.add('satFat');
  }

  if (errors.length > 0 || kcal === null) return { draft: null, errors, invalid, estimatedKcal };
  return {
    draft: {
      barcode: barcode === '' ? null : barcode,
      name,
      brand: f.brand.trim() === '' ? null : f.brand.trim(),
      unit: f.unit,
      per100: { kcal, protein, carbs, fat, sugars: n.sugars, fiber: n.fiber, satFat: n.satFat, salt: n.salt },
      servingSize: n.servingSize,
      servingLabel: base?.servingLabel ?? null,
      imageUrl: base?.imageUrl ?? null,
      source: base?.source ?? 'custom',
    },
    errors,
    invalid,
    estimatedKcal,
  };
}
