import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

type ExpandingRingsProps = {
  /** The size of what they come out of: they go behind it, in a view of that size. */
  size: number;
  color: string;
  count?: number;
  /** How many times its size they grow to. */
  reach?: number;
  thickness?: number;
  /** When the first one starts, and how far apart the others follow. */
  delay?: number;
  stagger?: number;
  ms?: number;
};

/** Thin circles widening from something just done and fading out, as a stone in water. Once, on mount. */
export function ExpandingRings({ size, color, count = 2, reach = 2.6, thickness = 2, delay = 0, stagger = 140, ms = 600 }: ExpandingRingsProps) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={[styles.slot, { width: size, height: size }]}>
      {Array.from({ length: count }, (_, index) => (
        <Ring key={index} size={size} color={color} reach={reach} thickness={thickness} delay={delay + index * stagger} ms={ms} />
      ))}
    </View>
  );
}

function Ring({ size, color, reach, thickness, delay, ms }: { size: number; color: string; reach: number; thickness: number; delay: number; ms: number }) {
  const grown = useSharedValue(0);
  useEffect(() => {
    grown.set(withDelay(delay, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) })));
  }, [grown, delay, ms]);
  const style = useAnimatedStyle(() => {
    const g = grown.get();
    return { opacity: g === 0 ? 0 : 0.9 * (1 - g), transform: [{ scale: 0.7 + (reach - 0.7) * g }] };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: thickness, borderColor: color }, style]} />;
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, top: 0 },
});
