import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActivityBadge } from '@/components/activity-badge';
import { AgendaRow } from '@/components/agenda-row';
import { AppText } from '@/components/app-text';
import { ActionRow, ListGroup, Row, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { MonthGrid } from '@/components/month-grid';
import { ScreenScroll } from '@/components/screen';
import { SupplementRow } from '@/components/supplement-row';
import { Radius, Spacing } from '@/constants/theme';
import { getWeightUpTo } from '@/db/body';
import { getDayPlan } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { getDosesOn, getDosesTaken, getPurchasesBetween, getSupplements, setDoseTaken } from '@/db/supplements';
import { useAgenda } from '@/hooks/use-agenda';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import {
  activeDates,
  busyDates,
  formatMinutes,
  isPendingDelete,
  summarizeActivity,
  weekStreak,
  type AgendaItem,
} from '@/lib/calendar';
import {
  addDays,
  addMonths,
  daysFrom,
  formatDayTitle,
  formatLongDate,
  formatMonthName,
  monthGrid,
  monthOf,
  monthRange,
  type DateKey,
} from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';
import { adherence, dosesDue, formatEuro, percent, type Adherence } from '@/lib/supplements';
import { logWeight } from '@/services/log-weight';
import { startAndOpenWorkout } from '@/services/start-workout';
import { usePendingDeletes } from '@/services/undo';

const DAY_IN = FadeIn.duration(180);

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();

  // null follows today, so the calendar moves on to the new day when it is opened tomorrow.
  const [picked, setPicked] = useState<DateKey | null>(null);
  const selected = picked ?? today;
  const [shownMonth, setShownMonth] = useState<string | null>(null);
  const month = shownMonth ?? monthOf(selected);
  const grid = monthGrid(month);
  const pending = usePendingDeletes();

  // The six weeks on screen, and the year before today for the streak.
  const { data, agenda, types } = useAgenda(grid[0], grid[41], today);
  const history = useAgenda(addDays(today, -371), today, today);
  const streak = weekStreak(activeDates(history.agenda), today);

  const range = monthRange(month);
  const { data: supplements } = useLiveQuery(
    `calendar-supplements:${selected}:${month}`,
    async (database) => {
      const [list, all, taken, doses, purchases] = await Promise.all([
        getSupplements(database),
        getSupplements(database, { archived: true }),
        getDosesOn(database, selected),
        getDosesTaken(database, range.from, range.to),
        getPurchasesBetween(database, range.from, range.to),
      ]);
      return { list, all, taken, doses, spent: purchases.reduce((sum, p) => sum + p.price, 0) };
    },
    ['calendar'],
  );
  const { data: reportSeen } = useLiveQuery('report-seen', (database) => getSetting(database, 'reportSeen'), ['settings']);
  // What was eaten that day against its target, and the weight.
  const { data: body } = useLiveQuery(
    `calendar-body:${selected}`,
    async (database) => {
      const [totals, plan, weight] = await Promise.all([
        getDailyTotals(database, selected, selected),
        getDayPlan(database, selected),
        getWeightUpTo(database, selected),
      ]);
      return { eaten: totals[0] ?? null, target: plan.targets, weight };
    },
    ['food', 'body', 'settings', 'calendar'],
  );
  const weighIn = body?.weight?.date === selected ? body.weight : null;

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

  const items = (agenda.get(selected) ?? []).filter((i) => !isPendingDelete(i, pending));
  const busy = busyDates(agenda);
  const dueToday = (supplements?.list ?? []).filter(
    (s) => s.schedule === 'asNeeded' || dosesDue(s, selected, busy) > 0,
  );
  const taken = dueToday.reduce((sum, s) => sum + Math.min(s.timesPerDay, supplements?.taken.get(s.id)?.size ?? 0), 0);
  const due = dueToday.filter((s) => s.schedule !== 'asNeeded').reduce((sum, s) => sum + s.timesPerDay, 0);

  const summary = summarizeActivity(agenda, data?.types ?? [], data?.gymTypeId ?? null, range.from, range.to);
  const monthDays = daysFrom(range.from, range.to);
  const monthAdherence = (supplements?.all ?? []).reduce<Adherence>(
    (total, s) => {
      const a = adherence(s, supplements?.doses ?? new Map(), monthDays, busy, today);
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

  const openItem = (item: AgendaItem) => {
    if (item.kind === 'workout') {
      if (item.workout.endedAt) router.push({ pathname: '/training/session', params: { id: item.workout.id } });
      else router.push('/workout');
      return;
    }
    const o = item.occurrence;
    router.push({
      pathname: '/activity',
      params: o.planId === null ? { id: o.recordId ?? undefined } : { plan: o.planId, date: o.date },
    });
  };

  return (
    <ScreenScroll>
      {/* As in Calendar: always in the bar, dimmed while today is on screen. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          disabled={selected === today && month === monthOf(today)}
          accessibilityLabel="Torna a oggi"
          onPress={() => select(today)}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altro">
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
          <Stack.Toolbar.MenuAction icon="calendar.badge.plus" onPress={() => router.push({ pathname: '/activity', params: { date: selected } })}>
            Attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="pills" onPress={() => router.push('/supplement')}>
            Integratore
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="scalemass" onPress={() => logWeight(db, selected > today ? today : selected, weighIn ?? body?.weight ?? null, today)}>
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
        <View style={styles.dayHead}>
          <AppText variant="title2" numberOfLines={1}>
            {formatDayTitle(selected, today)}
          </AppText>
          {formatDayTitle(selected, today) !== formatLongDate(selected) ? (
            <AppText variant="subhead" tone="textSecondary">
              {formatLongDate(selected)}
            </AppText>
          ) : null}
        </View>
        <ListGroup>
          {items.map((item) => (
            <AgendaRow
              key={item.key}
              item={item}
              types={types}
              gymTypeId={data?.gymTypeId ?? null}
              dayNames={data?.dayNames ?? new Map()}
              onPress={() => openItem(item)}
              onStart={
                item.kind === 'activity' && item.status === 'planned' && item.occurrence.typeId === data?.gymTypeId && selected === today
                  ? () => void startAndOpenWorkout(db, router, item.dayId)
                  : undefined
              }
            />
          ))}
          <ActionRow
            label={items.length === 0 ? 'Aggiungi un’attività' : 'Aggiungi attività'}
            symbol="plus.circle.fill"
            onPress={() => router.push({ pathname: '/activity', params: { date: selected } })}
          />
        </ListGroup>

        <SectionTitle
          action={
            due > 0 ? (
              <AppText variant="footnote" tone={taken >= due ? 'accent' : 'textSecondary'} weight="600" numeric>
                {`${Math.min(taken, due)} di ${due}`}
              </AppText>
            ) : undefined
          }>
          Integratori
        </SectionTitle>
        <ListGroup>
          {dueToday.map((s) => (
            <SupplementRow
              key={s.id}
              supplement={s}
              taken={supplements?.taken.get(s.id) ?? new Set()}
              disabled={selected > today}
              onToggle={(index, on) => void setDoseTaken(db, s.id, selected, index, on)}
              onPress={() => router.push({ pathname: '/supplement', params: { id: s.id } })}
            />
          ))}
          {(supplements?.list ?? []).length === 0 ? (
            <ActionRow label="Aggiungi i tuoi integratori" symbol="plus.circle.fill" onPress={() => router.push('/supplement')} />
          ) : (
            <Row
              title={dueToday.length === 0 ? 'Nessuno da prendere' : 'Tutti gli integratori'}
              onPress={() => router.push('/calendar/supplements')}
            />
          )}
        </ListGroup>

        {selected <= today ? (
          <>
            <SectionTitle>Alimentazione e peso</SectionTitle>
            <ListGroup>
              <Row
                icon={<ActivityBadge symbol="fork.knife" color="orange" size={28} />}
                title="Alimentazione"
                subtitle={
                  body?.eaten
                    ? `${formatKcal(body.eaten.kcal)} / ${formatKcal(body.target.kcal)} kcal · P ${formatNumber(body.eaten.protein, 0)} g`
                    : 'Niente registrato'
                }
                onPress={() => router.navigate({ pathname: '/', params: { date: selected } })}
              />
              <Row
                icon={<ActivityBadge symbol="scalemass.fill" color="blue" size={28} />}
                title="Peso"
                detail={
                  weighIn ? (
                    `${formatNumber(weighIn.kg, 1)} kg`
                  ) : (
                    <AppText tone="accent">Registra</AppText>
                  )
                }
                chevron={weighIn !== null}
                onPress={() => logWeight(db, selected, body?.weight ?? null, today)}
              />
            </ListGroup>
          </>
        ) : null}
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
        <Row
          icon={<ActivityBadge symbol="flame.fill" color="orange" size={28} />}
          title="Settimane di fila"
          detail={String(streak)}
        />
        {adherencePercent !== null ? (
          <Row
            icon={<ActivityBadge symbol="pills.fill" color="indigo" size={28} />}
            title="Integratori presi"
            detail={`${adherencePercent}%`}
          />
        ) : null}
        {(supplements?.spent ?? 0) > 0 ? (
          <Row
            icon={<ActivityBadge symbol="eurosign" color="teal" size={28} />}
            title="Speso in integratori"
            detail={formatEuro(supplements?.spent ?? 0)}
          />
        ) : null}
        <Row title="Report completo" onPress={() => openReport(month)} />
      </ListGroup>
    </ScreenScroll>
  );
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
  dayHead: { paddingHorizontal: Spacing.xs, paddingTop: Spacing.xl, paddingBottom: Spacing.sm },
});
