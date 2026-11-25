/**
 * What ties one part of the app to another: a supplement that is also a food (a whey shake is in
 * the diary and among the supplements), told apart by their names.
 */

/** A dose and a food logged this close together are the same shake, whichever came first. */
export const SAME_MOMENT_MS = 10 * 60_000;

// Words that say nothing about which product it is.
const FILLER = new Set(['con', 'del', 'della', 'per', 'gusto', 'the', 'and', 'with', 'flavour', 'flavor', 'dose', 'scoop', 'misurino']);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w));
}

/**
 * Whether a supplement and a food are the same product: every telling word of one is in the
 * other. "Impact Whey" is "Impact Whey Protein · Cioccolato"; "Creatina" is not "Crema".
 */
export function sameProduct(supplement: string, food: string): boolean {
  const a = words(supplement);
  const b = words(food);
  if (a.length === 0 || b.length === 0) return false;
  const inB = new Set(b);
  const inA = new Set(a);
  return a.every((w) => inB.has(w)) || b.every((w) => inA.has(w));
}

/** Whether two ISO times are the same moment for a dose and its food. */
export function sameMoment(a: string, b: string): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_MOMENT_MS;
}

/**
 * The dose a food logged in the diary ticks: the first of the day not ticked yet; none when all
 * the day's are, unless it is taken when needed, which has no count.
 */
export function nextDose(taken: readonly number[], perDay: number, whenNeeded: boolean): number | null {
  const done = new Set(taken);
  let index = 0;
  while (done.has(index)) index += 1;
  return whenNeeded || index < Math.max(1, perDay) ? index : null;
}
