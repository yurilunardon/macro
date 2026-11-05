/**
 * Supplements: what to take on which days, how much is left and what it costs. Pure, so the
 * counts behind the calendar and the report are tested without a database.
 */
import { daysBetween, formatShortDate, weekdayOf, type DateKey } from './dates';
import { formatNumber } from './format';
import { formatWeekdays } from './calendar';

export type DoseUnit = 'g' | 'mg' | 'mcg' | 'ml' | 'capsule' | 'tablet' | 'drop' | 'scoop' | 'sachet' | 'gummy';

export const DOSE_UNITS: readonly { key: DoseUnit; one: string; many: string }[] = [
  { key: 'g', one: 'g', many: 'g' },
  { key: 'mg', one: 'mg', many: 'mg' },
  { key: 'mcg', one: 'µg', many: 'µg' },
  { key: 'ml', one: 'ml', many: 'ml' },
  { key: 'capsule', one: 'capsula', many: 'capsule' },
  { key: 'tablet', one: 'compressa', many: 'compresse' },
  { key: 'drop', one: 'goccia', many: 'gocce' },
  { key: 'scoop', one: 'misurino', many: 'misurini' },
  { key: 'sachet', one: 'bustina', many: 'bustine' },
  { key: 'gummy', one: 'caramella', many: 'caramelle' },
];

export function isDoseUnit(value: unknown): value is DoseUnit {
  return DOSE_UNITS.some((u) => u.key === value);
}

/**
 * - daily: every day
 * - every: every `everyDays` days, counting from the day it was added
 * - weekdays: on some days of the week
 * - active: on the days with an activity or a workout
 * - once: on one day only, `onceOn`
 * - asNeeded: never due, ticked when taken
 */
export type SupplementSchedule = 'daily' | 'every' | 'weekdays' | 'active' | 'once' | 'asNeeded';

export const SCHEDULES: readonly { key: SupplementSchedule; label: string }[] = [
  { key: 'daily', label: 'Ogni giorno' },
  { key: 'every', label: 'Ogni tot giorni' },
  { key: 'weekdays', label: 'Alcuni giorni della settimana' },
  { key: 'active', label: 'Quando mi alleno' },
  { key: 'once', label: 'Una volta sola' },
  { key: 'asNeeded', label: 'Al bisogno' },
];

export function isSchedule(value: unknown): value is SupplementSchedule {
  return SCHEDULES.some((s) => s.key === value);
}

export type Supplement = {
  id: number;
  name: string;
  /** Taken each time, in `unit`. */
  dose: number;
  unit: DoseUnit;
  /** How many doses a day: one for each of `times`. */
  timesPerDay: number;
  schedule: SupplementSchedule;
  /** For `weekdays`, as Date.getDay(): 0 is Sunday. */
  weekdays: number[];
  /** For `every`: 2 is every other day. */
  everyDays: number | null;
  /** For `once`: the day. */
  onceOn: DateKey | null;
  /** When it is meant to be taken, in order: "07:30". */
  times: string[];
  /** Whether a notification comes at those times. */
  remind: boolean;
  /** What a dose holds, e.g. "100 µg D3 · 100 µg K2". */
  contents: string | null;
  /** How to take it, e.g. "Con un pasto che contiene grassi". */
  note: string | null;
  /** A usual package: how much it holds, in `unit`, and its price in euro. */
  packageAmount: number | null;
  packagePrice: number | null;
  position: number;
  archived: boolean;
  /** Nothing is due before this day. */
  startedOn: DateKey;
};

/** A package bought: what it held, in the supplement's unit, and what it cost. */
export type Purchase = { id: number; supplementId: number; date: DateKey; amount: number; price: number };

/** Doses due on a day: none before the supplement was added, nor for "Al bisogno". */
export function dosesDue(
  s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay' | 'startedOn' | 'everyDays' | 'onceOn'>,
  date: DateKey,
  active: ReadonlySet<DateKey>,
): number {
  if (date < s.startedOn) return 0;
  switch (s.schedule) {
    case 'daily':
      return s.timesPerDay;
    case 'every':
      return daysBetween(s.startedOn, date) % Math.max(1, s.everyDays ?? 1) === 0 ? s.timesPerDay : 0;
    case 'once':
      return date === s.onceOn ? s.timesPerDay : 0;
    case 'weekdays':
      return s.weekdays.includes(weekdayOf(date)) ? s.timesPerDay : 0;
    case 'active':
      return active.has(date) ? s.timesPerDay : 0;
    case 'asNeeded':
      return 0;
  }
}

/** "5 g", "2 capsule", "1 compressa". */
export function formatDose(dose: number, unit: DoseUnit): string {
  const names = DOSE_UNITS.find((u) => u.key === unit) ?? DOSE_UNITS[0];
  return `${formatNumber(dose, 2)} ${dose === 1 ? names.one : names.many}`;
}

/** "Ogni giorno", "2 volte al giorno", "Ogni 2 giorni", "Lun, Mer, Ven", "Quando ti alleni", "Al bisogno". */
export function formatSchedule(s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay' | 'everyDays' | 'onceOn'>): string {
  const times = s.timesPerDay > 1 ? `${s.timesPerDay} volte` : null;
  switch (s.schedule) {
    case 'daily':
      return times ? `${times} al giorno` : 'Ogni giorno';
    case 'every': {
      const every = `Ogni ${Math.max(1, s.everyDays ?? 1)} giorni`;
      return times ? `${every}, ${times}` : every;
    }
    case 'once':
      return s.onceOn ? `Una volta sola, ${formatShortDate(s.onceOn)}` : 'Una volta sola';
    case 'weekdays': {
      const days = s.weekdays.length > 0 ? formatWeekdays(s.weekdays) : 'Nessun giorno';
      return times ? `${days}, ${times}` : days;
    }
    case 'active':
      return times ? `Quando ti alleni, ${times}` : 'Quando ti alleni';
    case 'asNeeded':
      return 'Al bisogno';
  }
}

/** The SF Symbol for what is taken: a powder, a pill, drops. */
export function supplementSymbol(unit: DoseUnit): 'waterbottle.fill' | 'pills.fill' | 'pill.fill' | 'drop.fill' {
  switch (unit) {
    case 'g':
    case 'scoop':
    case 'sachet':
      return 'waterbottle.fill';
    case 'capsule':
    case 'gummy':
      return 'pills.fill';
    case 'drop':
    case 'ml':
      return 'drop.fill';
    default:
      return 'pill.fill';
  }
}

/** Price of one dose, from the usual package; null without a price. */
export function costPerDose(s: Pick<Supplement, 'dose' | 'packageAmount' | 'packagePrice'>): number | null {
  if (!s.packageAmount || s.packagePrice === null || s.packageAmount <= 0) return null;
  return (s.packagePrice / s.packageAmount) * s.dose;
}

/** Doses taken on an average day, from the schedule, or from the last weeks when it has none. */
export function dosesPerDay(s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay' | 'everyDays'>, recent: { doses: number; days: number }): number {
  switch (s.schedule) {
    case 'daily':
      return s.timesPerDay;
    case 'every':
      return s.timesPerDay / Math.max(1, s.everyDays ?? 1);
    case 'once':
      return 0;
    case 'weekdays':
      return (s.timesPerDay * s.weekdays.length) / 7;
    default:
      return recent.days > 0 ? recent.doses / recent.days : 0;
  }
}

/** What a month of it costs, at the usual price. */
export function monthlyCost(s: Supplement, recent: { doses: number; days: number }): number | null {
  const each = costPerDose(s);
  return each === null ? null : each * dosesPerDay(s, recent) * 30;
}

/**
 * How much is left: everything bought, less a dose for each one ticked since the first purchase.
 * Null when no purchase was recorded.
 */
export function stockLeft(s: Pick<Supplement, 'dose'>, purchases: readonly Pick<Purchase, 'amount' | 'date'>[], takenSince: (from: DateKey) => number): number | null {
  if (purchases.length === 0) return null;
  const first = purchases.reduce((min, p) => (p.date < min ? p.date : min), purchases[0].date);
  const bought = purchases.reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, bought - takenSince(first) * s.dose);
}

/** Days until it runs out at the usual pace; null when unknown. */
export function daysLeft(s: Pick<Supplement, 'dose'>, left: number | null, perDay: number): number | null {
  if (left === null || perDay <= 0 || s.dose <= 0) return null;
  return Math.floor(left / (s.dose * perDay));
}

export type Adherence = { due: number; taken: number };

/**
 * Doses due and taken from `from` to `to`, counting only days up to today. Doses taken beyond
 * what was due on a day do not make up for another day.
 */
export function adherence(
  s: Pick<Supplement, 'id' | 'schedule' | 'weekdays' | 'timesPerDay' | 'startedOn' | 'everyDays' | 'onceOn'>,
  taken: ReadonlyMap<string, number>,
  dates: readonly DateKey[],
  active: ReadonlySet<DateKey>,
  today: DateKey,
): Adherence {
  let due = 0;
  let done = 0;
  for (const date of dates) {
    if (date > today) continue;
    const d = dosesDue(s, date, active);
    if (d === 0) continue;
    due += d;
    done += Math.min(d, taken.get(`${s.id}:${date}`) ?? 0);
  }
  return { due, taken: done };
}

/** Whole-number percentage, or null when nothing was due. */
export function percent({ due, taken }: Adherence): number | null {
  return due === 0 ? null : Math.round((taken / due) * 100);
}

/** Days since the supplement was added, up to `limit`, for the pace of the ones without a schedule. */
export function recentWindow(startedOn: DateKey, today: DateKey, limit = 28): number {
  return Math.max(1, Math.min(limit, daysBetween(startedOn, today) + 1));
}

/** Common supplements, to fill in a new one quickly. */
export const SUPPLEMENT_PRESETS: readonly { name: string; dose: number; unit: DoseUnit; schedule: SupplementSchedule }[] = [
  { name: 'Creatina', dose: 5, unit: 'g', schedule: 'daily' },
  { name: 'Proteine in polvere', dose: 30, unit: 'g', schedule: 'asNeeded' },
  { name: 'Omega 3', dose: 2, unit: 'capsule', schedule: 'daily' },
  { name: 'Vitamina C', dose: 1, unit: 'tablet', schedule: 'daily' },
  { name: 'Vitamina D', dose: 1, unit: 'tablet', schedule: 'daily' },
  { name: 'Magnesio', dose: 1, unit: 'tablet', schedule: 'daily' },
  { name: 'Multivitaminico', dose: 1, unit: 'tablet', schedule: 'daily' },
  { name: 'Caffeina', dose: 1, unit: 'tablet', schedule: 'active' },
];

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

/** "24,90 €". */
export function formatEuro(value: number): string {
  return euro.format(value);
}

export type SupplementReminder = {
  date: DateKey;
  /** "08:00" */
  time: string;
  title: string;
  body: string;
  /** The doses it is about, to mark them as taken from the notification. */
  doses: { id: number; index: number }[];
  /** The evening's, about what was not taken: "Fatti tutti", no "Tra 30 minuti". */
  evening: boolean;
};

/** "A", "A e B", "A, B e C". */
function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** A dose changed for one day only: moved to another time, or skipped. */
export type DoseChange = { time: string | null; skipped: boolean };

/**
 * The reminders of the next days: one per time of day, naming what is due then and not ticked yet,
 * for the supplements that ask for it; and, at `evening`, one with what should have been taken by
 * then and was not. What falls later that evening has its own and is not nagged about before it.
 * Times already gone are left out.
 */
export function supplementReminders(
  supplements: readonly Supplement[],
  taken: ReadonlySet<string>,
  changes: ReadonlyMap<string, DoseChange>,
  busy: ReadonlySet<DateKey>,
  dates: readonly DateKey[],
  now: { date: DateKey; time: string },
  evening: string | null = null,
): SupplementReminder[] {
  const reminders: SupplementReminder[] = [];
  for (const date of dates) {
    const gone = (time: string) => date === now.date && time <= now.time;
    const byTime = new Map<string, { supplement: Supplement; index: number }[]>();
    const late: { supplement: Supplement; index: number }[] = [];
    for (const supplement of supplements) {
      if (supplement.archived || !supplement.remind) continue;
      const due = dosesDue(supplement, date, busy);
      for (let index = 0; index < due; index++) {
        const key = `${supplement.id}:${date}:${index}`;
        const change = changes.get(key);
        if (taken.has(key) || change?.skipped) continue;
        const time = change?.time ?? supplement.times[index] ?? supplement.times[0];
        if (!time) continue;
        if (!gone(time)) byTime.set(time, [...(byTime.get(time) ?? []), { supplement, index }]);
        if (evening !== null && time < evening) late.push({ supplement, index });
      }
    }
    for (const [time, list] of [...byTime.entries()].sort()) {
      const single = list.length === 1 ? list[0].supplement : null;
      reminders.push({
        date,
        time,
        title: single ? single.name : 'Integratori',
        body: single ? formatDose(single.dose, single.unit) : list.map((d) => `${d.supplement.name} ${formatDose(d.supplement.dose, d.supplement.unit)}`).join(' · '),
        doses: list.map((d) => ({ id: d.supplement.id, index: d.index })),
        evening: false,
      });
    }
    if (evening !== null && late.length > 0 && !gone(evening)) {
      reminders.push({
        date,
        time: evening,
        title: 'Non hai ancora preso',
        body: joinNames([...new Set(late.map((d) => d.supplement.name))]),
        doses: late.map((d) => ({ id: d.supplement.id, index: d.index })),
        evening: true,
      });
    }
  }
  return reminders.sort((a, b) => (a.date === b.date ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : a.date < b.date ? -1 : 1));
}
