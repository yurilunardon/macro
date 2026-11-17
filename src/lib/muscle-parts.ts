import type { Muscle } from './exercises';

/**
 * The parts of a muscle that exercises tell apart: the three heads of the deltoid, the lats and
 * the upper and lower back, and so on. Muscles whose heads are trained much the same by every
 * exercise (biceps, triceps, quadriceps, hamstrings, forearms) stay whole.
 */
export type MusclePart =
  | 'front-delts'
  | 'side-delts'
  | 'rear-delts'
  | 'lats'
  | 'upper-back'
  | 'lower-back'
  | 'upper-chest'
  | 'lower-chest'
  | 'rectus-abs'
  | 'obliques'
  | 'glute-max'
  | 'glute-med'
  | 'gastrocnemius'
  | 'soleus';

export const MUSCLE_PARTS: Partial<Record<Muscle, readonly { key: MusclePart; label: string }[]>> = {
  shoulders: [
    { key: 'front-delts', label: 'Anteriore' },
    { key: 'side-delts', label: 'Laterale' },
    { key: 'rear-delts', label: 'Posteriore' },
  ],
  back: [
    { key: 'lats', label: 'Dorsali' },
    { key: 'upper-back', label: 'Parte alta' },
    { key: 'lower-back', label: 'Lombari' },
  ],
  chest: [
    { key: 'upper-chest', label: 'Alto' },
    { key: 'lower-chest', label: 'Medio-basso' },
  ],
  abs: [
    { key: 'rectus-abs', label: 'Retto' },
    { key: 'obliques', label: 'Obliqui' },
  ],
  glutes: [
    { key: 'glute-max', label: 'Grande gluteo' },
    { key: 'glute-med', label: 'Medio gluteo' },
  ],
  calves: [
    { key: 'gastrocnemius', label: 'Gemelli' },
    { key: 'soleus', label: 'Soleo' },
  ],
};

const PART_MUSCLE = new Map<MusclePart, Muscle>(
  Object.entries(MUSCLE_PARTS).flatMap(([muscle, parts]) => parts.map((p) => [p.key, muscle as Muscle] as const)),
);

export function isMusclePart(value: unknown): value is MusclePart {
  return typeof value === 'string' && PART_MUSCLE.has(value as MusclePart);
}

export function partMuscle(part: MusclePart): Muscle {
  return PART_MUSCLE.get(part) as Muscle;
}

export function partsOfMuscle(muscle: Muscle): readonly { key: MusclePart; label: string }[] {
  return MUSCLE_PARTS[muscle] ?? [];
}

export function partLabel(part: MusclePart): string {
  return partsOfMuscle(partMuscle(part)).find((p) => p.key === part)?.label ?? part;
}

/**
 * The parts each exercise of the library trains most, for its main muscle and the ones it helps.
 * Kept apart from the library so that the exercises in the database need no change: an exercise
 * that is not here (one made in the app) counts for its muscles whole.
 */
const EXERCISE_PARTS: Record<string, readonly MusclePart[]> = {
  // Chest: inclined, and pressing or flying upwards, for the upper part; flat and down for the rest.
  'bench-press': ['lower-chest', 'front-delts'],
  'incline-bench-press': ['upper-chest', 'front-delts'],
  'decline-bench-press': ['lower-chest'],
  'db-bench-press': ['lower-chest', 'front-delts'],
  'incline-db-press': ['upper-chest', 'front-delts'],
  'smith-incline-press': ['upper-chest', 'front-delts'],
  'machine-chest-press': ['lower-chest', 'front-delts'],
  'db-fly': ['lower-chest'],
  'incline-db-fly': ['upper-chest', 'front-delts'],
  'cable-crossover': ['lower-chest'],
  'low-cable-fly': ['upper-chest', 'front-delts'],
  'pec-deck': ['lower-chest'],
  'push-up': ['lower-chest', 'front-delts'],
  'chest-dip': ['lower-chest', 'front-delts'],
  'db-pullover': ['lower-chest', 'lats'],
  'close-grip-bench': ['lower-chest'],
  'triceps-dip': ['lower-chest', 'front-delts'],
  // Back: pulling from above for the lats, rows for the lats and the upper back, hinges for the lower.
  'pull-up': ['lats'],
  'chin-up': ['lats'],
  'assisted-pull-up': ['lats'],
  'lat-pulldown': ['lats'],
  'close-grip-pulldown': ['lats'],
  'straight-arm-pulldown': ['lats'],
  'barbell-row': ['upper-back', 'lats', 'rear-delts'],
  'db-row': ['lats', 'upper-back'],
  'seated-cable-row': ['upper-back', 'lats'],
  't-bar-row': ['upper-back', 'lats'],
  'chest-supported-row': ['upper-back', 'lats', 'rear-delts'],
  'machine-row': ['upper-back', 'lats'],
  'db-shrug': ['upper-back'],
  deadlift: ['lower-back', 'upper-back', 'glute-max'],
  'back-extension': ['lower-back', 'glute-max'],
  'romanian-deadlift': ['lower-back', 'glute-max'],
  'db-romanian-deadlift': ['glute-max'],
  'stiff-leg-deadlift': ['lower-back', 'glute-max'],
  'good-morning': ['lower-back', 'glute-max'],
  // Shoulders: presses for the front, raises to the side for the side, flies and pulls back for the rear.
  'overhead-press': ['front-delts'],
  'db-shoulder-press': ['front-delts'],
  'machine-shoulder-press': ['front-delts'],
  'arnold-press': ['front-delts', 'side-delts'],
  'lateral-raise': ['side-delts'],
  'cable-lateral-raise': ['side-delts'],
  'machine-lateral-raise': ['side-delts'],
  'front-raise': ['front-delts'],
  'rear-delt-fly': ['rear-delts', 'upper-back'],
  'reverse-pec-deck': ['rear-delts', 'upper-back'],
  'face-pull': ['rear-delts', 'upper-back'],
  'upright-row': ['side-delts', 'upper-back'],
  // Legs: the gluteus maximus works in every squat and hinge; standing on one leg brings in the medius.
  'back-squat': ['glute-max'],
  'front-squat': ['glute-max'],
  'smith-squat': ['glute-max'],
  'hack-squat': ['glute-max'],
  'pendulum-squat': ['glute-max'],
  'leg-press': ['glute-max'],
  'goblet-squat': ['glute-max'],
  'bulgarian-split-squat': ['glute-max', 'glute-med'],
  'walking-lunge': ['glute-max', 'glute-med'],
  'reverse-lunge': ['glute-max', 'glute-med'],
  'step-up': ['glute-max', 'glute-med'],
  'hip-thrust': ['glute-max'],
  'machine-hip-thrust': ['glute-max'],
  'glute-bridge': ['glute-max'],
  'cable-kickback': ['glute-max'],
  'hip-abduction': ['glute-med'],
  'sumo-deadlift': ['glute-max', 'lower-back'],
  'kettlebell-swing': ['glute-max'],
  // Calves: straight knee for the gastrocnemius, bent knee for the soleus.
  'standing-calf-raise': ['gastrocnemius'],
  'leg-press-calf-raise': ['gastrocnemius'],
  'smith-calf-raise': ['gastrocnemius'],
  'seated-calf-raise': ['soleus'],
  // Abs: bending and lifting the legs for the rectus, turning and resisting a turn for the obliques.
  crunch: ['rectus-abs'],
  'cable-crunch': ['rectus-abs'],
  'machine-crunch': ['rectus-abs'],
  'hanging-leg-raise': ['rectus-abs'],
  'lying-leg-raise': ['rectus-abs'],
  'ab-wheel': ['rectus-abs'],
  plank: ['rectus-abs'],
  'russian-twist': ['obliques'],
  'pallof-press': ['obliques'],
  'side-plank': ['obliques'],
};

/** The parts an exercise trains most; none for one made in the app. */
export function exerciseParts(exercise: { ref: string | null }): readonly MusclePart[] {
  return exercise.ref ? (EXERCISE_PARTS[exercise.ref] ?? []) : [];
}

/**
 * The parts of `muscle` that an exercise's sets count for: the ones it names, or all of them when
 * it names none of this muscle's (an exercise made in the app, or one that trains it evenly).
 */
export function partsTrained(exercise: { ref: string | null }, muscle: Muscle): readonly MusclePart[] {
  const all = partsOfMuscle(muscle).map((p) => p.key);
  const named = exerciseParts(exercise).filter((p) => all.includes(p));
  return named.length > 0 ? named : all;
}
