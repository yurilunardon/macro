import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Spacing } from '@/constants/theme';
import { addDays, daysBetween, type DateKey } from '@/lib/dates';
import { haptics } from '@/services/haptics';

/** Days kept in the pager on either side of the day the screen was opened on: two years. */
const RANGE = 730;

/** What a page needs from the pager. */
export type DayPageProps = {
  /** Only the day on screen gets menus and swipe actions; see DayPage. */
  interactive: boolean;
  /** Called by the page once its data is on screen. */
  onReady: (day: DateKey) => void;
};

/**
 * The days as pages of a native paging scroll view, as in Calendar and Photos: the system moves
 * them under the finger and can be flicked through as fast as the hand goes, with the day after
 * coming in as the finger goes. The pages around the one on screen are kept ready.
 *
 * `base` is the day in the middle of the list; a day picked far away is first drawn in the page
 * beside the current one, slid to like any neighbour, and then the list is renumbered around it
 * so that page stays where it is.
 */
export function useDayPager(today: DateKey, asked: DateKey | null = null, scrollToTop?: () => Promise<void>) {
  const { width } = useWindowDimensions();
  const [base, setBase] = useState(asked ?? today);
  const [incoming, setIncoming] = useState<{ index: number; date: DateKey } | null>(null);
  const days = useMemo(() => {
    const list = Array.from({ length: RANGE * 2 + 1 }, (_, i) => addDays(base, i - RANGE));
    if (incoming) list[incoming.index] = incoming.date;
    return list;
  }, [base, incoming]);
  const baseRef = useRef(base);
  const indexOf = (day: DateKey) => Math.min(RANGE * 2, Math.max(0, RANGE + daysBetween(baseRef.current, day)));
  const list = useRef<FlatList<DateKey>>(null);

  // null means "today", so the screen moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(asked !== null && asked !== today ? asked : null);
  const date = selected ?? today;
  const pick = (day: DateKey) => setSelected(day === today ? null : day);
  const shown = useRef(RANGE);

  // The day that gets menus and swipe actions: the one the pages have come to rest on, a moment
  // after they stop, so nothing is built while they move.
  const [interactiveDay, setInteractiveDay] = useState(date);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle = (day: DateKey) => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setInteractiveDay(day), 250);
  };
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // The pager is as tall as the day on screen, not as the longest day kept ready beside it.
  const heights = useRef(new Map<DateKey, number>());
  const [height, setHeight] = useState<number | undefined>(undefined);
  const dayAtShown = useRef(date);
  const onPageLayout = (day: DateKey, h: number) => {
    heights.current.set(day, h);
    if (day === dayAtShown.current) setHeight(h);
  };

  // A slide started by a tap: where it goes, and a day tapped meanwhile, taken next.
  const moving = useRef<{ index: number; date: DateKey } | null>(null);
  const queued = useRef<DateKey | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Waiting for a far day's page to have its data before sliding to it.
  const waiting = useRef<{ index: number; date: DateKey } | null>(null);

  const slide = (target: { index: number; date: DateKey }) => {
    waiting.current = null;
    moving.current = target;
    list.current?.scrollToIndex({ index: target.index, animated: true });
    // Should the end of the animation not be reported, finish anyway.
    clearTimeout(finishTimer.current);
    finishTimer.current = setTimeout(finishSlide, 700);
  };

  const finishSlide = () => {
    clearTimeout(finishTimer.current);
    const target = moving.current;
    if (!target) return;
    moving.current = null;
    shown.current = target.index;
    dayAtShown.current = target.date;
    // A far day sat in a neighbour's page: renumber the list so that page is that day for good.
    const expected = addDays(baseRef.current, target.index - RANGE);
    if (expected !== target.date) {
      const next = addDays(target.date, RANGE - target.index);
      baseRef.current = next;
      setBase(next);
      setIncoming(null);
    }
    const h = heights.current.get(target.date);
    if (h !== undefined) setHeight(h);
    settle(target.date);
    const next = queued.current;
    queued.current = null;
    if (next && next !== target.date) goTo(next);
  };

  // Picking a day above slides to it from the side it is on, near or far, as in Calendar: the
  // page going away and the one coming in move together.
  const goTo = (day: DateKey) => {
    if (moving.current || waiting.current) {
      queued.current = day;
      pick(day);
      return;
    }
    const distance = daysBetween(dayAtShown.current, day);
    if (distance === 0) return;
    haptics.selection();
    pick(day);
    const index = shown.current + Math.sign(distance);
    if (Math.abs(distance) === 1) {
      slide({ index, date: day });
      return;
    }
    waiting.current = { index, date: day };
    setIncoming({ index, date: day });
    setTimeout(() => {
      if (waiting.current?.date === day) slide(waiting.current);
    }, 400);
  };

  /** A page has its data: if it is the far day being brought in, slide to it now. */
  const onReady = (day: DateKey) => {
    if (waiting.current?.date === day) slide(waiting.current);
  };
  // The pages get one function for good, which calls the latest: a new one on every render of
  // the screen made all seven pages draw again at each change of day.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const [pageReady] = useState(() => (day: DateKey) => onReadyRef.current(day));

  // "Oggi" with today already on screen, as in Calendar: back up to it, and its circle beats once
  // on the way, in the strip that is always in sight.
  const [pulse, setPulse] = useState(0);
  const showToday = () => {
    if (date !== today) {
      goTo(today);
      return;
    }
    haptics.selection();
    setPulse((n) => n + 1);
    void scrollToTop?.();
  };

  // At midnight, or back after days away, today moves on: follow it if it was on screen.
  useEffect(() => {
    if (selected !== null || dayAtShown.current === today || moving.current) return;
    const index = indexOf(today);
    shown.current = index;
    dayAtShown.current = today;
    list.current?.scrollToIndex({ index, animated: false });
    setInteractiveDay(today);
  }, [today, selected]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (moving.current) return;
    if (index === shown.current || index < 0 || index >= days.length) return;
    shown.current = index;
    dayAtShown.current = days[index];
    pick(days[index]);
    // A click for each day the finger brings in, as for a day tapped above.
    haptics.selection();
    // While moving it only grows, so the page leaving is never cut; it fits the new day once still.
    const h = heights.current.get(days[index]);
    if (h !== undefined) setHeight((current) => Math.max(current ?? 0, h));
  };

  const onRest = () => {
    if (moving.current) {
      finishSlide();
      return;
    }
    const day = dayAtShown.current;
    const h = heights.current.get(day);
    if (h !== undefined) setHeight(h);
    settle(day);
  };

  return {
    /** The day on screen. */
    date,
    goTo,
    showToday,
    /** Each new value makes the selected day's circle beat once. */
    pulse,
    view: {
      days,
      incoming,
      interactiveDay,
      width,
      height,
      list,
      pageReady,
      onPageLayout,
      onScroll,
      onRest,
      onDragStart: () => clearTimeout(settleTimer.current),
    },
  };
}

/**
 * As in Calendar, what belongs to a day is on its page: dragging, the days on either side come in
 * with theirs. Goes in the screen's scroll view, out of its side margins.
 */
export function DayPager({
  pager,
  today,
  renderDay,
}: {
  pager: ReturnType<typeof useDayPager>;
  today: DateKey;
  renderDay: (day: DateKey, page: DayPageProps) => ReactNode;
}) {
  const { days, incoming, interactiveDay, width, height, list, pageReady, onPageLayout, onScroll, onRest, onDragStart } = pager.view;
  const renderItem = ({ item }: ListRenderItemInfo<DateKey>) => (
    <View style={[styles.page, { width }]}>
      <View onLayout={(event) => onPageLayout(item, event.nativeEvent.layout.height)}>
        {renderDay(item, { interactive: item === interactiveDay, onReady: pageReady })}
      </View>
    </View>
  );
  return (
    <FlatList
      ref={list}
      data={days}
      // A far day drawn beside the current one may also be in its own place further on: that
      // copy gets another key, so the page sliding in keeps its key when the list is renumbered.
      keyExtractor={(day, index) => (incoming && day === incoming.date && index !== incoming.index ? `${day}#` : day)}
      renderItem={renderItem}
      extraData={`${interactiveDay}|${today}`}
      horizontal
      pagingEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      initialScrollIndex={RANGE}
      initialNumToRender={1}
      maxToRenderPerBatch={1}
      windowSize={7}
      scrollEventThrottle={16}
      onScroll={onScroll}
      onScrollBeginDrag={onDragStart}
      onMomentumScrollEnd={onRest}
      style={[styles.pager, { width, height }]}
    />
  );
}

const styles = StyleSheet.create({
  pager: { marginHorizontal: -Spacing.lg },
  page: { paddingHorizontal: Spacing.lg },
});
