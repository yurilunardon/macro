import { MUSCLES, type Muscle } from './exercises';
import { partsOfMuscle, partsTrained, type MusclePart } from './muscle-parts';
import { muscleShare, WEEKLY_SETS } from './training';

/** How a muscle is trained by a program in a week: enough to grow, little, or very little. */
export type MuscleLevel = 'good' | 'low' | 'bad';

export type CheckExercise = {
  /** The row of the day it is planned in. */
  planId: number;
  exerciseId: number;
  /** The library's id, which says what parts of a muscle it trains. */
  ref: string | null;
  muscle: Muscle;
  secondary: readonly Muscle[];
  sets: number;
};

export type CheckDay = {
  id: number;
  name: string;
  /** How many times it comes up in a week of the calendar: 1, or ⅔ for three days on two slots. */
  perWeek: number;
  exercises: readonly CheckExercise[];
};

export type MuscleCheck = {
  muscle: Muscle;
  /** Weekly sets, a set counting half where the muscle only helps. */
  sets: number;
  /** The same as a whole number: the one to show. */
  shown: number;
  level: MuscleLevel;
  /** Sets to add to get to the least that makes it grow; 0 when there. */
  missing: number;
  /** Rows of the days that train it as their main muscle, and the ones where it helps. */
  direct: number[];
  indirect: number[];
  /** The day an exercise for it belongs in; null for a program without days. */
  dayId: number | null;
  /** For a muscle with parts, each of them; empty for the others. */
  parts: PartCheck[];
};

export type PartCheck = {
  part: MusclePart;
  sets: number;
  shown: number;
  level: MuscleLevel;
  /** Rows of the days whose sets count for it. */
  planIds: number[];
};

/** A part is enough with half of what its whole muscle needs: the sets of the others help it too. */
export const PART_GOOD = WEEKLY_SETS.low / 2;
const PART_VERY_LOW = 3;

export function partLevelOf(shown: number): MuscleLevel {
  return shown >= PART_GOOD ? 'good' : shown >= PART_VERY_LOW ? 'low' : 'bad';
}

const RANK: Record<MuscleLevel, number> = { good: 0, low: 1, bad: 2 };

/** The worse of two: how a part is drawn, never better than its muscle. */
export function worseLevel(a: MuscleLevel, b: MuscleLevel): MuscleLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The part that lacks most, if one does. */
export function weakestPart(check: MuscleCheck): PartCheck | null {
  const weak = check.parts.filter((p) => p.level !== 'good').sort((a, b) => a.sets - b.sets);
  return weak[0] ?? null;
}

/** Half the way to the least useful: under it a muscle is barely trained. */
const VERY_LOW = WEEKLY_SETS.low / 2;

export function levelOf(shown: number): MuscleLevel {
  return shown >= WEEKLY_SETS.low ? 'good' : shown >= VERY_LOW ? 'low' : 'bad';
}

export function levelLabel(level: MuscleLevel): string {
  return level === 'good' ? 'Bene' : level === 'low' ? 'Poco' : 'Molto poco';
}

/**
 * How often each day of a program comes up in a week, from the gym days of the calendar over
 * `weeks` weeks in date order: a gym day tied to a day of the program counts for it, the others
 * take the days in turn, as the training tab does. With no gym day planned, each day once.
 */
export function weeklyTimes(
  dayIds: readonly number[],
  gym: readonly { dayId: number | null }[],
  weeks: number,
  next: number | null = null,
): { times: Map<number, number>; assumed: boolean } {
  const times = new Map<number, number>(dayIds.map((id) => [id, 0]));
  if (dayIds.length === 0) return { times, assumed: false };
  if (gym.length === 0) return { times: new Map(dayIds.map((id) => [id, 1])), assumed: true };
  let cursor = Math.max(0, next === null ? 0 : dayIds.indexOf(next));
  for (const { dayId } of gym) {
    const tied = dayId === null ? -1 : dayIds.indexOf(dayId);
    const at = tied >= 0 ? tied : cursor;
    times.set(dayIds[at], (times.get(dayIds[at]) ?? 0) + 1 / weeks);
    cursor = (at + 1) % dayIds.length;
  }
  return { times, assumed: false };
}

/** Muscles usually trained on the same day: where a muscle nobody trains yet finds its place. */
const FAMILIES: readonly (readonly Muscle[])[] = [
  ['chest', 'shoulders', 'triceps'],
  ['back', 'biceps', 'forearms'],
  ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
];

function daySets(day: CheckDay, muscles: readonly Muscle[]): number {
  return day.exercises.reduce((sum, e) => sum + e.sets * Math.max(...muscles.map((m) => muscleShare(e, m))), 0);
}

/** The day that already trains the muscle most, else the one of its family, else the lightest. */
export function dayFor(muscle: Muscle, days: readonly CheckDay[]): number | null {
  if (days.length === 0) return null;
  const best = (score: (day: CheckDay) => number) => days.reduce((top, day) => (score(day) > score(top) ? day : top), days[0]);
  const own = best((day) => daySets(day, [muscle]));
  if (daySets(own, [muscle]) > 0) return own.id;
  const family = FAMILIES.find((f) => f.includes(muscle)) ?? [muscle];
  const near = best((day) => daySets(day, family));
  if (daySets(near, family) > 0) return near.id;
  return best((day) => -day.exercises.reduce((sum, e) => sum + e.sets, 0)).id;
}

/** Every muscle against the weekly sets that make it grow. */
export function checkMuscles(days: readonly CheckDay[]): MuscleCheck[] {
  return MUSCLES.map(({ key: muscle }) => {
    let sets = 0;
    const direct: number[] = [];
    const indirect: number[] = [];
    for (const day of days) {
      for (const exercise of day.exercises) {
        const share = muscleShare(exercise, muscle);
        if (share === 0) continue;
        sets += day.perWeek * exercise.sets * share;
        (share === 1 ? direct : indirect).push(exercise.planId);
      }
    }
    const shown = Math.round(sets);
    const parts = partsOfMuscle(muscle).map(({ key: part }): PartCheck => {
      let partSets = 0;
      const planIds: number[] = [];
      for (const day of days) {
        for (const exercise of day.exercises) {
          const share = muscleShare(exercise, muscle);
          if (share === 0 || !partsTrained(exercise, muscle).includes(part)) continue;
          partSets += day.perWeek * exercise.sets * share;
          planIds.push(exercise.planId);
        }
      }
      const partShown = Math.round(partSets);
      return { part, sets: partSets, shown: partShown, level: partLevelOf(partShown), planIds };
    });
    return { muscle, sets, shown, level: levelOf(shown), missing: Math.max(0, WEEKLY_SETS.low - shown), direct, indirect, dayId: dayFor(muscle, days), parts };
  });
}

/** "mancano 4 serie", "manca 1 serie". */
export function missingLabel(missing: number, { short = false } = {}): string {
  const count = missing === 1 ? 'manca 1' : `mancano ${missing}`;
  return short ? count : `${count} serie`;
}

/** With its article, after "per": "per i glutei", "per l’addome". */
export function muscleWithArticle(muscle: Muscle): string {
  const names: Record<Muscle, string> = {
    chest: 'il petto',
    back: 'il dorso',
    shoulders: 'le spalle',
    biceps: 'i bicipiti',
    triceps: 'i tricipiti',
    forearms: 'gli avambracci',
    quads: 'i quadricipiti',
    hamstrings: 'i femorali',
    glutes: 'i glutei',
    calves: 'i polpacci',
    abs: 'l’addome',
  };
  return names[muscle];
}

/** "panca piana, croci e dip". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}
