import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActivityCard, activityName, ChecklistSection, DayRing, PlanWeekStrip } from '@/components/plan-day';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { setActivityStatus, setPlanDay } from '@/db/calendar';
import { setDoseTaken } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useClock } from '@/hooks/use-clock';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import type { AgendaItem, StoredStatus } from '@/lib/calendar';
import { addDays, formatDaySubtitle, formatDayTitle, type DateKey } from '@/lib/dates';
import { addMinutes, clockOf, type DayEntry } from '@/lib/plan';
import { haptics } from '@/services/haptics';
import { logWeight } from '@/services/log-weight';
import { openAgendaItem } from '@/services/open-agenda-item';
import { startAndOpenWorkout } from '@/services/start-workout';

const DAY_IN = FadeIn.duration(180);

/**
 * The calendar, the tab behind the round button between the other two: one day at a time, with its
 * activities and a checklist of what to take and do, moment by moment, ticked as it is done.
 */
export default function CalendarScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const today = useToday();
  const now = clockOf(new Date(useClock(60_000)).toISOString());

  // null follows today, so the calendar moves on to the new day when it is opened tomorrow.
  const [picked, setPicked] = useState<DateKey | null>(null);
  const date = picked ?? today;
  const plan = useDayPlan(date, today);
  const gymTypeId = plan.calendar?.gymTypeId ?? null;
  const dayNames = plan.calendar?.dayNames ?? new Map<number, string>();

  const select = (day: DateKey) => {
    haptics.selection();
    setPicked(day === today ? null : day);
  };

  // Each day's main activity under it in the week: its colour, and its name for VoiceOver.
  const dots = new Map<DateKey, { color: string; label: string }>();
  for (const day of plan.week) {
    const first = (plan.agenda.get(day) ?? []).find((i) => i.kind === 'workout' || i.status !== 'skipped');
    if (!first) continue;
    const typeId = first.kind === 'workout' ? gymTypeId : first.occurrence.typeId;
    const type = typeId === null ? undefined : plan.types.get(typeId);
    dots.set(day, { color: colors[type?.color ?? 'green'], label: activityName(first, plan.types, gymTypeId, dayNames) });
  }

  // A tick shows at once, before the database has it: what the tap set, as long as the stored
  // state is still the one it was tapped from.
  const [ticks, setTicks] = useState<{ date: DateKey; byKey: Map<string, { done: boolean; from: boolean; at: string }> }>({
    date,
    byKey: new Map(),
  });
  const shown = (entry: DayEntry): DayEntry => {
    const tick = ticks.date === date ? ticks.byKey.get(entry.key) : undefined;
    if (!tick || tick.from !== entry.done || entry.kind !== 'supplement') return entry;
    return { ...entry, done: tick.done, takenAt: tick.done ? tick.at : null };
  };
  const sections = plan.sections.map((section) => ({ ...section, entries: section.entries.map(shown) }));
  let ticked = 0;
  sections.forEach((section, i) => section.entries.forEach((e, j) => (ticked += Number(e.done) - Number(plan.sections[i].entries[j].done))));
  const progress = { done: plan.progress.done + ticked, total: plan.progress.total };

  const main = plan.items.find((i) => i.kind === 'workout' || i.status !== 'skipped');
  const subtitle = [formatDaySubtitle(date, today), main ? activityName(main, plan.types, gymTypeId, dayNames) : 'Riposo'].join(' · ');

  const setStatus = (item: AgendaItem, status: StoredStatus) => {
    if (item.kind !== 'activity') return;
    haptics.selection();
    const o = item.occurrence;
    if (o.planId !== null) void setPlanDay(db, o.planId, o.date, { status });
    else if (o.recordId !== null) void setActivityStatus(db, o.recordId, status);
  };

  const tick = (entry: DayEntry) => {
    if (entry.kind === 'weighIn') {
      logWeight(db, date, entry.kg !== null ? { kg: entry.kg } : null, today);
      return;
    }
    const done = !entry.done;
    const byKey = new Map(ticks.date === date ? ticks.byKey : []);
    byKey.set(entry.key, { done, from: plan.sections.flatMap((s) => s.entries).find((e) => e.key === entry.key)?.done ?? entry.done, at: new Date().toISOString() });
    setTicks({ date, byKey });
    // The last thing of the day gets the success tap; every other tick the light one.
    if (done && progress.done + 1 === progress.total) haptics.success();
    else haptics.selection();
    void setDoseTaken(db, entry.supplement.id, date, entry.index, done);
  };
  const open = (entry: DayEntry) => {
    if (entry.kind === 'weighIn') router.push('/calendar/weight');
    else router.push({ pathname: '/supplement', params: { id: entry.supplement.id } });
  };

  const empty = plan.ready && plan.items.length === 0 && plan.sections.length === 0;

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="left">
        {/* As in Calendar and in Alimentazione: always in the bar, dimmed while today is on screen. */}
        <Stack.Toolbar.Button disabled={date === today} accessibilityLabel="Torna a oggi" onPress={() => select(today)}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Il piano" onPress={() => router.push('/calendar/plan')}>
          Il piano
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="calendar.badge.plus" onPress={() => router.push({ pathname: '/activity', params: { date } })}>
            Aggiungi un’attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="scalemass" onPress={() => router.push('/calendar/weight')}>
            Peso e misure
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="chart.bar.xaxis"
            onPress={() => router.push({ pathname: '/calendar/report', params: { period: 'month', anchor: `${date.slice(0, 7)}-01` } })}>
            Report
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="figure.volleyball" onPress={() => router.push('/calendar/activity-types')}>
            Tipi di attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Impostazioni
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <View style={styles.header}>
        <View style={styles.flex}>
          <AppText variant="title">{formatDayTitle(date, today)}</AppText>
          <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        {progress.total > 0 ? <DayRing done={progress.done} total={progress.total} /> : null}
      </View>

      <PlanWeekStrip
        week={plan.week}
        selected={date}
        today={today}
        dots={dots}
        onSelect={select}
        onChangeWeek={(direction) => select(addDays(date, direction * 7))}
      />

      <Animated.View key={date} entering={DAY_IN}>
        {plan.items.map((item) => {
          const name = activityName(item, plan.types, gymTypeId, dayNames);
          const type = item.kind === 'workout' ? (gymTypeId === null ? undefined : plan.types.get(gymTypeId)) : plan.types.get(item.occurrence.typeId);
          const plannedGym = item.kind === 'activity' && item.occurrence.typeId === gymTypeId && item.status === 'planned';
          return (
            <ActivityCard
              key={item.key}
              item={item}
              name={name}
              type={type}
              date={date}
              today={today}
              onStart={plannedGym && date === today ? () => void startAndOpenWorkout(db, router, item.dayId, name) : undefined}
              onOpen={() => openAgendaItem(router, item)}
              menu={[
                {
                  actions: [
                    { label: 'Modifica', icon: 'pencil', onPress: () => openAgendaItem(router, item) },
                    ...(item.kind === 'activity'
                      ? [
                          item.status === 'skipped'
                            ? { label: 'Rimetti in programma', icon: 'arrow.uturn.backward' as const, onPress: () => setStatus(item, 'planned') }
                            : { label: 'Salta', icon: 'forward.end' as const, onPress: () => setStatus(item, 'skipped') },
                        ]
                      : []),
                  ],
                },
              ]}
            />
          );
        })}

        {sections.map((section) => (
          <ChecklistSection
            key={section.moment.id}
            section={section}
            late={date < today || (date === today && now > addMinutes(section.time, 60))}
            onPress={tick}
            onLongPress={open}
          />
        ))}

        {empty ? (
          <View style={[styles.empty, { backgroundColor: theme.card }]}>
            <AppText variant="headline" align="center">
              Niente in programma
            </AppText>
            <AppText tone="textSecondary" align="center">
              Gli allenamenti, gli integratori e la pesata arrivano dal piano.
            </AppText>
            <Button title="Apri il piano" onPress={() => router.push('/calendar/plan')} />
          </View>
        ) : null}
      </Animated.View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  empty: { gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.lg, borderCurve: 'continuous', marginTop: Spacing.lg },
});
