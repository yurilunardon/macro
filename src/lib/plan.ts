/**
 * What one day holds besides its activities: the weigh-in and the doses of the supplements, each at
 * its own time. Pure, so it is tested without a database.
 */
import { weekdayOf, type DateKey, toDateKey } from './dates';
import { dosesDue, type DoseChange, type Supplement } from './supplements';

/** When to weigh in: every day or on some days of the week, at a time of the day. */
export type WeighInPlan = {
  enabled: boolean;
  schedule: 'daily' | 'weekdays';
  /** For `weekdays`, as Date.getDay(): 0 is Sunday. */
  weekdays: number[];
  time: string;
};

export const DEFAULT_WEIGH_IN: WeighInPlan = { enabled: true, schedule: 'daily', weekdays: [], time: '07:05' };

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

/** The ISO date and time of a time on a day, in the phone's time zone. */
export function isoAt(date: DateKey, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

export type DayEntry =
  | {
      kind: 'weighIn';
      key: string;
      /** Where it goes in the day: when it was logged, or when it is planned. */
      at: string;
      kg: number | null;
      /** ISO date and time it was logged, when it was logged on the day itself. */
      loggedAt: string | null;
      done: boolean;
      skipped: false;
    }
  | {
      kind: 'supplement';
      key: string;
      supplement: Supplement;
      /** Which dose of the day, for one taken more than once. */
      index: number;
      /** Where it goes in the day: when it was taken, or when it is planned. */
      at: string;
      /** When it was meant to be taken, moved or not. */
      planned: string;
      /** ISO date and time it was ticked. */
      takenAt: string | null;
      done: boolean;
      skipped: boolean;
    };

/** The time it was done, if done on that very day: ticks made the day after say nothing about when. */
function clockOn(date: DateKey, iso: string | null): string | null {
  return iso !== null && toDateKey(new Date(iso)) === date ? clockOf(iso) : null;
}

/**
 * One day's weigh-in and doses, in the order they fall: what was done where it was done, the rest
 * at its time, a dose moved for that day where it was moved to. A supplement taken when needed
 * shows only once taken.
 */
export function buildDay({
  date,
  supplements,
  taken,
  changes,
  active,
  weighIn,
  weight,
}: {
  date: DateKey;
  supplements: readonly Supplement[];
  /** "id:index" → when the dose was ticked. */
  taken: ReadonlyMap<string, string>;
  /** "id:date:index" → how that dose was changed for the day. */
  changes: ReadonlyMap<string, DoseChange>;
  /** The days with an activity or a workout, for the supplements of training days. */
  active: ReadonlySet<DateKey>;
  weighIn: WeighInPlan;
  weight: { kg: number; loggedAt: string | null } | null;
}): DayEntry[] {
  const entries: DayEntry[] = [];

  if (weighIn.enabled && (weighInDue(weighIn, date) || weight)) {
    const at = clockOn(date, weight?.loggedAt ?? null) ?? weighIn.time;
    entries.push({ kind: 'weighIn', key: 'weigh-in', at, kg: weight?.kg ?? null, loggedAt: weight?.loggedAt ?? null, done: weight !== null, skipped: false });
  }

  for (const supplement of supplements) {
    const due = supplement.archived ? 0 : dosesDue(supplement, date, active);
    const indexes = new Set(Array.from({ length: due }, (_, i) => i));
    for (const key of taken.keys()) {
      const [id, index] = key.split(':').map(Number);
      if (id === supplement.id) indexes.add(index);
    }
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const takenAt = taken.get(`${supplement.id}:${index}`) ?? null;
      const change = changes.get(`${supplement.id}:${date}:${index}`);
      const planned = change?.time ?? supplement.times[index] ?? supplement.times[0] ?? '08:00';
      entries.push({
        kind: 'supplement',
        key: `s${supplement.id}:${index}`,
        supplement,
        index,
        at: clockOn(date, takenAt) ?? planned,
        planned,
        takenAt,
        done: takenAt !== null,
        skipped: takenAt === null && change?.skipped === true,
      });
    }
  }

  return entries.sort((a, b) => (a.at === b.at ? (a.key < b.key ? -1 : 1) : a.at < b.at ? -1 : 1));
}

/** How much of the day is done: the entries plus its activities. What was skipped does not count. */
export function dayProgress(entries: readonly DayEntry[], activities: { done: number; total: number }): { done: number; total: number } {
  let done = activities.done;
  let total = activities.total;
  for (const entry of entries) {
    if (entry.skipped) continue;
    total += 1;
    if (entry.done) done += 1;
  }
  return { done, total };
}
