import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenScroll } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { Radius, Spacing } from '@/constants/theme';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { restFor } from '@/db/exercises';
import { prefetch, prefetchLiveQuery, useLiveQuery } from '@/db/live';
import { getDay, getNextDay, getPrograms, setActiveProgram, type DaySummary, type ProgramDay } from '@/db/programs';
import { dayScreen } from '@/db/screens';
import { getActiveWorkout, getWorkoutHistory, startWorkout, type WorkoutSummary } from '@/db/workouts';
import { useAgenda } from '@/hooks/use-agenda';
import { useClock } from '@/hooks/use-clock';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, daysBetween, daysFrom, formatRecent, formatShortDate, formatWeekdayAndDay, weekOf, type DateKey } from '@/lib/dates';
import { muscleLabel } from '@/lib/exercises';
import { countLabel, formatNumber } from '@/lib/format';
import { formatDuration, formatWorkoutLength } from '@/lib/training';
import { buildTrainingLine, type LineRow } from '@/lib/training-line';
import { endWorkout } from '@/services/end-workout';
import { haptics } from '@/services/haptics';

type Period = 'week' | 'month' | 'year';
const PERIODS = [
  { key: 'week', label: 'Settimana' },
  { key: 'month', label: 'Mese' },
  { key: 'year', label: 'Anno' },
] as const;

/** Exercises listed in the open day; the rest are counted. */
const SHOWN_EXERCISES = 5;

/**
 * The gym, in three parts that look different from each other: the program on top, as a line that
 * follows time, with the next workout open; how the week, month or year went, in numbers; and the
 * archive (the past workouts and the exercise library) as two tiles.
 */
export default function TrainingScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const { names } = useExerciseNames();
  const { data } = useLiveQuery(
    'training-home',
    async (database) => {
      const [active, next, programs, history] = await Promise.all([
        getActiveWorkout(database),
        getNextDay(database),
        getPrograms(database),
        getWorkoutHistory(database),
      ]);
      // Every day of the program in use, with its exercises, so whichever is picked opens at once.
      const days = next ? await Promise.all(next.program.days.map((d) => getDay(database, d.id))) : [];
      return { active, next, programs, history, days: days.filter((d): d is ProgramDay => d !== null) };
    },
    ['training', 'settings'],
  );
  // The gym days to come in the calendar, so this page says the same: which day, and when.
  const soon = useAgenda(today, addDays(today, 13), today);
  const gymTypeId = soon.data?.gymTypeId ?? null;
  const upcoming = daysFrom(today, addDays(today, 13))
    .flatMap((date) => soon.agenda.get(date) ?? [])
    .flatMap((i) =>
      i.kind === 'activity' && i.status === 'planned' && i.occurrence.typeId === gymTypeId && i.dayId !== null
        ? [{ date: i.occurrence.date, time: i.occurrence.time, dayId: i.dayId }]
        : [],
    );
  const hasGymDays = (soon.data?.plans ?? []).some((p) => p.typeId === gymTypeId);
  const breath = useBreath(Boolean(data?.active));
  // While the workout sheet rises, this page stays as it was; the card changes once covered.
  const [starting, setStarting] = useState(false);
  const [period, setPeriod] = useState<Period>('week');

  const start = async (dayId: number | null) => {
    setStarting(true);
    await startWorkout(db, { dayId });
    // The sheet rises with the exercises already in it.
    await prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
    haptics.success();
    router.push('/workout');
    setTimeout(() => setStarting(false), 700);
  };

  const endActive = async () => {
    if (!data?.active) return;
    const id = data.active.id;
    if ((await endWorkout(db, id, { confirm: true })) === 'finished') {
      router.push({ pathname: '/workout-summary', params: { id } });
    }
  };

  const programs = data?.programs ?? [];
  const history = data?.history ?? [];
  const next = data?.next ?? null;
  const openDay = (dayId: number) => {
    void prefetch(db, dayScreen(dayId));
    router.push({ pathname: '/training/day', params: { id: dayId } });
  };

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Nuovo">
          <Stack.Toolbar.MenuAction icon="figure.strengthtraining.traditional" onPress={() => void start(null)}>
            Allenamento libero
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="list.bullet.rectangle" onPress={() => router.push('/training/new')}>
            Nuova scheda
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {/* The workout in progress comes before everything: the whole card opens it. */}
      {data?.active && !starting ? (
        <Animated.View key="active" entering={HERO_IN} exiting={HERO_OUT} style={styles.activeSlot}>
          <PressableScale
            onPressIn={() => void prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS)}
            onPress={() => router.push('/workout')}
            accessibilityRole="button"
            accessibilityHint="Apre l’allenamento">
            <Card style={styles.hero}>
              <Breathing breath={breath} />
              <View style={styles.heroTop}>
                <LiveDot breath={breath} />
                <AppText variant="footnote" weight="600" tone="accent" style={styles.flex}>
                  IN CORSO
                </AppText>
                <Icon name="chevron.right" size={14} tone="accent" weight="semibold" />
              </View>
              <View style={styles.heroName}>
                <DayBadge icon={data.active.icon} size={40} />
                <View style={styles.flex}>
                  <AppText variant="title" numberOfLines={1}>
                    {data.active.name}
                  </AppText>
                  <Elapsed since={data.active.startedAt} />
                </View>
                {/* Small and to the side: ending is a rare, deliberate act here. */}
                <Pressable
                  onPress={() => void endActive()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Termina allenamento"
                  style={({ pressed }) => [styles.end, { backgroundColor: theme.fill }, pressed && styles.pressed]}>
                  <AppText variant="subhead" weight="600" tone="danger">
                    Termina
                  </AppText>
                </Pressable>
              </View>
            </Card>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* 1 · The program. */}
      {next ? (
        <Animated.View layout={LAYOUT}>
          <MenuButton
            icon="chevron.down"
            accessibilityLabel={`Scheda in uso: ${next.program.name}. Cambia o gestisci le schede`}
            groups={[
              {
                title: 'Le tue schede',
                actions: programs.map((p) => ({
                  label: p.name,
                  checked: p.active,
                  onPress: () => {
                    if (p.active) return;
                    haptics.selection();
                    void setActiveProgram(db, p.id);
                  },
                })),
              },
              {
                actions: [
                  {
                    label: `Modifica ${next.program.name}`,
                    icon: 'pencil',
                    onPress: () => router.push({ pathname: '/training/program', params: { id: next.program.id } }),
                  },
                  { label: 'Tutte le schede', icon: 'list.bullet.rectangle', onPress: () => router.push('/training/programs') },
                  { label: 'Nuova scheda', icon: 'plus', onPress: () => router.push('/training/new') },
                ],
              },
            ]}>
            <View style={styles.programTitle}>
              <AppText variant="title3" numberOfLines={1} style={styles.shrink}>
                {next.program.name}
              </AppText>
              <Icon name="chevron.down" size={14} tone="accent" weight="semibold" />
            </View>
          </MenuButton>
          <TrainingLine
            rows={buildTrainingLine({ history, dayIds: next.program.days.map((d) => d.id), nextId: next.day.id, upcoming })}
            days={next.program.days}
            details={data?.days ?? []}
            today={today}
            canStart={!data?.active}
            names={names}
            onOpenDay={openDay}
            onStart={(dayId) => void start(dayId)}
            onOpenWorkout={(id) => router.push({ pathname: '/training/session', params: { id } })}
          />
          {/* Without gym days in the calendar there is no "today": one tap sets them up. */}
          {soon.data && gymTypeId !== null && !hasGymDays ? (
            <ListGroup style={styles.setup}>
              <Row
                icon={<Icon name="calendar.badge.plus" size={20} tone="accent" />}
                title="Scegli i giorni di palestra"
                subtitle="Il calendario ti dirà cosa fare ogni giorno"
                onPress={() => router.push({ pathname: '/activity', params: { type: gymTypeId, repeat: '1' } })}
              />
            </ListGroup>
          ) : null}
        </Animated.View>
      ) : data ? (
        <Card style={styles.hero}>
          <Icon name="list.bullet.rectangle.portrait" size={28} tone="accent" />
          <AppText variant="title2">Crea una scheda</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Da un modello, come Push Pull Legs, o da zero.
          </AppText>
          <View style={styles.heroButton}>
            <Button title="Nuova scheda" onPress={() => router.push('/training/new')} />
            <Button title="Allenamento libero" variant="plain" compact onPress={() => void start(null)} />
          </View>
        </Card>
      ) : null}

      {/* 2 · How it went, in numbers. */}
      {data ? (
        <Animated.View layout={LAYOUT}>
          <AppText variant="title3" style={styles.sectionTitle}>
            Riepilogo
          </AppText>
          <Segmented options={PERIODS} value={period} onChange={setPeriod} />
          <Summary history={history} period={period} today={today} />
        </Animated.View>
      ) : null}

      {/* 3 · The archive, as tiles: not rows that look like the program's days. */}
      {data ? (
        <Animated.View layout={LAYOUT}>
          <AppText variant="title3" style={styles.sectionTitle}>
            Archivio
          </AppText>
          <View style={styles.tiles}>
            <Tile
              symbol="clock.arrow.circlepath"
              label="Storico"
              detail={countLabel(history.length, 'allenamento', 'allenamenti')}
              onPress={() => router.push('/training/history')}
            />
            <Tile symbol="books.vertical" label="Esercizi" detail="La libreria" onPress={() => router.push('/training/exercises')} />
          </View>
        </Animated.View>
      ) : null}
    </ScreenScroll>
  );
}

type TrainingLineProps = {
  rows: readonly LineRow<WorkoutSummary>[];
  days: readonly DaySummary[];
  details: readonly ProgramDay[];
  today: DateKey;
  canStart: boolean;
  names: ReturnType<typeof useExerciseNames>['names'];
  onOpenDay: (dayId: number) => void;
  onStart: (dayId: number) => void;
  onOpenWorkout: (id: number) => void;
};

/**
 * The program on a line that follows time: what was done above, the next workout, what comes after
 * below, so a day done never shows among those to come. Tapping a row only opens it: a day done
 * shows how it went, a day to come its exercises and "Inizia", on any day, whatever the plan says.
 */
function TrainingLine({ rows, days, details, today, canStart, names, onOpenDay, onStart, onOpenWorkout }: TrainingLineProps) {
  const theme = useTheme();
  // One row open at a time: the next workout, until another is picked.
  const nextKey = rows.find((r) => r.kind === 'next')?.key ?? null;
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const openKey = picked === undefined || (picked !== null && !rows.some((r) => r.key === picked)) ? nextKey : picked;
  const toggle = (key: string) => {
    haptics.selection();
    setPicked(openKey === key ? null : key);
  };

  return (
    <View style={styles.line}>
      {rows.map((row, index) => {
        const dotY = row.kind === 'next' ? NEXT_DOT_Y : DOT_Y;
        const first = index === 0;
        const last = index === rows.length - 1;
        const open = row.key === openKey;
        const day = row.kind === 'past' ? null : days.find((d) => d.id === row.dayId);
        return (
          <Animated.View key={row.key} layout={LAYOUT} style={styles.step}>
            <View style={styles.rail}>
              {rows.length > 1 ? (
                <View style={[styles.lineSegment, { backgroundColor: theme.separator }, first ? { top: dotY } : { top: 0 }, last ? { height: dotY } : { bottom: 0 }]} />
              ) : null}
              <View style={[styles.dotSlot, { top: dotY - 7 }]}>
                {row.kind === 'next' ? (
                  <View style={[styles.dotCurrent, { borderColor: theme.accent, backgroundColor: theme.background }]} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: row.kind === 'past' ? theme.accent : theme.separator }]} />
                )}
              </View>
            </View>
            <View style={styles.stepBody}>
              <View style={[styles.dayCard, { backgroundColor: theme.card }]}>
                {row.kind === 'past' ? (
                  <PastDay workout={row.workout} today={today} open={open} onToggle={() => toggle(row.key)} onOpen={() => onOpenWorkout(row.workout.id)} />
                ) : day ? (
                  <ComingDay
                    day={day}
                    detail={details.find((d) => d.id === day.id) ?? null}
                    isNext={row.kind === 'next'}
                    when={comingLabel(row, today)}
                    open={open}
                    canStart={canStart}
                    names={names}
                    onToggle={() => toggle(row.key)}
                    onEdit={() => onOpenDay(day.id)}
                    onStart={() => onStart(day.id)}
                  />
                ) : null}
              </View>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** "Oggi · 21:00", "Mer 4 · 21:00", or "Dopo" for a day the calendar has no date for yet. */
function comingLabel(row: Exclude<LineRow<WorkoutSummary>, { kind: 'past' }>, today: DateKey): string {
  if (row.date === null) return row.kind === 'next' ? '' : 'Dopo';
  const away = daysBetween(today, row.date);
  const day = away === 0 ? 'Oggi' : away === 1 ? 'Domani' : formatWeekdayAndDay(row.date);
  return [day, row.time].filter(Boolean).join(' · ');
}

/** A workout done, and once open how it went. */
function PastDay({ workout, today, open, onToggle, onOpen }: { workout: WorkoutSummary; today: DateKey; open: boolean; onToggle: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const when = (formatRecent(workout.date, today) ?? formatShortDate(workout.date)).toLowerCase();
  const seconds = (new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000;
  return (
    <>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${workout.name}, fatto ${when}`}
        style={({ pressed }) => [styles.dayHead, pressed && { backgroundColor: theme.cardPressed }]}>
        <DayBadge icon={workout.icon} size={28} />
        <AppText numberOfLines={1} tone="textSecondary" style={styles.flex}>
          {workout.name}
        </AppText>
        <AppText variant="footnote" tone="accent" numberOfLines={1}>
          {`✓ ${when}`}
        </AppText>
      </Pressable>
      {open ? (
        <Animated.View entering={DAY_IN} style={styles.dayOpen}>
          <AppText variant="subhead" tone="textSecondary" numeric>
            {[formatWorkoutLength(seconds), `${workout.workSets} serie`, formatLifted(workout.tonnage)].join(' · ')}
          </AppText>
          <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.dayLink, pressed && styles.pressed]}>
            <AppText variant="subhead" weight="600" tone="accent">
              Apri allenamento
            </AppText>
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

/** A day of the program to come, and once open its exercises and "Inizia". */
function ComingDay({
  day,
  detail,
  isNext,
  when,
  open,
  canStart,
  names,
  onToggle,
  onEdit,
  onStart,
}: {
  day: DaySummary;
  detail: ProgramDay | null;
  isNext: boolean;
  when: string;
  open: boolean;
  canStart: boolean;
  names: TrainingLineProps['names'];
  onToggle: () => void;
  onEdit: () => void;
  onStart: () => void;
}) {
  const theme = useTheme();
  const exercises = detail?.exercises ?? [];
  const rest = exercises.length - SHOWN_EXERCISES;
  const meta = [
    rest > 0 ? `+ ${countLabel(rest, 'altro esercizio', 'altri esercizi')}` : null,
    exercises.length > 0 ? `circa ${formatWorkoutLength(estimateSeconds(detail))}` : 'Nessun esercizio',
    day.muscles.slice(0, 2).map(muscleLabel).join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Pressable
        onPress={onToggle}
        onLongPress={onEdit}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[day.name, isNext ? 'prossimo' : null, when].filter(Boolean).join(', ')}
        accessibilityHint="Tieni premuto per modificarlo"
        style={({ pressed }) => [styles.dayHead, pressed && { backgroundColor: theme.cardPressed }]}>
        <DayBadge icon={day.icon} size={isNext ? 36 : 28} />
        <View style={styles.flex}>
          {isNext ? (
            <AppText variant="footnote" weight="600" tone="accent">
              PROSSIMO
            </AppText>
          ) : null}
          <AppText variant={isNext ? 'title2' : undefined} numberOfLines={1}>
            {day.name}
          </AppText>
        </View>
        <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
          {when}
        </AppText>
      </Pressable>
      {open ? (
        <Animated.View entering={DAY_IN} style={styles.dayOpen}>
          {exercises.length > 0 ? (
            <View style={styles.exercises}>
              {exercises.slice(0, SHOWN_EXERCISES).map((planned) => (
                <View key={planned.id} style={styles.exercise}>
                  <AppText variant="subhead" numberOfLines={1} style={styles.flex}>
                    {names(planned.exercise).title}
                  </AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {`${planned.sets} × ${planned.repMin}–${planned.repMax}`}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.dayMeta}>
            <AppText variant="footnote" tone="textSecondary" style={styles.flex}>
              {meta}
            </AppText>
            <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Modifica ${day.name}`} hitSlop={8} style={({ pressed }) => [styles.dayLink, pressed && styles.pressed]}>
              <AppText variant="footnote" weight="600" tone="accent">
                Modifica
              </AppText>
            </Pressable>
          </View>
          {canStart && exercises.length > 0 ? <Button title={`Inizia ${day.name}`} variant={isNext ? 'filled' : 'tinted'} onPress={onStart} /> : null}
        </Animated.View>
      ) : null}
    </>
  );
}

/** About how long a day takes: each set about 40 s of work plus its rest. */
function estimateSeconds(day: ProgramDay | null): number {
  if (!day) return 0;
  return day.exercises.reduce((sum, e) => sum + e.sets * (40 + (e.restSeconds ?? restFor(e.exercise))), 0);
}

/** "6,1 t" or "850 kg". */
function formatLifted(kg: number): string {
  return kg >= 1000 ? `${formatNumber(kg / 1000, 1)} t` : `${Math.round(kg)} kg`;
}

function periodStart(period: Period, today: DateKey): DateKey {
  if (period === 'week') return weekOf(today)[0];
  if (period === 'month') return `${today.slice(0, 7)}-01` as DateKey;
  return `${today.slice(0, 4)}-01-01` as DateKey;
}

/** The workouts of the week, month or year so far, as four numbers. */
function Summary({ history, period, today }: { history: readonly WorkoutSummary[]; period: Period; today: DateKey }) {
  const from = periodStart(period, today);
  const done = history.filter((w) => w.date >= from && w.date <= today);
  const seconds = done.reduce((sum, w) => sum + (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000, 0);
  const sets = done.reduce((sum, w) => sum + w.workSets, 0);
  const kg = done.reduce((sum, w) => sum + w.tonnage, 0);
  const stats = [
    { value: String(done.length), label: done.length === 1 ? 'allenamento' : 'allenamenti' },
    { value: done.length > 0 ? formatWorkoutLength(seconds) : '0 min', label: 'in palestra' },
    { value: String(sets), label: 'serie' },
    { value: formatLifted(kg), label: 'sollevati' },
  ];
  return (
    <View style={styles.stats}>
      {stats.map((s) => (
        <Card key={s.label} style={styles.stat}>
          <AppText variant="title2" numeric>
            {s.value}
          </AppText>
          <AppText variant="footnote" tone="textSecondary">
            {s.label}
          </AppText>
        </Card>
      ))}
    </View>
  );
}

function Tile({ symbol, label, detail, onPress }: { symbol: 'clock.arrow.circlepath' | 'books.vertical'; label: string; detail: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}>
      <Icon name={symbol} size={24} tone="accent" />
      <View>
        <AppText variant="headline">{label}</AppText>
        <AppText variant="footnote" tone="textSecondary">
          {detail}
        </AppText>
      </View>
    </Pressable>
  );
}

/** Where the dot sits on each step of the line, level with the day's name. */
const DOT_Y = 24;
const NEXT_DOT_Y = 34;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  activeSlot: { marginBottom: Spacing.lg },
  hero: { gap: Spacing.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  heroName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  heroButton: { marginTop: Spacing.md, gap: Spacing.xs },
  end: { paddingHorizontal: Spacing.md, height: 32, borderRadius: 16, justifyContent: 'center' },
  glow: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  live: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  programTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Spacing.xs },
  line: { marginTop: Spacing.xs },
  step: { flexDirection: 'row', gap: Spacing.sm },
  rail: { width: 16, alignItems: 'center' },
  lineSegment: { position: 'absolute', width: 2, left: 7 },
  dotSlot: { position: 'absolute', width: 16, height: 14, alignItems: 'center', justifyContent: 'center' },
  // The gap between the rows is in here, so the rail beside them runs on unbroken.
  stepBody: { flex: 1, minWidth: 0, paddingBottom: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotCurrent: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  dayCard: { borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  dayOpen: { gap: Spacing.md, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  dayMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dayLink: { alignSelf: 'flex-start', paddingVertical: Spacing.xs },
  exercises: { gap: Spacing.xs + 2 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  setup: { marginTop: Spacing.md },
  sectionTitle: { marginTop: Spacing.xl, marginBottom: Spacing.sm, paddingHorizontal: Spacing.xs },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  stat: { flexBasis: '48%', flexGrow: 1, gap: 2 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, gap: Spacing.sm, padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous', minHeight: 104 },
});

// The workout in progress fades in and out above the program; what is below slides to its new
// place instead of jumping, and the open day fades in when another one is picked.
const HERO_IN = FadeIn.duration(260);
const HERO_OUT = FadeOut.duration(160);
const LAYOUT = LinearTransition.duration(280).easing(Easing.out(Easing.cubic));
const DAY_IN = FadeIn.duration(200);

/**
 * The time since the workout started. It ticks on its own: the clock in the screen redrew the
 * whole page every second while a workout ran.
 */
function Elapsed({ since }: { since: string }) {
  const now = useClock(1000);
  return (
    <AppText variant="subhead" tone="textSecondary" numeric>
      {formatDuration((now - new Date(since).getTime()) / 1000)}
    </AppText>
  );
}

/** One beat shared by the card and its dot, so they breathe together: 0 → 1 → 0, about once a second each way. */
function useBreath(running: boolean): SharedValue<number> {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduced || !running) return;
    breath.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => breath.set(0);
  }, [breath, reduced, running]);
  return breath;
}

/** A soft green glow over the card of the workout in progress, as if it breathed. */
function Breathing({ breath }: { breath: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: breath.get() * 0.16 }));
  return <Animated.View pointerEvents="none" style={[styles.glow, { backgroundColor: theme.accent }, style]} />;
}

/** A small green dot with a halo that swells and fades in time with the card. */
function LiveDot({ breath }: { breath: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: 0.45 * breath.get(), transform: [{ scale: 1 + breath.get() * 1.3 }] }));
  return (
    <View style={styles.live}>
      <Animated.View style={[styles.liveRing, { backgroundColor: theme.accent }, style]} />
      <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
    </View>
  );
}
