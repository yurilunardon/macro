import type { Equipment, ExerciseKind, Muscle } from '@/lib/exercises';

export type BuiltInExercise = {
  /** Stable id: never change it, workouts and plans point at the exercise through it. */
  ref: string;
  name: string;
  muscle: Muscle;
  secondary: Muscle[];
  equipment: Equipment;
  kind: ExerciseKind;
};

const e = (
  ref: string,
  name: string,
  muscle: Muscle,
  secondary: Muscle[],
  equipment: Equipment,
  kind: ExerciseKind = 'weight',
): BuiltInExercise => ({ ref, name, muscle, secondary, equipment, kind });

/** Bump when the list changes, so existing installs get the new exercises. */
export const EXERCISES_VERSION = 1;

/** The common gym exercises, with the names used in Italian gyms. */
export const BUILT_IN_EXERCISES: readonly BuiltInExercise[] = [
  // Petto
  e('bench-press', 'Panca piana con bilanciere', 'chest', ['triceps', 'shoulders'], 'barbell'),
  e('incline-bench-press', 'Panca inclinata con bilanciere', 'chest', ['shoulders', 'triceps'], 'barbell'),
  e('decline-bench-press', 'Panca declinata con bilanciere', 'chest', ['triceps'], 'barbell'),
  e('db-bench-press', 'Panca piana con manubri', 'chest', ['triceps', 'shoulders'], 'dumbbell'),
  e('incline-db-press', 'Panca inclinata con manubri', 'chest', ['shoulders', 'triceps'], 'dumbbell'),
  e('smith-incline-press', 'Panca inclinata al multipower', 'chest', ['shoulders', 'triceps'], 'smith'),
  e('machine-chest-press', 'Chest press', 'chest', ['triceps', 'shoulders'], 'machine'),
  e('db-fly', 'Croci con manubri', 'chest', [], 'dumbbell'),
  e('incline-db-fly', 'Croci su panca inclinata', 'chest', ['shoulders'], 'dumbbell'),
  e('cable-crossover', 'Croci ai cavi', 'chest', [], 'cable'),
  e('low-cable-fly', 'Croci ai cavi dal basso', 'chest', ['shoulders'], 'cable'),
  e('pec-deck', 'Pectoral machine', 'chest', [], 'machine'),
  e('push-up', 'Piegamenti', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('chest-dip', 'Dip alle parallele per il petto', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('db-pullover', 'Pullover con manubrio', 'chest', ['back'], 'dumbbell'),

  // Dorso
  e('pull-up', 'Trazioni alla sbarra', 'back', ['biceps'], 'bodyweight', 'bodyweight'),
  e('chin-up', 'Trazioni a presa supina', 'back', ['biceps'], 'bodyweight', 'bodyweight'),
  e('assisted-pull-up', 'Trazioni assistite alla macchina', 'back', ['biceps'], 'machine'),
  e('lat-pulldown', 'Lat machine avanti', 'back', ['biceps'], 'cable'),
  e('close-grip-pulldown', 'Lat machine presa stretta', 'back', ['biceps'], 'cable'),
  e('barbell-row', 'Rematore con bilanciere', 'back', ['biceps', 'shoulders'], 'barbell'),
  e('db-row', 'Rematore con manubrio', 'back', ['biceps'], 'dumbbell'),
  e('seated-cable-row', 'Pulley basso', 'back', ['biceps'], 'cable'),
  e('t-bar-row', 'Rematore T-bar', 'back', ['biceps'], 'barbell'),
  e('chest-supported-row', 'Rematore su panca inclinata', 'back', ['biceps', 'shoulders'], 'dumbbell'),
  e('machine-row', 'Row machine', 'back', ['biceps'], 'machine'),
  e('straight-arm-pulldown', 'Pulldown a braccia tese', 'back', [], 'cable'),
  e('deadlift', 'Stacco da terra', 'back', ['glutes', 'hamstrings', 'quads'], 'barbell'),
  e('back-extension', 'Hyperextension', 'back', ['glutes', 'hamstrings'], 'bodyweight', 'bodyweight'),
  e('db-shrug', 'Scrollate con manubri', 'back', [], 'dumbbell'),

  // Spalle
  e('overhead-press', 'Military press con bilanciere', 'shoulders', ['triceps'], 'barbell'),
  e('db-shoulder-press', 'Lento avanti con manubri', 'shoulders', ['triceps'], 'dumbbell'),
  e('machine-shoulder-press', 'Shoulder press', 'shoulders', ['triceps'], 'machine'),
  e('arnold-press', 'Arnold press', 'shoulders', ['triceps'], 'dumbbell'),
  e('lateral-raise', 'Alzate laterali con manubri', 'shoulders', [], 'dumbbell'),
  e('cable-lateral-raise', 'Alzate laterali ai cavi', 'shoulders', [], 'cable'),
  e('machine-lateral-raise', 'Alzate laterali alla macchina', 'shoulders', [], 'machine'),
  e('front-raise', 'Alzate frontali', 'shoulders', [], 'dumbbell'),
  e('rear-delt-fly', 'Alzate posteriori con manubri', 'shoulders', ['back'], 'dumbbell'),
  e('reverse-pec-deck', 'Reverse pec deck', 'shoulders', ['back'], 'machine'),
  e('face-pull', 'Face pull', 'shoulders', ['back'], 'cable'),
  e('upright-row', 'Tirate al mento', 'shoulders', ['back'], 'barbell'),

  // Bicipiti
  e('barbell-curl', 'Curl con bilanciere', 'biceps', ['forearms'], 'barbell'),
  e('ez-curl', 'Curl con bilanciere EZ', 'biceps', ['forearms'], 'barbell'),
  e('db-curl', 'Curl con manubri', 'biceps', ['forearms'], 'dumbbell'),
  e('hammer-curl', 'Curl a martello', 'biceps', ['forearms'], 'dumbbell'),
  e('incline-db-curl', 'Curl su panca inclinata', 'biceps', [], 'dumbbell'),
  e('preacher-curl', 'Curl alla panca Scott', 'biceps', [], 'barbell'),
  e('cable-curl', 'Curl ai cavi', 'biceps', [], 'cable'),
  e('concentration-curl', 'Curl di concentrazione', 'biceps', [], 'dumbbell'),

  // Tricipiti
  e('triceps-pushdown', 'Pushdown ai cavi', 'triceps', [], 'cable'),
  e('rope-pushdown', 'Pushdown con corda', 'triceps', [], 'cable'),
  e('overhead-cable-extension', 'Estensioni sopra la testa ai cavi', 'triceps', [], 'cable'),
  e('skull-crusher', 'French press con bilanciere EZ', 'triceps', [], 'barbell'),
  e('db-overhead-extension', 'Estensioni sopra la testa con manubrio', 'triceps', [], 'dumbbell'),
  e('close-grip-bench', 'Panca presa stretta', 'triceps', ['chest'], 'barbell'),
  e('triceps-dip', 'Dip alle parallele', 'triceps', ['chest', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('bench-dip', 'Dip su panca', 'triceps', [], 'bodyweight', 'bodyweight'),
  e('db-kickback', 'Kickback con manubrio', 'triceps', [], 'dumbbell'),

  // Avambracci
  e('wrist-curl', 'Curl di polso', 'forearms', [], 'dumbbell'),
  e('reverse-curl', 'Curl a presa prona', 'forearms', ['biceps'], 'barbell'),

  // Quadricipiti
  e('back-squat', 'Squat con bilanciere', 'quads', ['glutes', 'hamstrings'], 'barbell'),
  e('front-squat', 'Front squat', 'quads', ['glutes'], 'barbell'),
  e('smith-squat', 'Squat al multipower', 'quads', ['glutes'], 'smith'),
  e('hack-squat', 'Hack squat', 'quads', ['glutes'], 'machine'),
  e('pendulum-squat', 'Pendulum squat', 'quads', ['glutes'], 'machine'),
  e('leg-press', 'Leg press', 'quads', ['glutes', 'hamstrings'], 'machine'),
  e('goblet-squat', 'Goblet squat', 'quads', ['glutes'], 'dumbbell'),
  e('bulgarian-split-squat', 'Squat bulgaro', 'quads', ['glutes'], 'dumbbell'),
  e('walking-lunge', 'Affondi camminati con manubri', 'quads', ['glutes'], 'dumbbell'),
  e('reverse-lunge', 'Affondi indietro', 'quads', ['glutes'], 'dumbbell'),
  e('step-up', 'Step-up con manubri', 'quads', ['glutes'], 'dumbbell'),
  e('leg-extension', 'Leg extension', 'quads', [], 'machine'),
  e('hip-adduction', 'Adductor machine', 'quads', [], 'machine'),

  // Femorali
  e('romanian-deadlift', 'Stacco rumeno con bilanciere', 'hamstrings', ['glutes', 'back'], 'barbell'),
  e('db-romanian-deadlift', 'Stacco rumeno con manubri', 'hamstrings', ['glutes'], 'dumbbell'),
  e('stiff-leg-deadlift', 'Stacco a gambe tese', 'hamstrings', ['glutes', 'back'], 'barbell'),
  e('lying-leg-curl', 'Leg curl sdraiato', 'hamstrings', [], 'machine'),
  e('seated-leg-curl', 'Leg curl seduto', 'hamstrings', [], 'machine'),
  e('good-morning', 'Good morning', 'hamstrings', ['back', 'glutes'], 'barbell'),
  e('nordic-curl', 'Nordic curl', 'hamstrings', [], 'bodyweight', 'bodyweight'),

  // Glutei
  e('hip-thrust', 'Hip thrust con bilanciere', 'glutes', ['hamstrings'], 'barbell'),
  e('machine-hip-thrust', 'Hip thrust alla macchina', 'glutes', ['hamstrings'], 'machine'),
  e('glute-bridge', 'Ponte glutei', 'glutes', ['hamstrings'], 'bodyweight', 'bodyweight'),
  e('cable-kickback', 'Slanci ai cavi', 'glutes', [], 'cable'),
  e('hip-abduction', 'Abductor machine', 'glutes', [], 'machine'),
  e('sumo-deadlift', 'Stacco sumo', 'glutes', ['quads', 'hamstrings', 'back'], 'barbell'),
  e('kettlebell-swing', 'Kettlebell swing', 'glutes', ['hamstrings'], 'kettlebell'),

  // Polpacci
  e('standing-calf-raise', 'Calf in piedi', 'calves', [], 'machine'),
  e('seated-calf-raise', 'Calf seduto', 'calves', [], 'machine'),
  e('leg-press-calf-raise', 'Calf alla leg press', 'calves', [], 'machine'),
  e('smith-calf-raise', 'Calf al multipower', 'calves', [], 'smith'),

  // Addome
  e('crunch', 'Crunch', 'abs', [], 'bodyweight', 'bodyweight'),
  e('cable-crunch', 'Crunch ai cavi', 'abs', [], 'cable'),
  e('machine-crunch', 'Crunch alla macchina', 'abs', [], 'machine'),
  e('hanging-leg-raise', 'Leg raise alla sbarra', 'abs', [], 'bodyweight', 'bodyweight'),
  e('lying-leg-raise', 'Leg raise a terra', 'abs', [], 'bodyweight', 'bodyweight'),
  e('russian-twist', 'Russian twist', 'abs', [], 'bodyweight', 'bodyweight'),
  e('ab-wheel', 'Ab wheel', 'abs', [], 'other', 'bodyweight'),
  e('pallof-press', 'Pallof press', 'abs', [], 'cable'),
  e('plank', 'Plank', 'abs', [], 'bodyweight', 'time'),
  e('side-plank', 'Plank laterale', 'abs', [], 'bodyweight', 'time'),
];
