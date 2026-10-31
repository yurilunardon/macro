import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { EASE_OUT, project } from '@/components/motion';
import { ActivityCard, activityName, ChecklistSection, DayRing, PlanWeekStrip } from '@/components/plan-day';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { setActivityStatus, setPlanDay } from '@/db/calendar';
import { setDoseTaken } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useClock } from '@/hooks/use-clock';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useScrollTop } from '@/hooks/use-scroll-top';
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

  // "Oggi" with today already on screen, as in Calendar: back up to it, and its circle beats once.
  const scroll = useScrollTop();
  const [pulse, setPulse] = useState(0);
  const showToday = () => {
    if (date !== today) {
      select(today);
      return;
    }
    haptics.selection();
    void scroll.scrollToTop().then(() => setPulse((n) => n + 1));
  };

  // Swiping the day sideways goes to the one before or after, as the diary's pages: the day
  // follows the finger, slides out, and the next one comes in from the side it was pulled from.
  const dayX = useSharedValue(0);
  const pageWidth = useSharedValue(0);
  const step = (direction: number) => {
    select(addDays(date, direction));
    dayX.set(direction * pageWidth.get() * 0.35);
    dayX.set(withSpring(0, { duration: 420, dampingRatio: 1 }));
  };
  const swipe = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      dayX.set(event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      const projected = event.translationX + project(event.velocityX, 0.99);
      if (!event.canceled && Math.abs(projected) > pageWidth.get() * 0.3) {
        const direction = projected < 0 ? 1 : -1;
        dayX.set(
          withTiming(-direction * pageWidth.get(), { duration: 160, easing: EASE_OUT }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(step, direction);
          }),
        );
        return;
      }
      dayX.set(withSpring(0, { duration: 380, dampingRatio: 0.9, velocity: event.velocityX }));
    },
  });
  const dayStyle = useAnimatedStyle(() => {
    const w = pageWidth.get();
    return { transform: [{ translateX: dayX.get() }], opacity: w > 0 ? 1 - Math.min(1, Math.abs(dayX.get()) / w) * 0.6 : 1 };
  });

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
    <ScreenScroll scroll={scroll}>
      <Stack.Toolbar placement="left">
        {/* As in Calendar and in Alimentazione: always in the bar. */}
        <Stack.Toolbar.Button accessibilityLabel="Torna a oggi" onPress={showToday}>
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
        pulse={pulse}
        onSelect={select}
        onChangeWeek={(direction) => select(addDays(date, direction * 7))}
      />

      <GestureDetector gesture={swipe} touchAction="pan-y">
        <Animated.View style={dayStyle} onLayout={(event) => pageWidth.set(event.nativeEvent.layout.width)}>
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
        </Animated.View>
      </GestureDetector>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  empty: { gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.lg, borderCurve: 'continuous', marginTop: Spacing.lg },
});
