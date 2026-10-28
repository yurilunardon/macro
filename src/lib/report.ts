/** Periods of the report: a week (Monday to Sunday), a month or a year, and their parts for the chart. */
import {
  addDays,
  addMonths,
  formatMonth,
  formatShortDate,
  fromDateKey,
  monthOf,
  monthRange,
  weekOf,
  type DateKey,
} from './dates';

export type Period = 'week' | 'month' | 'year';

export function isPeriod(value: unknown): value is Period {
  return value === 'week' || value === 'month' || value === 'year';
}

export type Range = { from: DateKey; to: DateKey };

/** The week, month or year containing `anchor`. */
export function periodRange(period: Period, anchor: DateKey): Range {
  if (period === 'week') {
    const week = weekOf(anchor);
    return { from: week[0], to: week[6] };
  }
  if (period === 'month') return monthRange(monthOf(anchor));
  const year = anchor.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The first day of the period before (-1) or after (1). */
export function shiftPeriod(period: Period, anchor: DateKey, direction: number): DateKey {
  const { from } = periodRange(period, anchor);
  if (period === 'week') return addDays(from, 7 * direction);
  if (period === 'month') return `${addMonths(monthOf(from), direction)}-01`;
  return `${Number(from.slice(0, 4)) + direction}-01-01`;
}

/** "27 ott – 2 nov", "Ottobre 2026", "2026". */
export function formatPeriod(period: Period, anchor: DateKey): string {
  const { from, to } = periodRange(period, anchor);
  if (period === 'week') return `${formatShortDate(from)} – ${formatShortDate(to)}`;
  if (period === 'month') return formatMonth(monthOf(from));
  return from.slice(0, 4);
}

/** "settimana scorsa", "a settembre", "nel 2025": the period before, for comparisons. */
export function formatPrevious(period: Period, anchor: DateKey): string {
  const before = shiftPeriod(period, anchor, -1);
  if (period === 'week') return 'la settimana prima';
  if (period === 'month') return formatMonth(monthOf(before)).split(' ')[0].toLowerCase();
  return before.slice(0, 4);
}

export type Bucket = Range & { label: string };

const MONTH_LETTERS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];
const WEEKDAY_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

/** The bars of the chart: the days of a week, the weeks of a month, the months of a year. */
export function buckets(period: Period, anchor: DateKey): Bucket[] {
  const { from, to } = periodRange(period, anchor);
  if (period === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(from, i);
      return { from: day, to: day, label: WEEKDAY_LETTERS[i] };
    });
  }
  if (period === 'year') {
    return MONTH_LETTERS.map((label, i) => {
      const month = `${from.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
      return { ...monthRange(month), label };
    });
  }
  const list: Bucket[] = [];
  let start = from;
  while (start <= to) {
    const sunday = weekOf(start)[6];
    const end = sunday < to ? sunday : to;
    list.push({ from: start, to: end, label: `${fromDateKey(start).getDate()}–${fromDateKey(end).getDate()}` });
    start = addDays(end, 1);
  }
  return list;
}

/** "+3", "−2", "=" for a change from the period before. */
export function formatDelta(now: number, before: number, decimals = 0): string {
  const diff = Number((now - before).toFixed(decimals));
  if (diff === 0) return '=';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('it-IT', { maximumFractionDigits: decimals })}`;
}
