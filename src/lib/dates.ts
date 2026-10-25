/** Dates are stored as local calendar days in the form YYYY-MM-DD. */
export type DateKey = string;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const weekdayDayMonth = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const dayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const weekdayShort = new Intl.DateTimeFormat('it-IT', { weekday: 'narrow' });

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && DATE_KEY.test(value);
}

/** Midday of that day, so that DST changes never move it to another day. */
export function fromDateKey(key: DateKey): Date {
  const match = DATE_KEY.exec(key);
  if (!match) throw new Error(`Data non valida: ${key}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000);
}

/** The `count` days ending with `end`, oldest first. */
export function lastDays(end: DateKey, count: number): DateKey[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Oggi", "Ieri", "Domani" or e.g. "Lunedì 20 ottobre". */
export function formatDayTitle(key: DateKey, today: DateKey = todayKey()): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'Oggi';
  if (diff === -1) return 'Ieri';
  if (diff === 1) return 'Domani';
  return capitalize(weekdayDayMonth.format(fromDateKey(key)));
}

export function formatShortDate(key: DateKey): string {
  return dayMonth.format(fromDateKey(key));
}

export function formatWeekdayInitial(key: DateKey): string {
  return weekdayShort.format(fromDateKey(key)).toUpperCase();
}

/** Day of the week as in Date.getDay(): 0 is Sunday. */
export function weekdayOf(key: DateKey): number {
  return fromDateKey(key).getDay();
}
