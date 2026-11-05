import type { SFSymbol } from 'expo-symbols';
import { memo, useEffect, useMemo, useState, type ComponentRef, type RefObject } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { useAgenda } from '@/hooks/use-agenda';
import type { ScrollTop } from '@/hooks/use-scroll-top';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { useTheme } from '@/hooks/use-theme';
import { volleyClashes } from '@/lib/calendar';
import { dayInMonth, formatLongDate, formatMonth, monthAt, monthGrid, monthGridWeeks, monthNumber, monthOf, monthWeeks, type DateKey, type MonthKey } from '@/lib/dates';
import { useIsHovered } from '@/services/calendar-drag';

import { AppText } from './app-text';
import { Icon } from './icon';
import { EASE_OUT, project } from './motion';
import { usePinnedBar } from './pinned-strip';
import { activityName } from './plan-day';
import { DayCircle } from './week-strip';

const ROW = 56;
const HEADER = 44;
const LETTERS = 20;
/** For what is dragged over the days: the height of a row, and where the rows begin. */
export const DAY_ROW = ROW;
export const MONTH_ROWS_TOP = HEADER + LETTERS;
const CIRCLE = 36;
const COVER = 240;
const MOST_WEEKS = 6;
const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

/**
 * How far up what is under the grid goes for this month. The grid always has room for six weeks, so
 * the page never changes size as months turn; what follows is moved instead, which costs no layout.
 */
export function monthGridLift(month: MonthKey): number {
  return -(MOST_WEEKS - monthWeeks(monthNumber(month))) * ROW;
}

/** The month on screen, for what is dragged over its days. */
export type MonthGeometry = { pinnedRow: SharedValue<number>; weeks: SharedValue<number>; gridTop: SharedValue<number> };

type MonthGridProps = {
  selected: DateKey;
  today: DateKey;
  scroll: ScrollTop;
  /** Each new value makes the selected day's circle beat once. */
  pulse: number;
  /** Written here, on the UI thread: how far up to draw what is under the grid. */
  lift: SharedValue<number>;
  geometry: MonthGeometry;
  /** The grid, to be measured on screen. */
  view?: RefObject<ComponentRef<typeof View> | null>;
  onSelect: (day: DateKey) => void;
  /** -1 for the month before, 1 for the next. */
  onChangeMonth: (direction: number) => void;
};

/**
 * The month of the selected day as in Calendar, with the months on either side beside it: dragging,
 * they come in with the finger, as the days do in the food diary. As the page scrolls the month goes
 * away and the week of the selected day stays at the top, with its weekdays.
 *
 * The months stand side by side for good and only the row of them moves, so one coming to rest never
 * has to be swapped with another, which is where a flash would come from.
 */
export function MonthGrid({ selected, today, scroll, pulse, lift, geometry, view, onSelect, onChangeMonth }: MonthGridProps) {
  const { width: windowWidth } = useWindowDimensions();
  const month = monthOf(selected);
  const current = monthNumber(month);
  const [origin] = useState(current);

  const bar = usePinnedBar();
  const { gridTop } = geometry;
  useEffect(() => {
    const weeks = monthGridWeeks(month);
    geometry.weeks.set(weeks.length);
    geometry.pinnedRow.set(Math.max(0, weeks.findIndex((week) => week.includes(selected))));
  }, [geometry, month, selected]);

  /** How far the row of months has gone from `origin`: in points, so a spring settles as finely as anywhere else. */
  const x = useSharedValue(0);
  /** The month it is on or going to. */
  const aim = useSharedValue(current);

  useEffect(() => {
    if (aim.get() === current) return;
    // Another way than by dragging: an arrow, a day from another month, "Oggi". From afar it still
    // comes in from beside it.
    const to = (current - origin) * windowWidth;
    if (Math.abs(to - x.get()) > windowWidth) x.set(to - Math.sign(to - x.get()) * windowWidth);
    aim.set(current);
    x.set(withTiming(to, { duration: 320, easing: EASE_OUT }));
  }, [aim, x, current, origin, windowWidth]);

  useAnimatedReaction(
    () => {
      const at = origin + x.get() / windowWidth;
      const before = Math.floor(at);
      const part = at - before;
      return monthWeeks(before) * (1 - part) + monthWeeks(before + 1) * part;
    },
    (weeks) => lift.set(-(MOST_WEEKS - weeks) * ROW),
  );

  const change = useStableCallback((direction: number) => onChangeMonth(direction));
  const startAt = useSharedValue(0);
  // A drag that ends on the day it began on, which came along with the finger, is not a tap on it.
  const dragged = useSharedValue(false);
  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onBegin: () => {
      'worklet';
      dragged.set(false);
    },
    onActivate: () => {
      'worklet';
      dragged.set(true);
      startAt.set(x.get());
    },
    onUpdate: (event) => {
      'worklet';
      // Only the months on either side are there.
      const here = (aim.get() - origin) * windowWidth;
      x.set(Math.min(here + windowWidth, Math.max(here - windowWidth, startAt.get() - event.translationX)));
    },
    onDeactivate: (event) => {
      'worklet';
      // Where it is on screen, plus where the flick would take it.
      const projected = x.get() - (aim.get() - origin) * windowWidth - project(event.velocityX, 0.99);
      const direction = !event.canceled && Math.abs(projected) > windowWidth * 0.25 ? Math.sign(projected) : 0;
      if (direction !== 0) {
        aim.set(aim.get() + direction);
        scheduleOnRN(change, direction);
      }
      x.set(withSpring((aim.get() - origin) * windowWidth, { duration: 380, dampingRatio: 1, velocity: -event.velocityX }));
    },
  });
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: -x.get() }] }));

  const select = useStableCallback((day: DateKey) => {
    if (!dragged.get()) onSelect(day);
  });
  const dayOf = (number: number) => (number === current ? selected : dayInMonth(selected, number - current, today));

  return (
    <View ref={view} collapsable={false} style={styles.grid} onLayout={(event) => gridTop.set(event.nativeEvent.layout.y)}>
      <GestureDetector gesture={pan} touchAction="pan-y">
        {/* Where a short month leaves room, the touch goes to what is under it. */}
        <View style={styles.months} pointerEvents="box-none">
          <Animated.View style={[StyleSheet.absoluteFill, row]} pointerEvents="box-none">
            {[current - 1, current, current + 1].map((number) => (
              <MonthPage
                key={number}
                month={monthAt(number)}
                selected={dayOf(number)}
                onScreen={number === current}
                left={(number - origin) * windowWidth}
                width={windowWidth - Spacing.lg * 2}
                today={today}
                pulse={pulse}
                offset={scroll.offset}
                bar={bar}
                gridTop={gridTop}
                onSelect={select}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.arrows}>
        <Pressable onPress={() => onChangeMonth(-1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Mese precedente" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
        </Pressable>
        <Pressable onPress={() => onChangeMonth(1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Mese successivo" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
        </Pressable>
      </View>
    </View>
  );
}

/** What each day of a month holds: the symbol of its main activity, and its name for VoiceOver. */
function useMonthSymbols(month: MonthKey, today: DateKey) {
  const days = monthGrid(month);
  const { data: calendar, agenda, types } = useAgenda(days[0], days[days.length - 1], today);
  return useMemo(() => {
    const gymTypeId = calendar?.gymTypeId ?? null;
    const dayNames = calendar?.dayNames ?? new Map<number, string>();
    const symbols = new Map<DateKey, { symbol: SFSymbol; label: string; warn?: boolean }>();
    const clashes = new Set(calendar ? volleyClashes(agenda, calendar.kinds, today, types).map((c) => c.date) : []);
    for (const [day, items] of agenda) {
      const first = items.find((i) => i.kind === 'workout' || i.status !== 'skipped');
      if (!first) continue;
      const typeId = first.kind === 'workout' ? gymTypeId : first.occurrence.typeId;
      const type = typeId === null ? undefined : types.get(typeId);
      const label = activityName(first, types, gymTypeId, dayNames);
      symbols.set(day, clashes.has(day) ? { symbol: 'exclamationmark.triangle.fill', label: `${label}, allenamento da spostare`, warn: true } : { symbol: (type?.symbol ?? 'dumbbell.fill') as SFSymbol, label });
    }
    return symbols;
  }, [agenda, calendar, types, today]);
}

const MonthPage = memo(function MonthPage({
  month,
  selected,
  onScreen,
  left,
  width,
  today,
  pulse,
  offset,
  bar,
  gridTop,
  onSelect,
}: {
  month: MonthKey;
  selected: DateKey;
  /** The ones on either side are out of VoiceOver's way. */
  onScreen: boolean;
  left: number;
  width: number;
  today: DateKey;
  pulse: number;
  offset: SharedValue<number>;
  bar: SharedValue<number>;
  gridTop: SharedValue<number>;
  onSelect: (day: DateKey) => void;
}) {
  const theme = useTheme();
  const symbols = useMonthSymbols(month, today);
  const weeks = monthGridWeeks(month);
  const pinnedWeek = weeks.findIndex((week) => week.includes(selected));

  // Each month has its week ready to stay at the top, so turning months with the page scrolled the
  // week beside comes in with the finger too.
  const pinnedRow = useSharedValue(pinnedWeek);
  useEffect(() => {
    pinnedRow.set(pinnedWeek);
  }, [pinnedRow, pinnedWeek]);
  const pinned = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, offset.get() + bar.get() - (gridTop.get() + HEADER + LETTERS + pinnedRow.get() * ROW)) }],
  }));
  // Only once pinned: before, they would hide the rows above it.
  const whenPinned = useAnimatedStyle(() => ({
    opacity: offset.get() + bar.get() - (gridTop.get() + HEADER + LETTERS + pinnedRow.get() * ROW) > 0 ? 1 : 0,
  }));

  // On the first drawing the selected day's circle is simply there; afterwards it comes in.
  const [firstSelected] = useState(selected);
  const [appear, setAppear] = useState(false);
  if (!appear && selected !== firstSelected) setAppear(true);

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
    const symbol = symbols.get(day);
    return (
      <DayCell
        key={day}
        day={day}
        inMonth={monthOf(day) === month}
        isSelected={day === selected}
        isToday={day === today}
        symbol={symbol?.symbol}
        label={symbol?.label}
        warn={symbol?.warn === true}
        pulse={pulse}
        appear={appear}
        onSelect={onSelect}
      />
    );
  };

  return (
    <View
      style={[styles.page, { left, width }]}
      pointerEvents="box-none"
      accessibilityElementsHidden={!onScreen}
      importantForAccessibility={onScreen ? 'auto' : 'no-hide-descendants'}>
      <View style={styles.header}>
        <AppText variant="title2" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {formatMonth(month)}
        </AppText>
      </View>
      {letters}
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
    </View>
  );
});

/** One day: drawn again only when something of its own changes, not at each day picked. */
const DayCell = memo(function DayCell({
  day,
  inMonth,
  isSelected,
  isToday,
  symbol,
  label,
  warn,
  pulse,
  appear,
  onSelect,
}: {
  day: DateKey;
  inMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
  symbol: SFSymbol | undefined;
  label: string | undefined;
  /** A workout to move, because of volleyball. */
  warn: boolean;
  pulse: number;
  appear: boolean;
  onSelect: (day: DateKey) => void;
}) {
  const theme = useTheme();
  const hovered = useIsHovered(day);
  return (
    <Pressable
      onPress={() => onSelect(day)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, label].filter(Boolean).join(', ')}
      style={styles.cell}>
      <View style={styles.slot}>
        {hovered ? <View style={[styles.hover, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]} /> : null}
        {isSelected ? <DayCircle selected color={isToday ? theme.accent : theme.text} pulse={pulse} appear={appear} /> : null}
        <AppText
          numeric
          maxFontSizeMultiplier={1.3}
          style={[styles.number, { color: isSelected ? (isToday ? theme.onAccent : theme.background) : isToday ? theme.accent : inMonth ? theme.text : theme.textTertiary }]}>
          {String(Number(day.slice(8)))}
        </AppText>
      </View>
      <View style={[styles.symbol, !inMonth && styles.faded]}>{symbol ? <Icon name={symbol} size={13} tone={warn ? 'warning' : 'textSecondary'} /> : null}</View>
    </Pressable>
  );
}, (a, b) =>
  a.day === b.day &&
  a.inMonth === b.inMonth &&
  a.isSelected === b.isSelected &&
  a.isToday === b.isToday &&
  a.symbol === b.symbol &&
  a.label === b.label &&
  a.warn === b.warn &&
  a.onSelect === b.onSelect &&
  // These two matter only to the day with the circle, or about to have it.
  (!(a.isSelected || b.isSelected) || (a.pulse === b.pulse && a.appear === b.appear)),
);

const styles = StyleSheet.create({
  // Over the pages under it, when its selected week stays at the top.
  grid: { zIndex: 1, marginBottom: Spacing.sm },
  months: { height: HEADER + LETTERS + MOST_WEEKS * ROW },
  page: { position: 'absolute', top: 0 },
  header: { height: HEADER, justifyContent: 'center', paddingLeft: Spacing.xs, paddingRight: 88 },
  arrows: { position: 'absolute', top: 0, right: 0, flexDirection: 'row' },
  arrow: { width: 44, height: HEADER, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  letters: { flexDirection: 'row', height: LETTERS, alignItems: 'center' },
  letter: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', height: ROW, alignItems: 'center' },
  pinned: { zIndex: 1, marginHorizontal: -Spacing.lg, paddingHorizontal: Spacing.lg },
  cover: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: COVER, paddingHorizontal: Spacing.lg, justifyContent: 'flex-end' },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.lg },
  cell: { flex: 1, alignItems: 'center', gap: 1 },
  slot: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  hover: { ...StyleSheet.absoluteFill, borderRadius: CIRCLE / 2, borderWidth: 2 },
  number: { fontSize: 16, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  symbol: { height: 15, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.4 },
});
