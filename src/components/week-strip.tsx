import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useEffect, useRef } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate, formatWeekdayInitial, weekOf, type DateKey } from '@/lib/dates';

import { AppText } from './app-text';
import { beat, EASE_OUT, project } from './motion';

const CIRCLE = 36;
// Grows from a little over half its size with a slight overshoot, so the new day is plain to see.
const CIRCLE_SPRING = { duration: 460, dampingRatio: 0.7 };

/** What a day holds, as a dot under it: its colour, and for VoiceOver what it stands for. */
export type DayMark = { color: string; label: string };

type WeekStripProps = {
  selected: DateKey;
  today: DateKey;
  onSelect: (day: DateKey) => void;
  /** Swiping the strip moves a week back (-1) or forward (1). */
  onChangeWeek: (direction: number) => void;
  marks: ReadonlyMap<DateKey, DayMark>;
  /** Each new value makes the selected day's circle beat once, to show where it is. */
  pulse?: number;
};

/**
 * The week of the selected day, Monday to Sunday, as in Calendar: the selected day in a filled
 * circle (green when it is today), and under a day its mark, if it has one.
 */
export function WeekStrip({ selected, today, onSelect, onChangeWeek, marks, pulse = 0 }: WeekStripProps) {
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
            const mark = marks.get(day);
            return (
              <Pressable
                key={day}
                onPress={() => onSelect(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, mark?.label].filter(Boolean).join(', ')}
                style={styles.cell}>
                <AppText variant="caption" weight="600" tone={isToday ? 'accent' : 'textSecondary'} maxFontSizeMultiplier={1.3}>
                  {formatWeekdayInitial(day)}
                </AppText>
                <View style={styles.slot}>
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
                <View style={[styles.dot, { backgroundColor: mark?.color ?? 'transparent' }]} />
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
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
  cell: { flex: 1, alignItems: 'center', gap: 6 },
  slot: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  circle: { ...StyleSheet.absoluteFill, borderRadius: CIRCLE / 2 },
  number: { fontSize: 16, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
