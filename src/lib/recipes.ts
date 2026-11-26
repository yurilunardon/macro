import { formatNumber, parseDecimal } from './format';
import { scaleNutrients, sumNutrients, type Nutrients, type Unit } from './nutrition';
import { normalizeSearch } from './search';

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
  /** Cooked weight if given, otherwise the weight the cooking gives. */
  weight: number;
  /** The weight comes from the cooking, not from a scale. */
  estimated: boolean;
  /** What the cooking changes, for the estimate: "pasta ×2,2". */
  cooking: string[];
  per100: Nutrients;
  servingSize: number | null;
};

/** What happens to a food in the pot: how much it weighs cooked for each gram raw. */
export type Cooking = { label: string; factor: number };

const COOKED = /\b(cott|lessat|bollit|arrost|grigliat|alla griglia|al forno|al vapore|fritt|in scatola|sgocciolat|precott|tegamino|strapazzat|sodo|surgelat)/;
const NOT_COOKED_IN_WATER = /\b(gallett|soffiat|bevanda|latte|cracker|biscott|fiocchi|sfoglia|frolla|brise|pizza|pane|pangrattato|caffe|crema|gelato|budino|torta)/;
const FISH = /\b(salmone|merluzz|nasello|branzino|orata|sogliola|platessa|trota|spada|sgombr|alici|acciugh|gamber|calamar|totan|polpo|seppi|tonno fresco|cozze|vongole|pesce|filetto di (merluzzo|platessa|salmone))/;
const PRESERVED = /\b(sottolio|sott olio|scatol|affumicat|al naturale|salamoia|prosciutto|bresaola|salame|mortadella|wurstel|speck|coppa|pancetta|guanciale|lardo)/;
const MEAT = /\b(pollo|tacchino|manzo|vitell|maiale|agnello|coniglio|macinat|salsicc|bistecc|filetto|lonza|fesa|sovracosc|cosc|petto|hamburger|spezzatino|arista|braciol|polpett|carne)/;
const PASTA = /\b(pasta|spaghett|penne|fusilli|rigatoni|maccheroni|tagliatelle|fettuccine|linguine|farfalle|tortiglioni|paccheri|orecchiette|bucatini|mezze maniche|ditalini|tagliolini|pappardelle|vermicelli|trofie|sedanini|conchiglie|caserecce|gramigna|stelline|noodles)/;
const DRY_LEGUMES = /\b(ceci|fagiol|lenticch|fave|piselli|soia|cicerch|lupini|azuki).*\bsecc|\bsecc.*\b(ceci|fagiol|lenticch|fave|piselli|soia|cicerch)/;

/**
 * How cooking changes an ingredient's weight, from its name: dry pasta, rice, grains and dry
 * legumes take water, raw meat and fish lose it. Foods already cooked, and the rest, stay as they are.
 */
export function cookingOf(name: string, unit: Unit = 'g'): Cooking | null {
  if (unit !== 'g') return null;
  const n = normalizeSearch(name);
  if (COOKED.test(n)) return null;
  if (/\bpolenta\b/.test(n)) return { label: 'polenta', factor: 4 };
  if (/\blasagn/.test(n)) return { label: 'lasagne', factor: 2 };
  if (NOT_COOKED_IN_WATER.test(n)) return null;
  if (PASTA.test(n)) return /\bfresc/.test(n) ? { label: 'pasta fresca', factor: 1.6 } : { label: 'pasta', factor: 2.2 };
  if (/\b(gnocchi|tortellini|ravioli|cappelletti|agnolotti)\b/.test(n)) return { label: 'pasta fresca', factor: 1.6 };
  if (/\briso\b/.test(n)) return { label: 'riso', factor: 2.6 };
  if (/\b(couscous|cous cous)\b/.test(n)) return { label: 'couscous', factor: 2.4 };
  if (/\bquinoa\b/.test(n)) return { label: 'quinoa', factor: 2.7 };
  if (/\b(farro|orzo|bulgur|grano saraceno|miglio|amaranto)\b/.test(n)) return { label: 'cereali', factor: 2.5 };
  if (DRY_LEGUMES.test(n)) return { label: 'legumi secchi', factor: 2.4 };
  if (PRESERVED.test(n)) return null;
  if (FISH.test(n)) return { label: 'pesce', factor: 0.8 };
  if (MEAT.test(n)) return { label: 'carne', factor: 0.75 };
  return null;
}

type Computable = Pick<RecipeIngredient, 'quantity' | 'per100'> & { name?: string; unit?: Unit };

/**
 * Values of the finished dish per 100 g. Cooking changes the weight (pasta absorbs water,
 * meat loses it): the cooked weight, when known, gives the best numbers; otherwise it is
 * estimated from what cooking does to each ingredient.
 */
export function computeRecipe(
  ingredients: readonly Computable[],
  cookedWeight: number | null,
  servings: number | null,
): RecipeComputation | null {
  if (ingredients.length === 0) return null;
  const totals = sumNutrients(ingredients.map((i) => scaleNutrients(i.per100, i.quantity)));
  const rawWeight = ingredients.reduce((sum, i) => sum + i.quantity, 0);
  const cooking = new Map<string, number>();
  let cookedEstimate = 0;
  for (const i of ingredients) {
    const c = i.name ? cookingOf(i.name, i.unit) : null;
    if (c) cooking.set(c.label, c.factor);
    cookedEstimate += i.quantity * (c?.factor ?? 1);
  }
  const weighed = cookedWeight !== null && cookedWeight > 0;
  const weight = weighed ? cookedWeight : cookedEstimate;
  if (weight <= 0) return null;
  return {
    totals,
    rawWeight,
    weight,
    estimated: !weighed && cooking.size > 0,
    cooking: [...cooking].map(([label, factor]) => `${label} ×${formatNumber(factor, 2)}`),
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
