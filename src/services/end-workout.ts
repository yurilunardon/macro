import type { SQLiteDatabase } from 'expo-sqlite';

import { confirmDestructive } from '@/components/prompt';
import { deleteWorkout, finishWorkout, getWorkout } from '@/db/workouts';
import { countLabel } from '@/lib/format';

import { haptics } from './haptics';
import { restTimer } from './rest-timer';

/**
 * Ends a workout, from its screen or from the card of the workout in progress. Asks first when
 * something would be lost (sets not ticked) or, with `confirm`, always. A workout with nothing
 * ticked is offered to be cancelled instead. Resolves to what happened, null if called off.
 */
export async function endWorkout(
  db: SQLiteDatabase,
  workoutId: number,
  { confirm = false }: { confirm?: boolean } = {},
): Promise<'finished' | 'cancelled' | null> {
  const workout = await getWorkout(db, workoutId);
  if (!workout) return null;
  const sets = workout.exercises.flatMap((e) => e.sets);
  const done = sets.filter((s) => s.done).length;
  if (done === 0) {
    const cancel = await confirmDestructive({
      title: 'Nessuna serie completata',
      message: 'Non c’è niente da salvare.',
      action: 'Annulla allenamento',
    });
    if (!cancel) return null;
    await deleteWorkout(db, workoutId);
    restTimer.stop();
    return 'cancelled';
  }
  const pending = sets.length - done;
  if (pending > 0 || confirm) {
    const ok = await confirmDestructive({
      title: 'Terminare l’allenamento?',
      message:
        pending > 0
          ? `${pending === 1 ? '1 serie non completata non verrà salvata' : `${pending} serie non completate non verranno salvate`}.`
          : `${countLabel(done, 'serie completata', 'serie completate')}.`,
      action: 'Termina allenamento',
    });
    if (!ok) return null;
  }
  await finishWorkout(db, workoutId);
  restTimer.stop();
  haptics.success();
  return 'finished';
}
