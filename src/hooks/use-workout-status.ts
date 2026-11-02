import { useLiveQuery } from '@/db/live';
import { getActiveWorkout, getWorkout } from '@/db/workouts';
import { formatDuration, workoutProgress } from '@/lib/training';
import { useRestTimer } from '@/services/rest-timer';
import { useWorkoutStarting } from '@/services/start-workout';

import { useClock } from './use-clock';

export type WorkoutStatus = {
  /** The time since it started; the rest left during a rest; "Vai!" once that is over. */
  time: string;
  /** From 0 to 1: the sets done, or the rest left. */
  progress: number;
  resting: boolean;
};

/**
 * The workout in progress as the tab bar shows it, or null without one. It waits for the workout's
 * sheet to cover the bar when a workout starts.
 */
export function useWorkoutStatus(): WorkoutStatus | null {
  const starting = useWorkoutStarting();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  const id = active?.id ?? null;
  const { data: workout } = useLiveQuery(`workout-status:${id}`, (database) => (id === null ? Promise.resolve(null) : getWorkout(database, id)), ['training']);
  const rest = useRestTimer();
  const now = useClock(1000, id !== null && !starting);
  if (!active || starting) return null;
  const resting = rest !== null && rest.endsAt > now;
  if (rest !== null && !resting) return { time: 'Vai!', progress: 1, resting: false };
  if (resting) {
    const left = (rest.endsAt - now) / 1000;
    return { time: formatDuration(left), progress: left / rest.total, resting: true };
  }
  const { done, total } = workoutProgress(workout?.exercises ?? []);
  return { time: formatDuration((now - new Date(active.startedAt).getTime()) / 1000), progress: total > 0 ? done / total : 0, resting: false };
}
