import { normalizeSearch } from './search';

export type Muscle =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

export const MUSCLES: readonly { key: Muscle; label: string }[] = [
  { key: 'chest', label: 'Petto' },
  { key: 'back', label: 'Dorso' },
  { key: 'shoulders', label: 'Spalle' },
  { key: 'biceps', label: 'Bicipiti' },
  { key: 'triceps', label: 'Tricipiti' },
  { key: 'forearms', label: 'Avambracci' },
  { key: 'quads', label: 'Quadricipiti' },
  { key: 'hamstrings', label: 'Femorali' },
  { key: 'glutes', label: 'Glutei' },
  { key: 'calves', label: 'Polpacci' },
  { key: 'abs', label: 'Addome' },
];

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'smith'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'other';

export const EQUIPMENT: readonly { key: Equipment; label: string }[] = [
  { key: 'barbell', label: 'Bilanciere' },
  { key: 'dumbbell', label: 'Manubri' },
  { key: 'machine', label: 'Macchina' },
  { key: 'cable', label: 'Cavi' },
  { key: 'smith', label: 'Multipower' },
  { key: 'bodyweight', label: 'Corpo libero' },
  { key: 'kettlebell', label: 'Kettlebell' },
  { key: 'band', label: 'Elastici' },
  { key: 'other', label: 'Altro' },
];

/** kg × reps; reps with optional added weight; or a hold in seconds (plank). */
export type ExerciseKind = 'weight' | 'bodyweight' | 'time';

export function isMuscle(value: unknown): value is Muscle {
  return MUSCLES.some((m) => m.key === value);
}

export function isEquipment(value: unknown): value is Equipment {
  return EQUIPMENT.some((e) => e.key === value);
}

export function muscleLabel(key: Muscle): string {
  return MUSCLES.find((m) => m.key === key)?.label ?? key;
}

export function equipmentLabel(key: Equipment): string {
  return EQUIPMENT.find((e) => e.key === key)?.label ?? key;
}

/**
 * The smallest jump in load that is usually available: 2.5 kg on a bar (1.25 per side), the
 * next pair of dumbbells, one plate on a stack.
 */
export function loadIncrement(equipment: Equipment): number {
  switch (equipment) {
    case 'dumbbell':
      return 2;
    case 'kettlebell':
      return 4;
    case 'machine':
      return 5;
    default:
      return 2.5;
  }
}

/** Default rest: longer for heavy compound lifts, shorter for small muscles. */
export function defaultRestSeconds(muscle: Muscle, equipment: Equipment): number {
  const small = muscle === 'biceps' || muscle === 'triceps' || muscle === 'forearms' || muscle === 'calves' || muscle === 'abs';
  if (small) return 90;
  return equipment === 'barbell' || equipment === 'smith' ? 180 : 120;
}

/** Normalised like foods, so an exercise is found by either name, muscle or equipment. */
export function exerciseSearchText(name: string, nameEn: string | null, muscle: Muscle, equipment: Equipment): string {
  return normalizeSearch(`${name} ${nameEn ?? ''} ${muscleLabel(muscle)} ${equipmentLabel(equipment)}`);
}

/** Which name of an exercise comes first: most are called in English in the gym. */
export type NameLanguage = 'en' | 'it';

/**
 * The name to show and, when the exercise has both, the other one underneath. Custom exercises
 * have only the name they were given.
 */
export function exerciseNames(
  exercise: { name: string; nameEn: string | null },
  language: NameLanguage,
): { title: string; subtitle: string | null } {
  if (!exercise.nameEn || exercise.nameEn === exercise.name) return { title: exercise.name, subtitle: null };
  return language === 'en'
    ? { title: exercise.nameEn, subtitle: exercise.name }
    : { title: exercise.name, subtitle: exercise.nameEn };
}
