import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 112;
/** About the length of the tick below, a little over so no dot is left at its start. */
const TICK_LENGTH = 66;
const CALM = Easing.bezier(0.33, 0, 0.2, 1);

/**
 * "Fatto": a green circle opens in the middle of the screen, a tick is drawn in it, and after a
 * moment both give way to the recap. It eases into place, without bouncing, and takes no touches.
 */
export function FinishTick() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const circle = useSharedValue(0);
  const tick = useSharedValue(0);
  const away = useSharedValue(0);
  useEffect(() => {
    circle.set(withTiming(1, { duration: reduced ? 1 : 340, easing: CALM }));
    tick.set(withDelay(reduced ? 0 : 200, withTiming(1, { duration: reduced ? 1 : 340, easing: CALM })));
    away.set(withSequence(withDelay(800, withTiming(1, { duration: 260, easing: Easing.in(Easing.quad) }))));
  }, [circle, tick, away, reduced]);
  const circleStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, circle.get() * 1.6) * (1 - away.get()),
    transform: [{ scale: 0.7 + 0.3 * circle.get() + 0.08 * away.get() }],
  }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - tick.get()) }));
  return (
    <View pointerEvents="none" style={styles.slot} accessible accessibilityLabel="Allenamento finito">
      <Animated.View style={[styles.circle, { backgroundColor: theme.accent }, circleStyle]}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 112 112">
          <AnimatedPath
            d="M34 58 L50 74 L80 40"
            stroke={theme.onAccent}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={`${TICK_LENGTH} ${TICK_LENGTH}`}
            animatedProps={tickProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
});
