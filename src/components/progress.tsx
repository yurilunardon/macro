import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  css,
  cubicBezier,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
const FILL_EASING = cubicBezier(0.23, 1, 0.32, 1);

type ProgressBarProps = { value: number; target: number; color: string; height?: number };

/** Fills up to the target and stays full past it, in its own colour: being over is said beside it. */
export function ProgressBar({ value, target, color, height = 6 }: ProgressBarProps) {
  const theme = useTheme();
  const r = ratio(value, target);
  return (
    <View style={[styles.track, { height, backgroundColor: theme.track }]}>
      <Animated.View
        style={[
          styles.fill,
          transitions.fill,
          { width: `${Math.min(1, r) * 100}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

type CalorieRingProps = { eaten: number; target: number; size?: number };

/**
 * Ring filled by eaten / target, with the calories left in the middle. Its colour says how
 * close the day is to the goal; it fills and changes colour smoothly when food is added or the
 * day changes.
 */
export function CalorieRing({ eaten, target, size = 176 }: CalorieRingProps) {
  const theme = useTheme();
  // The day's main number: a big ring, with a stroke that grows with it.
  const stroke = Math.round(size * 0.09);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const r = ratio(eaten, target);
  const { kcal: left, over } = remainingKcal(eaten, target);
  const tones = RING_TONES.map((tone) => theme[tone]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(r, { duration: 700, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [progress, r]);

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

// The bars grow to their new length instead of jumping, e.g. after adding food.
const transitions = css.create({
  fill: { transitionProperty: 'width', transitionDuration: 500, transitionTimingFunction: FILL_EASING },
});

const styles = StyleSheet.create({
  track: { width: '100%', borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 2 },
  ringNumber: { fontSize: 36, lineHeight: 42, letterSpacing: -0.5 },
});
