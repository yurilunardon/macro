import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_WORK_HOURS, GYM_REF, type Occurrence, type WorkHours } from '@/lib/calendar';
import { addDays, weekdayOf, type DateKey } from '@/lib/dates';
import { DEFAULT_WEIGH_IN, type WeighInPlan } from '@/lib/plan';
import type { DoseUnit, SupplementSchedule } from '@/lib/supplements';

import { addPlan, endPlan, getActivityTypes, getCalendar, updatePlan, type PlanInput } from './calendar';
import { notifyChange } from './live';
import { getSetting, setSetting } from './settings';
import { addSupplement, getSupplements } from './supplements';

/** The moments supplements used to be tied to, and the times they stood for. */
const OLD_MOMENTS: readonly { id: string; time: string }[] = [
  // With breakfast: the morning stood for the moment of waking up.
  { id: 'morning', time: '07:30' },
  { id: 'lunch', time: '13:00' },
  { id: 'training', time: '21:00' },
  { id: 'after', time: '23:00' },
  { id: 'evening', time: '23:30' },
];

/** The time of a moment: as changed by hand, if it was. */
function momentTime(saved: readonly { id: string; time: string }[] | null, id: string | null): string | null {
  if (id === null) return null;
  const own = saved?.find((m) => m.id === id);
  const usual = OLD_MOMENTS.find((m) => m.id === id);
  // Left as it was, the morning is the one at breakfast, not the one at waking up.
  if (id === 'morning' && (!own || own.time === '07:00')) return usual?.time ?? null;
  return own?.time ?? usual?.time ?? null;
}

/**
 * Gives each supplement its own times in place of a moment of the day. Moments are gone, so what
 * was in one goes at the time it stood for, also when a backup from before is restored.
 */
export async function giveSupplementsTheirTimes(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: number; schedule: string; moment: string | null; reminder: string | null }>(
    'SELECT id, schedule, moment, reminder FROM supplements WHERE times IS NULL',
  );
  if (rows.length === 0) return;
  const saved = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'moments'");
  let moments: { id: string; time: string }[] | null = null;
  try {
    moments = saved ? JSON.parse(saved.value) : null;
  } catch {
    moments = null;
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const row of rows) {
      const time = row.reminder ?? momentTime(moments, row.moment);
      const every = row.schedule === 'alternate';
      await tx.runAsync(
        'UPDATE supplements SET times = ?, schedule = ?, every_days = CASE WHEN ? THEN 2 ELSE every_days END WHERE id = ?',
        time ?? (row.schedule === 'asNeeded' ? '' : '08:00'),
        every ? 'every' : row.schedule,
        every ? 1 : 0,
        row.id,
      );
    }
  });
  notifyChange('calendar');
}

export async function getWeighInPlan(db: SQLiteDatabase): Promise<WeighInPlan> {
  const saved = await getSetting(db, 'weighInPlan');
  if (!saved) return DEFAULT_WEIGH_IN;
  // Saved when it went by the moments of the day: only the morning's keeps its usual time.
  return saved.time ? saved : { ...saved, time: DEFAULT_WEIGH_IN.time };
}

export async function getWorkHours(db: SQLiteDatabase): Promise<WorkHours> {
  return (await getSetting(db, 'workHours')) ?? DEFAULT_WORK_HOURS;
}

/**
 * What one day of the week holds from `from` on: the plans that covered it lose that day (and
 * end, when it was their only one), and `input`, if given, becomes a plan of its own for it.
 * The other days of those plans stay as they were. With `typeId`, only the plans of that kind:
 * the gym moved to a day leaves its volleyball where it is.
 */
export async function setWeekday(
  db: SQLiteDatabase,
  weekday: number,
  input: Omit<PlanInput, 'weekdays' | 'startDate'> | null,
  from: DateKey,
  typeId?: number,
): Promise<void> {
  const { plans } = await getCalendar(db, from, addDays(from, 6));
  for (const plan of plans) {
    if (typeId !== undefined && plan.typeId !== typeId) continue;
    if (!plan.weekdays.includes(weekday) || (plan.endDate !== null && plan.endDate < from)) continue;
    const rest = plan.weekdays.filter((d) => d !== weekday);
    if (rest.length === 0) await endPlan(db, plan.id, from);
    else await updatePlan(db, plan.id, { ...plan, weekdays: rest, startDate: plan.startDate }, from);
  }
  if (input) await addPlan(db, { ...input, weekdays: [weekday], startDate: from });
}

/** Bumped when the starting plan changes, so a phone that has the old one gets what is new. */
const STARTING_PLAN = 1;

type StartingSupplement = {
  name: string;
  dose: number;
  unit: DoseUnit;
  schedule: SupplementSchedule;
  everyDays?: number;
  time: string;
  contents: string | null;
  note: string;
  packageAmount: number | null;
};

/** The supplements agreed with the user (October 2026), with the doses on their labels. */
const SUPPLEMENTS: readonly StartingSupplement[] = [
  {
    name: 'Creatina',
    dose: 5,
    unit: 'g',
    schedule: 'daily',
    time: '07:30',
    contents: null,
    note: 'Con la colazione, insieme a qualche carboidrato. Anche nei giorni di riposo.',
    packageAmount: null,
  },
  {
    name: 'Omega 3',
    dose: 2,
    unit: 'capsule',
    schedule: 'daily',
    time: '13:00',
    contents: '300 mg di EPA + DHA a capsula',
    note: 'Con il pasto.',
    packageAmount: 90,
  },
  {
    name: 'Vitamina D3 + K2',
    dose: 1,
    unit: 'capsule',
    schedule: 'every',
    everyDays: 2,
    time: '13:00',
    contents: '100 µg D3 · 100 µg K2',
    note: 'Con un pasto che contiene grassi. A giorni alterni: una al giorno è il limite massimo.',
    packageAmount: 30,
  },
  {
    name: 'Whey',
    dose: 1,
    unit: 'scoop',
    schedule: 'active',
    time: '23:00',
    contents: '25 g · 21 g di proteine',
    note: 'Dopo l’allenamento, o quando ti mancano proteine.',
    packageAmount: null,
  },
  {
    name: 'Magnesio',
    dose: 1,
    unit: 'tablet',
    schedule: 'daily',
    time: '23:30',
    contents: '113 mg di magnesio',
    note: 'Prima di dormire. Dopo una settimana, se lo tolleri bene, puoi passare a 2.',
    packageAmount: 90,
  },
];

/** The week agreed with the user: volleyball and three gym days. The matches come from the team's calendar. */
const WEEK: readonly { ref: string; weekday: number; time: string; minutes: number; note: string | null }[] = [
  { ref: 'volleyball', weekday: 2, time: '21:00', minutes: 120, note: null },
  { ref: 'volleyball', weekday: 4, time: '21:00', minutes: 120, note: null },
  { ref: GYM_REF, weekday: 3, time: '21:00', minutes: 90, note: 'Push' },
  { ref: GYM_REF, weekday: 5, time: '21:00', minutes: 90, note: 'Pull' },
  { ref: GYM_REF, weekday: 0, time: '17:00', minutes: 90, note: 'Gambe' },
];

/**
 * Puts the plan agreed with the user in the calendar, once: the supplements not there yet and
 * the days of the week with nothing planned on them. Everything stays editable afterwards, and
 * what is deleted is not put back.
 */
export async function seedStartingPlan(db: SQLiteDatabase, today: DateKey): Promise<void> {
  if (((await getSetting(db, 'planSeeded')) ?? 0) >= STARTING_PLAN) return;

  const existing = new Set((await getSupplements(db)).map((s) => s.name.trim().toLowerCase()));
  for (const s of SUPPLEMENTS) {
    if (existing.has(s.name.toLowerCase())) continue;
    await addSupplement(
      db,
      {
        name: s.name,
        dose: s.dose,
        unit: s.unit,
        schedule: s.schedule,
        everyDays: s.everyDays ?? null,
        weekdays: [],
        times: [s.time],
        contents: s.contents,
        note: s.note,
        packageAmount: s.packageAmount,
        packagePrice: null,
      },
      today,
    );
  }

  const types = new Map((await getActivityTypes(db)).map((t) => [t.ref, t.id]));
  const { plans } = await getCalendar(db, today, addDays(today, 6));
  const covered = (weekday: number) => plans.some((p) => p.weekdays.includes(weekday) && (p.endDate === null || p.endDate >= today));
  for (const day of WEEK) {
    const typeId = types.get(day.ref);
    if (typeId === undefined || covered(day.weekday)) continue;
    await addPlan(db, { typeId, weekdays: [day.weekday], time: day.time, minutes: day.minutes, dayId: null, note: day.note, startDate: today });
  }

  if (!(await getSetting(db, 'planReviewOn'))) await setSetting(db, 'planReviewOn', addDays(today, 28));
  await setSetting(db, 'planSeeded', STARTING_PLAN);
}

/** The weigh-in at this time from now on. */
export async function setWeighInTime(db: SQLiteDatabase, time: string): Promise<void> {
  await setSetting(db, 'weighInPlan', { ...(await getWeighInPlan(db)), time });
}

/** When a weigh-in of a day was done, in place of when it was logged. */
export async function setLoggedAt(db: SQLiteDatabase, date: DateKey, at: string): Promise<void> {
  await db.runAsync('UPDATE weights SET logged_at = ? WHERE date = ?', at, date);
  notifyChange('body');
}

/**
 * Changes a repeated activity for good: from that week on, on that day of the week and at that time,
 * and no longer on the day it was. The rest of its plan stays, as does what else is on those days.
 */
export async function makeRegular(db: SQLiteDatabase, o: Occurrence, to: { date: DateKey; time: string | null; minutes: number | null }): Promise<void> {
  if (o.planId === null) return;
  const from = o.date < to.date ? o.date : to.date;
  await setWeekday(db, weekdayOf(o.date), null, from, o.typeId);
  await setWeekday(db, weekdayOf(to.date), { typeId: o.typeId, time: to.time, minutes: to.minutes, dayId: o.dayId, note: o.note }, from, o.typeId);
}
