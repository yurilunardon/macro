import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { DayPage } from '@/components/day-page';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, daysBetween, isDateKey, type DateKey } from '@/lib/dates';
import { mealForTime } from '@/lib/meals';
import { formatExpiry, type ExpiryStatus } from '@/lib/provisioning';
import { haptics } from '@/services/haptics';

/** UIBarButtonItem's width: passed through to the native button, though not in the props' type. */
const WIDE: object = { width: 64 };

/** Days kept in the pager on either side of the day the app was opened on: two years. */
const RANGE = 730;

export default function NutritionScreen() {
  const router = useRouter();
  const today = useToday();
  const expiry = useAppExpiry();
  // A day opened from elsewhere, such as the calendar.
  const params = useLocalSearchParams<{ date?: string }>();
  const asked = isDateKey(params.date) ? params.date : null;
  const { width } = useWindowDimensions();
  const theme = useTheme();

  // The days are pages of a native paging scroll view, as in Calendar and Photos: the system
  // moves them under the finger and can be flicked through as fast as the hand goes. The pages
  // around the one on screen are kept ready; see DayPage for why they cost little.
  // `base` is the day in the middle of the list; a day picked far away is first drawn in the
  // page beside the current one, slid to like any neighbour, and then the list is renumbered
  // around it so that page stays where it is.
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

  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(asked !== null && asked !== today ? asked : null);
  const date = selected ?? today;
  const pick = (day: DateKey) => setSelected(day === today ? null : day);
  // It opens on today, the day in the middle of the list.
  const initialIndex = RANGE;
  const shown = useRef(initialIndex);

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

  // Back to the top of the page, where the day's ring is, e.g. to watch it empty. The top is the
  // first offset iOS reports, with the large title open: it sets it itself, under the bar.
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const top = useSharedValue<number | null>(null);
  const onPageScroll = useAnimatedScrollHandler((event) => {
    if (top.get() === null) top.set(event.contentOffset.y);
    offset.set(event.contentOffset.y);
  });
  const [scrollToTop] = useState(() => (): Promise<void> => {
    const to = top.get() ?? 0;
    const far = offset.get() - to;
    if (far < 8) return Promise.resolve();
    scheduleOnUI(() => {
      'worklet';
      scrollTo(scroller, 0, to, true);
    });
    // Resolved once the scroll has about come to rest.
    return new Promise((resolve) => setTimeout(resolve, Math.min(300 + far / 4, 650)));
  });

  // At midnight, or back after days away, today moves on: follow it if it was on screen.
  useEffect(() => {
    if (selected !== null || dayAtShown.current === today || moving.current) return;
    const index = indexOf(today);
    shown.current = index;
    dayAtShown.current = today;
    list.current?.scrollToIndex({ index, animated: false });
    setInteractiveDay(today);
  }, [today, selected]);

  // Opened on a day from the calendar: slide to it as if it were picked above, then forget it, so
  // the same day can be asked for again.
  useEffect(() => {
    if (asked === null) return;
    if (dayAtShown.current !== asked) goTo(asked);
    router.setParams({ date: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

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

  // As in Calendar, the date belongs to the page (see DayPage): dragging, the days on either
  // side come in with theirs.
  const renderDay = ({ item }: ListRenderItemInfo<DateKey>) => (
    <View style={[styles.page, { width }]}>
      <View onLayout={(event) => onPageLayout(item, event.nativeEvent.layout.height)}>
        <DayPage date={item} today={today} interactive={item === interactiveDay} onReady={pageReady} scrollToTop={scrollToTop} />
      </View>
    </View>
  );

  return (
    <ScreenScroll animatedRef={scroller} onScroll={onPageScroll}>
      {/* As in Calendar: always in the bar, dimmed while today is on screen. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={date === today} accessibilityLabel="Torna a oggi" onPress={() => goTo(today)}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {/* Scanning is the quickest way to log food: the button on the far right, wider than an icon. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="target" onPress={() => router.push('/goals')}>
            Obiettivi
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="fork.knife" onPress={() => router.push('/foods')}>
            I miei alimenti
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="frying.pan" onPress={() => router.push('/recipes')}>
            Ricette e pasti salvati
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          {...WIDE}
          separateBackground
          icon="barcode.viewfinder"
          accessibilityLabel="Scansiona codice a barre"
          onPress={() => router.push({ pathname: '/add/scan', params: { meal: mealForTime(), date } })}
        />
      </Stack.Toolbar>

      {expiry && expiry.level !== 'ok' ? <ExpiryBanner status={expiry} /> : null}

      <WeekStrip selected={date} today={today} onSelect={goTo} onChangeWeek={(direction) => goTo(addDays(date, direction * 7))} />
      <View style={[styles.rule, { backgroundColor: theme.separator }]} />

      <FlatList
        ref={list}
        data={days}
        // A far day drawn beside the current one may also be in its own place further on: that
        // copy gets another key, so the page sliding in keeps its key when the list is renumbered.
        keyExtractor={(day, index) => (incoming && day === incoming.date && index !== incoming.index ? `${day}#` : day)}
        renderItem={renderDay}
        extraData={`${interactiveDay}|${today}`}
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        initialScrollIndex={initialIndex}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={7}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => clearTimeout(settleTimer.current)}
        onMomentumScrollEnd={onRest}
        style={[styles.pager, { width, height }]}
      />
    </ScreenScroll>
  );
}

/** Shown from three days before the app's signature expires. */
function ExpiryBanner({ status }: { status: ExpiryStatus }) {
  const theme = useTheme();
  const tone = status.level === 'soon' ? 'warning' : 'danger';
  const openAltStore = () => {
    Linking.openURL('altstore://').catch(() => {
      Alert.alert('Apri AltStore', 'Apri AltStore dalla schermata Home e tocca My Apps → Refresh All.');
    });
  };
  return (
    <Pressable onPress={openAltStore} accessibilityRole="button" accessibilityHint="Apre AltStore">
      <Card style={[styles.banner, { backgroundColor: theme.card, borderColor: theme[tone] }]}>
        <Icon name="clock.badge.exclamationmark" size={22} tone={tone} />
        <View style={styles.flex}>
          <AppText variant="headline">{`Fuel scade ${formatExpiry(status.expiresAt)}`}</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Rinnovala in AltStore con Refresh All. I dati restano.
          </AppText>
        </View>
        <Icon name="chevron.right" size={13} tone="textSecondary" weight="semibold" />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Full width, out of the screen's side margins, as the pages under it.
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.lg },
  pager: { marginHorizontal: -Spacing.lg },
  page: { paddingHorizontal: Spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, borderWidth: 1.5 },
});
