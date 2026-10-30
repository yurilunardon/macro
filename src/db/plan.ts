import type { SQLiteDatabase } from 'expo-sqlite';

import { GYM_REF } from '@/lib/calendar';
import { addDays, type DateKey } from '@/lib/dates';
import { DEFAULT_MOMENTS, DEFAULT_WEIGH_IN, type Moment, type WeighInPlan } from '@/lib/plan';
import type { DoseUnit, SupplementSchedule } from '@/lib/supplements';

import { addPlan, endPlan, getActivityTypes, getCalendar, updatePlan, type PlanInput } from './calendar';
import { getSetting, setSetting } from './settings';
import { addSupplement, getSupplements } from './supplements';

export async function getMoments(db: SQLiteDatabase): Promise<Moment[]> {
  const saved = await getSetting(db, 'moments');
  return saved && saved.length > 0 ? saved : [...DEFAULT_MOMENTS];
}

export async function getWeighInPlan(db: SQLiteDatabase): Promise<WeighInPlan> {
  return (await getSetting(db, 'weighInPlan')) ?? DEFAULT_WEIGH_IN;
}

/**
 * What one day of the week holds from `from` on: the plans that covered it lose that day (and
 * end, when it was their only one), and `input`, if given, becomes a plan of its own for it.
 * The other days of those plans stay as they were.
 */
export async function setWeekday(
  db: SQLiteDatabase,
  weekday: number,
  input: Omit<PlanInput, 'weekdays' | 'startDate'> | null,
  from: DateKey,
): Promise<void> {
  const { plans } = await getCalendar(db, from, addDays(from, 6));
  for (const plan of plans) {
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
  moment: string;
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
    moment: 'morning',
    contents: null,
    note: 'Con la colazione, insieme a qualche carboidrato. Anche nei giorni di riposo.',
    packageAmount: null,
  },
  {
    name: 'Omega 3',
    dose: 2,
    unit: 'capsule',
    schedule: 'daily',
    moment: 'lunch',
    contents: '300 mg di EPA + DHA a capsula',
    note: 'Con il pasto.',
    packageAmount: 90,
  },
  {
    name: 'Vitamina D3 + K2',
    dose: 1,
    unit: 'capsule',
    schedule: 'alternate',
    moment: 'lunch',
    contents: '100 µg D3 · 100 µg K2',
    note: 'Con un pasto che contiene grassi. A giorni alterni: una al giorno è il limite massimo.',
    packageAmount: 30,
  },
  {
    name: 'Whey',
    dose: 1,
    unit: 'scoop',
    schedule: 'active',
    moment: 'after',
    contents: '25 g · 21 g di proteine',
    note: 'Dopo l’allenamento, o quando ti mancano proteine.',
    packageAmount: null,
  },
  {
    name: 'Magnesio',
    dose: 1,
    unit: 'tablet',
    schedule: 'daily',
    moment: 'evening',
    contents: '113 mg di magnesio',
    note: 'Prima di dormire. Dopo una settimana, se lo tolleri bene, puoi passare a 2.',
    packageAmount: 90,
  },
];

/** The week agreed with the user: volleyball, the match and three gym days kept off Saturday's legs. */
const WEEK: readonly { ref: string; weekday: number; time: string; minutes: number; note: string | null }[] = [
  { ref: 'volleyball', weekday: 2, time: '21:00', minutes: 120, note: null },
  { ref: 'volleyball', weekday: 4, time: '21:00', minutes: 120, note: null },
  { ref: 'match', weekday: 6, time: '19:30', minutes: 120, note: null },
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
        timesPerDay: 1,
        schedule: s.schedule,
        weekdays: [],
        moment: s.moment,
        reminder: null,
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
