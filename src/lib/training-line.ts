import type { DateKey } from './dates';
import { nextInRotation } from './training';

/** A gym day in the calendar, with the day of the program it is for. */
export type UpcomingGymDay = { date: DateKey; time: string | null; dayId: number };

export type LineRow<W> =
  | { kind: 'past'; key: string; workout: W }
  | { kind: 'active'; key: string }
  | { kind: 'next' | 'later'; key: string; dayId: number; date: DateKey | null; time: string | null };

/** The workouts done shown above the next one. */
export const PAST_SHOWN = 2;

/**
 * The training page's line, in the order of time: the last workouts done, oldest first, the one in
 * progress, then the gym days to come with their dates. As many days to come as the program has, and every day of the
 * program is among them, those the calendar has no date for at the end, so that any of them can
 * be started from here at any time.
 */
export function buildTrainingLine<W extends { id: number }>({
  history,
  dayIds,
  nextId,
  upcoming,
  active = null,
}: {
  /** The workouts done, newest first. */
  history: readonly W[];
  /** The days of the program, in their order. */
  dayIds: readonly number[];
  /** The next day in the rotation, for when the calendar has no gym days to come. */
  nextId: number;
  /** The gym days to come, in date order. */
  upcoming: readonly UpcomingGymDay[];
  /** The workout in progress, and the day of the program it is for, if any. */
  active?: { dayId: number | null } | null;
}): LineRow<W>[] {
  const past: LineRow<W>[] = history
    .slice(0, PAST_SHOWN)
    .reverse()
    .map((workout) => ({ kind: 'past', key: `done:${workout.id}`, workout }));

  const dated = upcoming.filter((u) => dayIds.includes(u.dayId)).slice(0, dayIds.length);
  const coming = dated.map((u) => ({ dayId: u.dayId, date: u.date as DateKey | null, time: u.time }));
  // The days left out follow in the rotation's order, from after the last one with a date.
  let cursor: number | null = coming.length > 0 ? coming[coming.length - 1].dayId : null;
  for (let i = 0; i < dayIds.length; i += 1) {
    const dayId: number = (cursor === null ? nextId : nextInRotation(dayIds, cursor)) ?? nextId;
    cursor = dayId;
    // The day being done is already on the line, in its own row.
    if (dayId !== active?.dayId && !coming.some((c) => c.dayId === dayId)) coming.push({ dayId, date: null, time: null });
  }

  return [
    ...past,
    ...(active ? [{ kind: 'active' as const, key: 'active' }] : []),
    ...coming.map(
      ({ dayId, date, time }, index): LineRow<W> => ({
        kind: index === 0 ? 'next' : 'later',
        key: `coming:${date ?? 'free'}:${dayId}`,
        dayId,
        date,
        time,
      }),
    ),
  ];
}
