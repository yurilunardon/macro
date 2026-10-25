/** Intermittent fasting: a fast runs from `start` until it is ended, with a goal in hours. */

export type Fast = { id: number; start: string; end: string | null; goalHours: number };

export const FASTING_GOALS = [12, 14, 16, 18, 20, 24] as const;

export type FastStatus = {
  elapsedHours: number;
  /** 0…1 towards the goal, more than 1 once passed. */
  progress: number;
  goalReached: boolean;
  /** When the goal is (or was) reached. */
  goalAt: Date;
};

export function fastStatus(fast: Pick<Fast, 'start' | 'end' | 'goalHours'>, now: Date = new Date()): FastStatus {
  const start = new Date(fast.start).getTime();
  const end = fast.end ? new Date(fast.end).getTime() : now.getTime();
  const elapsedHours = Math.max(0, (end - start) / 3_600_000);
  return {
    elapsedHours,
    progress: fast.goalHours > 0 ? elapsedHours / fast.goalHours : 0,
    goalReached: elapsedHours >= fast.goalHours,
    goalAt: new Date(start + fast.goalHours * 3_600_000),
  };
}

/** "15 h 42 min", or "42 min" under an hour. */
export function formatHours(hours: number): string {
  const totalMinutes = Math.floor(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
