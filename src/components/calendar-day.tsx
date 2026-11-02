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
import { formatDaySubtitle, formatDayTitle, type DateKey } from '@/lib/dates';
import { addMinutes, clockOf, type DayEntry } from '@/lib/plan';
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
 * is done, its activities, and a checklist of what to take and do, moment by moment.
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

  return (
    <View>
      {heading}
      <Animated.View entering={FADE_IN}>
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
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { minHeight: 700 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.lg, minHeight: 64 },
  empty: { gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.lg, borderCurve: 'continuous', marginTop: Spacing.lg },
});
