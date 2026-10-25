import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { DayPage, type DayPager } from '@/components/day-page';
import { Icon } from '@/components/icon';
import { EASE_OUT } from '@/components/motion';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { WeekStrip } from '@/components/week-strip';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const expiry = useAppExpiry();
  const { width: screenWidth } = useWindowDimensions();
  const pageWidth = Math.min(screenWidth, MaxContentWidth) - Spacing.lg * 2;
  const stride = pageWidth + PAGE_GAP;
  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;

  // The days sit side by side like pages, each at its distance in days from a fixed anchor, and
  // the row slides under the finger as in Calendar. Yesterday and tomorrow are drawn already, so
  // the day coming in shows its own data from the first frame.
  const [anchor] = useState(today);
  const offset = daysBetween(anchor, date);
  const position = useSharedValue(offset);
  const track = useSharedValue(-offset * stride);
  const fade = useSharedValue(1);
  const jumping = useRef<DateKey | null>(null);

  const show = (day: DateKey) => setSelected(day === today ? null : day);

  // A change that did not come from a swipe (midnight, a jump) or a new width lines the row up.
  const lastStride = useRef(stride);
  useEffect(() => {
    const strideChanged = lastStride.current !== stride;
    lastStride.current = stride;
    if (position.get() === offset && !strideChanged) return;
    position.set(offset);
    track.set(-offset * stride);
  }, [offset, stride, position, track]);

  const reveal = (day: DateKey) => {
    if (jumping.current !== day) return;
    jumping.current = null;
    fade.set(withTiming(1, { duration: 200, easing: EASE_OUT }));
  };

  const jump = (day: DateKey) => {
    const target = daysBetween(anchor, day);
    position.set(target);
    track.set(-target * stride);
    show(day);
    // Should the page be slow to report that it is ready, never leave the diary hidden.
    setTimeout(() => reveal(day), 600);
  };

  /** Next to the current day the pages slide; further away the diary fades to the new day. */
  const goTo = (day: DateKey) => {
    const target = daysBetween(anchor, day);
    const current = position.get();
    if (target === current) return;
    haptics.selection();
    if (Math.abs(target - current) === 1) {
      position.set(target);
      track.set(withSpring(-target * stride, PAGE_SPRING));
      show(day);
      return;
    }
    jumping.current = day;
    fade.set(
      withTiming(0, { duration: 120, easing: EASE_OUT }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(jump, day);
      }),
    );
  };

  const pager: DayPager = {
    track,
    position,
    stride,
    pageWidth,
    onSwipe: (next) => show(addDays(anchor, next)),
  };

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: track.get() }] }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  // The day's entries, for the actions in the header.
  const { data: dayEntries } = useLiveQuery(`day-entries:${date}`, (database) => getEntriesForDate(database, date));
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
      message: `Elimini ${countLabel(count, 'alimento', 'alimenti')}, ${formatKcal(kcal)} kcal in tutto.`,
      action: 'Svuota',
    });
    if (ok) await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
  };

  const pages = [addDays(date, -1), date, addDays(date, 1)];
  const relative = Math.abs(daysBetween(today, date)) <= 1 ? formatDayTitle(date, today) : formatDaySubtitle(date, today);

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Azioni sul giorno" hidden={count === 0 && date === today}>
          {date !== today ? (
            <Stack.Toolbar.MenuAction icon="calendar" onPress={() => goTo(today)}>
              Torna a oggi
            </Stack.Toolbar.MenuAction>
          ) : null}
          {count > 0 ? (
            <Stack.Toolbar.MenuAction
              icon="doc.on.doc"
              subtitle={countLabel(count, 'alimento', 'alimenti')}
              onPress={() => void copyWholeDay()}>
              {`Copia tutto in ${copyTarget.label}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
          {count > 0 ? (
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void clearDay()}>
              {`Svuota ${dayName}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="barcode.viewfinder"
          accessibilityLabel="Scansiona un codice a barre"
          onPress={() => router.push({ pathname: '/add/scan', params: { meal: mealForTime(), date } })}
        />
      </Stack.Toolbar>

      {expiry && expiry.level !== 'ok' ? <ExpiryBanner status={expiry} /> : null}

      <View style={styles.dateRow}>
        <View style={styles.flex}>
          <AppText variant="headline">{formatLongDate(date)}</AppText>
          <AppText variant="footnote" tone="textSecondary">
            {relative}
          </AppText>
        </View>
        {date !== today ? (
          <Pressable
            onPress={() => goTo(today)}
            accessibilityRole="button"
            accessibilityLabel="Torna a oggi"
            style={({ pressed }) => [styles.todayButton, { backgroundColor: theme.accentSoft }, pressed && styles.pressed]}>
            <AppText variant="subhead" weight="600" tone="accent">
              Oggi
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <WeekStrip selected={date} today={today} onSelect={goTo} onChangeWeek={(direction) => goTo(addDays(date, direction * 7))} />

      <Animated.View style={[{ width: pageWidth }, fadeStyle]}>
        <Animated.View style={trackStyle}>
          {pages.map((day) => (
            <View
              key={day}
              style={[{ width: pageWidth, left: daysBetween(anchor, day) * stride }, day === date ? styles.current : styles.beside]}>
              <DayPage date={day} today={today} active={day === date} pager={pager} onReady={reveal} />
            </View>
          ))}
        </Animated.View>
      </Animated.View>
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
          <AppText variant="headline">{`Macro scade ${formatExpiry(status.expiresAt)}`}</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Rinnovala in AltStore con Refresh All: Mac acceso, AltServer aperto, stessa Wi-Fi. I dati restano.
          </AppText>
        </View>
        <Icon name="chevron.right" size={13} tone="textSecondary" weight="semibold" />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  todayButton: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: Radius.pill },
  pressed: { opacity: 0.7 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, borderWidth: 1.5 },
  // The day on screen sets the height of the row; the others overlay it on either side.
  current: { position: 'relative' },
  beside: { position: 'absolute', top: 0 },
});
