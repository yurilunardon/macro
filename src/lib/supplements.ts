/**
 * Supplements: what to take on which days, how much is left and what it costs. Pure, so the
 * counts behind the calendar and the report are tested without a database.
 */
import { daysBetween, weekdayOf, type DateKey } from './dates';
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
 * - weekdays: on some days of the week
 * - active: on the days with an activity or a workout
 * - asNeeded: never due, ticked when taken
 */
export type SupplementSchedule = 'daily' | 'weekdays' | 'active' | 'asNeeded';

export const SCHEDULES: readonly { key: SupplementSchedule; label: string }[] = [
  { key: 'daily', label: 'Ogni giorno' },
  { key: 'weekdays', label: 'Alcuni giorni' },
  { key: 'active', label: 'Nei giorni di attività' },
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
  timesPerDay: number;
  schedule: SupplementSchedule;
  /** For `weekdays`, as Date.getDay(): 0 is Sunday. */
  weekdays: number[];
  /** "08:00": a reminder at that time on the days it is due. */
  reminder: string | null;
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
export function dosesDue(s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay' | 'startedOn'>, date: DateKey, active: ReadonlySet<DateKey>): number {
  if (date < s.startedOn) return 0;
  switch (s.schedule) {
    case 'daily':
      return s.timesPerDay;
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

/** "Ogni giorno", "2 volte al giorno", "Lun, Mer, Ven", "Nei giorni di attività", "Al bisogno". */
export function formatSchedule(s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay'>): string {
  const times = s.timesPerDay > 1 ? `${s.timesPerDay} volte` : null;
  switch (s.schedule) {
    case 'daily':
      return times ? `${times} al giorno` : 'Ogni giorno';
    case 'weekdays': {
      const days = s.weekdays.length > 0 ? formatWeekdays(s.weekdays) : 'Nessun giorno';
      return times ? `${days}, ${times}` : days;
    }
    case 'active':
      return times ? `Nei giorni di attività, ${times}` : 'Nei giorni di attività';
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
export function dosesPerDay(s: Pick<Supplement, 'schedule' | 'weekdays' | 'timesPerDay'>, recent: { doses: number; days: number }): number {
  switch (s.schedule) {
    case 'daily':
      return s.timesPerDay;
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
  s: Pick<Supplement, 'id' | 'schedule' | 'weekdays' | 'timesPerDay' | 'startedOn'>,
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

export type SupplementReminder = { date: DateKey; time: string; body: string };

/**
 * The reminders of the next `days` days: one per time of day, naming the supplements due then
 * and not ticked yet. Times already gone are left out.
 */
export function supplementReminders(
  supplements: readonly Supplement[],
  taken: ReadonlyMap<string, number>,
  busy: ReadonlySet<DateKey>,
  dates: readonly DateKey[],
  now: { date: DateKey; time: string },
): SupplementReminder[] {
  const reminders: SupplementReminder[] = [];
  for (const date of dates) {
    const byTime = new Map<string, string[]>();
    for (const s of supplements) {
      if (s.reminder === null || s.archived) continue;
      const due = dosesDue(s, date, busy);
      if (due === 0 || (taken.get(`${s.id}:${date}`) ?? 0) >= due) continue;
      if (date === now.date && s.reminder <= now.time) continue;
      const names = byTime.get(s.reminder) ?? [];
      names.push(`${s.name} ${formatDose(s.dose, s.unit)}`);
      byTime.set(s.reminder, names);
    }
    for (const [time, names] of [...byTime.entries()].sort()) reminders.push({ date, time, body: names.join(' · ') });
  }
  return reminders;
}
