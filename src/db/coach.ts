import type { SQLiteDatabase } from 'expo-sqlite';

import { expandActivities } from '@/lib/calendar';
import { CHAT_KEPT, type CoachMessage, type CoachNote, type CoachSnapshot } from '@/lib/coach';
import { addDays, daysFrom, type DateKey } from '@/lib/dates';
import { isWarmUp, muscleLabel } from '@/lib/exercises';
import { dosesDue, formatDose, formatSchedule } from '@/lib/supplements';

import { getCalendar } from './calendar';
import { getDayPlans } from './days';
import { getDailyTotals } from './entries';
import { getProgramCheck } from './program-check';
import { getPrograms } from './programs';
import { getSetting, setSetting } from './settings';
import { getDosesTaken, getSupplements } from './supplements';
import { getWeightsSince } from './body';

/** How far back each part of the snapshot looks. */
const DIARY_DAYS = 14;
const WEIGHT_DAYS = 30;
const WORKOUT_DAYS = 28;
const COMING_DAYS = 7;

/** Everything the coach is told with a question: the user, the last weeks and what is coming. */
export async function getCoachSnapshot(db: SQLiteDatabase, today: DateKey): Promise<CoachSnapshot> {
  const diaryFrom = addDays(today, -(DIARY_DAYS - 1));
  const dates = daysFrom(diaryFrom, today);
  const [profile, goalWeight, notes, totals, plans, weights, sets, programs, supplements, taken, calendar] = await Promise.all([
    getSetting(db, 'profile'),
    getSetting(db, 'goalWeight'),
    getSetting(db, 'coachNotes'),
    getDailyTotals(db, diaryFrom, today),
    getDayPlans(db, dates),
    getWeightsSince(db, addDays(today, -WEIGHT_DAYS)),
    db.getAllAsync<{ workout_id: number; date: string; name: string; started_at: string; ended_at: string; exercise: string; ref: string | null; weight: number | null; reps: number | null; type: string }>(
      `SELECT w.id AS workout_id, w.date, w.name, w.started_at, w.ended_at, e.name AS exercise, e.ref, s.weight, s.reps, s.type
       FROM workouts w JOIN workout_exercises we ON we.workout_id = w.id JOIN exercises e ON e.id = we.exercise_id
       JOIN workout_sets s ON s.workout_exercise_id = we.id
       WHERE w.ended_at IS NOT NULL AND w.date >= ? AND s.done = 1 AND s.type != 'warmup'
       ORDER BY w.started_at, we.position, s.position`,
      addDays(today, -WORKOUT_DAYS),
    ),
    getPrograms(db),
    getSupplements(db),
    getDosesTaken(db, diaryFrom, today),
    getCalendar(db, today, addDays(today, COMING_DAYS)),
  ]);

  const byDate = new Map(totals.map((t) => [t.date, t]));
  const days = dates.flatMap((date) => {
    const t = byDate.get(date);
    if (!t) return [];
    const plan = plans.get(date);
    return [{ date, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, target: plan?.isDefault ? null : (plan?.targets ?? null), training: plan?.dayType !== 'rest' }];
  });

  const workouts: CoachSnapshot['workouts'] = [];
  for (const row of sets) {
    if (isWarmUp({ ref: row.ref })) continue;
    let w = workouts[workouts.length - 1];
    if (!w || (w as { id?: number }).id !== row.workout_id) {
      const minutes = Math.round((Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60_000);
      w = Object.assign({ date: row.date, name: row.name, minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null, exercises: [] }, { id: row.workout_id });
      workouts.push(w);
    }
    let e = w.exercises[w.exercises.length - 1];
    if (!e || e.name !== row.exercise) {
      e = { name: row.exercise, sets: [] };
      w.exercises.push(e);
    }
    e.sets.push({ kg: row.weight, reps: row.reps });
  }

  const active = programs.find((p) => p.active && !p.draft);
  const check = active ? await getProgramCheck(db, active.id, today) : null;
  const program = check
    ? {
        name: check.program.name,
        days: check.days.map((d) => ({
          name: d.name,
          exercises: [...check.planned.values()]
            .filter((p) => p.dayId === d.id && !isWarmUp(p.exercise))
            .map((p) => `${p.exercise.name} ${p.sets}×${p.repMin}-${p.repMax}`),
        })),
        muscles: check.muscles.map((m) => ({ name: muscleLabel(m.muscle), sets: m.sets, level: m.level })),
      }
    : null;

  const busy = new Set(dates.filter((d) => plans.get(d)?.dayType === 'training'));
  const supplementRows = supplements.map((s) => {
    let due = 0;
    let done = 0;
    for (const date of dates) {
      due += dosesDue(s, date, busy);
      done += taken.get(`${s.id}:${date}`) ?? 0;
    }
    return { name: s.name, dose: formatDose(s.dose, s.unit), schedule: formatSchedule(s), taken: done, due };
  });

  const types = new Map(calendar.types.map((t) => [t.id, t.name]));
  const coming = expandActivities(calendar.plans, calendar.records, today, addDays(today, COMING_DAYS))
    .filter((o) => o.status !== 'skipped')
    .map((o) => ({
      date: o.date,
      time: o.time,
      what: [o.dayId !== null ? calendar.dayNames.get(o.dayId) : null, o.title, o.note, types.get(o.typeId)].find((x) => x) ?? 'Attività',
    }));

  return {
    today,
    profile,
    goalWeight,
    days,
    weights: weights.map((w) => ({ date: w.date, kg: w.kg })),
    workouts: workouts.map(({ date, name, minutes, exercises }) => ({ date, name, minutes, exercises })),
    program,
    supplements: supplementRows,
    coming,
    notes: notes ?? [],
  };
}

export async function getCoachChat(db: SQLiteDatabase): Promise<{ messages: CoachMessage[]; notes: CoachNote[] }> {
  const [messages, notes] = await Promise.all([getSetting(db, 'coachChat'), getSetting(db, 'coachNotes')]);
  return { messages: messages ?? [], notes: notes ?? [] };
}

export async function addCoachMessages(db: SQLiteDatabase, added: readonly CoachMessage[]): Promise<void> {
  const messages = (await getSetting(db, 'coachChat')) ?? [];
  await setSetting(db, 'coachChat', [...messages, ...added].slice(-CHAT_KEPT));
}

export async function clearCoachChat(db: SQLiteDatabase): Promise<void> {
  await setSetting(db, 'coachChat', []);
}

export async function addCoachNotes(db: SQLiteDatabase, texts: readonly string[]): Promise<void> {
  if (texts.length === 0) return;
  const notes = (await getSetting(db, 'coachNotes')) ?? [];
  const at = new Date().toISOString();
  await setSetting(db, 'coachNotes', [...notes, ...texts.map((text) => ({ text, at }))]);
}

export async function setCoachNotes(db: SQLiteDatabase, notes: readonly CoachNote[]): Promise<void> {
  await setSetting(db, 'coachNotes', [...notes]);
}
