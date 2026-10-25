import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { getDayPlans } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { calorieStatus } from '@/lib/calories';
import { formatLongDate, formatWeekdayInitial, weekOf, type DateKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';

import { AppText } from './app-text';
import { EASE_OUT, project } from './motion';

const RING = 40;
const STROKE = 3;
const DOT = 32;

const STATUS_TONE = { far: 'ringFar', closer: 'ringCloser', onTarget: 'ringOnTarget', over: 'ringFar' } as const;

type WeekStripProps = {
  selected: DateKey;
  today: DateKey;
  onSelect: (day: DateKey) => void;
  /** Swiping the strip moves a week back (-1) or forward (1). */
  onChangeWeek: (direction: number) => void;
};

/**
 * The week of the selected day, Monday to Sunday, as in Calendar and Fitness: each day has a
 * small calorie ring, and the dark circle of the selected day slides to the one tapped.
 */
export function WeekStrip({ selected, today, onSelect, onChangeWeek }: WeekStripProps) {
  const theme = useTheme();
  const days = weekOf(selected);
  const weekStart = days[0];
  const { data } = useLiveQuery(`week:${weekStart}`, async (database) => {
    const [totals, plans] = await Promise.all([getDailyTotals(database, days[0], days[6]), getDayPlans(database, days)]);
    return { kcal: new Map(totals.map((t) => [t.date, t.kcal])), plans };
  });

  const [width, setWidth] = useState(0);
  const cell = width / 7;
  const index = days.indexOf(selected);

  // The circle slides within a week and jumps when the week changes.
  const dotX = useSharedValue(0);
  const shownWeek = useRef(weekStart);
  useEffect(() => {
    if (cell === 0) return;
    const x = index * cell + (cell - DOT) / 2;
    if (shownWeek.current === weekStart) dotX.set(withSpring(x, { duration: 380, dampingRatio: 0.9 }));
    else dotX.set(x);
    shownWeek.current = weekStart;
  }, [cell, dotX, index, weekStart]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dotX.get() }] }));

  // Swiping the strip turns the week; the strip follows the finger like the days below.
  const stripX = useSharedValue(0);
  const turn = (direction: number) => {
    onChangeWeek(direction);
    stripX.set(direction * width * 0.4);
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
      if (!event.canceled && Math.abs(projected) > width * 0.25) {
        const direction = projected < 0 ? 1 : -1;
        stripX.set(
          withTiming(-direction * width, { duration: 160, easing: EASE_OUT }, (finished) => {
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

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={styles.clip} onLayout={onLayout}>
        <Animated.View style={stripStyle}>
          <Animated.View
            pointerEvents="none"
            style={[styles.dot, { backgroundColor: theme.text, top: styles.label.height + 4 + (RING - DOT) / 2 }, dotStyle]}
          />
          <View style={styles.row}>
            {days.map((day) => {
              const isSelected = day === selected;
              const isToday = day === today;
              const kcal = data?.kcal.get(day) ?? 0;
              const target = data?.plans.get(day)?.targets.kcal ?? 0;
              const progress = target > 0 ? Math.min(1, kcal / target) : 0;
              const tone = STATUS_TONE[calorieStatus(kcal, target)];
              const radius = (RING - STROKE) / 2;
              const circumference = 2 * Math.PI * radius;
              return (
                <Pressable
                  key={day}
                  onPress={() => onSelect(day)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${formatLongDate(day)}${isToday ? ', oggi' : ''}, ${formatKcal(kcal)} kcal`}
                  style={styles.cell}>
                  <AppText
                    variant="caption"
                    weight="600"
                    tone={isToday ? 'accent' : 'textSecondary'}
                    align="center"
                    style={styles.label}>
                    {formatWeekdayInitial(day)}
                  </AppText>
                  <View style={styles.ring}>
                    <Svg width={RING} height={RING}>
                      <Circle cx={RING / 2} cy={RING / 2} r={radius} stroke={theme.track} strokeWidth={STROKE} fill="none" />
                      {kcal > 0 ? (
                        <Circle
                          cx={RING / 2}
                          cy={RING / 2}
                          r={radius}
                          stroke={theme[tone]}
                          strokeWidth={STROKE}
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray={`${circumference} ${circumference}`}
                          strokeDashoffset={circumference * (1 - progress)}
                          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                        />
                      ) : null}
                    </Svg>
                    <View style={styles.number} pointerEvents="none">
                      <AppText
                        variant="callout"
                        weight={isSelected || isToday ? '700' : '500'}
                        numeric
                        style={{ color: isSelected ? theme.background : isToday ? theme.accent : theme.text }}>
                        {String(Number(day.slice(8)))}
                      </AppText>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', marginBottom: Spacing.md },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 },
  label: { height: 16 },
  ring: { width: RING, height: RING },
  number: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', left: 0, width: DOT, height: DOT, borderRadius: DOT / 2 },
});
