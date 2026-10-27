import type { ExerciseKind, Muscle } from './exercises';
import { formatNumber } from './format';

export type SetType = 'normal' | 'warmup' | 'drop' | 'failure';

export const SET_TYPES: readonly { key: SetType; label: string; short: string }[] = [
  { key: 'normal', label: 'Serie normale', short: '' },
  { key: 'warmup', label: 'Riscaldamento', short: 'R' },
  { key: 'drop', label: 'Drop set', short: 'D' },
  { key: 'failure', label: 'A cedimento', short: 'C' },
];

export function isSetType(value: unknown): value is SetType {
  return SET_TYPES.some((t) => t.key === value);
}

export type LoggedSet = {
  type: SetType;
  /** kg; for bodyweight exercises the added weight, if any. */
  weight: number | null;
  reps: number | null;
  /** For holds such as the plank. */
  seconds: number | null;
  /** Reps in reserve: how many more were possible. */
  rir: number | null;
  done: boolean;
};

/** Sets that count for progress and volume: completed, and not warm-ups. */
export function isWorkSet(set: LoggedSet): boolean {
  return set.done && set.type !== 'warmup';
}

/**
 * Estimated one-rep max (Epley). Beyond 12 reps the estimate stops being meaningful, so those
 * sets have none.
 */
export function estimateOneRepMax(weight: number | null, reps: number | null): number | null {
  if (weight === null || reps === null || weight <= 0 || reps <= 0 || reps > 12) return null;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export type Plan = { sets: number; repMin: number; repMax: number };

export type Suggestion =
  | { kind: 'first' }
  | { kind: 'increase'; weight: number; reps: number }
  | { kind: 'repeat'; weight: number | null; reps: number }
  | { kind: 'hold'; seconds: number };

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Double progression: stay on a weight and add reps until every work set reaches the top of
 * the range, then add the smallest load jump and start again from the bottom of the range.
 * `last` is the previous session of this exercise.
 */
export function suggestNext(plan: Plan, last: readonly LoggedSet[], increment: number, kind: ExerciseKind): Suggestion {
  const work = last.filter((s) => s.done && (s.type === 'normal' || s.type === 'failure'));
  if (kind === 'time') {
    const best = Math.max(0, ...work.map((s) => s.seconds ?? 0));
    return best > 0 ? { kind: 'hold', seconds: best + 5 } : { kind: 'first' };
  }
  const withReps = work.filter((s) => s.reps !== null && s.reps > 0);
  if (withReps.length === 0) return { kind: 'first' };

  const top = Math.max(...withReps.map((s) => s.weight ?? 0));
  const atTop = withReps.filter((s) => (s.weight ?? 0) === top);
  const minReps = Math.min(...atTop.map((s) => s.reps ?? 0));
  const enoughSets = atTop.length >= Math.min(plan.sets, withReps.length);

  if (kind === 'weight' && top > 0 && enoughSets && minReps >= plan.repMax) {
    return { kind: 'increase', weight: roundTo(top + increment, 0.25), reps: plan.repMin };
  }
  const reps = Math.min(plan.repMax, Math.max(plan.repMin, minReps + 1));
  return { kind: 'repeat', weight: top > 0 ? top : null, reps };
}

/** "80 kg × 8", "+10 kg × 6" for added weight, "× 12" with the body only, "45 s". */
export function formatSet(set: Pick<LoggedSet, 'weight' | 'reps' | 'seconds'>, kind: ExerciseKind): string {
  if (kind === 'time') return set.seconds !== null ? `${formatNumber(set.seconds, 0)} s` : '—';
  const reps = set.reps !== null ? `× ${set.reps}` : '';
  if (set.weight === null || set.weight === 0) return kind === 'bodyweight' ? reps || '—' : reps ? `— ${reps}` : '—';
  const weight = `${kind === 'bodyweight' ? '+' : ''}${formatNumber(set.weight, 2)} kg`;
  return reps ? `${weight} ${reps}` : weight;
}

/** "1:30" for a rest; "32:10" or "1:02:05" for a workout that is running. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** "1 h 05 min", "48 min": for finished workouts. */
export function formatWorkoutLength(totalSeconds: number): string {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Sum of kg × reps over the work sets: the usual "volume" of a session. */
export function tonnage(sets: readonly LoggedSet[]): number {
  return sets.filter(isWorkSet).reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
}

/**
 * Hard sets per muscle: a set counts fully for the main muscle and half for each secondary one,
 * as commonly done when counting weekly volume.
 */
export function setsPerMuscle(
  sets: readonly { muscle: Muscle; secondary: readonly Muscle[]; count: number }[],
): Map<Muscle, number> {
  const totals = new Map<Muscle, number>();
  for (const { muscle, secondary, count } of sets) {
    totals.set(muscle, (totals.get(muscle) ?? 0) + count);
    for (const m of secondary) totals.set(m, (totals.get(m) ?? 0) + count / 2);
  }
  return totals;
}

/** In a rotation of days (Push, Pull, Legs…), the one after the last done, or the first. */
export function nextInRotation<T>(days: readonly T[], lastDone: T | null): T | null {
  if (days.length === 0) return null;
  const index = lastDone === null ? -1 : days.indexOf(lastDone);
  return days[(index + 1) % days.length];
}

/** Best estimated 1RM among some sets, or null. */
export function bestOneRepMax(sets: readonly LoggedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!isWorkSet(s)) continue;
    const e1rm = estimateOneRepMax(s.weight, s.reps);
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm;
  }
  return best;
}

/** SF Symbol for a training day, from the words in its name. */
export type DayIcon =
  | 'figure.strengthtraining.traditional'
  | 'figure.rower'
  | 'figure.step.training'
  | 'figure.arms.open'
  | 'figure.stairs'
  | 'figure.cross.training'
  | 'dumbbell.fill'
  | 'figure.core.training'
  | 'figure.strengthtraining.functional';

const DAY_ICONS: readonly { words: readonly string[]; icon: DayIcon }[] = [
  // Pressing: chest, shoulders, triceps.
  { words: ['push', 'spinta', 'petto', 'chest'], icon: 'figure.strengthtraining.traditional' },
  // Pulling: back and biceps, a row.
  { words: ['pull', 'tirata', 'trazione', 'dorso', 'schiena', 'back'], icon: 'figure.rower' },
  { words: ['upper', 'superior', 'sopra', 'busto'], icon: 'figure.arms.open' },
  { words: ['lower', 'inferior', 'sotto'], icon: 'figure.stairs' },
  { words: ['leg', 'gamb', 'squat', 'quad', 'glute'], icon: 'figure.step.training' },
  { words: ['full', 'total', 'completo', 'tutto'], icon: 'figure.cross.training' },
  { words: ['braccia', 'arm', 'bicip', 'tricip'], icon: 'dumbbell.fill' },
  { words: ['core', 'addom', 'abs'], icon: 'figure.core.training' },
];

export function dayIcon(name: string): DayIcon {
  const lower = name.toLowerCase();
  return DAY_ICONS.find((d) => d.words.some((w) => lower.includes(w)))?.icon ?? 'figure.strengthtraining.functional';
}
