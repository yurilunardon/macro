import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle } from 'react-native-svg';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { remainingKcal, RING_STOPS, RING_TONES } from '@/lib/calories';
import { formatKcal } from '@/lib/format';

import { AppText } from './app-text';

/** 0…1, or more than 1 when over target. Zero targets count as no progress. */
export function ratio(value: number, target: number): number {
  return target > 0 ? Math.max(0, value / target) : 0;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const FILL_EASING = Easing.bezier(0.23, 1, 0.32, 1);

type ProgressBarProps = {
  value: number;
  target: number;
  color: string;
  height?: number;
  /** A slow, even change instead of the quick one, e.g. while the day is emptied. */
  slowMs?: number;
};

/** Fills up to the target and stays full past it, in its own colour: being over is said beside it. */
export function ProgressBar({ value, target, color, height = 6, slowMs }: ProgressBarProps) {
  const theme = useTheme();
  const r = Math.min(1, ratio(value, target));
  const shown = useSharedValue(r);
  const width = useSharedValue(0);
  const reached = useRef(r);
  useEffect(() => {
    if (reached.current === r) return;
    reached.current = r;
    shown.set(withTiming(r, slowMs ? { duration: slowMs, easing: Easing.inOut(Easing.cubic) } : { duration: 500, easing: FILL_EASING }));
  }, [shown, r, slowMs]);
  // It slides in from the left rather than changing its width: with a width, the whole screen was
  // laid out again at every frame, for as long as the bar moved.
  const fill = useAnimatedStyle(() => ({
    opacity: width.get() > 0 ? 1 : 0,
    transform: [{ translateX: (shown.get() - 1) * width.get() }],
  }));
  return (
    <View onLayout={(event) => width.set(event.nativeEvent.layout.width)} style={[styles.track, { height, backgroundColor: theme.track }]}>
      <Animated.View style={[styles.fill, { backgroundColor: color }, fill]} />
    </View>
  );
}

type CalorieRingProps = {
  eaten: number;
  target: number;
  size?: number;
  /**
   * Empties or fills slowly and evenly over this long, the number in the middle counting along,
   * e.g. while the day's foods are taken away.
   */
  slowMs?: number;
};

/**
 * Ring filled by eaten / target, with the calories left in the middle. Its colour says how
 * close the day is to the goal; it fills and changes colour smoothly when food is added or the
 * day changes.
 */
export function CalorieRing({ eaten, target, size = 176, slowMs }: CalorieRingProps) {
  const theme = useTheme();
  // The day's main number: a big ring, with a stroke that grows with it.
  const stroke = Math.round(size * 0.09);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const r = ratio(eaten, target);
  const tones = RING_TONES.map((tone) => theme[tone]);

  const progress = useSharedValue(0);
  const counting = useSharedValue(false);
  const [counted, setCounted] = useState<number | null>(null);
  // Only the day's numbers changing moves it: a day becoming the one on screen changes nothing.
  const reached = useRef<number | null>(null);
  useEffect(() => {
    if (reached.current === r) return;
    const changed = reached.current !== null;
    reached.current = r;
    if (changed && slowMs) {
      counting.set(true);
      progress.set(
        withTiming(r, { duration: slowMs, easing: Easing.inOut(Easing.cubic) }, (finished) => {
          'worklet';
          if (finished) counting.set(false);
        }),
      );
    } else {
      counting.set(false);
      progress.set(withTiming(r, { duration: 700, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    }
  }, [progress, counting, r, slowMs]);

  // While it changes slowly the number follows the ring, instead of jumping to the end at once.
  useAnimatedReaction(
    () => (counting.get() ? Math.round(progress.get() * target) : null),
    (now, before) => {
      if (now !== before) scheduleOnRN(setCounted, now);
    },
    [target],
  );
  // Always from the whole calories eaten: rounding what is left instead gave a number one away from
  // the one counted.
  const { kcal: left, over } = remainingKcal(counted ?? Math.round(eaten), target);

  const ringProps = useAnimatedProps(() => {
    const p = progress.get();
    return {
      strokeDashoffset: circumference * (1 - Math.min(1, p)),
      stroke: interpolateColor(p, RING_STOPS, tones, 'HSV'),
      // A ring with nothing in it would still draw the round cap as a dot.
      strokeOpacity: p > 0.002 ? 1 : 0,
    };
  });

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={`${formatKcal(eaten)} chilocalorie su ${formatKcal(target)}: ${
        over ? `${formatKcal(left)} oltre l'obiettivo` : `ne mancano ${formatKcal(left)}`
      }`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={ringProps}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <AppText variant="title" numeric tone={over ? 'danger' : 'text'} style={styles.ringNumber}>
          {formatKcal(left)}
        </AppText>
        <AppText variant="footnote" tone="textSecondary">
          {over ? 'kcal in più' : 'kcal rimaste'}
        </AppText>
      </View>
    </View>
  );
}

/**
 * A number that counts to its new value over `ms` instead of jumping. Without `ms` it just shows it,
 * as on the days kept ready beside the one on screen.
 */
export function useCountedNumber(value: number, ms?: number): number {
  const shown = useSharedValue(value);
  const [counted, setCounted] = useState(Math.round(value));
  const reached = useRef(value);
  useEffect(() => {
    if (reached.current === value) return;
    reached.current = value;
    shown.set(ms ? withTiming(value, { duration: ms, easing: Easing.inOut(Easing.cubic) }) : value);
  }, [shown, value, ms]);
  useAnimatedReaction(
    () => Math.round(shown.get()),
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(setCounted, now);
    },
  );
  return counted;
}

const styles = StyleSheet.create({
  track: { width: '100%', borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { width: '100%', height: '100%', borderRadius: Radius.pill },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 2 },
  ringNumber: { fontSize: 38, lineHeight: 44, letterSpacing: -0.5 },
});
