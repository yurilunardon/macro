import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { DayPage } from '@/components/day-page';
import { DayPager, useDayPager } from '@/components/day-pager';
import { Icon } from '@/components/icon';
import { PinnedStrip } from '@/components/pinned-strip';
import { ScreenScroll } from '@/components/screen';
import { WeekStrip, type DayProgress } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import { getDayPlans } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, isDateKey, weekOf, type DateKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { mealForTime } from '@/lib/meals';
import { formatExpiry, type ExpiryStatus } from '@/lib/provisioning';

/** UIBarButtonItem's width: passed through to the native button, though not in the props' type. */
const WIDE: object = { width: 64 };

/** Round each day, how much of its calorie goal was eaten. */
function useCalorieRings(date: DateKey): Map<DateKey, DayProgress> {
  const days = weekOf(date);
  const { data } = useLiveQuery(`week:${days[0]}`, async (database) => {
    const [totals, plans] = await Promise.all([getDailyTotals(database, days[0], days[6]), getDayPlans(database, days)]);
    return { kcal: new Map(totals.map((t) => [t.date, t.kcal])), plans };
  }, ['food', 'settings']);
  const rings = new Map<DateKey, DayProgress>();
  for (const day of days) {
    const kcal = data?.kcal.get(day) ?? 0;
    const target = data?.plans.get(day)?.targets.kcal ?? 0;
    if (kcal > 0) rings.set(day, { progress: target > 0 ? kcal / target : 0, label: `${formatKcal(kcal)} kcal` });
  }
  return rings;
}

export default function NutritionScreen() {
  const router = useRouter();
  const today = useToday();
  const expiry = useAppExpiry();
  // A day opened from elsewhere, such as the calendar.
  const params = useLocalSearchParams<{ date?: string }>();
  const asked = isDateKey(params.date) ? params.date : null;

  // Back to the top of the page, where the day's ring is, e.g. to watch it empty.
  const scroll = useScrollTop();
  const { scrollToTop } = scroll;
  // The pages around the one on screen are kept ready; see DayPage for why they cost little.
  const pager = useDayPager(today, asked, scrollToTop);
  const { date } = pager;
  const rings = useCalorieRings(date);

  // Opened on a day from the calendar: slide to it as if it were picked above, then forget it, so
  // the same day can be asked for again.
  useEffect(() => {
    if (asked === null) return;
    pager.goTo(asked);
    router.setParams({ date: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  return (
    <ScreenScroll scroll={scroll}>
      {/* As in Calendar: always in the bar. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Torna a oggi" onPress={pager.showToday}>
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

      <PinnedStrip scroll={scroll}>
        <WeekStrip
          selected={date}
          today={today}
          rings={rings}
          pulse={pager.pulse}
          onSelect={pager.goTo}
          onChangeWeek={(direction) => pager.goTo(addDays(date, direction * 7))}
        />
      </PinnedStrip>

      <DayPager
        pager={pager}
        today={today}
        renderDay={(day, page) => <DayPage date={day} today={today} {...page} scrollToTop={scrollToTop} />}
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
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, borderWidth: 1.5 },
});
