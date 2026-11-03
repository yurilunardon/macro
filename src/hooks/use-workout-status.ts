import { useLiveQuery } from '@/db/live';
import { getActiveWorkout, getWorkout, type WorkoutExercise } from '@/db/workouts';
import { formatDuration, workoutProgress } from '@/lib/training';
import { useRestTimer } from '@/services/rest-timer';
import { useWorkoutStarting } from '@/services/start-workout';

import { useClock } from './use-clock';

export type WorkoutStatus = {
  name: string;
  /** The time since it started; the rest left during a rest; "Vai!" once that is over. */
  time: string;
  resting: boolean;
  /** The rest is over, waiting for the next set. */
  ready: boolean;
  /** Sets ticked, and how many there are. */
  done: number;
  total: number;
  /** The exercise of the set to do now. */
  current: WorkoutExercise | null;
};

/**
 * The workout in progress, ticking every second, or null without one. It waits for the workout's
 * sheet to cover the page when a workout starts.
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
  const ready = rest !== null && !resting;
  const exercises = workout?.exercises ?? [];
  const progress = workoutProgress(exercises);
  return {
    name: active.name,
    time: ready ? 'Vai!' : formatDuration((resting ? rest.endsAt - now : now - new Date(active.startedAt).getTime()) / 1000),
    resting,
    ready,
    done: progress.done,
    total: progress.total,
    current: progress.current ? (exercises[progress.current.exercise] ?? null) : null,
  };
}
