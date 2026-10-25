import type { Nutrients } from './nutrition';

export type BreakdownKey = 'protein' | 'carbs' | 'fat' | 'fiber';

type Item = { id: number; totals: Nutrients };

/**
 * Where a nutrient came from: the entries that have some of it, largest first, each with its
 * share of the day's total.
 */
export function nutrientBreakdown<T extends Item>(
  entries: readonly T[],
  key: BreakdownKey,
): { total: number; items: { entry: T; amount: number; share: number }[] } {
  const amounts = entries.map((entry) => ({ entry, amount: entry.totals[key] ?? 0 }));
  const total = amounts.reduce((sum, a) => sum + a.amount, 0);
  const items = amounts
    .filter((a) => a.amount > 0.05)
    .sort((a, b) => b.amount - a.amount || a.entry.id - b.entry.id)
    .map((a) => ({ ...a, share: total > 0 ? a.amount / total : 0 }));
  return { total, items };
}
