/**
 * Ring colour along the way to the goal, as stops on eaten / target: red while far from it,
 * orange closer, green on target, red again when well over. In between the colours blend.
 */
export const RING_STOPS = [0, 0.5, 0.75, 0.9, 1.1, 1.25];
export const RING_TONES = ['ringFar', 'ringFar', 'ringCloser', 'ringOnTarget', 'ringOnTarget', 'ringFar'] as const;

/** "1.360 kcal rimanenti" style summary of what is left, or how much is over. */
export function remainingKcal(eaten: number, target: number): { kcal: number; over: boolean } {
  const remaining = target - eaten;
  return { kcal: Math.abs(remaining), over: remaining < 0 };
}

/**
 * Fibre goal from the day's calories: 14 g every 1000 kcal, as in the US dietary guidelines,
 * and never below the 25 g a day EFSA considers adequate for adults.
 */
export function fiberTarget(kcal: number): number {
  return Math.max(25, Math.round((kcal / 1000) * 14));
}
