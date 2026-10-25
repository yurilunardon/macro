import { Easing } from 'react-native-reanimated';

/** Strong ease-out for things entering, leaving or settling. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Where a flick would come to rest if it kept slowing down: Apple's exponential decay. */
export function project(velocity: number): number {
  'worklet';
  const rate = 0.998;
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Past an edge, the further it is dragged the less it follows the finger. */
export function rubberband(overshoot: number, dimension: number): number {
  'worklet';
  const constant = 0.55;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
