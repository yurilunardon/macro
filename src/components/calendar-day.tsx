import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { setActivityStatus, setPlanDay } from '@/db/calendar';
import { setDoseTaken } from '@/db/supplements';
import { useClock } from '@/hooks/use-clock';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useFrozen } from '@/hooks/use-frozen';
import { useTheme } from '@/hooks/use-theme';
import type { AgendaItem, StoredStatus } from '@/lib/calendar';
import { hourRows, placeInRow, type HourBlock } from '@/lib/day-hours';
import { formatDaySubtitle, formatDayTitle, type DateKey } from '@/lib/dates';
import { addMinutes, clockOf, type DayEntry, type DaySection } from '@/lib/plan';
import { minutesOfClock } from '@/lib/week-layout';
import { haptics } from '@/services/haptics';
import { logWeight } from '@/services/log-weight';
import { openAgendaItem } from '@/services/open-agenda-item';
import { startAndOpenWorkout, useWorkoutStarting } from '@/services/start-workout';

import { AppText } from './app-text';
import { Button } from './button';
import type { DayPageProps } from './day-pager';
import { ActivityCard, activityName, ChecklistSection, DayRing } from './plan-day';

const FADE_IN = FadeIn.duration(180);

/**
 * One day of the calendar, a page of the pager as in the food diary: its title and how much of it
 * is done, then the day by the hour, as in Calendar, with its activities and what to take and do at
 * each moment, to tick there. An empty hour takes little room; the red line says where the day is.
 */
export const CalendarDay = memo(function CalendarDay({ date, today, interactive, onReady }: { date: DateKey; today: DateKey } & DayPageProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const now = clockOf(new Date(useClock(60_000)).toISOString());
  // Under the workout's rising sheet the page stays as it was; it changes once covered.
  const plan = useFrozen(useDayPlan(date, today), useWorkoutStarting());
  const gymTypeId = plan.calendar?.gymTypeId ?? null;
  const dayNames = plan.calendar?.dayNames ?? new Map<number, string>();

  const { ready } = plan;
  useEffect(() => {
    if (ready) onReady(date);
  }, [ready, date, onReady]);

  // A tick shows at once, before the database has it: what the tap set, as long as the stored
  // state is still the one it was tapped from.
  const [ticks, setTicks] = useState<Map<string, { done: boolean; from: boolean; at: string }>>(new Map());
  const shown = (entry: DayEntry): DayEntry => {
    const tick = ticks.get(entry.key);
    if (!tick || tick.from !== entry.done || entry.kind !== 'supplement') return entry;
    return { ...entry, done: tick.done, takenAt: tick.done ? tick.at : null };
  };
  const sections = plan.sections.map((section) => ({ ...section, entries: section.entries.map(shown) }));
  let ticked = 0;
  sections.forEach((section, i) => section.entries.forEach((e, j) => (ticked += Number(e.done) - Number(plan.sections[i].entries[j].done))));
  const progress = { done: plan.progress.done + ticked, total: plan.progress.total };

  const main = plan.items.find((i) => i.kind === 'workout' || i.status !== 'skipped');
  const subtitle = [formatDaySubtitle(date, today), ready ? (main ? activityName(main, plan.types, gymTypeId, dayNames) : 'Riposo') : null]
    .filter(Boolean)
    .join(' · ');

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
    const next = new Map(ticks);
    next.set(entry.key, { done, from: plan.sections.flatMap((s) => s.entries).find((e) => e.key === entry.key)?.done ?? entry.done, at: new Date().toISOString() });
    setTicks(next);
    // The last thing of the day gets the success tap; every other tick the light one.
    if (done && progress.done + 1 === progress.total) haptics.success();
    else haptics.selection();
    void setDoseTaken(db, entry.supplement.id, date, entry.index, done);
  };
  const open = (entry: DayEntry) => {
    if (entry.kind === 'weighIn') router.push('/calendar/weight');
    else router.push({ pathname: '/supplement', params: { id: entry.supplement.id } });
  };

  // The title belongs to the page, as in the diary: dragging, the days on either side come in with theirs.
  const heading = (
    <View style={styles.heading}>
      <View style={styles.flex}>
        <AppText variant="title">{formatDayTitle(date, today)}</AppText>
        <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      {progress.total > 0 ? <DayRing done={progress.done} total={progress.total} /> : null}
    </View>
  );

  // Until its data is there the day shows only its title, then the rest fades in: never a half-filled page.
  if (!ready) {
    return (
      <View>
        {heading}
        <View style={styles.loading} />
      </View>
    );
  }

  const activityCard = (item: AgendaItem) => {
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
        interactive={interactive}
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
  };

  // What falls at a time goes on the hours; an activity without one stays above them.
  const timeOf = (item: AgendaItem) => (item.kind === 'workout' ? clockOf(item.workout.startedAt) : item.occurrence.time);
  const blocks: HourBlock<{ item: AgendaItem } | { section: DaySection }>[] = [
    // A moment first when it falls with an activity: what is taken at its start comes before it.
    ...sections.map((section) => ({ key: section.moment.id, start: minutesOfClock(section.time), end: minutesOfClock(section.time), value: { section } })),
    ...plan.items.flatMap((item) => {
      const time = timeOf(item);
      if (time === null) return [];
      const start = minutesOfClock(time);
      const ended = item.kind === 'workout' ? item.workout.endedAt : null;
      const minutes = item.kind === 'workout' ? 0 : (item.occurrence.minutes ?? plan.types.get(item.occurrence.typeId)?.minutes ?? 60);
      return [{ key: item.key, start, end: ended ? minutesOfClock(clockOf(ended)) : start + minutes, value: { item } }];
    }),
  ];
  const nowMinute = date === today ? minutesOfClock(now) : null;
  const rows = hourRows(blocks);

  return (
    <View>
      {heading}
      <Animated.View entering={FADE_IN} style={styles.day}>
        {plan.items.filter((item) => timeOf(item) === null).map(activityCard)}

        {plan.items.length === 0 && plan.sections.length === 0 ? (
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

        <View>
          {rows.map((row, index) => {
            const nowAt = nowMinute === null ? null : placeInRow(row, nowMinute);
            // The time of the red line takes the place of the hour's when the two would touch.
            const before = index > 0 && nowMinute !== null ? placeInRow(rows[index - 1], nowMinute) : null;
            const hidden = (nowAt !== null && nowAt < 0.4) || (before !== null && before > 0.6);
            return (
              <View key={row.hour} style={styles.hour}>
                <View style={styles.gutter}>
                  {hidden ? null : (
                    <AppText variant="caption" tone="textSecondary" numeric style={styles.hourLabel}>
                      {`${String(row.hour).padStart(2, '0')}:00`}
                    </AppText>
                  )}
                </View>
                <View style={[styles.hourBody, { borderTopColor: theme.separator }]}>
                  {row.blocks.map((block) =>
                    'section' in block.value ? (
                      <ChecklistSection
                        key={block.key}
                        section={block.value.section}
                        late={date < today || (date === today && now > addMinutes(block.value.section.time, 60))}
                        onPress={tick}
                        onLongPress={open}
                      />
                    ) : (
                      activityCard(block.value.item)
                    ),
                  )}
                </View>
                {nowAt !== null ? (
                  <View pointerEvents="none" style={[styles.now, { top: `${nowAt * 100}%` }]}>
                    <AppText variant="caption" weight="700" numeric style={[styles.nowLabel, { color: theme.danger }]}>
                      {now}
                    </AppText>
                    <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
                    <View style={[styles.nowLine, { backgroundColor: theme.danger }]} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
});

const GUTTER = 44;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { minHeight: 700 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md, minHeight: 64 },
  day: { gap: Spacing.md },
  empty: { gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.lg, borderCurve: 'continuous' },
  // An empty hour takes this much: enough to read the day's shape, not a screen of nothing.
  hour: { flexDirection: 'row', minHeight: 30 },
  gutter: { width: GUTTER },
  hourLabel: { marginTop: -7 },
  hourBody: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.xs, gap: Spacing.xs },
  now: { position: 'absolute', left: 0, right: 0, height: 14, marginTop: -7, flexDirection: 'row', alignItems: 'center' },
  nowLabel: { width: GUTTER - 4 },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  nowLine: { flex: 1, height: 1.5 },
});
