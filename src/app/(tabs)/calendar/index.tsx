import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionTitle } from '@/components/card';
import { DayDetail } from '@/components/day-detail';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MonthGrid } from '@/components/month-grid';
import { ScreenScroll } from '@/components/screen';
import { WeekView } from '@/components/week-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { getDosesTaken, getPurchasesBetween, getSupplements } from '@/db/supplements';
import { useAgenda } from '@/hooks/use-agenda';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { activeDates, busyDates, formatMinutes, summarizeActivity, weekStreak } from '@/lib/calendar';
import {
  addDays,
  addMonths,
  daysFrom,
  formatMonthName,
  formatShortDate,
  monthGrid,
  monthOf,
  monthRange,
  weekOf,
  type DateKey,
} from '@/lib/dates';
import { adherence, formatEuro, percent, type Adherence } from '@/lib/supplements';
import { haptics } from '@/services/haptics';
import { logWeight } from '@/services/log-weight';

type CalendarView = 'week' | 'month';

const VIEWS: readonly { key: CalendarView; label: string }[] = [
  { key: 'week', label: 'Settimana' },
  { key: 'month', label: 'Mese' },
];

const SWITCH_IN = FadeIn.duration(220);
const DAY_IN = FadeIn.duration(180);

/**
 * The calendar, opened from the round button between the tabs: the week day by day with the
 * times of everything, or the month with the day picked under it.
 */
export default function CalendarScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();

  // The view last used, the week the first time.
  const { data: savedView } = useLiveQuery('calendar-view', (database) => getSetting(database, 'calendarView'), ['settings']);
  const [chosenView, setChosenView] = useState<CalendarView | null>(null);
  const view = chosenView ?? savedView ?? 'week';
  const changeView = (next: CalendarView) => {
    setChosenView(next);
    void setSetting(db, 'calendarView', next);
  };

  // null follows today, so the calendar moves on to the new day when it is opened tomorrow.
  const [picked, setPicked] = useState<DateKey | null>(null);
  const selected = picked ?? today;
  const [shownMonth, setShownMonth] = useState<string | null>(null);
  const month = shownMonth ?? monthOf(selected);
  const grid = monthGrid(month);
  const [weekStart, setWeekStart] = useState<DateKey | null>(null);
  const week = weekOf(weekStart ?? today);

  const { data, agenda, types } = useAgenda(view === 'week' ? week[0] : grid[0], view === 'week' ? week[6] : grid[41], today);
  // The year before today, for the streak.
  const history = useAgenda(addDays(today, -371), today, today);
  const streak = weekStreak(activeDates(history.agenda), today);
  const busy = busyDates(agenda);

  const range = monthRange(month);
  const { data: monthData } = useLiveQuery(
    `calendar-month:${month}`,
    async (database) => {
      const [all, doses, purchases] = await Promise.all([
        getSupplements(database, { archived: true }),
        getDosesTaken(database, range.from, range.to),
        getPurchasesBetween(database, range.from, range.to),
      ]);
      return { all, doses, spent: purchases.reduce((sum, p) => sum + p.price, 0) };
    },
    ['calendar'],
  );
  const { data: reportSeen } = useLiveQuery('report-seen', (database) => getSetting(database, 'reportSeen'), ['settings']);

  const select = (day: DateKey) => {
    setPicked(day === today ? null : day);
    setShownMonth(null);
  };
  const changeMonth = (direction: number) => {
    const next = addMonths(month, direction);
    // As in Calendar: the first of the month, or today when it is in it.
    select(monthOf(today) === next ? today : `${next}-01`);
    setShownMonth(next);
  };
  const changeWeek = (direction: number) => {
    haptics.selection();
    const next = addDays(week[0], direction * 7);
    setWeekStart(weekOf(today)[0] === next ? null : next);
  };
  const atToday = view === 'week' ? weekStart === null : selected === today && month === monthOf(today);
  const goToday = () => {
    select(today);
    setWeekStart(null);
  };

  const summary = summarizeActivity(agenda, data?.types ?? [], data?.gymTypeId ?? null, range.from, range.to);
  const monthDays = daysFrom(range.from, range.to);
  const monthAdherence = (monthData?.all ?? []).reduce<Adherence>(
    (total, s) => {
      const a = adherence(s, monthData?.doses ?? new Map(), monthDays, busy, today);
      return { due: total.due + a.due, taken: total.taken + a.taken };
    },
    { due: 0, taken: 0 },
  );
  const adherencePercent = percent(monthAdherence);

  // In the first week of a month, last month's report waits at the top until opened or closed.
  const lastMonth = addMonths(monthOf(today), -1);
  const showReport = reportSeen !== undefined && reportSeen !== lastMonth && Number(today.slice(8)) <= 7;
  const openReport = (forMonth: string) => {
    if (forMonth === lastMonth) void setSetting(db, 'reportSeen', lastMonth);
    router.push({ pathname: '/calendar/report', params: { period: 'month', anchor: `${forMonth}-01` } });
  };

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        {/* As in Calendar: always in the bar, dimmed while today is on screen. */}
        <Stack.Toolbar.Button disabled={atToday} accessibilityLabel="Torna a oggi" onPress={goToday}>
          Oggi
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="pills" onPress={() => router.push('/calendar/supplements')}>
            Integratori
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="figure.volleyball" onPress={() => router.push('/calendar/activity-types')}>
            Tipi di attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="scalemass" onPress={() => router.push('/calendar/weight')}>
            Peso e misure
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="chart.bar.xaxis" onPress={() => openReport(month)}>
            Report
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Impostazioni
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu separateBackground icon="plus" accessibilityLabel="Aggiungi">
          <Stack.Toolbar.MenuAction icon="calendar.badge.plus" onPress={() => router.push({ pathname: '/activity', params: { date: view === 'month' ? selected : today } })}>
            Attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="pills" onPress={() => router.push('/supplement')}>
            Integratore
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="scalemass" onPress={() => logWeight(db, view === 'month' && selected < today ? selected : today, null, today)}>
            Peso
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {showReport ? (
        <Pressable
          onPress={() => openReport(lastMonth)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.banner, { backgroundColor: theme.card }, pressed && styles.pressed]}>
          <ActivityBadge symbol="chart.bar.xaxis" color="green" size={36} />
          <View style={styles.flex}>
            <AppText variant="headline">{`Il report di ${formatMonthName(lastMonth).toLowerCase()} è pronto`}</AppText>
            <AppText variant="subhead" tone="textSecondary">
              Allenamenti, attività e integratori del mese.
            </AppText>
          </View>
          <Pressable
            onPress={() => void setSetting(db, 'reportSeen', lastMonth)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Chiudi"
            style={styles.close}>
            <Icon name="xmark" size={13} tone="textSecondary" weight="semibold" />
          </Pressable>
        </Pressable>
      ) : null}

      {savedView !== undefined || chosenView !== null ? (
        <>
          <Segmented options={VIEWS} value={view} onChange={changeView} />

          {view === 'week' ? (
            <Animated.View key="week" entering={SWITCH_IN}>
              <View style={styles.weekNav}>
                <Pressable onPress={() => changeWeek(-1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Settimana prima" style={styles.arrow}>
                  <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
                </Pressable>
                <View style={styles.flex}>
                  <AppText variant="headline" align="center" numberOfLines={1}>
                    {weekTitle(week[0], weekOf(today)[0])}
                  </AppText>
                  <AppText variant="footnote" tone="textSecondary" align="center" numeric>
                    {`${formatShortDate(week[0])} – ${formatShortDate(week[6])}`}
                  </AppText>
                </View>
                <Pressable onPress={() => changeWeek(1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Settimana dopo" style={styles.arrow}>
                  <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
                </Pressable>
              </View>
              <Animated.View key={week[0]} entering={DAY_IN}>
                <WeekView
                  week={week}
                  today={today}
                  agenda={agenda}
                  calendar={data}
                  types={types}
                  onOpenDay={(date) => router.push({ pathname: '/calendar/day', params: { date } })}
                />
              </Animated.View>
            </Animated.View>
          ) : (
            <Animated.View key="month" entering={SWITCH_IN} style={styles.month}>
              <MonthGrid
                month={month}
                selected={selected}
                today={today}
                agenda={agenda}
                types={types}
                gymTypeId={data?.gymTypeId ?? null}
                onSelect={select}
                onChangeMonth={changeMonth}
              />

              {/* The day picked: what was done or is planned, and the supplements to tick. */}
              <Animated.View key={selected} entering={DAY_IN}>
                <DayDetail
                  date={selected}
                  today={today}
                  items={agenda.get(selected) ?? []}
                  calendar={data}
                  types={types}
                  busy={busy.has(selected)}
                />
              </Animated.View>

              <SectionTitle>{formatMonthName(month)}</SectionTitle>
              <ListGroup>
                {summary.byType.map((t) => {
                  const type = types.get(t.typeId);
                  return (
                    <Row
                      key={t.typeId}
                      icon={<ActivityBadge symbol={type?.symbol ?? 'calendar'} color={type?.color ?? 'blue'} size={28} />}
                      title={type?.name ?? 'Attività'}
                      detail={`${t.count} · ${formatMinutes(t.minutes)}`}
                    />
                  );
                })}
                {summary.byType.length === 0 ? <Row title="Nessuna attività fatta" chevron={false} /> : null}
                <Row icon={<ActivityBadge symbol="flame.fill" color="orange" size={28} />} title="Settimane di fila" detail={String(streak)} />
                {adherencePercent !== null ? (
                  <Row icon={<ActivityBadge symbol="pills.fill" color="indigo" size={28} />} title="Integratori presi" detail={`${adherencePercent}%`} />
                ) : null}
                {(monthData?.spent ?? 0) > 0 ? (
                  <Row
                    icon={<ActivityBadge symbol="eurosign" color="teal" size={28} />}
                    title="Speso in integratori"
                    detail={formatEuro(monthData?.spent ?? 0)}
                  />
                ) : null}
                <Row title="Report completo" onPress={() => openReport(month)} />
              </ListGroup>
            </Animated.View>
          )}
        </>
      ) : null}
    </ScreenScroll>
  );
}

/** "Questa settimana", "Settimana scorsa", "Prossima settimana", or how far off. */
function weekTitle(monday: DateKey, thisMonday: DateKey): string {
  const weeks = Math.round((Number(new Date(`${monday}T12:00:00`)) - Number(new Date(`${thisMonday}T12:00:00`))) / (7 * 86_400_000));
  if (weeks === 0) return 'Questa settimana';
  if (weeks === -1) return 'Settimana scorsa';
  if (weeks === 1) return 'Prossima settimana';
  return weeks < 0 ? `${-weeks} settimane fa` : `Tra ${weeks} settimane`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    paddingRight: Spacing.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    marginBottom: Spacing.md,
  },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  weekNav: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, marginBottom: Spacing.md },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  month: { marginTop: Spacing.md },
});
