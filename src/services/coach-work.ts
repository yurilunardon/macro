/**
 * What the coach writes by itself: the sentence of the day, the weekly analysis, the comment at the
 * end of a workout; and a question asked from anywhere. Each is written once and kept; a failed
 * try is not repeated on its own until the app starts again, so the free quota is not eaten.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  addCoachMessages,
  addCoachNotes,
  addCoachWeek,
  addCoachWorkoutNote,
  getCoachChat,
  getCoachHome,
  getCoachSnapshot,
  getCoachWorkoutNote,
  getWorkoutForCoach,
  setCoachDaily,
  updateCoachProfile,
} from '@/db/coach';
import {
  CHAT_SENT,
  dailyQuestion,
  lastWeek,
  newNotes,
  oneLine,
  parseReply,
  parseWeek,
  systemPrompt,
  WEEK_SCHEMA,
  weekQuestion,
  workoutQuestion,
  type CoachMessage,
} from '@/lib/coach';
import type { DateKey } from '@/lib/dates';

import { askCoach, CoachError } from './coach';

const running = new Map<string, Promise<void>>();
const failed = new Set<string>();

/** One job at a time per key; after a failure, again only if asked (`force`). */
function once(key: string, force: boolean, job: () => Promise<void>): Promise<void> {
  const busy = running.get(key);
  if (busy) return busy;
  if (failed.has(key) && !force) return Promise.resolve();
  failed.delete(key);
  const promise = job()
    .catch((e: unknown) => {
      failed.add(key);
      throw e;
    })
    .finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

export function isCoachBusy(key: string): boolean {
  return running.has(key);
}

function clockNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** A question to the coach and its answer, kept in the conversation; what it learned goes on the card. */
export async function sendToCoach(db: SQLiteDatabase, today: DateKey, question: CoachMessage): Promise<void> {
  const [snapshot, { messages }] = await Promise.all([getCoachSnapshot(db, today), getCoachChat(db)]);
  const history = [...messages, question].slice(-CHAT_SENT);
  // The conversation starts with a question: one the model asked first is left out.
  while (history.length > 0 && history[0].role !== 'user') history.shift();
  const reply = parseReply(await askCoach(systemPrompt(snapshot), history));
  await addCoachMessages(db, [question, { role: 'model', text: reply.text, at: new Date().toISOString() }]);
  await addCoachNotes(db, newNotes(snapshot.notes, reply.notes));
  await updateCoachProfile(db, reply.profile);
}

export const dailyKey = (today: DateKey) => `daily:${today}`;

/** The coach's sentence for today, if not written yet. */
export function ensureDaily(db: SQLiteDatabase, today: DateKey, force = false): Promise<void> {
  return once(dailyKey(today), force, async () => {
    const home = await getCoachHome(db);
    if (home.daily?.date === today && !force) return;
    const snapshot = await getCoachSnapshot(db, today);
    const text = oneLine(await askCoach(systemPrompt(snapshot), [{ role: 'user', text: dailyQuestion(today, clockNow()) }]));
    if (!text) throw new CoachError('Risposta vuota');
    await setCoachDaily(db, { date: today, text, at: new Date().toISOString() });
  });
}

export const weekKey = (today: DateKey) => `week:${lastWeek(today).from}`;

/** The analysis of last week, if not written yet. */
export function ensureWeek(db: SQLiteDatabase, today: DateKey, force = false): Promise<void> {
  const { from, to } = lastWeek(today);
  return once(weekKey(today), force, async () => {
    const home = await getCoachHome(db);
    if (home.weeks.some((w) => w.from === from) && !force) return;
    const snapshot = await getCoachSnapshot(db, today);
    // Nothing logged and no workout in it: nothing to analyse.
    if (!snapshot.days.some((d) => d.date >= from && d.date <= to) && !snapshot.workouts.some((w) => w.date >= from && w.date <= to)) return;
    const json = await askCoach(systemPrompt(snapshot), [{ role: 'user', text: weekQuestion(from, to) }], WEEK_SCHEMA);
    const week = parseWeek(json, from, to, new Date().toISOString());
    if (!week) throw new CoachError('L’analisi non è venuta bene, riprova');
    await addCoachWeek(db, week);
  });
}

export const workoutKey = (workoutId: number) => `workout:${workoutId}`;

/** The coach's comment on a finished workout, if not written yet. */
export function ensureWorkoutNote(db: SQLiteDatabase, today: DateKey, workoutId: number, force = false): Promise<void> {
  return once(workoutKey(workoutId), force, async () => {
    if ((await getCoachWorkoutNote(db, workoutId)) && !force) return;
    const [snapshot, workout] = await Promise.all([getCoachSnapshot(db, today), getWorkoutForCoach(db, workoutId)]);
    if (!workout || workout.exercises.every((e) => e.sets.length === 0)) return;
    const text = parseReply(await askCoach(systemPrompt(snapshot), [{ role: 'user', text: workoutQuestion(workout) }])).text;
    if (!text) throw new CoachError('Risposta vuota');
    await addCoachWorkoutNote(db, { workoutId, text, at: new Date().toISOString() });
  });
}
