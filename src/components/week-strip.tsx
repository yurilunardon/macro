import type { SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useEffect, useRef } from 'react';
import Animated, { Easing, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RING_STOPS, RING_TONES } from '@/lib/calories';
import { formatLongDate, formatWeekdayInitial, weekOf, type DateKey } from '@/lib/dates';

import { AppText } from './app-text';
import { Icon } from './icon';
import { beat, EASE_OUT, project } from './motion';

/** The day's number with room for a ring round it, and the circle of the selected day inside that. */
const SLOT = 42;
const CIRCLE = 32;
const RING_WIDTH = 3;
const RING_RADIUS = (SLOT - RING_WIDTH) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
// Grows from a little over half its size with a slight overshoot, so the new day is plain to see.
const CIRCLE_SPRING = { duration: 460, dampingRatio: 0.7 };

/** How far along a day is, from 0 to 1, and for VoiceOver what that stands for. */
export type DayProgress = {
  progress: number;
  label: string;
  /** A slow, even change instead of the quick one, e.g. while the day is emptied. */
  slowMs?: number;
};
/** What a day holds, and for VoiceOver its name. */
export type DaySymbol = { symbol: SFSymbol; label: string };

type WeekStripProps = {
  selected: DateKey;
  today: DateKey;
  onSelect: (day: DateKey) => void;
  /** Swiping the strip moves a week back (-1) or forward (1). */
  onChangeWeek: (direction: number) => void;
  /** How much: a ring round every day, as the week in Fitness. */
  rings?: ReadonlyMap<DateKey, DayProgress>;
  /** What: a small symbol under the days that have one, whose place is kept under the others. */
  symbols?: ReadonlyMap<DateKey, DaySymbol>;
  /** Each new value makes the selected day's circle beat once, to show where it is. */
  pulse?: number;
};

/**
 * The week of the selected day, Monday to Sunday, as in Calendar: the selected day in a filled
 * circle (green when it is today). A ring says how much, a symbol says what, so the two cannot be
 * taken for each other as two dots of different meaning were.
 */
export function WeekStrip({ selected, today, onSelect, onChangeWeek, rings, symbols, pulse = 0 }: WeekStripProps) {
  const theme = useTheme();
  const days = weekOf(selected);

  // Swiping the strip turns the week: it follows the finger, then the new week slides in.
  const stripX = useSharedValue(0);
  const width = useSharedValue(0);
  const turn = (direction: number) => {
    onChangeWeek(direction);
    stripX.set(direction * width.get() * 0.4);
    stripX.set(withSpring(0, { duration: 420, dampingRatio: 1 }));
  };
  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      stripX.set(event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      const projected = event.translationX + project(event.velocityX, 0.99);
      if (!event.canceled && Math.abs(projected) > width.get() * 0.25) {
        const direction = projected < 0 ? 1 : -1;
        stripX.set(
          withTiming(-direction * width.get(), { duration: 160, easing: EASE_OUT }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(turn, direction);
          }),
        );
        return;
      }
      stripX.set(withSpring(0, { duration: 380, dampingRatio: 0.9, velocity: event.velocityX }));
    },
  });
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.get() }] }));

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={styles.clip} onLayout={(event) => width.set(event.nativeEvent.layout.width)}>
        <Animated.View style={[styles.row, stripStyle]}>
          {days.map((day) => {
            const isSelected = day === selected;
            const isToday = day === today;
            const ring = rings?.get(day);
            const symbol = symbols?.get(day);
            return (
              <Pressable
                key={day}
                onPress={() => onSelect(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, ring?.label, symbol?.label].filter(Boolean).join(', ')}
                style={styles.cell}>
                <AppText variant="caption" weight="600" tone={isToday ? 'accent' : 'textSecondary'} maxFontSizeMultiplier={1.3}>
                  {formatWeekdayInitial(day)}
                </AppText>
                <View style={styles.slot}>
                  {rings ? <DayRing progress={ring?.progress ?? 0} slowMs={ring?.slowMs} /> : null}
                  <DayCircle selected={isSelected} color={isToday ? theme.accent : theme.text} pulse={pulse} />
                  <AppText
                    numeric
                    // The number lives in a fixed circle, as in Calendar: it grows only so far.
                    maxFontSizeMultiplier={1.3}
                    style={[
                      styles.number,
                      { color: isSelected ? (isToday ? theme.onAccent : theme.background) : isToday ? theme.accent : theme.text },
                    ]}>
                    {String(Number(day.slice(8)))}
                  </AppText>
                </View>
                {symbols ? <View style={styles.symbol}>{symbol ? <Icon name={symbol.symbol} size={15} tone="textSecondary" /> : null}</View> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * How far along the day is: a thin ring round it, in the colours of the day's big ring, red far
 * from the goal and green on it, and moving as that one does when food is added or taken away.
 */
function DayRing({ progress, slowMs }: { progress: number; slowMs?: number }) {
  const theme = useTheme();
  const center = SLOT / 2;
  const tones = RING_TONES.map((tone) => theme[tone]);
  const shown = useSharedValue(progress);
  useEffect(() => {
    shown.set(withTiming(progress, slowMs ? { duration: slowMs, easing: Easing.inOut(Easing.cubic) } : { duration: 700, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [shown, progress, slowMs]);
  const ringProps = useAnimatedProps(() => {
    const p = shown.get();
    return {
      strokeDashoffset: RING_LENGTH * (1 - Math.min(1, p)),
      stroke: interpolateColor(p, RING_STOPS, tones, 'HSV'),
      // A ring with nothing in it would still draw the round cap as a dot.
      strokeOpacity: p > 0.002 ? 1 : 0,
    };
  });
  return (
    <View pointerEvents="none" style={styles.ring}>
      <Svg width={SLOT} height={SLOT}>
        <Circle cx={center} cy={center} r={RING_RADIUS} stroke={theme.track} strokeWidth={RING_WIDTH} fill="none" />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={RING_RADIUS}
          strokeWidth={RING_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
          fill="none"
          transform={`rotate(-90 ${center} ${center})`}
          animatedProps={ringProps}
        />
      </Svg>
    </View>
  );
}

/**
 * The circle behind the selected day, as in Calendar: it does not travel from the old day, it
 * just appears on the new one, growing a touch into place.
 */
function DayCircle({ selected, color, pulse }: { selected: boolean; color: string; pulse: number }) {
  const visible = useSharedValue(selected ? 1 : 0);
  const scale = useSharedValue(1);
  const first = useRef(true);
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === lastPulse.current) return;
    lastPulse.current = pulse;
    if (selected) beat(scale);
  }, [pulse, selected, scale]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (selected) {
      visible.set(0.4);
      visible.set(withTiming(1, { duration: 140 }));
      scale.set(0.6);
      scale.set(withSpring(1, CIRCLE_SPRING));
    } else {
      visible.set(0);
    }
  }, [selected, visible, scale]);
  const style = useAnimatedStyle(() => ({ opacity: visible.get(), transform: [{ scale: scale.get() }] }));
  return <Animated.View pointerEvents="none" style={[styles.circle, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', marginBottom: Spacing.sm },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  slot: { width: SLOT, height: SLOT, alignItems: 'center', justifyContent: 'center' },
  ring: { ...StyleSheet.absoluteFill },
  circle: { position: 'absolute', width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2 },
  number: { fontSize: 16, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  symbol: { height: 16, alignItems: 'center', justifyContent: 'center' },
});
