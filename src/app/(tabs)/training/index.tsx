import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
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
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { FoldChevron } from '@/components/fold-chevron';
import { restFor } from '@/db/exercises';
import { prefetch, useLiveQuery } from '@/db/live';
import { getDay, getNextDay, getPrograms, setActiveProgram, type DaySummary, type ProgramDay } from '@/db/programs';
import { dayScreen } from '@/db/screens';
import { getActiveWorkout, getWorkout, getWorkoutHistory, type Workout, type WorkoutSummary } from '@/db/workouts';
import { useAgenda } from '@/hooks/use-agenda';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useFrozen } from '@/hooks/use-frozen';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { useWorkoutStatus } from '@/hooks/use-workout-status';
import { addDays, daysBetween, daysFrom, formatMonthName, formatRecent, formatShortDate, formatWeekdayAndDay, monthOf, type DateKey } from '@/lib/dates';
import { isWarmUp, muscleLabel } from '@/lib/exercises';
import { countLabel } from '@/lib/format';
import { periodRange, totalsOf, workoutsBetween } from '@/lib/progress';
import { formatLifted, formatSetShort, formatWorkoutLength, formatWorkoutLengthShort, isWorkSet } from '@/lib/training';
import { buildTrainingLine, PAST_SHOWN, type LineRow } from '@/lib/training-line';
import { haptics } from '@/services/haptics';
import { openActiveWorkout, startAndOpenWorkout, useWorkoutStarting } from '@/services/start-workout';

/**
 * The gym, in three parts that look different from each other: the program on top, as a line that
 * follows time, with the next workout open; a card that opens the progress page; and the archive
 * (the past workouts, the programs and the exercise library) as tiles.
 */
export default function TrainingScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
  const { names } = useExerciseNames();
  // As a workout starts this page stays as it was, part of it still showing behind the rising sheet;
  // under the sheet its queries wait by themselves. Behind a page further in, on the other hand, it
  // keeps up: held until it came back, it all changed and jumped under the finger going back.
  const still = useWorkoutStarting();
  const { data: live } = useLiveQuery(
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
      // The sets of the workouts on the line, so they open at once.
      const past = await Promise.all(history.slice(0, PAST_SHOWN).map((w) => getWorkout(database, w.id)));
      return { active, next, programs, history, days: days.filter((d): d is ProgramDay => d !== null), past: past.filter((w): w is Workout => w !== null) };
    },
    ['training', 'settings'],
  );
  const data = useFrozen(live, still);
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

  const start = (dayId: number | null, name: string) => startAndOpenWorkout(db, router, dayId, name);
  // Asked for as such: no plan to compare it with.
  const startFree = () => startAndOpenWorkout(db, router, null, 'Allenamento libero', { anyTime: true });

  const programs = data?.programs ?? [];
  const history = data?.history ?? [];
  const next = data?.next ?? null;
  const rows = useFrozen(next ? buildTrainingLine({ history, dayIds: next.program.days.map((d) => d.id), nextId: next.day.id, upcoming, active: data?.active }) : [], still);
  const openDay = (dayId: number) => {
    void prefetch(db, dayScreen(dayId));
    router.push({ pathname: '/training/day', params: { id: dayId } });
  };

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Nuovo">
          <Stack.Toolbar.MenuAction icon="figure.strengthtraining.traditional" onPress={() => void startFree()}>
            Allenamento libero
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="list.bullet.rectangle" onPress={() => router.push('/training/new')}>
            Nuova scheda
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

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
            {/* Says what it is, with the system's mark for a button that picks one of many. */}
            <View style={styles.programTitle}>
              <AppText variant="caption" weight="600" tone="textSecondary">
                SCHEDA IN USO
              </AppText>
              <View style={styles.programName}>
                <AppText variant="title3" numberOfLines={1} style={styles.shrink}>
                  {next.program.name}
                </AppText>
                <Icon name="chevron.up.chevron.down" size={13} tone="accent" weight="semibold" />
              </View>
            </View>
          </MenuButton>
          <TrainingLine
            rows={rows}
            days={next.program.days}
            details={data?.days ?? []}
            past={data?.past ?? []}
            today={today}
            canStart={!data?.active}
            names={names}
            onOpenDay={openDay}
            onStart={(dayId, name) => void start(dayId, name)}
            onOpenWorkout={(id) => router.push({ pathname: '/training/session', params: { id } })}
            onResume={() => openActiveWorkout(db, router)}
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
            <Button title="Allenamento libero" variant="plain" compact onPress={() => void startFree()} />
          </View>
        </Card>
      ) : null}

      {/* 2 · How it is going: the numbers are on their own page. */}
      {data ? (
        <Animated.View layout={LAYOUT}>
          <AppText variant="title3" style={styles.sectionTitle}>
            Progressi
          </AppText>
          <ProgressCard history={history} today={today} onPress={() => router.push('/training/progress')} />
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
            <Tile
              symbol="list.bullet.rectangle"
              label="Schede"
              detail={countLabel(programs.length, 'scheda', 'schede')}
              onPress={() => router.push('/training/programs')}
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
  /** The workouts done on the line, with their sets. */
  past: readonly Workout[];
  today: DateKey;
  canStart: boolean;
  names: ReturnType<typeof useExerciseNames>['names'];
  onOpenDay: (dayId: number) => void;
  onStart: (dayId: number, name: string) => void;
  onOpenWorkout: (id: number) => void;
  onResume: () => void;
};

/**
 * The program on a line that follows time: what was done above, the next workout, what comes after
 * below, so a day done never shows among those to come. Tapping a row only opens or folds it,
 * leaving the others as they are: a day done shows how it went, a day to come its exercises and
 * "Inizia", on any day, whatever the plan says.
 */
function TrainingLine({ rows, days, details, past, today, canStart, names, onOpenDay, onStart, onOpenWorkout, onResume }: TrainingLineProps) {
  const theme = useTheme();
  const breath = useBreath(rows.some((r) => r.kind === 'active'));
  // The next workout starts open and the others folded; each then stays as it was left.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOpen = (row: LineRow<WorkoutSummary>) => toggled.get(row.key) ?? row.kind === 'next';
  const toggle = (row: LineRow<WorkoutSummary>) => {
    haptics.selection();
    setToggled(new Map(toggled).set(row.key, !isOpen(row)));
  };

  return (
    <View style={styles.line}>
      {rows.map((row, index) => {
        const dotY = row.kind === 'next' || row.kind === 'active' ? NEXT_DOT_Y : DOT_Y;
        const first = index === 0;
        const last = index === rows.length - 1;
        const open = isOpen(row);
        const day = row.kind === 'past' || row.kind === 'active' ? null : days.find((d) => d.id === row.dayId);
        return (
          <Animated.View key={row.key} layout={LAYOUT} style={styles.step}>
            <View style={styles.rail}>
              {rows.length > 1 ? (
                <View style={[styles.lineSegment, { backgroundColor: theme.separator }, first ? { top: dotY } : { top: 0 }, last ? { height: dotY } : { bottom: 0 }]} />
              ) : null}
              <View style={[styles.dotSlot, { top: dotY - 7 }]}>
                {row.kind === 'active' ? (
                  <LiveDot breath={breath} />
                ) : row.kind === 'next' ? (
                  <View style={[styles.dotCurrent, { borderColor: theme.accent, backgroundColor: theme.background }]} />
                ) : row.kind === 'past' ? (
                  // Done: the tick is on the line, so the row only has to say when.
                  <View style={[styles.dotDone, { backgroundColor: theme.accent }]}>
                    <Icon name="checkmark" size={11} weight="bold" color={theme.onAccent} />
                  </View>
                ) : (
                  <View style={[styles.dot, { backgroundColor: theme.separator }]} />
                )}
              </View>
            </View>
            <View style={styles.stepBody}>
              <View style={[styles.dayCard, { backgroundColor: row.kind === 'active' ? theme.accentSoft : theme.card }]}>
                {row.kind === 'active' ? (
                  <ActiveDay names={names} onResume={onResume} />
                ) : row.kind === 'past' ? (
                  <PastDay
                    workout={row.workout}
                    detail={past.find((w) => w.id === row.workout.id) ?? null}
                    today={today}
                    open={open}
                    names={names}
                    onToggle={() => toggle(row)}
                    onOpen={() => onOpenWorkout(row.workout.id)}
                  />
                ) : day ? (
                  <ComingDay
                    day={day}
                    detail={details.find((d) => d.id === day.id) ?? null}
                    isNext={row.kind === 'next'}
                    caption={comingCaption(row, today)}
                    open={open}
                    canStart={canStart}
                    names={names}
                    onToggle={() => toggle(row)}
                    onEdit={() => onOpenDay(day.id)}
                    onStart={() => onStart(day.id, day.name)}
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

/** "PROSSIMO · MER 4, 21:00", "VEN 6, 21:00", or "DOPO" for a day the calendar has no date for yet. */
function comingCaption(row: Extract<LineRow<WorkoutSummary>, { kind: 'next' | 'later' }>, today: DateKey): string {
  const away = row.date === null ? null : daysBetween(today, row.date);
  const day = row.date === null ? null : away === 0 ? 'Oggi' : away === 1 ? 'Domani' : formatWeekdayAndDay(row.date);
  const when = [day, row.time].filter(Boolean).join(', ');
  if (row.kind === 'next') return (when ? `Prossimo · ${when}` : 'Prossimo').toUpperCase();
  return (when || 'Dopo').toUpperCase();
}

/** The workout in progress, in its place on the line: how far along it is, and back to it. */
function ActiveDay({ names, onResume }: { names: TrainingLineProps['names']; onResume: () => void }) {
  const theme = useTheme();
  const status = useWorkoutStatus();
  if (!status) return null;
  const color = status.resting ? theme.warning : theme.accent;
  return (
    <Pressable onPress={onResume} accessibilityRole="button" accessibilityLabel={`${status.name} in corso, ${status.time}. Riprendi`} style={styles.activeDay}>
      <View>
        <AppText variant="caption" weight="600" numeric numberOfLines={1} style={{ color }}>
          {`${status.resting ? 'RECUPERO' : status.ready ? 'RECUPERO FINITO' : 'IN CORSO'} · ${status.time}`.toUpperCase()}
        </AppText>
        <AppText variant="title2" numberOfLines={1}>
          {status.name}
        </AppText>
      </View>
      <ProgressBar value={status.done} target={status.total} color={theme.accent} height={6} />
      <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
        {[`${status.done} di ${status.total} serie`, status.current ? `ora ${names(status.current.exercise).title}` : null].filter(Boolean).join(' · ')}
      </AppText>
      <Button title="Riprendi" onPress={onResume} />
    </Pressable>
  );
}

/** A workout done, with when above what, and once open how it went. */
function PastDay({
  workout,
  detail,
  today,
  open,
  names,
  onToggle,
  onOpen,
}: {
  workout: WorkoutSummary;
  detail: Workout | null;
  today: DateKey;
  open: boolean;
  names: TrainingLineProps['names'];
  onToggle: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const when = formatRecent(workout.date, today) ?? formatShortDate(workout.date);
  const seconds = (new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000;
  const metrics = [
    { label: 'durata', value: formatWorkoutLengthShort(seconds) },
    { label: 'serie', value: String(workout.workSets) },
    { label: 'sollevati', value: formatLifted(workout.tonnage) },
  ];
  return (
    <>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${workout.name}, fatto ${when.toLowerCase()}`}
        style={({ pressed }) => [styles.dayHead, pressed && { backgroundColor: theme.cardPressed }]}>
        <View style={styles.flex}>
          <AppText variant="caption" weight="600" tone="textSecondary" numberOfLines={1}>
            {when.toUpperCase()}
          </AppText>
          <AppText numberOfLines={1}>{workout.name}</AppText>
        </View>
        <FoldChevron open={open} />
      </Pressable>
      {open ? (
        <Animated.View entering={DAY_IN} style={styles.dayOpen}>
          <View style={styles.metrics}>
            {metrics.map((m) => (
              <View key={m.label} style={styles.metric}>
                <AppText variant="headline" numeric numberOfLines={1}>
                  {m.value}
                </AppText>
                <AppText variant="caption" tone="textSecondary">
                  {m.label}
                </AppText>
              </View>
            ))}
          </View>
          <View style={[styles.rule, { backgroundColor: theme.separator }]} />
          {(detail?.exercises ?? []).map((exercise) => {
            const sets = exercise.sets.filter(isWorkSet);
            return sets.length > 0 ? (
              <View key={exercise.id}>
                <AppText variant="subhead" numberOfLines={1}>
                  {names(exercise.exercise).title}
                </AppText>
                <AppText variant="footnote" tone="textSecondary" numeric>
                  {sets.map((set) => formatSetShort(set, exercise.exercise.kind)).join(' · ')}
                </AppText>
              </View>
            ) : null;
          })}
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
  caption,
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
  caption: string;
  open: boolean;
  canStart: boolean;
  names: TrainingLineProps['names'];
  onToggle: () => void;
  onEdit: () => void;
  onStart: () => void;
}) {
  const theme = useTheme();
  const exercises = detail?.exercises ?? [];
  const meta = [
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
        accessibilityLabel={`${day.name}, ${caption.toLowerCase()}`}
        accessibilityHint="Tieni premuto per modificarlo"
        style={({ pressed }) => [styles.dayHead, pressed && { backgroundColor: theme.cardPressed }]}>
        <View style={styles.flex}>
          <AppText variant="caption" weight="600" tone={isNext ? 'accent' : 'textSecondary'} numeric numberOfLines={1}>
            {caption}
          </AppText>
          <AppText variant={isNext ? 'title2' : undefined} numberOfLines={1}>
            {day.name}
          </AppText>
        </View>
        <FoldChevron open={open} />
      </Pressable>
      {open ? (
        <Animated.View entering={DAY_IN} style={styles.dayOpen}>
          {exercises.length > 0 ? (
            <View style={styles.exercises}>
              {exercises.map((planned) => (
                <View key={planned.id} style={styles.exercise}>
                  <AppText variant="subhead" numberOfLines={1} style={styles.flex}>
                    {names(planned.exercise).title}
                  </AppText>
                  {isWarmUp(planned.exercise) ? null : (
                    <AppText variant="subhead" tone="textSecondary" numeric>
                      {`${planned.sets} × ${planned.repMin}–${planned.repMax}`}
                    </AppText>
                  )}
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

/** The picture on the card: bars going up, whatever the month was like. */
const PROGRESS_PICTURE = [38, 62, 48, 78, 100];

/** A way into the progress page: this month's workouts. */
function ProgressCard({ history, today, onPress }: { history: readonly WorkoutSummary[]; today: DateKey; onPress: () => void }) {
  const theme = useTheme();
  const range = periodRange('month', today);
  const inside = workoutsBetween(history, range.from, range.to);
  const totals = totalsOf(inside);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Progressi: ${countLabel(totals.count, 'allenamento', 'allenamenti')} in ${formatMonthName(monthOf(today)).toLowerCase()}`}
      style={({ pressed }) => [styles.progressCard, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}>
      <View style={styles.flex}>
        <AppText variant="headline" numberOfLines={1}>
          {countLabel(totals.count, 'allenamento', 'allenamenti')}
        </AppText>
        <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
          {`${formatMonthName(monthOf(today))} · ${totals.sets} serie · ${formatLifted(totals.kg)}`}
        </AppText>
      </View>
      <View style={styles.miniBars}>
        {PROGRESS_PICTURE.map((height) => (
          <View key={height} style={[styles.miniBar, { height: `${height}%`, backgroundColor: theme.accent }]} />
        ))}
      </View>
      <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
    </Pressable>
  );
}

function Tile({ symbol, label, detail, onPress }: { symbol: 'clock.arrow.circlepath' | 'list.bullet.rectangle' | 'books.vertical'; label: string; detail: string; onPress: () => void }) {
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

/** Where the dot sits on each step of the line, in the middle of the row when folded. */
const DOT_Y = 29;
const NEXT_DOT_Y = 32;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  hero: { gap: Spacing.xs },
  heroButton: { marginTop: Spacing.md, gap: Spacing.xs },
  live: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  programTitle: { alignSelf: 'flex-start', justifyContent: 'center', gap: 1, minHeight: 44, paddingHorizontal: Spacing.xs },
  programName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2 },
  line: { marginTop: Spacing.xs },
  step: { flexDirection: 'row', gap: Spacing.sm },
  rail: { width: 20, alignItems: 'center' },
  lineSegment: { position: 'absolute', width: 2, left: 9 },
  dotSlot: { position: 'absolute', width: 20, height: 14, alignItems: 'center', justifyContent: 'center' },
  dotDone: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // The gap between the rows is in here, so the rail beside them runs on unbroken.
  stepBody: { flex: 1, minWidth: 0, paddingBottom: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotCurrent: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  dayCard: { borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 58, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  activeDay: { gap: Spacing.md, padding: Spacing.lg },
  dayOpen: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  metrics: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1, gap: 1 },
  rule: { height: StyleSheet.hairlineWidth },
  dayMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dayLink: { alignSelf: 'flex-start', paddingVertical: Spacing.xs },
  exercises: { gap: Spacing.xs + 2 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  setup: { marginTop: Spacing.md },
  sectionTitle: { marginTop: Spacing.xl, marginBottom: Spacing.sm, paddingHorizontal: Spacing.xs },
  progressCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 72, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous' },
  miniBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 36 },
  miniBar: { width: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', minHeight: 104 },
});

// What is below slides to its new place instead of jumping, and an open day fades in.
const LAYOUT = LinearTransition.duration(280).easing(Easing.out(Easing.cubic));
const DAY_IN = FadeIn.duration(200);

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
