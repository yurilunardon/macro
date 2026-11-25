import type { SQLiteDatabase } from 'expo-sqlite';

import { expandActivities } from '@/lib/calendar';
import {
  CHAT_KEPT,
  WEEKS_KEPT,
  WORKOUT_NOTES_KEPT,
  type CoachDaily,
  type CoachMessage,
  type CoachNote,
  type CoachProfile,
  type CoachSnapshot,
  type CoachUndo,
  type CoachWeek,
  type CoachWorkoutNote,
  type ProfileFieldKey,
  type WorkoutForCoach,
} from '@/lib/coach';
import { addDays, daysFrom, type DateKey } from '@/lib/dates';
import { isWarmUp, muscleLabel } from '@/lib/exercises';
import { dosesDue, formatDose, formatSchedule } from '@/lib/supplements';

import { getCalendar } from './calendar';
import { getDayPlans, getTrainingSettings, setTrainingSettings } from './days';
import { getDailyTotals } from './entries';
import { getProgramCheck } from './program-check';
import { getPlannedExercise, getPrograms, updateDayExercise } from './programs';
import { getWorkout } from './workouts';
import { deleteSetting, getSetting, setSetting } from './settings';
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
  const [facts, targets, training, profile, goalWeight, notes, totals, plans, weights, sets, programs, supplements, taken, calendar] = await Promise.all([
    getSetting(db, 'coachProfile'),
    getSetting(db, 'targets'),
    getTrainingSettings(db),
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
            .map((p) => ({ id: p.id, text: `${p.exercise.name} ${p.sets}×${p.repMin}-${p.repMax}` })),
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

  const now = new Date();
  return {
    today,
    clock: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    facts: facts ?? {},
    targets: { training: targets, rest: training.restTargets },
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

/** Everything the coach's screen shows besides the conversation. */
export async function getCoachHome(db: SQLiteDatabase): Promise<{
  profile: CoachProfile;
  notes: CoachNote[];
  weeks: CoachWeek[];
  daily: CoachDaily | null;
}> {
  const [profile, notes, weeks, daily] = await Promise.all([
    getSetting(db, 'coachProfile'),
    getSetting(db, 'coachNotes'),
    getSetting(db, 'coachWeeks'),
    getSetting(db, 'coachDaily'),
  ]);
  return { profile: profile ?? {}, notes: notes ?? [], weeks: weeks ?? [], daily };
}

/** Fields of the card rewritten: an empty one is taken away. */
export async function updateCoachProfile(db: SQLiteDatabase, change: Partial<Record<ProfileFieldKey, string | null>>): Promise<void> {
  if (Object.keys(change).length === 0) return;
  const profile: CoachProfile = { ...((await getSetting(db, 'coachProfile')) ?? {}) };
  for (const [key, value] of Object.entries(change) as [ProfileFieldKey, string | null][]) {
    if (value && value.trim()) profile[key] = value.trim();
    else delete profile[key];
  }
  await setSetting(db, 'coachProfile', profile);
}

export async function setCoachDaily(db: SQLiteDatabase, daily: CoachDaily): Promise<void> {
  await setSetting(db, 'coachDaily', daily);
}

/** Keeps a weekly analysis, in place of an older one of the same week. */
export async function addCoachWeek(db: SQLiteDatabase, week: CoachWeek): Promise<void> {
  const weeks = ((await getSetting(db, 'coachWeeks')) ?? []).filter((w) => w.from !== week.from);
  await setSetting(db, 'coachWeeks', [week, ...weeks].sort((a, b) => b.from.localeCompare(a.from)).slice(0, WEEKS_KEPT));
}

export async function getCoachWorkoutNote(db: SQLiteDatabase, workoutId: number): Promise<CoachWorkoutNote | null> {
  return ((await getSetting(db, 'coachWorkouts')) ?? []).find((n) => n.workoutId === workoutId) ?? null;
}

export async function addCoachWorkoutNote(db: SQLiteDatabase, note: CoachWorkoutNote): Promise<void> {
  const notes = ((await getSetting(db, 'coachWorkouts')) ?? []).filter((n) => n.workoutId !== note.workoutId);
  await setSetting(db, 'coachWorkouts', [note, ...notes].slice(0, WORKOUT_NOTES_KEPT));
}

/** A finished workout as the coach reads it: work sets only. */
export async function getWorkoutForCoach(db: SQLiteDatabase, workoutId: number): Promise<WorkoutForCoach | null> {
  const workout = await getWorkout(db, workoutId);
  if (!workout) return null;
  return {
    name: workout.name,
    date: workout.date,
    exercises: workout.exercises
      .filter((e) => !isWarmUp(e.exercise))
      .map((e) => ({
        name: e.exercise.name,
        sets: e.sets.filter((s) => s.done && s.type !== 'warmup').map((s) => ({ kg: s.weight, reps: s.reps })),
      })),
  };
}

export class ApplyError extends Error {}

/** Makes the change a proposal of a weekly analysis says, and keeps what there was before. */
export async function applyCoachProposal(db: SQLiteDatabase, weekFrom: string, proposalId: string): Promise<void> {
  const weeks = (await getSetting(db, 'coachWeeks')) ?? [];
  const proposal = weeks.find((w) => w.from === weekFrom)?.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.applied) return;
  const change = proposal.change;
  let before: CoachUndo;
  if (change.kind === 'targets') {
    const [training, settings] = await Promise.all([getSetting(db, 'targets'), getTrainingSettings(db)]);
    before = { kind: 'targets', training, rest: settings.restTargets };
    const base = training ?? { kcal: change.kcal, protein: change.protein, carbs: 0, fat: 0 };
    const next = (from: typeof base) => ({ kcal: change.kcal, protein: change.protein, carbs: change.carbs ?? from.carbs, fat: change.fat ?? from.fat });
    // Without targets of their own for rest days, a change for them goes to every day.
    if (change.day === 'rest' && settings.restTargets) {
      await setTrainingSettings(db, { ...settings, restTargets: next(settings.restTargets) });
    } else {
      await setSetting(db, 'targets', next(base));
      if (change.day === 'all' && settings.restTargets) await setTrainingSettings(db, { ...settings, restTargets: null });
    }
  } else if (change.kind === 'exercise') {
    const planned = await getPlannedExercise(db, change.planId);
    if (!planned) throw new ApplyError('L’esercizio non è più nella scheda');
    before = { kind: 'exercise', planId: change.planId, sets: planned.sets, repMin: planned.repMin, repMax: planned.repMax };
    await updateDayExercise(db, change.planId, { sets: change.sets, repMin: change.repMin, repMax: change.repMax, restSeconds: planned.restSeconds, note: planned.note });
  } else {
    before = { kind: 'goalWeight', kg: await getSetting(db, 'goalWeight') };
    await setSetting(db, 'goalWeight', change.kg);
  }
  await markProposal(db, weekFrom, proposalId, { at: new Date().toISOString(), before });
}

/** Puts back what there was before a proposal was applied. */
export async function undoCoachProposal(db: SQLiteDatabase, weekFrom: string, proposalId: string): Promise<void> {
  const weeks = (await getSetting(db, 'coachWeeks')) ?? [];
  const applied = weeks.find((w) => w.from === weekFrom)?.proposals.find((p) => p.id === proposalId)?.applied;
  if (!applied) return;
  const before = applied.before;
  if (before.kind === 'targets') {
    if (before.training) await setSetting(db, 'targets', before.training);
    else await deleteSetting(db, 'targets');
    const settings = await getTrainingSettings(db);
    await setTrainingSettings(db, { ...settings, restTargets: before.rest });
  } else if (before.kind === 'exercise') {
    const planned = await getPlannedExercise(db, before.planId);
    if (planned) await updateDayExercise(db, before.planId, { sets: before.sets, repMin: before.repMin, repMax: before.repMax, restSeconds: planned.restSeconds, note: planned.note });
  } else if (before.kg === null) await deleteSetting(db, 'goalWeight');
  else await setSetting(db, 'goalWeight', before.kg);
  await markProposal(db, weekFrom, proposalId, null);
}

async function markProposal(db: SQLiteDatabase, weekFrom: string, proposalId: string, applied: CoachWeek['proposals'][number]['applied']): Promise<void> {
  const weeks = (await getSetting(db, 'coachWeeks')) ?? [];
  await setSetting(
    db,
    'coachWeeks',
    weeks.map((w) => (w.from === weekFrom ? { ...w, proposals: w.proposals.map((p) => (p.id === proposalId ? { ...p, applied } : p)) } : w)),
  );
}
