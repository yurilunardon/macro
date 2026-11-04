import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import type { ScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate, formatMonth, monthGrid, monthOf, type DateKey, type MonthKey } from '@/lib/dates';

import { AppText } from './app-text';
import { Icon } from './icon';
import { EASE_OUT, project } from './motion';
import { usePinnedBar } from './pinned-strip';
import { DayCircle, type DaySymbol } from './week-strip';

const ROW = 56;
const CIRCLE = 36;
const COVER = 240;
const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

type MonthGridProps = {
  month: MonthKey;
  selected: DateKey;
  today: DateKey;
  /** What each day holds, as a small symbol under it. */
  symbols: ReadonlyMap<DateKey, DaySymbol>;
  scroll: ScrollTop;
  /** Each new value makes the selected day's circle beat once. */
  pulse: number;
  onSelect: (day: DateKey) => void;
  /** -1 for the month before, 1 for the next. */
  onChangeMonth: (direction: number) => void;
};

/**
 * A month as in Calendar, Monday first, the selected day in a filled circle (green when it is
 * today) and under each day the symbol of what it holds. As the page scrolls the month goes away
 * and the week of the selected day stays at the top, with its weekdays. Swiping it, or the arrows,
 * turn the month.
 */
export function MonthGrid({ month, selected, today, symbols, scroll, pulse, onSelect, onChangeMonth }: MonthGridProps) {
  const theme = useTheme();
  const days = monthGrid(month);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)).filter((week) => week.some((day) => monthOf(day) === month));
  const pinnedWeek = weeks.findIndex((week) => week.includes(selected));

  // Where the selected week is on the page: the grid, its rows in it, the row in them.
  const bar = usePinnedBar();
  const { offset } = scroll;
  const gridTop = useSharedValue(0);
  const rowsTop = useSharedValue(0);
  const pinnedRow = useSharedValue(pinnedWeek);
  useEffect(() => {
    pinnedRow.set(pinnedWeek);
  }, [pinnedRow, pinnedWeek]);
  const pinned = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, offset.get() + bar.get() - (gridTop.get() + rowsTop.get() + pinnedRow.get() * ROW)) }],
  }));
  // Only once pinned: before, they would hide the rows above it.
  const whenPinned = useAnimatedStyle(() => ({
    opacity: offset.get() + bar.get() - (gridTop.get() + rowsTop.get() + pinnedRow.get() * ROW) > 0 ? 1 : 0,
  }));

  const gridX = useSharedValue(0);
  const width = useSharedValue(0);
  const turn = (direction: number) => {
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

  const letters = (
    <View style={styles.letters}>
      {WEEKDAYS.map((letter, i) => (
        <AppText key={i} variant="caption" weight="600" tone="textSecondary" style={styles.letter} maxFontSizeMultiplier={1.3}>
          {letter}
        </AppText>
      ))}
    </View>
  );

  const cell = (day: DateKey) => {
    const inMonth = monthOf(day) === month;
    const isSelected = day === selected;
    const isToday = day === today;
    const symbol = symbols.get(day);
    return (
      <Pressable
        key={day}
        onPress={() => onSelect(day)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, symbol?.label].filter(Boolean).join(', ')}
        style={styles.cell}>
        <View style={styles.slot}>
          <DayCircle selected={isSelected} color={isToday ? theme.accent : theme.text} pulse={pulse} />
          <AppText
            numeric
            maxFontSizeMultiplier={1.3}
            style={[styles.number, { color: isSelected ? (isToday ? theme.onAccent : theme.background) : isToday ? theme.accent : inMonth ? theme.text : theme.textTertiary }]}>
            {String(Number(day.slice(8)))}
          </AppText>
        </View>
        <View style={[styles.symbol, !inMonth && styles.faded]}>{symbol ? <Icon name={symbol.symbol} size={13} tone="textSecondary" /> : null}</View>
      </Pressable>
    );
  };

  return (
    <View style={styles.grid} onLayout={(event) => gridTop.set(event.nativeEvent.layout.y)}>
      <View style={styles.header}>
        <AppText variant="title2" style={styles.flex} accessibilityRole="header">
          {formatMonth(month)}
        </AppText>
        <Pressable onPress={() => turn(-1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Mese precedente" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
        </Pressable>
        <Pressable onPress={() => turn(1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Mese successivo" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
        </Pressable>
      </View>
      {letters}
      <GestureDetector gesture={pan} touchAction="pan-y">
        <View onLayout={(event) => {
          rowsTop.set(event.nativeEvent.layout.y);
          width.set(event.nativeEvent.layout.width);
        }}>
          <Animated.View style={gridStyle}>
            {weeks.map((week, index) =>
              index === pinnedWeek ? (
                <Animated.View key={week[0]} style={[styles.pinned, { backgroundColor: theme.background }, pinned]}>
                  <Animated.View pointerEvents="none" style={[styles.cover, { backgroundColor: theme.background }, whenPinned]}>
                    {letters}
                  </Animated.View>
                  <View style={styles.row}>{week.map(cell)}</View>
                  <Animated.View style={[styles.rule, { backgroundColor: theme.separator }, whenPinned]} />
                </Animated.View>
              ) : (
                <View key={week[0]} style={styles.row}>
                  {week.map(cell)}
                </View>
              ),
            )}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Over the pages under it, when its selected week stays at the top.
  grid: { zIndex: 1, marginBottom: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.xs },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  letters: { flexDirection: 'row', height: 20, alignItems: 'center' },
  letter: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', height: ROW, alignItems: 'center' },
  pinned: { zIndex: 1, marginHorizontal: -Spacing.lg, paddingHorizontal: Spacing.lg },
  cover: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: COVER, paddingHorizontal: Spacing.lg, justifyContent: 'flex-end' },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.lg },
  cell: { flex: 1, alignItems: 'center', gap: 1 },
  slot: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  number: { fontSize: 16, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  symbol: { height: 15, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.4 },
});
