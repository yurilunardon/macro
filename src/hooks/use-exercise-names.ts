import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { exerciseNames, type NameLanguage } from '@/lib/exercises';

/** Names of exercises in the language chosen in the library (English first by default). */
export function useExerciseNames(): {
  language: NameLanguage;
  names: (exercise: { name: string; nameEn: string | null }) => { title: string; subtitle: string | null };
} {
  const { data } = useLiveQuery('exercise-names', (database) => getSetting(database, 'exerciseNames'));
  const language: NameLanguage = data ?? 'en';
  return { language, names: (exercise) => exerciseNames(exercise, language) };
}
