/**
 * The times of a day: when each workout and activity took place and when the supplements were
 * ticked, in order, and the usual time of each over a period. Pure, so it is tested without a
 * database.
 */
import { type AgendaItem } from './calendar';
import { toDateKey, type DateKey } from './dates';

/** A dose ticked: which supplement, for which day, and when. */
export type DoseTick = { supplementId: number; date: DateKey; takenAt: string };

export type TimelineRow =
  | { kind: 'item'; key: string; time: string | null; item: AgendaItem }
  /** Supplements ticked together, within a few minutes; no time when ticked on another day. */
  | { kind: 'doses'; key: string; time: string | null; supplementIds: number[] };

/** Doses ticked within this many minutes of the first one share a row. */
const SAME_MOMENT = 20;

/** "18:05", in local time. */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function itemTime(item: AgendaItem): string | null {
  return item.kind === 'workout' ? clockOf(item.workout.startedAt) : item.occurrence.time;
}

/**
 * A day in order of time: what has no time first, as all-day events in Calendar, then the rest.
 * Doses ticked on the day itself are grouped by moment; ones ticked later (from another day or
 * the reminder of an old day) have no time of their own.
 */
export function buildTimeline(items: readonly AgendaItem[], ticks: readonly DoseTick[]): TimelineRow[] {
  const rows: TimelineRow[] = items.map((item) => ({ kind: 'item', key: item.key, time: itemTime(item), item }));

  const sorted = [...ticks].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
  const later: number[] = [];
  let group: { start: number; time: string; ids: number[] } | null = null;
  const flush = () => {
    if (group) rows.push({ kind: 'doses', key: `d${group.time}`, time: group.time, supplementIds: group.ids });
    group = null;
  };
  for (const tick of sorted) {
    if (toDateKey(new Date(tick.takenAt)) !== tick.date) {
      if (!later.includes(tick.supplementId)) later.push(tick.supplementId);
      continue;
    }
    const time = clockOf(tick.takenAt);
    const at = minutesOf(time);
    if (group && at - group.start <= SAME_MOMENT) {
      if (!group.ids.includes(tick.supplementId)) group.ids.push(tick.supplementId);
      continue;
    }
    flush();
    group = { start: at, time, ids: [tick.supplementId] };
  }
  flush();
  if (later.length > 0) rows.push({ kind: 'doses', key: 'd-later', time: null, supplementIds: later });

  return rows.sort((a, b) => {
    if (a.time === b.time) return a.key < b.key ? -1 : 1;
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time < b.time ? -1 : 1;
  });
}

/**
 * The usual time among some, as "18:40": the average on a clock, so 23:50 and 00:10 give midnight
 * rather than noon. Null without times.
 */
export function averageClock(times: readonly string[]): string | null {
  if (times.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const time of times) {
    const angle = (minutesOf(time) / 1440) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  let minutes = Math.round(((Math.atan2(y, x) / (2 * Math.PI)) * 1440 + 1440) % 1440);
  if (minutes === 1440) minutes = 0;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The time workouts started on, those done in the period. */
export function workoutTimes(agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>, from: DateKey, to: DateKey): string[] {
  const times: string[] = [];
  for (const [date, items] of agenda) {
    if (date < from || date > to) continue;
    for (const item of items) if (item.kind === 'workout' && item.workout.endedAt !== null) times.push(clockOf(item.workout.startedAt));
  }
  return times;
}

/** The times doses were ticked on their own day. */
export function tickTimes(ticks: readonly DoseTick[]): string[] {
  return ticks.filter((t) => toDateKey(new Date(t.takenAt)) === t.date).map((t) => clockOf(t.takenAt));
}

/** Morning before 12, afternoon before 18, evening after: how many of the times fall in each. */
export function partsOfDay(times: readonly string[]): { morning: number; afternoon: number; evening: number } {
  const parts = { morning: 0, afternoon: 0, evening: 0 };
  for (const time of times) {
    const m = minutesOf(time);
    if (m < 12 * 60) parts.morning++;
    else if (m < 18 * 60) parts.afternoon++;
    else parts.evening++;
  }
  return parts;
}
