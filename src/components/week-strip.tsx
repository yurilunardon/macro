import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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

const CIRCLE = 36;
const SHOW = FadeIn.duration(160);
const HIDE = FadeOut.duration(120);

const STATUS_TONE = { far: 'ringFar', closer: 'ringCloser', onTarget: 'ringOnTarget', over: 'ringFar' } as const;

type WeekStripProps = {
  selected: DateKey;
  today: DateKey;
  onSelect: (day: DateKey) => void;
  /** Swiping the strip moves a week back (-1) or forward (1). */
  onChangeWeek: (direction: number) => void;
};

/**
 * The week of the selected day, Monday to Sunday, as in Calendar: the selected day in a filled
 * circle (green when it is today), and under each day with food a dot in the colour of its
 * calorie ring.
 */
export function WeekStrip({ selected, today, onSelect, onChangeWeek }: WeekStripProps) {
  const theme = useTheme();
  const days = weekOf(selected);
  const { data } = useLiveQuery(`week:${days[0]}`, async (database) => {
    const [totals, plans] = await Promise.all([getDailyTotals(database, days[0], days[6]), getDayPlans(database, days)]);
    return { kcal: new Map(totals.map((t) => [t.date, t.kcal])), plans };
  });

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
            const kcal = data?.kcal.get(day) ?? 0;
            const target = data?.plans.get(day)?.targets.kcal ?? 0;
            const tone = STATUS_TONE[calorieStatus(kcal, target)];
            const numberColor = isSelected ? (isToday ? theme.onAccent : theme.background) : isToday ? theme.accent : theme.text;
            return (
              <Pressable
                key={day}
                onPress={() => onSelect(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${formatLongDate(day)}${isToday ? ', oggi' : ''}${kcal > 0 ? `, ${formatKcal(kcal)} kcal` : ''}`}
                style={styles.cell}>
                <AppText variant="caption" weight="600" tone={isToday ? 'accent' : 'textSecondary'}>
                  {formatWeekdayInitial(day)}
                </AppText>
                <View style={styles.slot}>
                  {isSelected ? (
                    <Animated.View
                      entering={SHOW}
                      exiting={HIDE}
                      style={[styles.circle, { backgroundColor: isToday ? theme.accent : theme.text }]}
                    />
                  ) : null}
                  <AppText variant="callout" weight={isSelected || isToday ? '700' : '500'} numeric style={{ color: numberColor }}>
                    {String(Number(day.slice(8)))}
                  </AppText>
                </View>
                <View style={[styles.dot, { backgroundColor: kcal > 0 ? theme[tone] : 'transparent' }]} />
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', marginBottom: Spacing.lg },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', gap: 6 },
  slot: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  circle: { ...StyleSheet.absoluteFill, borderRadius: CIRCLE / 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
