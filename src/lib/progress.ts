import { addDays, addMonths, formatMonthName, fromDateKey, monthOf, monthRange, weekOf, type DateKey } from './dates';

export type Period = 'week' | 'month' | 'year';

/** What the numbers need of a finished workout. */
export type ProgressWorkout = { date: DateKey; startedAt: string; endedAt: string; workSets: number; tonnage: number };

export type PeriodRange = {
  from: DateKey;
  to: DateKey;
  previousFrom: DateKey;
  previousTo: DateKey;
  /** "Questa settimana", "Ottobre", "2026". */
  label: string;
  /** "della settimana scorsa", "di settembre", "del 2025". */
  previousOf: string;
  /** "la settimana scorsa", "settembre", "il 2025". */
  previousName: string;
};

/** The week, month or year holding `today`, with the one before it to compare with. */
export function periodRange(period: Period, today: DateKey): PeriodRange {
  if (period === 'week') {
    const week = weekOf(today);
    return {
      from: week[0],
      to: week[6],
      previousFrom: addDays(week[0], -7),
      previousTo: addDays(week[6], -7),
      label: 'Questa settimana',
      previousOf: 'della settimana scorsa',
      previousName: 'la settimana scorsa',
    };
  }
  if (period === 'month') {
    const month = monthOf(today);
    const before = addMonths(month, -1);
    const name = formatMonthName(before).toLowerCase();
    const { from, to } = monthRange(month);
    const previous = monthRange(before);
    return { from, to, previousFrom: previous.from, previousTo: previous.to, label: formatMonthName(month), previousOf: `di ${name}`, previousName: name };
  }
  const year = Number(today.slice(0, 4));
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    previousFrom: `${year - 1}-01-01`,
    previousTo: `${year - 1}-12-31`,
    label: String(year),
    previousOf: `del ${year - 1}`,
    previousName: `il ${year - 1}`,
  };
}

export function workoutsBetween<W extends ProgressWorkout>(workouts: readonly W[], from: DateKey, to: DateKey): W[] {
  return workouts.filter((w) => w.date >= from && w.date <= to);
}

export function totalsOf(workouts: readonly ProgressWorkout[]): { count: number; seconds: number; sets: number; kg: number } {
  return {
    count: workouts.length,
    seconds: workouts.reduce((sum, w) => sum + (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000, 0),
    sets: workouts.reduce((sum, w) => sum + w.workSets, 0),
    kg: workouts.reduce((sum, w) => sum + w.tonnage, 0),
  };
}

/** "3 in più di settembre", "1 in meno della settimana scorsa", "Come il 2025"; null with nothing to say. */
export function compareCounts(now: number, before: number, range: Pick<PeriodRange, 'previousOf' | 'previousName'>): { text: string; trend: 'up' | 'down' | 'same' } | null {
  if (now === 0 && before === 0) return null;
  if (now === before) return { text: `Come ${range.previousName}`, trend: 'same' };
  const diff = Math.abs(now - before);
  return now > before ? { text: `${diff} in più ${range.previousOf}`, trend: 'up' } : { text: `${diff} in meno ${range.previousOf}`, trend: 'down' };
}

export type VolumeBucket = { key: string; label: string; title: string; kg: number };

const WEEKDAY_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const MONTH_LETTERS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];

/** The kilos lifted over a period, split as it reads best: by day, by week of the month, by month. */
export function volumeBuckets(period: Period, workouts: readonly ProgressWorkout[], range: Pick<PeriodRange, 'from' | 'to'>): VolumeBucket[] {
  const inside = workoutsBetween(workouts, range.from, range.to);
  const sum = (from: DateKey, to: DateKey) => workoutsBetween(inside, from, to).reduce((total, w) => total + w.tonnage, 0);
  if (period === 'week') {
    return WEEKDAY_LETTERS.map((label, i) => {
      const day = addDays(range.from, i);
      return { key: day, label, title: WEEKDAY_NAMES[i], kg: sum(day, day) };
    });
  }
  if (period === 'year') {
    const year = range.from.slice(0, 4);
    return MONTH_LETTERS.map((label, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const { from, to } = monthRange(month);
      return { key: month, label, title: formatMonthName(month), kg: sum(from, to) };
    });
  }
  const buckets: VolumeBucket[] = [];
  // The weeks of the month, Monday to Sunday, cut at its first and last day.
  for (let start = range.from, n = 1; start <= range.to; n += 1) {
    const sunday = weekOf(start)[6];
    const end = sunday < range.to ? sunday : range.to;
    buckets.push({ key: start, label: `S${n}`, title: `Settimana ${n}`, kg: sum(start, end) });
    start = addDays(end, 1);
  }
  return buckets;
}

/** How many workouts in each month of the year of `from`, January first. */
export function workoutsPerMonth(workouts: readonly ProgressWorkout[], from: DateKey): { key: string; title: string; count: number }[] {
  const year = from.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, title: formatMonthName(key), count: workouts.filter((w) => w.date.startsWith(key)).length };
  });
}

/** The month as weeks of seven days, Monday first; null for the days of the months around it. */
export function monthWeeks(month: string): (DateKey | null)[][] {
  const { from, to } = monthRange(month);
  const weeks: (DateKey | null)[][] = [];
  for (let monday = weekOf(from)[0]; monday <= to; monday = addDays(monday, 7)) {
    weeks.push(weekOf(monday).map((day) => (day >= from && day <= to ? day : null)));
  }
  return weeks;
}

/** The day of the month, as the grid shows it. */
export function dayNumber(day: DateKey): string {
  return String(fromDateKey(day).getDate());
}
