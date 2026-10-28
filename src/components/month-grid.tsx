import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useTheme } from '@/hooks/use-theme';
import type { ActivityColor, ActivityType, AgendaItem } from '@/lib/calendar';
import { formatLongDate, formatMonth, monthGrid, monthOf, type DateKey, type MonthKey } from '@/lib/dates';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Icon } from './icon';
import { EASE_OUT, project } from './motion';

const CIRCLE = 34;
const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

type MonthGridProps = {
  month: MonthKey;
  selected: DateKey;
  today: DateKey;
  agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>;
  types: ReadonlyMap<number, ActivityType>;
  gymTypeId: number | null;
  onSelect: (day: DateKey) => void;
  /** -1 for the month before, 1 for the next. */
  onChangeMonth: (direction: number) => void;
};

/** One dot per kind of activity on a day, up to three: full once done, a ring while still to do. */
function dotsFor(items: readonly AgendaItem[] | undefined, types: ReadonlyMap<number, ActivityType>, gymTypeId: number | null) {
  const dots: { color: ActivityColor; done: boolean }[] = [];
  for (const item of items ?? []) {
    if (item.kind === 'activity' && item.status === 'skipped') continue;
    const typeId = item.kind === 'workout' ? gymTypeId : item.occurrence.typeId;
    const type = typeId === null ? undefined : types.get(typeId);
    if (!type) continue;
    const done = item.kind === 'workout' || item.status === 'done';
    const same = dots.find((d) => d.color === type.color);
    if (same) same.done = same.done || done;
    else dots.push({ color: type.color, done });
  }
  return dots.slice(0, 3);
}

/**
 * A month as in Calendar: six weeks, Monday first, the selected day in a filled circle (green
 * when it is today) and under each day a dot for each kind of activity. Swiping it, or the
 * arrows, turn the month.
 */
export function MonthGrid({ month, selected, today, agenda, types, gymTypeId, onSelect, onChangeMonth }: MonthGridProps) {
  const theme = useTheme();
  const colors = useActivityColors();
  const days = monthGrid(month);

  const gridX = useSharedValue(0);
  const width = useSharedValue(0);
  const turn = (direction: number) => {
    haptics.selection();
    onChangeMonth(direction);
    gridX.set(direction * width.get() * 0.3);
    gridX.set(withSpring(0, { duration: 420, dampingRatio: 1 }));
  };
  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      gridX.set(event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      const projected = event.translationX + project(event.velocityX, 0.99);
      if (!event.canceled && Math.abs(projected) > width.get() * 0.25) {
        const direction = projected < 0 ? 1 : -1;
        gridX.set(
          withTiming(-direction * width.get(), { duration: 160, easing: EASE_OUT }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(turn, direction);
          }),
        );
        return;
      }
      gridX.set(withSpring(0, { duration: 380, dampingRatio: 0.9, velocity: event.velocityX }));
    },
  });
  const gridStyle = useAnimatedStyle(() => ({ transform: [{ translateX: gridX.get() }] }));

  return (
    <View style={[styles.card, { backgroundColor: theme.card }]}>
      <View style={styles.header}>
        <AppText variant="title2" style={styles.flex} accessibilityRole="header">
          {formatMonth(month)}
        </AppText>
        <Pressable
          onPress={() => turn(-1)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Mese precedente"
          style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
        </Pressable>
        <Pressable
          onPress={() => turn(1)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Mese successivo"
          style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((letter, i) => (
          <AppText key={i} variant="caption" weight="600" tone={i >= 5 ? 'textTertiary' : 'textSecondary'} style={styles.weekday}>
            {letter}
          </AppText>
        ))}
      </View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <View style={styles.clip} onLayout={(event) => width.set(event.nativeEvent.layout.width)}>
          <Animated.View style={[styles.grid, gridStyle]}>
            {days.map((day) => {
              const inMonth = monthOf(day) === month;
              const isSelected = day === selected;
              const isToday = day === today;
              const dots = dotsFor(agenda.get(day), types, gymTypeId);
              const numberColor = isSelected
                ? isToday
                  ? theme.onAccent
                  : theme.background
                : isToday
                  ? theme.accent
                  : inMonth
                    ? theme.text
                    : theme.textTertiary;
              const names = (agenda.get(day) ?? [])
                .filter((i) => i.kind === 'workout' || i.status !== 'skipped')
                .map((i) => (i.kind === 'workout' ? i.workout.name : types.get(i.occurrence.typeId)?.name))
                .filter(Boolean);
              return (
                <Pressable
                  key={day}
                  onPress={() => onSelect(day)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, ...names].filter(Boolean).join(', ')}
                  style={styles.cell}>
                  <View
                    style={[
                      styles.circle,
                      isSelected && { backgroundColor: isToday ? theme.accent : theme.text },
                    ]}>
                    <AppText numeric style={[styles.number, { color: numberColor }, isToday && styles.bold]}>
                      {String(Number(day.slice(8)))}
                    </AppText>
                  </View>
                  <View style={styles.dots}>
                    {dots.map((dot) => (
                      <View
                        key={dot.color}
                        style={[
                          styles.dot,
                          dot.done
                            ? { backgroundColor: colors[dot.color] }
                            : { borderWidth: 1.5, borderColor: colors[dot.color] },
                          !inMonth && styles.faded,
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 22, borderCurve: 'continuous', paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.lg, paddingRight: Spacing.xs },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  week: { flexDirection: 'row', paddingHorizontal: Spacing.xs, marginTop: Spacing.xs },
  weekday: { flex: 1, textAlign: 'center' },
  clip: { overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.xs },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingTop: 6, height: 50 },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  number: { fontSize: 17, lineHeight: 22 },
  bold: { fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  faded: { opacity: 0.4 },
});
