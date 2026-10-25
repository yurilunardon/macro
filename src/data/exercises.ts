import type { Equipment, ExerciseKind, Muscle } from '@/lib/exercises';

export type BuiltInExercise = {
  /** Stable id: never change it, workouts and plans point at the exercise through it. */
  ref: string;
  /** Italian name. */
  name: string;
  /** English name, the one most used in Italian gyms. */
  nameEn: string;
  muscle: Muscle;
  secondary: Muscle[];
  equipment: Equipment;
  kind: ExerciseKind;
};

const e = (
  ref: string,
  name: string,
  nameEn: string,
  muscle: Muscle,
  secondary: Muscle[],
  equipment: Equipment,
  kind: ExerciseKind = 'weight',
): BuiltInExercise => ({ ref, name, nameEn, muscle, secondary, equipment, kind });

/** Bump when the list changes, so existing installs get the new exercises. 2 added English names. */
export const EXERCISES_VERSION = 2;

/** The common gym exercises, with their Italian and English names. */
export const BUILT_IN_EXERCISES: readonly BuiltInExercise[] = [
  // Petto
  e('bench-press', 'Panca piana con bilanciere', 'Bench press', 'chest', ['triceps', 'shoulders'], 'barbell'),
  e('incline-bench-press', 'Panca inclinata con bilanciere', 'Incline bench press', 'chest', ['shoulders', 'triceps'], 'barbell'),
  e('decline-bench-press', 'Panca declinata con bilanciere', 'Decline bench press', 'chest', ['triceps'], 'barbell'),
  e('db-bench-press', 'Panca piana con manubri', 'Dumbbell bench press', 'chest', ['triceps', 'shoulders'], 'dumbbell'),
  e('incline-db-press', 'Panca inclinata con manubri', 'Incline dumbbell press', 'chest', ['shoulders', 'triceps'], 'dumbbell'),
  e('smith-incline-press', 'Panca inclinata al multipower', 'Smith incline press', 'chest', ['shoulders', 'triceps'], 'smith'),
  e('machine-chest-press', 'Chest press', 'Chest press', 'chest', ['triceps', 'shoulders'], 'machine'),
  e('db-fly', 'Croci con manubri', 'Dumbbell fly', 'chest', [], 'dumbbell'),
  e('incline-db-fly', 'Croci su panca inclinata', 'Incline dumbbell fly', 'chest', ['shoulders'], 'dumbbell'),
  e('cable-crossover', 'Croci ai cavi', 'Cable crossover', 'chest', [], 'cable'),
  e('low-cable-fly', 'Croci ai cavi dal basso', 'Low cable fly', 'chest', ['shoulders'], 'cable'),
  e('pec-deck', 'Pectoral machine', 'Pec deck', 'chest', [], 'machine'),
  e('push-up', 'Piegamenti', 'Push-up', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('chest-dip', 'Dip alle parallele per il petto', 'Chest dip', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('db-pullover', 'Pullover con manubrio', 'Dumbbell pullover', 'chest', ['back'], 'dumbbell'),

  // Dorso
  e('pull-up', 'Trazioni alla sbarra', 'Pull-up', 'back', ['biceps'], 'bodyweight', 'bodyweight'),
  e('chin-up', 'Trazioni a presa supina', 'Chin-up', 'back', ['biceps'], 'bodyweight', 'bodyweight'),
  e('assisted-pull-up', 'Trazioni assistite alla macchina', 'Assisted pull-up', 'back', ['biceps'], 'machine'),
  e('lat-pulldown', 'Lat machine avanti', 'Lat pulldown', 'back', ['biceps'], 'cable'),
  e('close-grip-pulldown', 'Lat machine presa stretta', 'Close-grip lat pulldown', 'back', ['biceps'], 'cable'),
  e('barbell-row', 'Rematore con bilanciere', 'Barbell row', 'back', ['biceps', 'shoulders'], 'barbell'),
  e('db-row', 'Rematore con manubrio', 'Dumbbell row', 'back', ['biceps'], 'dumbbell'),
  e('seated-cable-row', 'Pulley basso', 'Seated cable row', 'back', ['biceps'], 'cable'),
  e('t-bar-row', 'Rematore T-bar', 'T-bar row', 'back', ['biceps'], 'barbell'),
  e('chest-supported-row', 'Rematore su panca inclinata', 'Chest-supported row', 'back', ['biceps', 'shoulders'], 'dumbbell'),
  e('machine-row', 'Row machine', 'Machine row', 'back', ['biceps'], 'machine'),
  e('straight-arm-pulldown', 'Pulldown a braccia tese', 'Straight-arm pulldown', 'back', [], 'cable'),
  e('deadlift', 'Stacco da terra', 'Deadlift', 'back', ['glutes', 'hamstrings', 'quads'], 'barbell'),
  e('back-extension', 'Hyperextension', 'Back extension', 'back', ['glutes', 'hamstrings'], 'bodyweight', 'bodyweight'),
  e('db-shrug', 'Scrollate con manubri', 'Dumbbell shrug', 'back', [], 'dumbbell'),

  // Spalle
  e('overhead-press', 'Military press con bilanciere', 'Overhead press', 'shoulders', ['triceps'], 'barbell'),
  e('db-shoulder-press', 'Lento avanti con manubri', 'Dumbbell shoulder press', 'shoulders', ['triceps'], 'dumbbell'),
  e('machine-shoulder-press', 'Shoulder press', 'Shoulder press machine', 'shoulders', ['triceps'], 'machine'),
  e('arnold-press', 'Arnold press', 'Arnold press', 'shoulders', ['triceps'], 'dumbbell'),
  e('lateral-raise', 'Alzate laterali con manubri', 'Lateral raise', 'shoulders', [], 'dumbbell'),
  e('cable-lateral-raise', 'Alzate laterali ai cavi', 'Cable lateral raise', 'shoulders', [], 'cable'),
  e('machine-lateral-raise', 'Alzate laterali alla macchina', 'Machine lateral raise', 'shoulders', [], 'machine'),
  e('front-raise', 'Alzate frontali', 'Front raise', 'shoulders', [], 'dumbbell'),
  e('rear-delt-fly', 'Alzate posteriori con manubri', 'Rear delt fly', 'shoulders', ['back'], 'dumbbell'),
  e('reverse-pec-deck', 'Reverse pec deck', 'Reverse pec deck', 'shoulders', ['back'], 'machine'),
  e('face-pull', 'Face pull', 'Face pull', 'shoulders', ['back'], 'cable'),
  e('upright-row', 'Tirate al mento', 'Upright row', 'shoulders', ['back'], 'barbell'),

  // Bicipiti
  e('barbell-curl', 'Curl con bilanciere', 'Barbell curl', 'biceps', ['forearms'], 'barbell'),
  e('ez-curl', 'Curl con bilanciere EZ', 'EZ bar curl', 'biceps', ['forearms'], 'barbell'),
  e('db-curl', 'Curl con manubri', 'Dumbbell curl', 'biceps', ['forearms'], 'dumbbell'),
  e('hammer-curl', 'Curl a martello', 'Hammer curl', 'biceps', ['forearms'], 'dumbbell'),
  e('incline-db-curl', 'Curl su panca inclinata', 'Incline dumbbell curl', 'biceps', [], 'dumbbell'),
  e('preacher-curl', 'Curl alla panca Scott', 'Preacher curl', 'biceps', [], 'barbell'),
  e('cable-curl', 'Curl ai cavi', 'Cable curl', 'biceps', [], 'cable'),
  e('concentration-curl', 'Curl di concentrazione', 'Concentration curl', 'biceps', [], 'dumbbell'),

  // Tricipiti
  e('triceps-pushdown', 'Pushdown ai cavi', 'Triceps pushdown', 'triceps', [], 'cable'),
  e('rope-pushdown', 'Pushdown con corda', 'Rope pushdown', 'triceps', [], 'cable'),
  e('overhead-cable-extension', 'Estensioni sopra la testa ai cavi', 'Overhead cable extension', 'triceps', [], 'cable'),
  e('skull-crusher', 'French press con bilanciere EZ', 'Skull crusher', 'triceps', [], 'barbell'),
  e('db-overhead-extension', 'Estensioni sopra la testa con manubrio', 'Dumbbell overhead extension', 'triceps', [], 'dumbbell'),
  e('close-grip-bench', 'Panca presa stretta', 'Close-grip bench press', 'triceps', ['chest'], 'barbell'),
  e('triceps-dip', 'Dip alle parallele', 'Dip', 'triceps', ['chest', 'shoulders'], 'bodyweight', 'bodyweight'),
  e('bench-dip', 'Dip su panca', 'Bench dip', 'triceps', [], 'bodyweight', 'bodyweight'),
  e('db-kickback', 'Kickback con manubrio', 'Triceps kickback', 'triceps', [], 'dumbbell'),

  // Avambracci
  e('wrist-curl', 'Curl di polso', 'Wrist curl', 'forearms', [], 'dumbbell'),
  e('reverse-curl', 'Curl a presa prona', 'Reverse curl', 'forearms', ['biceps'], 'barbell'),

  // Quadricipiti
  e('back-squat', 'Squat con bilanciere', 'Back squat', 'quads', ['glutes', 'hamstrings'], 'barbell'),
  e('front-squat', 'Front squat', 'Front squat', 'quads', ['glutes'], 'barbell'),
  e('smith-squat', 'Squat al multipower', 'Smith squat', 'quads', ['glutes'], 'smith'),
  e('hack-squat', 'Hack squat', 'Hack squat', 'quads', ['glutes'], 'machine'),
  e('pendulum-squat', 'Pendulum squat', 'Pendulum squat', 'quads', ['glutes'], 'machine'),
  e('leg-press', 'Leg press', 'Leg press', 'quads', ['glutes', 'hamstrings'], 'machine'),
  e('goblet-squat', 'Goblet squat', 'Goblet squat', 'quads', ['glutes'], 'dumbbell'),
  e('bulgarian-split-squat', 'Squat bulgaro', 'Bulgarian split squat', 'quads', ['glutes'], 'dumbbell'),
  e('walking-lunge', 'Affondi camminati con manubri', 'Walking lunge', 'quads', ['glutes'], 'dumbbell'),
  e('reverse-lunge', 'Affondi indietro', 'Reverse lunge', 'quads', ['glutes'], 'dumbbell'),
  e('step-up', 'Step-up con manubri', 'Step-up', 'quads', ['glutes'], 'dumbbell'),
  e('leg-extension', 'Leg extension', 'Leg extension', 'quads', [], 'machine'),
  e('hip-adduction', 'Adductor machine', 'Hip adduction', 'quads', [], 'machine'),

  // Femorali
  e('romanian-deadlift', 'Stacco rumeno con bilanciere', 'Romanian deadlift', 'hamstrings', ['glutes', 'back'], 'barbell'),
  e('db-romanian-deadlift', 'Stacco rumeno con manubri', 'Dumbbell Romanian deadlift', 'hamstrings', ['glutes'], 'dumbbell'),
  e('stiff-leg-deadlift', 'Stacco a gambe tese', 'Stiff-leg deadlift', 'hamstrings', ['glutes', 'back'], 'barbell'),
  e('lying-leg-curl', 'Leg curl sdraiato', 'Lying leg curl', 'hamstrings', [], 'machine'),
  e('seated-leg-curl', 'Leg curl seduto', 'Seated leg curl', 'hamstrings', [], 'machine'),
  e('good-morning', 'Good morning', 'Good morning', 'hamstrings', ['back', 'glutes'], 'barbell'),
  e('nordic-curl', 'Nordic curl', 'Nordic curl', 'hamstrings', [], 'bodyweight', 'bodyweight'),

  // Glutei
  e('hip-thrust', 'Hip thrust con bilanciere', 'Hip thrust', 'glutes', ['hamstrings'], 'barbell'),
  e('machine-hip-thrust', 'Hip thrust alla macchina', 'Machine hip thrust', 'glutes', ['hamstrings'], 'machine'),
  e('glute-bridge', 'Ponte glutei', 'Glute bridge', 'glutes', ['hamstrings'], 'bodyweight', 'bodyweight'),
  e('cable-kickback', 'Slanci ai cavi', 'Cable kickback', 'glutes', [], 'cable'),
  e('hip-abduction', 'Abductor machine', 'Hip abduction', 'glutes', [], 'machine'),
  e('sumo-deadlift', 'Stacco sumo', 'Sumo deadlift', 'glutes', ['quads', 'hamstrings', 'back'], 'barbell'),
  e('kettlebell-swing', 'Kettlebell swing', 'Kettlebell swing', 'glutes', ['hamstrings'], 'kettlebell'),

  // Polpacci
  e('standing-calf-raise', 'Calf in piedi', 'Standing calf raise', 'calves', [], 'machine'),
  e('seated-calf-raise', 'Calf seduto', 'Seated calf raise', 'calves', [], 'machine'),
  e('leg-press-calf-raise', 'Calf alla leg press', 'Leg press calf raise', 'calves', [], 'machine'),
  e('smith-calf-raise', 'Calf al multipower', 'Smith calf raise', 'calves', [], 'smith'),

  // Addome
  e('crunch', 'Crunch', 'Crunch', 'abs', [], 'bodyweight', 'bodyweight'),
  e('cable-crunch', 'Crunch ai cavi', 'Cable crunch', 'abs', [], 'cable'),
  e('machine-crunch', 'Crunch alla macchina', 'Ab crunch machine', 'abs', [], 'machine'),
  e('hanging-leg-raise', 'Leg raise alla sbarra', 'Hanging leg raise', 'abs', [], 'bodyweight', 'bodyweight'),
  e('lying-leg-raise', 'Leg raise a terra', 'Lying leg raise', 'abs', [], 'bodyweight', 'bodyweight'),
  e('russian-twist', 'Russian twist', 'Russian twist', 'abs', [], 'bodyweight', 'bodyweight'),
  e('ab-wheel', 'Ab wheel', 'Ab wheel', 'abs', [], 'other', 'bodyweight'),
  e('pallof-press', 'Pallof press', 'Pallof press', 'abs', [], 'cable'),
  e('plank', 'Plank', 'Plank', 'abs', [], 'bodyweight', 'time'),
  e('side-plank', 'Plank laterale', 'Side plank', 'abs', [], 'bodyweight', 'time'),
];
