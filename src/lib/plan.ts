/**
 * The day's plan: the moments of the day the supplements and the weigh-in are tied to, and the
 * checklist of one day built from them. Pure, so it is tested without a database.
 */
import type { ActivityType, AgendaItem } from './calendar';
import { weekdayOf, type DateKey } from './dates';
import { dosesDue, type Supplement } from './supplements';

export type Moment = {
  id: string;
  name: string;
  /** "07:00": when it falls; for one tied to the training, when it falls on days without one. */
  time: string;
  /** Tied to the day's training: at its start or at its end. */
  anchor: 'start' | 'end' | null;
};

export const DEFAULT_MOMENTS: readonly Moment[] = [
  { id: 'morning', name: 'Mattina', time: '07:00', anchor: null },
  { id: 'lunch', name: 'Pranzo', time: '13:00', anchor: null },
  { id: 'training', name: 'Allenamento', time: '21:00', anchor: 'start' },
  { id: 'after', name: 'Dopo l’allenamento', time: '23:00', anchor: 'end' },
  { id: 'evening', name: 'Sera', time: '23:30', anchor: null },
];

/** When to weigh in: every day or on some days of the week, at a moment of the day. */
export type WeighInPlan = {
  enabled: boolean;
  schedule: 'daily' | 'weekdays';
  /** For `weekdays`, as Date.getDay(): 0 is Sunday. */
  weekdays: number[];
  moment: string;
};

export const DEFAULT_WEIGH_IN: WeighInPlan = { enabled: true, schedule: 'daily', weekdays: [], moment: 'morning' };

export function weighInDue(plan: WeighInPlan, date: DateKey): boolean {
  if (!plan.enabled) return false;
  return plan.schedule === 'daily' || plan.weekdays.includes(weekdayOf(date));
}

/** "21:00" plus 90 minutes is "22:30"; never past midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = Math.min(hour * 60 + minute + Math.round(minutes), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "21:04" from an ISO date and time, in the phone's time zone. */
export function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The day's training, for the moments tied to it: when it starts and when it ends. */
export type TrainingTimes = { start: string; end: string } | null;

/**
 * When the day's training starts and ends: the workout logged, else the first activity planned
 * with a time, for as long as it lasts. Null on a day without one.
 */
export function trainingTimes(items: readonly AgendaItem[], types: ReadonlyMap<number, ActivityType>): TrainingTimes {
  for (const item of items) {
    if (item.kind === 'workout') {
      const start = clockOf(item.workout.startedAt);
      return { start, end: item.workout.endedAt ? clockOf(item.workout.endedAt) : addMinutes(start, 90) };
    }
    const o = item.occurrence;
    if (item.status === 'skipped' || o.time === null) continue;
    return { start: o.time, end: addMinutes(o.time, o.minutes ?? types.get(o.typeId)?.minutes ?? 60) };
  }
  return null;
}

export function momentTime(moment: Moment, training: TrainingTimes): string {
  if (training && moment.anchor === 'start') return training.start;
  if (training && moment.anchor === 'end') return training.end;
  return moment.time;
}

/** The moments in the order they fall on a day. */
export function sortMoments(moments: readonly Moment[], training: TrainingTimes): Moment[] {
  return [...moments].sort((a, b) => {
    const ta = momentTime(a, training);
    const tb = momentTime(b, training);
    return ta === tb ? moments.indexOf(a) - moments.indexOf(b) : ta < tb ? -1 : 1;
  });
}

/**
 * The moment a supplement goes in: its own; for one taken at a set time, the last moment that
 * falls by then; otherwise the first of the day.
 */
export function momentOf(supplement: Pick<Supplement, 'moment' | 'reminder'>, sorted: readonly Moment[], training: TrainingTimes): Moment | null {
  const own = sorted.find((m) => m.id === supplement.moment);
  if (own) return own;
  if (supplement.reminder) {
    const before = sorted.filter((m) => momentTime(m, training) <= (supplement.reminder ?? ''));
    if (before.length > 0) return before[before.length - 1];
  }
  return sorted[0] ?? null;
}

export type DayEntry =
  | {
      kind: 'weighIn';
      key: string;
      kg: number | null;
      /** ISO date and time it was logged, when it was logged on the day itself. */
      loggedAt: string | null;
      done: boolean;
    }
  | {
      kind: 'supplement';
      key: string;
      supplement: Supplement;
      /** Which dose of the day, for one taken more than once. */
      index: number;
      /** ISO date and time it was ticked. */
      takenAt: string | null;
      /** A set time of its own, when it has one. */
      time: string | null;
      done: boolean;
    };

export type DaySection = { moment: Moment; time: string; entries: DayEntry[] };

/**
 * One day's checklist: the weigh-in and the supplements due, each in its moment, the moments
 * in the order they fall and only those with something in them.
 */
export function buildDay({
  date,
  moments,
  training,
  supplements,
  taken,
  active,
  weighIn,
  weight,
}: {
  date: DateKey;
  moments: readonly Moment[];
  training: TrainingTimes;
  supplements: readonly Supplement[];
  /** "id:index" → when the dose was ticked. */
  taken: ReadonlyMap<string, string>;
  /** The days with an activity or a workout, for the supplements of training days. */
  active: ReadonlySet<DateKey>;
  weighIn: WeighInPlan;
  weight: { kg: number; loggedAt: string | null } | null;
}): DaySection[] {
  const sorted = sortMoments(moments, training);
  const entries = new Map<string, DayEntry[]>(sorted.map((m) => [m.id, []]));

  if (weighIn.enabled && (weighInDue(weighIn, date) || weight)) {
    const moment = sorted.find((m) => m.id === weighIn.moment) ?? sorted[0];
    entries.get(moment.id)?.push({
      kind: 'weighIn',
      key: 'weigh-in',
      kg: weight?.kg ?? null,
      loggedAt: weight?.loggedAt ?? null,
      done: weight !== null,
    });
  }

  for (const supplement of supplements) {
    if (supplement.archived) continue;
    const due = dosesDue(supplement, date, active);
    const moment = momentOf(supplement, sorted, training);
    if (!moment) continue;
    for (let index = 0; index < due; index++) {
      const takenAt = taken.get(`${supplement.id}:${index}`) ?? null;
      entries.get(moment.id)?.push({
        kind: 'supplement',
        key: `s${supplement.id}:${index}`,
        supplement,
        index,
        takenAt,
        time: supplement.moment ? null : supplement.reminder,
        done: takenAt !== null,
      });
    }
  }

  return sorted
    .map((moment) => ({ moment, time: momentTime(moment, training), entries: entries.get(moment.id) ?? [] }))
    .filter((section) => section.entries.length > 0);
}

/** How much of the day is done: the entries plus its activities. */
export function dayProgress(sections: readonly DaySection[], activities: { done: number; total: number }): { done: number; total: number } {
  let done = activities.done;
  let total = activities.total;
  for (const section of sections) {
    for (const entry of section.entries) {
      total += 1;
      if (entry.done) done += 1;
    }
  }
  return { done, total };
}
