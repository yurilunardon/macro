/**
 * The calendar's activities: the gym, volleyball, matches and anything else, planned once or
 * every week. Pure, so the rules (what repeats, what counts as done, which day of the program
 * falls on which date) are tested without a database.
 */
import { addDays, daysBetween, weekdayOf, weekOf, type DateKey } from './dates';
import { nextInRotation } from './training';

export type ActivityColor = 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'teal' | 'pink' | 'yellow' | 'indigo';

export const ACTIVITY_COLORS: readonly ActivityColor[] = ['green', 'orange', 'red', 'blue', 'purple', 'teal', 'pink', 'yellow', 'indigo'];

export const COLOR_NAMES: Record<ActivityColor, string> = {
  green: 'Verde',
  orange: 'Arancione',
  red: 'Rosso',
  blue: 'Blu',
  purple: 'Viola',
  teal: 'Azzurro',
  pink: 'Rosa',
  yellow: 'Giallo',
  indigo: 'Indaco',
};

export function isActivityColor(value: unknown): value is ActivityColor {
  return typeof value === 'string' && (ACTIVITY_COLORS as readonly string[]).includes(value);
}

/** The built-in kind of the gym: done when a workout is logged in the app. */
export const GYM_REF = 'gym';

export type ActivityType = {
  id: number;
  /** Set on the built-in types ('gym', 'volleyball', 'match'); null on the user's own. */
  ref: string | null;
  name: string;
  symbol: string;
  color: ActivityColor;
  /** Usual length, in minutes, for activities without their own. */
  minutes: number | null;
  archived: boolean;
};

/** Symbols offered for a new kind of activity. */
export const ACTIVITY_SYMBOLS = [
  'figure.volleyball',
  'trophy.fill',
  'dumbbell.fill',
  'figure.run',
  'figure.outdoor.cycle',
  'figure.pool.swim',
  'figure.soccer',
  'figure.basketball',
  'figure.tennis',
  'figure.pickleball',
  'figure.hiking',
  'figure.walk',
  'figure.yoga',
  'figure.climbing',
  'figure.boxing',
  'figure.martial.arts',
  'figure.mixed.cardio',
  'figure.core.training',
  'figure.cooldown',
  'sportscourt.fill',
] as const;

export type ActivitySymbol = (typeof ACTIVITY_SYMBOLS)[number];

/** Repeats every week on some days, from `startDate` to `endDate` (both included; null: no end). */
export type ActivityPlan = {
  id: number;
  typeId: number;
  /** As Date.getDay(): 0 is Sunday. */
  weekdays: number[];
  /** "20:00", or null for no set time. */
  time: string | null;
  minutes: number | null;
  /** Gym only: always this day of the program; null follows the program's rotation. */
  dayId: number | null;
  note: string | null;
  startDate: DateKey;
  endDate: DateKey | null;
};

/** `cancelled` is only stored for one day of a plan taken off the calendar. */
export type StoredStatus = 'planned' | 'done' | 'skipped' | 'cancelled';

export type ActivityStatus = 'planned' | 'done' | 'skipped';

/** A single activity, or one day of a plan changed by hand (`planId` set). */
export type ActivityRecord = {
  id: number;
  typeId: number;
  planId: number | null;
  date: DateKey;
  time: string | null;
  minutes: number | null;
  dayId: number | null;
  note: string | null;
  status: StoredStatus;
};

/** One activity on one date, from a single record or from a plan. */
export type Occurrence = {
  /** Stable: the record, or the plan and the date. */
  key: string;
  recordId: number | null;
  planId: number | null;
  typeId: number;
  date: DateKey;
  time: string | null;
  minutes: number | null;
  dayId: number | null;
  note: string | null;
  status: ActivityStatus;
};

export function planCovers(plan: Pick<ActivityPlan, 'weekdays' | 'startDate' | 'endDate'>, date: DateKey): boolean {
  return date >= plan.startDate && (plan.endDate === null || date <= plan.endDate) && plan.weekdays.includes(weekdayOf(date));
}

function occurrenceOf(record: ActivityRecord): Occurrence {
  return {
    key: record.planId === null ? `a${record.id}` : `p${record.planId}:${record.date}`,
    recordId: record.id,
    planId: record.planId,
    typeId: record.typeId,
    date: record.date,
    time: record.time,
    minutes: record.minutes,
    dayId: record.dayId,
    note: record.note,
    status: record.status === 'cancelled' ? 'skipped' : record.status,
  };
}

/** Untimed first, as all-day events in Calendar, then by time. */
function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.time ?? '';
  const tb = b.time ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Every activity from `from` to `to`: the single ones, and each plan on the days it covers,
 * with the days changed by hand in place of the plan's (and the ones taken off left out).
 */
export function expandActivities(
  plans: readonly ActivityPlan[],
  records: readonly ActivityRecord[],
  from: DateKey,
  to: DateKey,
): Occurrence[] {
  const out: Occurrence[] = [];
  const changed = new Map<string, ActivityRecord>();
  for (const record of records) {
    if (record.date < from || record.date > to) continue;
    if (record.planId !== null) changed.set(`${record.planId}:${record.date}`, record);
    else if (record.status !== 'cancelled') out.push(occurrenceOf(record));
  }
  const count = daysBetween(from, to);
  for (let i = 0; i <= count; i++) {
    const date = addDays(from, i);
    for (const plan of plans) {
      if (!planCovers(plan, date)) continue;
      const record = changed.get(`${plan.id}:${date}`);
      if (record) {
        if (record.status !== 'cancelled') out.push(occurrenceOf(record));
        continue;
      }
      out.push({
        key: `p${plan.id}:${date}`,
        recordId: null,
        planId: plan.id,
        typeId: plan.typeId,
        date,
        time: plan.time,
        minutes: plan.minutes,
        dayId: plan.dayId,
        note: plan.note,
        status: 'planned',
      });
    }
  }
  return out.sort(compareOccurrences);
}

/** A workout logged in the app, as the calendar shows it. */
export type WorkoutBrief = {
  id: number;
  name: string;
  date: DateKey;
  startedAt: string;
  /** null while it is running. */
  endedAt: string | null;
  dayId: number | null;
  workSets: number;
};

export type AgendaItem =
  | {
      kind: 'workout';
      key: string;
      workout: WorkoutBrief;
      /** The planned gym day it fulfils, if there was one. */
      occurrence: Occurrence | null;
    }
  | {
      kind: 'activity';
      key: string;
      occurrence: Occurrence;
      status: ActivityStatus;
      /** Gym: the day of the program it is for, fixed or next in the rotation. */
      dayId: number | null;
    };

/** The active program's days in order and the one to do next, for the gym days to come. */
export type Rotation = { dayIds: readonly number[]; next: number | null };

/**
 * What each day holds. Activities that are over count as done unless marked as skipped: nobody
 * ticks every practice. The gym is the exception, since every workout is logged in the app: a
 * planned gym day is done by the workout of that date, and missed without one. Gym days to come
 * get the program's days in turn, starting from the next one, as the training tab shows them.
 */
export function buildAgenda({
  occurrences,
  workouts,
  gymTypeId,
  today,
  rotation,
}: {
  occurrences: readonly Occurrence[];
  workouts: readonly WorkoutBrief[];
  gymTypeId: number | null;
  today: DateKey;
  rotation: Rotation | null;
}): Map<DateKey, AgendaItem[]> {
  const agenda = new Map<DateKey, AgendaItem[]>();
  const push = (date: DateKey, item: AgendaItem) => {
    const list = agenda.get(date);
    if (list) list.push(item);
    else agenda.set(date, [item]);
  };

  const workoutsByDate = new Map<DateKey, WorkoutBrief[]>();
  for (const w of [...workouts].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))) {
    const list = workoutsByDate.get(w.date);
    if (list) list.push(w);
    else workoutsByDate.set(w.date, [w]);
  }

  const gymByDate = new Map<DateKey, Occurrence[]>();
  for (const o of occurrences) {
    if (o.typeId === gymTypeId) {
      const list = gymByDate.get(o.date);
      if (list) list.push(o);
      else gymByDate.set(o.date, [o]);
    } else {
      push(o.date, { kind: 'activity', key: o.key, occurrence: o, status: o.status === 'planned' && o.date < today ? 'done' : o.status, dayId: o.dayId });
    }
  }

  // Each workout fulfils a planned gym day of its date, in order; the rest stand on their own.
  const upcoming: Occurrence[] = [];
  const dates = new Set([...workoutsByDate.keys(), ...gymByDate.keys()]);
  for (const date of dates) {
    const planned = (gymByDate.get(date) ?? []).filter((o) => o.status !== 'skipped');
    const skipped = (gymByDate.get(date) ?? []).filter((o) => o.status === 'skipped');
    const done = workoutsByDate.get(date) ?? [];
    done.forEach((workout, i) => {
      push(date, { kind: 'workout', key: `w${workout.id}`, workout, occurrence: planned[i] ?? null });
    });
    for (const o of planned.slice(done.length)) {
      if (o.status === 'done') push(date, { kind: 'activity', key: o.key, occurrence: o, status: 'done', dayId: o.dayId });
      else if (date < today) push(date, { kind: 'activity', key: o.key, occurrence: o, status: 'skipped', dayId: o.dayId });
      else upcoming.push(o);
    }
    for (const o of skipped) push(date, { kind: 'activity', key: o.key, occurrence: o, status: 'skipped', dayId: o.dayId });
  }

  const days = rotateGymDays(upcoming, rotation);
  for (const o of upcoming) push(o.date, { kind: 'activity', key: o.key, occurrence: o, status: 'planned', dayId: days.get(o.key) ?? null });

  for (const items of agenda.values()) items.sort(compareItems);
  return agenda;
}

function itemTime(item: AgendaItem): string {
  if (item.kind === 'activity') return item.occurrence.time ?? '';
  const start = new Date(item.workout.startedAt);
  return `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
}

function compareItems(a: AgendaItem, b: AgendaItem): number {
  const ta = itemTime(a);
  const tb = itemTime(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The day of the program for each gym day to come, in date order: a fixed day keeps its own and
 * the rotation goes on after it; the others take the next one in turn.
 */
export function rotateGymDays(upcoming: readonly Occurrence[], rotation: Rotation | null): Map<string, number> {
  const days = new Map<string, number>();
  let cursor = rotation?.next ?? null;
  for (const o of [...upcoming].sort(compareOccurrences)) {
    if (o.dayId !== null) {
      days.set(o.key, o.dayId);
      if (rotation && rotation.dayIds.includes(o.dayId)) cursor = nextInRotation(rotation.dayIds, o.dayId);
      continue;
    }
    if (rotation === null || cursor === null) continue;
    days.set(o.key, cursor);
    cursor = nextInRotation(rotation.dayIds, cursor);
  }
  return days;
}

/** The days with something done on them: a workout, or an activity that took place. */
export function activeDates(agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>): Set<DateKey> {
  const dates = new Set<DateKey>();
  for (const [date, items] of agenda) {
    if (items.some((i) => i.kind === 'workout' || i.status === 'done')) dates.add(date);
  }
  return dates;
}

/**
 * Weeks in a row, Monday to Sunday, with at least one active day, as Hevy counts its streak.
 * The week under way does not break it until it is over.
 */
export function weekStreak(active: ReadonlySet<DateKey>, today: DateKey): number {
  const hasActiveDay = (monday: DateKey) => Array.from({ length: 7 }, (_, i) => addDays(monday, i)).some((d) => active.has(d));
  let monday = weekOf(today)[0];
  if (!hasActiveDay(monday)) monday = addDays(monday, -7);
  let weeks = 0;
  while (hasActiveDay(monday)) {
    weeks += 1;
    monday = addDays(monday, -7);
  }
  return weeks;
}

/** How long an item lasted or will last, in minutes: its own, the workout's, or the usual for its kind. */
export function itemMinutes(item: AgendaItem, types: ReadonlyMap<number, ActivityType>): number {
  if (item.kind === 'workout') {
    if (!item.workout.endedAt) return 0;
    return Math.max(0, Math.round((new Date(item.workout.endedAt).getTime() - new Date(item.workout.startedAt).getTime()) / 60_000));
  }
  return item.occurrence.minutes ?? types.get(item.occurrence.typeId)?.minutes ?? 0;
}

export type TypeTotal = { typeId: number; count: number; minutes: number };

export type PeriodActivity = {
  /** Per kind of activity, the gym included (its workouts), in the order of `types`. */
  byType: TypeTotal[];
  activeDays: number;
  minutes: number;
};

/** What was done in a period: done activities and logged workouts, per kind. */
export function summarizeActivity(
  agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>,
  types: readonly ActivityType[],
  gymTypeId: number | null,
  from: DateKey,
  to: DateKey,
): PeriodActivity {
  const typeMap = new Map(types.map((t) => [t.id, t]));
  const totals = new Map<number, TypeTotal>();
  let activeDays = 0;
  let minutes = 0;
  for (const [date, items] of agenda) {
    if (date < from || date > to) continue;
    let active = false;
    for (const item of items) {
      const typeId = item.kind === 'workout' ? gymTypeId : item.occurrence.typeId;
      if (typeId === null) continue;
      if (item.kind === 'activity' && item.status !== 'done') continue;
      if (item.kind === 'workout' && !item.workout.endedAt) continue;
      active = true;
      const length = itemMinutes(item, typeMap);
      minutes += length;
      const total = totals.get(typeId) ?? { typeId, count: 0, minutes: 0 };
      total.count += 1;
      total.minutes += length;
      totals.set(typeId, total);
    }
    if (active) activeDays += 1;
  }
  const order = new Map(types.map((t, i) => [t.id, i]));
  const byType = [...totals.values()].sort((a, b) => (order.get(a.typeId) ?? 99) - (order.get(b.typeId) ?? 99));
  return { byType, activeDays, minutes };
}

/** "20:00" from hours and minutes. */
export function timeKey(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseTimeKey(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}

/** "1 h 30 min", "45 min", "2 h". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return rest === 0 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 60)} h ${rest} min`;
}

const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const WEEKDAY_PLURAL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** Monday first, as the weekdays are shown. */
export const WEEKDAYS_FROM_MONDAY = [1, 2, 3, 4, 5, 6, 0];

/** "Ogni martedì", "Lun, Mer, Ven", "Ogni giorno". */
export function formatWeekdays(weekdays: readonly number[]): string {
  const sorted = WEEKDAYS_FROM_MONDAY.filter((d) => weekdays.includes(d));
  if (sorted.length === 7) return 'Ogni giorno';
  if (sorted.length === 1) return `Ogni ${WEEKDAY_PLURAL[sorted[0]]}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
}

export function weekdayShort(day: number): string {
  return WEEKDAY_SHORT[day];
}

/** The days with something planned or done, for the supplements taken on activity days. */
export function busyDates(agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>): Set<DateKey> {
  const dates = new Set<DateKey>();
  for (const [date, items] of agenda) {
    if (items.some((i) => i.kind === 'workout' || i.status !== 'skipped')) dates.add(date);
  }
  return dates;
}

/** Whether an item is hidden by a delete waiting for "Annulla" (see services/undo). */
export function isPendingDelete(item: AgendaItem, pending: ReadonlySet<string>): boolean {
  if (item.kind === 'workout') return false;
  const o = item.occurrence;
  if (o.planId === null) return o.recordId !== null && pending.has(`activity:${o.recordId}`);
  if (pending.has(`plan-day:${o.planId}:${o.date}`)) return true;
  for (const key of pending) {
    const match = /^plan-from:(\d+):(.+)$/.exec(key);
    if (match && Number(match[1]) === o.planId && o.date >= match[2]) return true;
  }
  return false;
}
