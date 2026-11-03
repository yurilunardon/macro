import { Easing, type SharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

/** The numbers of a day changing when a food is added or removed: a slow, even movement. */
export const SMOOTH_MS = 900;

/** Strong ease-out for things entering, leaving or settling. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Where a flick would come to rest if it kept slowing down: Apple's exponential decay. 0.998 is
 * UIScrollView's normal deceleration, 0.99 its "fast" one used for paging.
 */
export function project(velocity: number, rate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Past an edge, the further it is dragged the less it follows the finger. */
export function rubberband(overshoot: number, dimension: number): number {
  'worklet';
  const constant = 0.55;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Starts and ends at rest, so the swell has no sudden start or stop. */
const SWELL = Easing.bezier(0.37, 0, 0.63, 1);

/**
 * Swells a little and settles back, once: the "here it is" of Calendar's Today. It eases in and
 * back with hardly any overshoot: a sharp rise and a loose spring looked like a jerk.
 */
export function beat(scale: SharedValue<number>): void {
  scale.set(withSequence(withTiming(1.14, { duration: 280, easing: SWELL }), withSpring(1, { duration: 620, dampingRatio: 0.85 })));
}
