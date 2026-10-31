import { Easing, type SharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

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

/** Swells a little and settles back, once: the "here it is" of Calendar's Today. */
export function beat(scale: SharedValue<number>): void {
  scale.set(withSequence(withTiming(1.22, { duration: 160, easing: EASE_OUT }), withSpring(1, { duration: 420, dampingRatio: 0.5 })));
}
