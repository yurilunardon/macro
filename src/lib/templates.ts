/**
 * Ready-made programs built on common, well-tested splits. Each exercise is given as sets × a
 * rep range (double progression), with the rest in seconds.
 */
export type TemplateExercise = { ref: string; sets: number; repMin: number; repMax: number; rest: number };
export type TemplateDay = { name: string; exercises: TemplateExercise[] };
export type ProgramTemplate = { key: string; name: string; description: string; days: TemplateDay[] };

const x = (ref: string, sets: number, repMin: number, repMax: number, rest: number): TemplateExercise => ({
  ref,
  sets,
  repMin,
  repMax,
  rest,
});

export const PROGRAM_TEMPLATES: readonly ProgramTemplate[] = [
  {
    key: 'ppl',
    name: 'Push Pull Legs',
    description: 'Spinta, tirata e gambe a rotazione: 3 giorni a settimana, o 6 per allenare tutto due volte.',
    days: [
      {
        name: 'Push',
        exercises: [
          x('bench-press', 3, 6, 10, 180),
          x('incline-db-press', 3, 8, 12, 120),
          x('db-shoulder-press', 3, 8, 12, 120),
          x('lateral-raise', 3, 12, 15, 90),
          x('rope-pushdown', 3, 10, 15, 90),
          x('overhead-cable-extension', 2, 10, 15, 90),
        ],
      },
      {
        name: 'Pull',
        exercises: [
          x('lat-pulldown', 3, 8, 12, 120),
          x('db-row', 3, 8, 12, 120),
          x('seated-cable-row', 3, 10, 12, 120),
          x('face-pull', 3, 12, 15, 90),
          x('db-curl', 3, 8, 12, 90),
          x('hammer-curl', 2, 10, 12, 90),
        ],
      },
      {
        name: 'Legs',
        exercises: [
          x('back-squat', 3, 6, 10, 180),
          x('romanian-deadlift', 3, 8, 10, 150),
          x('leg-press', 3, 10, 12, 120),
          x('lying-leg-curl', 3, 10, 12, 90),
          x('standing-calf-raise', 3, 10, 15, 90),
          x('cable-crunch', 3, 10, 15, 60),
        ],
      },
    ],
  },
  {
    key: 'upper-lower',
    name: 'Upper Lower',
    description: 'Parte alta e parte bassa alternate, 4 giorni a settimana: ogni muscolo due volte.',
    days: [
      {
        name: 'Upper A',
        exercises: [
          x('bench-press', 3, 6, 10, 180),
          x('barbell-row', 3, 6, 10, 150),
          x('db-shoulder-press', 3, 8, 12, 120),
          x('lat-pulldown', 3, 8, 12, 120),
          x('db-curl', 2, 10, 12, 90),
          x('rope-pushdown', 2, 10, 15, 90),
        ],
      },
      {
        name: 'Lower A',
        exercises: [
          x('back-squat', 3, 6, 10, 180),
          x('romanian-deadlift', 3, 8, 10, 150),
          x('leg-extension', 3, 10, 15, 90),
          x('lying-leg-curl', 3, 10, 12, 90),
          x('standing-calf-raise', 3, 10, 15, 90),
        ],
      },
      {
        name: 'Upper B',
        exercises: [
          x('incline-db-press', 3, 8, 12, 120),
          x('pull-up', 3, 6, 10, 150),
          x('machine-chest-press', 2, 10, 12, 120),
          x('seated-cable-row', 3, 10, 12, 120),
          x('lateral-raise', 3, 12, 15, 90),
          x('hammer-curl', 2, 10, 12, 90),
        ],
      },
      {
        name: 'Lower B',
        exercises: [
          x('leg-press', 3, 10, 12, 150),
          x('hip-thrust', 3, 8, 12, 120),
          x('bulgarian-split-squat', 2, 8, 12, 120),
          x('seated-leg-curl', 3, 10, 12, 90),
          x('hanging-leg-raise', 3, 8, 15, 60),
        ],
      },
    ],
  },
  {
    key: 'full-body',
    name: 'Full body',
    description: 'Tutto il corpo in ogni seduta, 2 o 3 volte a settimana: il più semplice per ripartire.',
    days: [
      {
        name: 'Full body A',
        exercises: [
          x('back-squat', 3, 6, 10, 180),
          x('bench-press', 3, 6, 10, 180),
          x('lat-pulldown', 3, 8, 12, 120),
          x('romanian-deadlift', 2, 8, 10, 150),
          x('lateral-raise', 2, 12, 15, 90),
          x('plank', 2, 30, 60, 60),
        ],
      },
      {
        name: 'Full body B',
        exercises: [
          x('leg-press', 3, 10, 12, 150),
          x('db-shoulder-press', 3, 8, 12, 120),
          x('db-row', 3, 8, 12, 120),
          x('lying-leg-curl', 2, 10, 12, 90),
          x('db-curl', 2, 10, 12, 90),
          x('rope-pushdown', 2, 10, 15, 90),
        ],
      },
    ],
  },
];
