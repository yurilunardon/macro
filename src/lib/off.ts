/**
 * Open Food Facts client. Data © Open Food Facts contributors, ODbL licence.
 * API docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
import type { FoodDraft, Nutrients, Unit } from './nutrition';

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const SEARCH_URL = 'https://search.openfoodfacts.org/search';
// OFF asks every app to identify itself.
const USER_AGENT = 'Macro/1.0 (app personale iOS)';

const FIELDS = [
  'code',
  'product_name',
  'product_name_it',
  'generic_name_it',
  'brands',
  'quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'nutriments',
  'image_front_small_url',
].join(',');

type RawNutriments = Record<string, number | string | undefined>;

export type RawProduct = {
  code?: string;
  product_name?: string;
  product_name_it?: string;
  generic_name_it?: string;
  brands?: string | string[];
  quantity?: string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: RawNutriments;
  image_front_small_url?: string;
};

export class OffNetworkError extends Error {}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function firstBrand(brands: RawProduct['brands']): string | null {
  const list = Array.isArray(brands) ? brands : typeof brands === 'string' ? brands.split(',') : [];
  for (const brand of list) {
    const text = cleanText(brand);
    if (text) return text;
  }
  return null;
}

/** Reads a nutrient per 100 g, falling back to the per-serving value when only that is given. */
function per100(n: RawNutriments, key: string, servingSize: number | null): number | null {
  const value = toNumber(n[`${key}_100g`]);
  if (value !== null) return Math.max(0, value);
  const perServing = toNumber(n[`${key}_serving`]);
  if (perServing !== null && servingSize !== null && servingSize > 0) {
    return Math.max(0, (perServing * 100) / servingSize);
  }
  return null;
}

function detectUnit(p: RawProduct): Unit {
  if (p.product_quantity_unit?.toLowerCase() === 'ml') return 'ml';
  const quantity = p.quantity?.toLowerCase() ?? '';
  return /\d\s*(ml|cl|l)\b/.test(quantity) ? 'ml' : 'g';
}

/**
 * Turns an OFF product into a food draft. Returns null when the product has no usable
 * energy value, because such an entry cannot be counted.
 */
export function parseOffProduct(p: RawProduct): FoodDraft | null {
  const n = p.nutriments ?? {};
  const servingSize = toNumber(p.serving_quantity);
  const validServing = servingSize !== null && servingSize > 0 ? servingSize : null;

  let kcal = per100(n, 'energy-kcal', validServing);
  if (kcal === null) {
    const kj = per100(n, 'energy-kj', validServing) ?? per100(n, 'energy', validServing);
    if (kj !== null) kcal = kj / 4.184;
  }
  if (kcal === null) return null;

  const nutrients: Nutrients = {
    kcal,
    protein: per100(n, 'proteins', validServing) ?? 0,
    carbs: per100(n, 'carbohydrates', validServing) ?? 0,
    fat: per100(n, 'fat', validServing) ?? 0,
    sugars: per100(n, 'sugars', validServing),
    fiber: per100(n, 'fiber', validServing),
    satFat: per100(n, 'saturated-fat', validServing),
    salt: per100(n, 'salt', validServing),
  };

  const name =
    cleanText(p.product_name_it) ?? cleanText(p.product_name) ?? cleanText(p.generic_name_it) ?? 'Senza nome';

  return {
    barcode: cleanText(p.code),
    name,
    brand: firstBrand(p.brands),
    unit: detectUnit(p),
    per100: nutrients,
    servingSize: validServing,
    servingLabel: cleanText(p.serving_size),
    imageUrl: cleanText(p.image_front_small_url),
    source: 'off',
  };
}

/** Codes to try for a scanned barcode: iOS reports UPC-A as EAN-13 with a leading 0. */
export function barcodeCandidates(code: string): string[] {
  const digits = code.replace(/\D/g, '');
  if (digits === '') return [];
  const candidates = [digits];
  if (digits.length === 13 && digits.startsWith('0')) candidates.push(digits.slice(1));
  if (digits.length === 12) candidates.push(`0${digits}`);
  return candidates;
}

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OffNetworkError('Connessione non disponibile');
  }
  if (!res.ok && res.status !== 404) throw new OffNetworkError(`Open Food Facts ha risposto ${res.status}`);
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    throw new OffNetworkError('Risposta non valida da Open Food Facts');
  }
}

export type ProductLookup = { kind: 'found'; food: FoodDraft } | { kind: 'incomplete' } | { kind: 'not_found' };

/** Looks up a barcode. "incomplete" means the product exists but has no nutrition facts. */
export async function fetchProductByBarcode(code: string, signal?: AbortSignal): Promise<ProductLookup> {
  let incomplete = false;
  for (const candidate of barcodeCandidates(code)) {
    const { body } = await getJson(`${PRODUCT_URL}${candidate}.json?fields=${FIELDS}`, signal);
    const data = body as { status?: number; product?: RawProduct };
    if (data.status !== 1 || !data.product) continue;
    const food = parseOffProduct({ ...data.product, code: data.product.code ?? candidate });
    if (food) return { kind: 'found', food };
    incomplete = true;
  }
  return incomplete ? { kind: 'incomplete' } : { kind: 'not_found' };
}

/** Removes characters that have a meaning in the search engine's query syntax. */
export function sanitizeQuery(query: string): string {
  return query
    .replace(/[:"'()[\]{}^~*?\\/!+\-&|<>=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Full-text search among products sold in Italy. Products without energy values are skipped. */
export async function searchProducts(query: string, signal?: AbortSignal): Promise<FoodDraft[]> {
  const terms = sanitizeQuery(query);
  if (terms === '') return [];
  const params = new URLSearchParams({
    q: `${terms} countries_tags:"en:italy"`,
    langs: 'it',
    page_size: '40',
    fields: FIELDS,
  });
  const { body } = await getJson(`${SEARCH_URL}?${params.toString()}`, signal);
  const hits = (body as { hits?: RawProduct[] }).hits ?? [];
  const foods: FoodDraft[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const food = parseOffProduct(hit);
    if (!food || (food.barcode && seen.has(food.barcode))) continue;
    if (food.barcode) seen.add(food.barcode);
    foods.push(food);
  }
  return foods;
}
