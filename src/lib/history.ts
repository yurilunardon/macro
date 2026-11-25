import { addDays, daysBetween, formatWeekdayName, type DateKey } from './dates';

/** From this many days without training, the gap is a pause rather than rest. */
export const PAUSE_DAYS = 6;

/** The days between two workouts: how many, the first and the last of them. */
export type RestGap = { days: number; from: DateKey; to: DateKey };

export type HistoryItem<T> = { kind: 'workout'; workout: T } | { kind: 'rest'; gap: RestGap };

/**
 * Workouts newest first, with the days without training between each two of them: the history
 * read as a calendar without drawing one. Two workouts on the same day or on following days have
 * nothing between them.
 */
export function historyLine<T extends { date: DateKey }>(workouts: readonly T[]): HistoryItem<T>[] {
  const items: HistoryItem<T>[] = [];
  workouts.forEach((workout, i) => {
    items.push({ kind: 'workout', workout });
    const older = workouts[i + 1];
    if (!older) return;
    const days = daysBetween(older.date, workout.date) - 1;
    if (days > 0) items.push({ kind: 'rest', gap: { days, from: addDays(older.date, 1), to: addDays(workout.date, -1) } });
  });
  return items;
}

/**
 * The days without training said with their names: "Giovedì · riposo", "Mercoledì e giovedì ·
 * riposo", "Da lunedì a giovedì · 4 giorni di riposo", and a pause when it is long.
 */
export function formatRestGap(gap: RestGap): string {
  const from = formatWeekdayName(gap.from);
  const to = formatWeekdayName(gap.to);
  if (gap.days === 1) return `${capitalize(from)} · riposo`;
  if (gap.days === 2) return `${capitalize(from)} e ${to} · riposo`;
  if (gap.days >= PAUSE_DAYS) return `${gap.days} giorni di pausa`;
  return `Da ${from} a ${to} · ${gap.days} giorni di riposo`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
