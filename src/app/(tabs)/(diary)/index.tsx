import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { DayPage, type DayPager } from '@/components/day-page';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { WeekStrip } from '@/components/week-strip';
import { MaxContentWidth, Spacing } from '@/constants/theme';
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

/** Two page margins, so the next day starts just past the edge of the screen. */
const PAGE_GAP = Spacing.lg * 2;
const PAGE_SPRING = { duration: 450, dampingRatio: 1 };
/** Should a page be slow to report that it is ready, slide anyway after this long. */
const READY_TIMEOUT = 500;

type Page = { date: DateKey; slot: number };

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
  const expiry = useAppExpiry();
  const { width: screenWidth } = useWindowDimensions();
  const pageWidth = Math.min(screenWidth, MaxContentWidth) - Spacing.lg * 2;
  const stride = pageWidth + PAGE_GAP;

  // The days sit side by side like pages in numbered slots, and the row slides under the finger
  // as in Calendar. `view` is the day the pager rests on; its neighbours are drawn already, so
  // the day coming in shows its own data from the first frame. Any other day is first drawn in
  // the slot beside the current one, off screen, and slides in once its data is there: near or
  // far, every change of day looks the same.
  // The data of a day only changes after the slide, so React never works during the animation.
  const [view, setViewState] = useState<Page>({ date: today, slot: 0 });
  const [incoming, setIncomingState] = useState<Page | null>(null);
  // The same two, for the callbacks that run once an animation ends.
  const viewRef = useRef(view);
  const incomingRef = useRef(incoming);
  const setView = (page: Page) => {
    viewRef.current = page;
    setViewState(page);
  };
  const setIncoming = (page: Page | null) => {
    incomingRef.current = page;
    setIncomingState(page);
  };
  // The day in the title and the week strip: it changes as soon as a day is picked. null means
  // "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;

  const track = useSharedValue(0);
  const position = useSharedValue(0);
  const settled = useSharedValue(0);
  const moving = useRef(false);
  const queued = useRef<DateKey | null>(null);

  const pick = (day: DateKey) => setSelected(day === today ? null : day);

  // At midnight, or back after days away, today moves on: follow it if it was on screen.
  useEffect(() => {
    if (selected !== null || viewRef.current.date === today || moving.current) return;
    setView({ date: today, slot: viewRef.current.slot });
  }, [today, selected]);

  // A new width (rotation, split screen) lines the row up again.
  useEffect(() => {
    track.set(-position.get() * stride);
  }, [stride, track, position]);

  /** The day drawn in a slot. */
  const dayAt = (slot: number): DateKey => {
    const brought = incomingRef.current;
    if (brought?.slot === slot) return brought.date;
    return addDays(viewRef.current.date, slot - viewRef.current.slot);
  };

  const settle = (slot: number) => {
    if (slot === settled.get()) {
      moving.current = false;
      return;
    }
    settled.set(slot);
    setView({ date: dayAt(slot), slot });
    setIncoming(null);
    moving.current = false;
    const next = queued.current;
    queued.current = null;
    if (next) goTo(next);
  };

  const slide = (slot: number) => {
    moving.current = true;
    position.set(slot);
    track.set(
      withSpring(-slot * stride, PAGE_SPRING, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(settle, slot);
      }),
    );
  };

  const goTo = (day: DateKey) => {
    const distance = daysBetween(viewRef.current.date, day);
    if (distance === 0 && !moving.current) {
      pick(day);
      return;
    }
    haptics.selection();
    pick(day);
    if (moving.current) {
      // Picked while sliding: go there once the pages have settled.
      queued.current = day;
      return;
    }
    const slot = viewRef.current.slot + Math.sign(distance);
    if (Math.abs(distance) === 1) {
      slide(slot);
      return;
    }
    moving.current = true;
    setIncoming({ date: day, slot });
    setTimeout(() => onReady(day), READY_TIMEOUT);
  };

  /** A page has its data on screen: the day being brought in can now slide. */
  const onReady = (day: DateKey) => {
    const brought = incomingRef.current;
    if (brought?.date !== day || position.get() !== settled.get()) return;
    slide(brought.slot);
  };

  const pager: DayPager = {
    track,
    position,
    settled,
    stride,
    pageWidth,
    onSwipe: (slot) => pick(dayAt(slot)),
    onSettle: settle,
  };

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: track.get() }] }));

  // The current day with the one before and after it; a day far away replaces the neighbour on
  // its side while it slides in.
  const pages: Page[] = [-1, 0, 1].map((step) =>
    incoming && incoming.slot === view.slot + step
      ? incoming
      : { date: addDays(view.date, step), slot: view.slot + step },
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
      {/* The buttons in the bar never come and go: "Oggi" is always there, as in Calendar. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Vai a oggi" onPress={() => goTo(today)}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sul giorno">
          <Stack.Toolbar.MenuAction
            icon="doc.on.doc"
            disabled={count === 0}
            subtitle={count > 0 ? countLabel(count, 'alimento', 'alimenti') : undefined}
            onPress={() => void copyWholeDay()}>
            {`Copia tutto in ${copyTarget.label}`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive disabled={count === 0} onPress={() => void clearDay()}>
            {`Svuota ${dayName}`}
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
      <AppText variant="subhead" tone="textSecondary" align="center" style={styles.date}>
        <AppText variant="subhead" weight="600">
          {formatLongDate(date)}
        </AppText>
        {` · ${relative}`}
      </AppText>

      <View style={{ width: pageWidth }}>
        <Animated.View style={trackStyle}>
          {pages.map((page) => (
            <View
              key={page.date}
              style={[{ width: pageWidth, left: page.slot * stride }, page.slot === view.slot ? styles.current : styles.beside]}>
              <DayPage date={page.date} today={today} active={page.slot === view.slot} pager={pager} onReady={onReady} />
            </View>
          ))}
        </Animated.View>
      </View>
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
  date: { marginBottom: Spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, borderWidth: 1.5 },
  // The day on screen sets the height of the row; the others overlay it on either side.
  current: { position: 'relative' },
  beside: { position: 'absolute', top: 0 },
});
