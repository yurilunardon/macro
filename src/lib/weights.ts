import { fromDateKey, type DateKey } from './dates';

export type WeighIn = { date: DateKey; kg: number };

/** Newest first, each with the change from the weigh-in before it (null for the first ever). */
export function withChanges(weights: readonly WeighIn[]): (WeighIn & { change: number | null })[] {
  const oldestFirst = [...weights].sort((a, b) => (a.date < b.date ? -1 : 1));
  return oldestFirst.map((w, i) => ({ ...w, change: i > 0 ? w.kg - oldestFirst[i - 1].kg : null })).reverse();
}

const monthYear = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

/** Consecutive items grouped by calendar month, e.g. "Ottobre 2026", keeping their order. */
export function groupByMonth<T extends { date: DateKey }>(items: readonly T[]): { title: string; items: T[] }[] {
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else {
      const title = monthYear.format(fromDateKey(item.date));
      groups.push({ key, title: title.charAt(0).toUpperCase() + title.slice(1), items: [item] });
    }
  }
  return groups.map(({ title, items: groupItems }) => ({ title, items: groupItems }));
}

/** "−0,4 kg", "+1,2 kg", "±0 kg". */
export function formatChange(change: number, unit: string, format: (n: number) => string): string {
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  return `${sign}${format(Math.abs(change))} ${unit}`;
}
