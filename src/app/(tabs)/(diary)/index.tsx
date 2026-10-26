import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
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
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { DayPage } from '@/components/day-page';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import { copyDay, deleteMealEntries, getEntriesForDate } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import {
  addDays,
  daysBetween,
  formatDaySubtitle,
  formatDayTitle,
  formatLongDate,
  type DateKey,
} from '@/lib/dates';
import { countLabel, formatKcal } from '@/lib/format';
import { MEALS, mealForTime } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { formatExpiry, type ExpiryStatus } from '@/lib/provisioning';
import { haptics } from '@/services/haptics';

/** Days kept in the pager on either side of the day the app was opened on: two years. */
const RANGE = 730;

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
  const expiry = useAppExpiry();
  const { width } = useWindowDimensions();

  // The days are pages of a native paging scroll view, as in Calendar and Photos: the system
  // moves them under the finger and can be flicked through as fast as the hand goes. The pages
  // around the one on screen are kept ready; see DayPage for why they cost little.
  const [anchor] = useState(today);
  const days = useMemo(() => Array.from({ length: RANGE * 2 + 1 }, (_, i) => addDays(anchor, i - RANGE)), [anchor]);
  const indexOf = (day: DateKey) => Math.min(days.length - 1, Math.max(0, RANGE + daysBetween(anchor, day)));
  const list = useRef<FlatList<DateKey>>(null);

  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;
  const pick = (day: DateKey) => setSelected(day === today ? null : day);
  const [initialIndex] = useState(() => indexOf(date));
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
  const onPageLayout = (day: DateKey, h: number) => {
    heights.current.set(day, h);
    if (day === dayAtShown()) setHeight(h);
  };
  const dayAtShown = () => days[shown.current];

  // Picking a day above jumps straight to it, near or far, and the page slides in from the side
  // it comes from, as in Calendar. Scrolling through the days in between would rush every one of
  // them past the screen.
  const enter = useSharedValue(0);
  const goTo = (day: DateKey) => {
    const index = indexOf(day);
    if (index === shown.current) return;
    haptics.selection();
    const direction = Math.sign(index - shown.current);
    shown.current = index;
    pick(day);
    list.current?.scrollToIndex({ index, animated: false });
    const h = heights.current.get(day);
    if (h !== undefined) setHeight(h);
    enter.set(direction);
    enter.set(withSpring(0, ENTER_SPRING));
    settle(day);
  };
  const enterStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.abs(enter.get()) * 0.7,
    transform: [{ translateX: enter.get() * width * 0.25 }],
  }));

  // At midnight, or back after days away, today moves on: follow it if it was on screen.
  useEffect(() => {
    if (selected !== null || days[shown.current] === today) return;
    shown.current = indexOf(today);
    list.current?.scrollToIndex({ index: shown.current, animated: false });
    setInteractiveDay(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, selected]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index === shown.current || index < 0 || index >= days.length) return;
    shown.current = index;
    pick(days[index]);
    // While moving it only grows, so the page leaving is never cut; it fits the new day once still.
    const h = heights.current.get(days[index]);
    if (h !== undefined) setHeight((current) => Math.max(current ?? 0, h));
  };

  const onRest = () => {
    const day = days[shown.current];
    const h = heights.current.get(day);
    if (h !== undefined) setHeight(h);
    settle(day);
  };

  const renderDay = ({ item }: ListRenderItemInfo<DateKey>) => (
    <View style={[styles.page, { width }]}>
      <View onLayout={(event) => onPageLayout(item, event.nativeEvent.layout.height)}>
        <DayPage date={item} today={today} interactive={item === interactiveDay} />
      </View>
    </View>
  );

  // The day's entries, for the actions in the header.
  const { data: dayEntries } = useLiveQuery(`day-entries:${date}`, (database) => getEntriesForDate(database, date), ['food']);
  const count = dayEntries?.length ?? 0;
  const dayName = formatDayTitle(date, today).toLowerCase();
  const copyTarget = date === today ? { date: addDays(today, 1), label: 'domani' } : { date: today, label: 'oggi' };

  const copyWholeDay = async () => {
    const copied = await copyDay(db, date, copyTarget.date);
    haptics.success();
    toast.show(`${countLabel(copied, 'alimento copiato', 'alimenti copiati')} in ${copyTarget.label}`, 'doc.on.doc.fill');
  };

  const clearDay = async () => {
    const kcal = sumNutrients((dayEntries ?? []).map((e) => e.totals)).kcal;
    const ok = await confirmDestructive({
      title: `Svuotare ${dayName}?`,
      message: `${countLabel(count, 'alimento', 'alimenti')}, ${formatKcal(kcal)} kcal.`,
      action: 'Svuota',
    });
    if (ok) await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
  };

  const relative = Math.abs(daysBetween(today, date)) <= 1 ? formatDayTitle(date, today) : formatDaySubtitle(date, today);

  return (
    <ScreenScroll>
      {/* As in Calendar: always in the bar, dimmed while today is on screen. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={date === today} accessibilityLabel="Torna a oggi" onPress={() => goTo(today)}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sul giorno">
          <Stack.Toolbar.MenuAction
            icon="doc.on.doc"
            disabled={count === 0}
            onPress={() => void copyWholeDay()}>
            {`Copia giorno in ${copyTarget.label}`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive disabled={count === 0} onPress={() => void clearDay()}>
            Svuota giorno
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon="barcode.viewfinder"
          accessibilityLabel="Scansiona codice a barre"
          onPress={() => router.push({ pathname: '/add/scan', params: { meal: mealForTime(), date } })}
        />
      </Stack.Toolbar>

      {expiry && expiry.level !== 'ok' ? <ExpiryBanner status={expiry} /> : null}

      <WeekStrip selected={date} today={today} onSelect={goTo} onChangeWeek={(direction) => goTo(addDays(date, direction * 7))} />
      <AppText variant="subhead" tone="textSecondary" align="center" numberOfLines={1} style={styles.date}>
        <AppText variant="subhead" weight="600">
          {formatLongDate(date)}
        </AppText>
        {` · ${relative}`}
      </AppText>

      <Animated.View style={enterStyle}>
      <FlatList
        ref={list}
        data={days}
        keyExtractor={(day) => day}
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
      </Animated.View>
    </ScreenScroll>
  );
}

const ENTER_SPRING = { duration: 420, dampingRatio: 1 };

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
  date: { marginBottom: Spacing.md },
  // Full width, out of the screen's side margins: each page has its own.
  pager: { marginHorizontal: -Spacing.lg },
  page: { paddingHorizontal: Spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, borderWidth: 1.5 },
});
