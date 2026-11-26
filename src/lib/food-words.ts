/**
 * Food written in words — the ingredients of a recipe sent in a message, or a meal described —
 * read by the coach into foods of the app with their amounts. The model only picks foods and
 * guesses amounts; the values come from the app's foods, except for those it does not have.
 */
import type { Nutrients, Unit } from './nutrition';

/** What the text is: a dish cooked from raw ingredients, or a meal already eaten. */
export type WordsKind = 'recipe' | 'meal';

/** The brand given to the foods the coach had to make up, so they are told apart. */
export const COACH_BRAND = 'Stima del coach';

export type CatalogFood = { id: number; name: string; brand: string | null; unit: Unit };

export type WordsFood =
  | { kind: 'known'; id: number }
  | { kind: 'new'; name: string; unit: Unit; per100: Nutrients };

export type WordsItem = {
  food: WordsFood;
  name: string;
  unit: Unit;
  amount: number;
  /** The amount was not written: the model guessed it. */
  guessed: boolean;
  /** How it was guessed: "una bottiglia". */
  why: string | null;
  /** It may not have been there, e.g. sugar in a coffee: left unticked. */
  optional: boolean;
};

export type WordsResult = { title: string; items: WordsItem[] };

export const WORDS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          foodId: { type: 'INTEGER', nullable: true },
          name: { type: 'STRING' },
          unit: { type: 'STRING', enum: ['g', 'ml'] },
          amount: { type: 'NUMBER' },
          guessed: { type: 'BOOLEAN' },
          why: { type: 'STRING' },
          optional: { type: 'BOOLEAN' },
          kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
        },
        required: ['name', 'unit', 'amount', 'guessed'],
      },
    },
  },
  required: ['title', 'items'],
} as const;

/** The foods the model chooses from, one per line: "12|Pasta di semola, cruda|g". */
export function catalogText(foods: readonly CatalogFood[]): string {
  return foods.map((f) => `${f.id}|${f.brand ? `${f.name} (${f.brand})` : f.name}|${f.unit}`).join('\n');
}

export function wordsSystem(catalog: readonly CatalogFood[]): string {
  return [
    'Sei dentro un’app italiana per contare calorie. Ti arriva un testo scritto da una persona: gli ingredienti di una ricetta oppure un pasto già mangiato. Trasformalo in alimenti con le quantità. Rispondi solo in JSON.',
    '',
    'Regole:',
    '- Per ogni alimento scegli dal CATALOGO l’id di quello più adatto (foodId). Per una RICETTA scegli la versione cruda o secca, come si pesa prima di cucinare; per un PASTO la versione già pronta o cotta.',
    '- Se nel catalogo non c’è niente di adatto, foodId null: dai name (nome breve e generico, in italiano), unit, e i valori medi per 100 g o 100 ml in kcal, protein, carbs, fat.',
    '- name: il nome dell’alimento scelto. unit: quella del catalogo. amount: la quantità in quell’unità.',
    '- Se la quantità è scritta in grammi o ml usala, guessed false. Se è a parole («una bottiglia», «2 mozzarelle», «un filo d’olio», «q.b.») o manca, stimala con le porzioni tipiche italiane: guessed true e in why come l’hai stimata, al massimo cinque parole («una bottiglia», «2 da 125 g», «non detto»).',
    '- Un numero senza unità vicino a un ingrediente sono grammi («300 di macinato» = 300 g).',
    '- Sale, pepe, spezie, erbe e acqua di cottura non metterli.',
    '- In un PASTO, scomponi i piatti nei loro ingredienti principali solo se nel catalogo non c’è il piatto intero; dai le porzioni di un piatto normale. optional true per quello che potrebbe non esserci (lo zucchero nel caffè). In una RICETTA optional è sempre false.',
    '- title: il nome breve del piatto o del pasto, con la maiuscola («Pasta al forno», «Colazione al bar»).',
    '',
    'CATALOGO (id|nome|unità):',
    catalogText(catalog),
  ].join('\n');
}

export function wordsQuestion(kind: WordsKind, text: string): string {
  return kind === 'recipe' ? `RICETTA:\n${text.trim()}` : `PASTO GIÀ MANGIATO:\n${text.trim()}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function per100Of(raw: Record<string, unknown>): Nutrients | null {
  const kcal = num(raw.kcal);
  const protein = num(raw.protein);
  const carbs = num(raw.carbs);
  const fat = num(raw.fat);
  if (kcal === null || protein === null || carbs === null || fat === null) return null;
  if (kcal < 0 || kcal > 900 || [protein, carbs, fat].some((v) => v < 0 || v > 100) || protein + carbs + fat > 105) return null;
  return { kcal, protein, carbs, fat, sugars: null, fiber: null, satFat: null, salt: null };
}

/** The model's answer, kept only where it makes sense: foods that exist, amounts and values that can be. */
export function parseWords(json: string, catalog: ReadonlyMap<number, CatalogFood>, kind: WordsKind): WordsResult | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { title?: unknown; items?: unknown };
  if (!Array.isArray(d.items)) return null;
  const items: WordsItem[] = [];
  for (const entry of d.items.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const amount = num(raw.amount);
    if (amount === null || amount <= 0 || amount > 5000) continue;
    const id = num(raw.foodId);
    const known = id !== null ? catalog.get(id) : undefined;
    const why = typeof raw.why === 'string' && raw.why.trim() ? raw.why.trim().slice(0, 60) : null;
    const base = { amount: Math.round(amount), guessed: raw.guessed === true, why, optional: kind === 'meal' && raw.optional === true };
    if (known) {
      items.push({ ...base, food: { kind: 'known', id: known.id }, name: known.name, unit: known.unit });
      continue;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
    const per100 = per100Of(raw);
    if (!name || !per100) continue;
    const unit: Unit = raw.unit === 'ml' ? 'ml' : 'g';
    items.push({ ...base, food: { kind: 'new', name, unit, per100 }, name, unit });
  }
  if (items.length === 0) return null;
  const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 60) : kind === 'recipe' ? 'Ricetta' : 'Pasto';
  return { title, items };
}

/** Text that reads as more than one food: worth the coach rather than the search. */
export function looksLikeSeveral(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /,|\+|\be\b|\bed\b|\bcon\b|\n/.test(t) || t.split(/\s+/).length >= 4;
}
