import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  Keyframe,
  LayoutAnimationConfig,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withDelay,
  withRepeat,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable from 'react-native-sortables';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ProgressBar } from '@/components/progress';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { RangeFlag } from '@/components/range-flag';
import { SetTypeMenu } from '@/components/set-type-menu';
import { FoldChevron } from '@/components/fold-chevron';
import { Jiggle } from '@/components/jiggle';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { restFor, updateExerciseOptions } from '@/db/exercises';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { useLiveQuery } from '@/db/live';
import {
  addSet,
  deleteSet,
  deleteWorkout,
  removeWorkoutExercise,
  reorderWorkoutExercises,
  setWorkoutExerciseRest,
  updateSet,
  updateWorkoutNotes,
  type SetFields,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { loadIncrement, muscleLabel } from '@/lib/exercises';
import { formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import {
  bestOneRepMax,
  formatDuration,
  formatSet,
  progression,
  workoutProgress,
  type LoggedSet,
  type Progression,
} from '@/lib/training';
import { haptics } from '@/services/haptics';
import { endWorkout } from '@/services/end-workout';
import { restTimer, useRestTimer } from '@/services/rest-timer';

const REST_PRESETS = [60, 90, 120, 150, 180, 240];
const glass = isLiquidGlassAvailable();

/**
 * What comes after the set just ticked, for the rest timer: "Prossima serie: Lat pulldown · 3"
 * within the same exercise, "Prossimo esercizio: Seated cable row" when it changes.
 */
function nextLabel(workout: Workout, setId: number, title: (e: WorkoutExercise) => string): string {
  let current: WorkoutExercise | null = null;
  for (const ex of workout.exercises) {
    let ordinal = 0;
    for (const set of ex.sets) {
      if (set.type !== 'warmup') ordinal += 1;
      if (set.id === setId) {
        current = ex;
        continue;
      }
      if (current && !set.done) {
        if (ex === current) return `Prossima serie: ${title(ex)} · ${set.type === 'warmup' ? 'riscaldamento' : ordinal}`;
        return `Prossimo esercizio: ${title(ex)}`;
      }
    }
  }
  return 'Ultima serie completata';
}

/** The workout in progress. Swiping the sheet down keeps it running; it comes back from the bar above the tabs. */
export default function WorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  const [reordering, setReordering] = useState(false);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // The order just dragged into, shown until the saved order comes back from the database.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const { data } = useLiveQuery(ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  // Ending or cancelling it, the sheet keeps showing the workout while the summary covers it or
  // it slides away, instead of flashing "Nessun allenamento in corso".
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState<Workout | null>(null);
  if (data?.workout && data.workout !== shown) setShown(data.workout);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  const workout = data.workout ?? (closing ? shown : null);
  if (!workout) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Allenamento' }} />
        <AppText tone="textSecondary">Nessun allenamento in corso.</AppText>
        <Button title="Chiudi" variant="plain" onPress={() => router.back()} />
      </View>
    );
  }

  const exercises =
    localOrder && localOrder.length === workout.exercises.length
      ? localOrder.map((id) => workout.exercises.find((ex) => ex.id === id)).filter((ex) => ex !== undefined)
      : workout.exercises;
  const title = (e: WorkoutExercise) => names(e.exercise).title;
  // The set to do now is picked out, so the eye finds it at once after a rest.
  const progress = workoutProgress(exercises);
  const currentSetId = progress.current ? exercises[progress.current.exercise].sets[progress.current.set].id : null;

  const onSetDone = (setId: number, rest: number) => {
    restTimer.start(rest, nextLabel(workout, setId, title), { sound: data.sound });
  };

  const removeExercise = async (ex: WorkoutExercise) => {
    const done = ex.sets.filter((set) => set.done).length;
    const ok = await confirmDestructive({
      title: `Eliminare ${title(ex)}?`,
      message: done > 0 ? `${done === 1 ? '1 serie completata verrà eliminata' : `${done} serie completate verranno eliminate`}.` : undefined,
      action: 'Elimina esercizio',
    });
    if (!ok) return;
    haptics.light();
    await removeWorkoutExercise(db, ex.id);
  };

  const finish = async () => {
    setClosing(true);
    const result = await endWorkout(db, workout.id);
    if (!result) {
      setClosing(false);
      return;
    }
    // The summary covers this sheet straight away; closing it closes both.
    if (result === 'finished') router.push({ pathname: '/workout-summary', params: { id: workout.id } });
    else router.back();
  };

  const discard = async () => {
    const ok = await confirmDestructive({
      title: 'Annullare l’allenamento?',
      message: 'Le serie registrate verranno eliminate.',
      action: 'Annulla allenamento',
    });
    if (!ok) return;
    setClosing(true);
    await deleteWorkout(db, workout.id);
    restTimer.stop();
    router.back();
  };

  const editNotes = () =>
    Alert.prompt(
      'Note dell’allenamento',
      'Come è andata, sensazioni, dolori…',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Salva', onPress: (text?: string) => void updateWorkoutNotes(db, workout.id, text ?? '') },
      ],
      'plain-text',
      workout.notes ?? '',
    );

  // The scroll view is the first view of the screen, so iOS fades the page under the bar as
  // everywhere else; wrapped in another view, the title sat right on top of the sets.
  return (
    <>
      <ScreenScroll animatedRef={scrollRef}>
        {/* While reordering, a tap anywhere outside the exercises ends it, as on the Home Screen. */}
        <View onStartShouldSetResponder={() => reordering} onResponderRelease={() => setReordering(false)}>
        {/* The name with the time under it, in the bar at the top, as during a call. */}
        <Stack.Screen
          options={{ title: workout.name, headerTitle: () => <WorkoutTitle name={workout.name} startedAt={workout.startedAt} /> }}
        />
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.down" accessibilityLabel="Riduci: l’allenamento continua" onPress={() => router.back()} />
        </Stack.Toolbar>
        <Stack.Toolbar placement="right">
          {reordering ? (
            <Stack.Toolbar.Button variant="done" onPress={() => setReordering(false)}>
              Fine
            </Stack.Toolbar.Button>
          ) : (
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sull’allenamento">
              <Stack.Toolbar.MenuAction icon="flag.checkered" onPress={() => void finish()}>
                Termina allenamento
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="plus"
                onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'workout', id: workout.id } })}>
                Aggiungi esercizio
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="arrow.up.arrow.down"
                disabled={workout.exercises.length < 2}
                onPress={() => setReordering(true)}>
                Riordina esercizi
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="note.text" onPress={editNotes}>
                {workout.notes ? 'Modifica nota' : 'Aggiungi nota'}
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="xmark.circle" destructive onPress={() => void discard()}>
                Annulla allenamento
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          )}
        </Stack.Toolbar>

        {workout.notes ? (
          <Pressable onPress={editNotes} accessibilityRole="button" style={styles.notes}>
            <Icon name="note.text" size={15} tone="textSecondary" />
            <AppText variant="footnote" tone="textSecondary" style={styles.flex}>
              {workout.notes}
            </AppText>
          </Pressable>
        ) : null}

        {/* Rows already there when the screen opens appear with it; new sets slide in. */}
        <LayoutAnimationConfig skipEntering>
          {/*
            Hold an exercise to move it: all of them start to wobble, as apps on the Home Screen,
            the one held follows the finger, the others make room and the page scrolls at its
            edges. "Fine" ends the editing.
          */}
          <Sortable.Grid
            data={exercises}
            keyExtractor={(ex) => String(ex.id)}
            columns={1}
            rowGap={Spacing.lg}
            scrollableRef={scrollRef}
            autoScrollActivationOffset={100}
            dragActivationDelay={300}
            activeItemScale={1.03}
            inactiveItemOpacity={1}
            activeItemShadowOpacity={0.25}
            overDrag="vertical"
            // The block stays where it was grabbed instead of jumping to centre on the finger,
            // which threw tall exercises far above or below it.
            enableActiveItemSnap={false}
            hapticsEnabled
            onDragStart={() => setReordering(true)}
            onDragEnd={({ data: ordered }) => {
              if (ordered === exercises) return;
              setLocalOrder(ordered.map((ex) => ex.id));
              void reorderWorkoutExercises(
                db,
                ordered.map((ex) => ex.id),
              );
            }}
            renderItem={({ item: ex }) => (
              <Jiggle
                editing={reordering}
                inset={0}
                removeLabel={`Elimina ${title(ex)}`}
                onRemove={() => void removeExercise(ex)}>
                <ExerciseBlock
                  item={ex}
                  currentSetId={currentSetId}
                  names={names(ex.exercise)}
                  onSetDone={onSetDone}
                  onReorder={() => setReordering(true)}
                  onRemove={() => void removeExercise(ex)}
                />
              </Jiggle>
            )}
          />
        </LayoutAnimationConfig>

        <View style={[styles.footer, reordering && styles.dimmed]} pointerEvents={reordering ? 'none' : 'auto'}>
          <Button
            title="Aggiungi esercizio"
            variant="tinted"
            icon={<Icon name="plus" size={16} tone="accent" weight="semibold" />}
            onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'workout', id: workout.id } })}
          />
          <Button title="Termina allenamento" variant="stop" icon={<Icon name="flag.checkered" size={16} tone="danger" weight="semibold" />} onPress={() => void finish()} />
        </View>
        <View style={styles.bottomSpace} />
        </View>
      </ScreenScroll>
      <RestBar />
    </>
  );
}

type ExerciseBlockProps = {
  item: WorkoutExercise;
  currentSetId: number | null;
  names: { title: string; subtitle: string | null };
  onSetDone: (setId: number, rest: number) => void;
  /** Switches the screen to dragging the exercises into another order. */
  onReorder: () => void;
  onRemove: () => void;
};

/** Exercises folded by hand or once done, kept while the workout is closed and reopened. */
const folded = new Map<number, boolean>();
/** The load suggested from last time, once taken, by exercise of the workout. */
const taken = new Map<number, number>();

function ExerciseBlock({ item, currentSetId, names, onSetDone, onReorder, onRemove }: ExerciseBlockProps) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const { exercise } = item;
  const complete = item.sets.length > 0 && item.sets.every((set) => set.done);
  const [collapsed, setCollapsed] = useState(() => folded.get(item.id) ?? false);
  useEffect(() => {
    folded.set(item.id, collapsed);
  }, [item.id, collapsed]);
  // The last set ticked folds the exercise away, a moment later so the tick is seen first;
  // reopening one of its sets opens it again.
  const [wasComplete, setWasComplete] = useState(complete);
  const [autoFold, setAutoFold] = useState(false);
  if (complete !== wasComplete) {
    setWasComplete(complete);
    setAutoFold(complete);
    if (!complete) setCollapsed(false);
  }
  useEffect(() => {
    if (!autoFold) return;
    const timer = setTimeout(() => {
      setCollapsed(true);
      setAutoFold(false);
    }, 650);
    return () => clearTimeout(timer);
  }, [autoFold]);
  const best = bestSet(item.sets);
  const rest = item.restSeconds ?? restFor(exercise);
  const plan = item.repMin !== null && item.repMax !== null ? { min: item.repMin, max: item.repMax } : null;
  const range = plan ? `${plan.min}–${plan.max}${exercise.kind === 'time' ? ' s' : ''}` : null;
  const timed = exercise.kind === 'time';
  let ordinal = 0;

  // Last time against the planned range: all sets at the top means more load today, most of
  // them under the bottom means less. Taking the suggested weight fills the sets still to do.
  const advice = complete ? null : progression(item.previous, plan, exercise.kind, loadIncrement(exercise.equipment));
  const [weight, setWeight] = useState<number | null>(() => taken.get(item.id) ?? null);
  const takeWeight = (value: number) => {
    haptics.light();
    taken.set(item.id, value);
    setWeight(value);
  };
  const prefill = (index: number): LoggedSet | undefined => {
    const last = item.previous[index];
    if (weight === null) return last;
    return last ? { ...last, weight } : { type: 'normal', weight, reps: null, seconds: null, rir: null, done: false };
  };

  // Folded with the set to do now inside, the exercise keeps the frame of that set and says it.
  const currentIndex = item.sets.findIndex((set) => set.id === currentSetId);
  const holdsCurrent = collapsed && currentIndex >= 0;

  const editNote = () =>
    Alert.prompt(
      'Nota fissa',
      'Visibile in ogni allenamento con questo esercizio.',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Salva', onPress: (text?: string) => void updateExerciseOptions(db, exercise.id, { note: text ?? '' }) },
      ],
      'plain-text',
      exercise.note ?? '',
    );

  return (
    <View style={styles.exercise}>
      {holdsCurrent ? (
        <Animated.View
          entering={CURRENT_IN}
          exiting={SETS_OUT}
          pointerEvents="none"
          style={[styles.exerciseRing, { borderColor: `${theme.accent}8C` }]}
        />
      ) : null}
      <ListGroup>
        <View style={styles.exerciseHeader}>
          <Pressable
            onPress={() => {
              haptics.selection();
              setCollapsed(!collapsed);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsed }}
            accessibilityHint={collapsed ? 'Mostra le serie' : 'Nascondi le serie'}
            style={styles.exerciseTitle}>
            {complete ? (
              <Animated.View entering={DONE_IN}>
                <Icon name="checkmark.circle.fill" size={22} tone="accent" />
              </Animated.View>
            ) : null}
            <View style={styles.flex}>
              <AppText variant="headline" tone={complete ? 'text' : 'accent'} numberOfLines={collapsed ? 1 : undefined}>
                {names.title}
              </AppText>
              <AppText variant="footnote" tone={holdsCurrent ? 'accent' : 'textSecondary'} weight={holdsCurrent ? '600' : undefined} numberOfLines={1}>
                {holdsCurrent
                  ? `Ora: serie ${currentIndex + 1} di ${item.sets.length}`
                  : complete && best
                  ? `${item.sets.length === 1 ? '1 serie' : `${item.sets.length} serie`} · migliore ${formatSet(best, exercise.kind)}`
                  : [names.subtitle, range ? `${item.sets.length} × ${range}` : muscleLabel(exercise.muscle)].filter(Boolean).join(' · ')}
              </AppText>
            </View>
            <FoldChevron open={!collapsed} />
          </Pressable>
          <MenuButton
            icon="ellipsis.circle"
            accessibilityLabel={`Opzioni per ${names.title}`}
            groups={[
              {
                title: `Recupero dopo ogni serie: ${formatDuration(rest)}`,
                actions: REST_PRESETS.map((seconds) => ({
                  label: formatDuration(seconds),
                  icon: 'timer' as const,
                  checked: seconds === rest,
                  onPress: () => void setWorkoutExerciseRest(db, item.id, seconds),
                })),
              },
              {
                title: 'Blocchi',
                actions: [
                  {
                    label: exercise.trackRir ? 'Nascondi colonna RIR' : 'Mostra colonna RIR',
                    icon: 'gauge.with.dots.needle.33percent',
                    onPress: () => void updateExerciseOptions(db, exercise.id, { trackRir: !exercise.trackRir }),
                  },
                  { label: exercise.note ? 'Modifica nota fissa' : 'Aggiungi nota fissa', icon: 'pin', onPress: editNote },
                ],
              },
              {
                actions: [
                  { label: 'Riordina esercizi', icon: 'arrow.up.arrow.down', onPress: onReorder },
                  {
                    label: 'Sostituisci esercizio',
                    icon: 'arrow.triangle.2.circlepath',
                    onPress: () => router.push({ pathname: '/exercise-picker', params: { target: 'replace', id: item.id } }),
                  },
                  { label: 'Elimina esercizio', icon: 'trash', destructive: true, onPress: onRemove },
                ],
              },
            ]}
          />
        </View>
        {collapsed ? null : (
        <Animated.View entering={SETS_IN} exiting={SETS_OUT}>
        {exercise.note ? (
          <View style={styles.noteRow}>
            <Icon name="pin.fill" size={12} tone="warning" />
            <AppText variant="footnote" style={styles.flex}>
              {exercise.note}
            </AppText>
          </View>
        ) : null}
        {advice ? (
          <View style={styles.adviceRow}>
            <Icon
              name={advice.direction === 'up' ? 'arrow.up.circle.fill' : 'arrow.down.circle.fill'}
              size={20}
              tone={advice.direction === 'up' ? 'accent' : 'warning'}
            />
            <View style={styles.flex}>
              <AppText variant="subhead" weight="600">
                {adviceTitle(advice, exercise.kind)}
              </AppText>
              <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
                {`L’ultima volta ${advice.counts.join(', ')} ${timed ? 's' : 'rip'}${plan ? `, obiettivo ${range}` : ''}`}
              </AppText>
            </View>
            {advice.weight !== null && weight !== advice.weight && item.sets.some((set) => !set.done) ? (
              <Pressable
                onPress={() => advice.weight !== null && takeWeight(advice.weight)}
                accessibilityRole="button"
                accessibilityLabel={`Usa ${formatNumber(advice.weight, 2)} chili nelle serie da fare`}
                style={({ pressed }) => [styles.adviceButton, { backgroundColor: theme.accentSoft }, pressed && { opacity: 0.6 }]}>
                <AppText variant="subhead" weight="600" tone="accent">
                  Usa
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={styles.tableHead}>
          <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colSet}>
            SERIE
          </AppText>
          <AppText variant="caption" tone="textSecondary" weight="600" numberOfLines={1} style={styles.colPrev}>
            {exercise.trackRir ? 'ULTIMA' : 'ULTIMA VOLTA'}
          </AppText>
          {timed ? (
            <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colInput}>
              SECONDI
            </AppText>
          ) : (
            <>
              <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colInput}>
                {exercise.kind === 'bodyweight' ? '+KG' : 'KG'}
              </AppText>
              <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colInput}>
                RIP
              </AppText>
            </>
          )}
          {exercise.trackRir ? (
            <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colRir}>
              RIR
            </AppText>
          ) : null}
          <View style={styles.colCheck} />
        </View>
        {item.sets.map((set, index) => {
          const badge = set.type === 'warmup' ? 'R' : set.type === 'drop' ? 'D' : set.type === 'failure' ? 'C' : String(++ordinal);
          return (
            <Animated.View key={set.id} entering={FadeIn.duration(200)}>
            <SwipeToDelete onDelete={() => void deleteSet(db, set.id)}>
              <SetRow
                set={set}
                current={set.id === currentSetId}
                badge={badge}
                previous={item.previous[index]}
                prefill={prefill(index)}
                divided={index > 0}
                kind={exercise.kind}
                trackRir={exercise.trackRir}
                range={item.repMin !== null && item.repMax !== null ? { min: item.repMin, max: item.repMax } : null}
                onUpdate={(fields) => void updateSet(db, set.id, fields)}
                onComplete={async (fields) => {
                  await updateSet(db, set.id, { ...fields, done: true });
                  haptics.light();
                  onSetDone(set.id, rest);
                }}
                onDelete={() => void deleteSet(db, set.id)}
              />
            </SwipeToDelete>
            </Animated.View>
          );
        })}
        <ActionRow label="Aggiungi serie" symbol="plus" onPress={() => void addSet(db, item.id)} />
        </Animated.View>
        )}
      </ListGroup>
    </View>
  );
}

function toText(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? '' : numberToInput(value, decimals);
}

type SetRowProps = {
  set: WorkoutSet;
  /** The set to do now. */
  current: boolean;
  badge: string;
  previous: LoggedSet | undefined;
  /** What an untouched set starts from: last time's values, or the load suggested for today. */
  prefill: LoggedSet | undefined;
  /** Every set but the first has a faint line above it. */
  divided: boolean;
  kind: WorkoutExercise['exercise']['kind'];
  trackRir: boolean;
  /** The planned range of reps (or seconds), to flag a value well outside it. */
  range: { min: number; max: number } | null;
  onUpdate: (fields: SetFields) => void;
  onComplete: (fields: SetFields) => void;
  onDelete: () => void;
};

/**
 * One set: its number (tap for warm-up, drop or failure), what was done last time, the values
 * (already filled in with last time's, to change if needed) and the tick that closes the set.
 */
function SetRow({ set, current, badge, previous, prefill, divided, kind, trackRir, range, onUpdate, onComplete, onDelete }: SetRowProps) {
  const theme = useTheme();
  // A set not touched yet starts from what was done last time, so most sets are just a tick.
  const touched = set.done || set.weight !== null || set.reps !== null || set.seconds !== null;
  const start = touched ? set : prefill;
  const [weight, setWeight] = useState(toText(start?.weight));
  const [reps, setReps] = useState(toText(start?.reps, 0));
  const [seconds, setSeconds] = useState(toText(start?.seconds, 0));
  const [rir, setRir] = useState(toText(set.rir, 1));
  const [missing, setMissing] = useState(false);
  // Taking the suggested load fills the sets not touched yet with it.
  const startKey = touched ? 'set' : `${prefill?.weight}|${prefill?.reps}|${prefill?.seconds}`;
  const [seenStart, setSeenStart] = useState(startKey);
  if (startKey !== seenStart) {
    setSeenStart(startKey);
    if (!touched) {
      setWeight(toText(prefill?.weight));
      setReps(toText(prefill?.reps, 0));
      setSeconds(toText(prefill?.seconds, 0));
    }
  }

  const values = (): SetFields => {
    const r = parseDecimal(reps);
    const s = parseDecimal(seconds);
    return { weight: parseDecimal(weight), reps: r === null ? null : Math.round(r), seconds: s === null ? null : Math.round(s), rir: parseDecimal(rir) };
  };

  // Once a set is ticked, a count outside the planned range (often a typo, 20 for 10) turns
  // orange with a "!" on its corner that says what to do. Warm-ups and drop sets follow their
  // own counts.
  const counted = kind === 'time' ? set.seconds : set.reps;
  const outside =
    set.done &&
    range !== null &&
    counted !== null &&
    (set.type === 'normal' || set.type === 'failure') &&
    (counted > range.max || counted < range.min)
      ? counted > range.max
        ? 'above'
        : 'below'
      : null;
  const flag = outside && range && counted !== null
    ? {
        title: `${counted} ${kind === 'time' ? 'secondi' : counted === 1 ? 'ripetizione' : 'ripetizioni'}, ${outside === 'above' ? 'sopra' : 'sotto'} ${range.min}–${range.max}`,
        message:
          outside === 'above'
            ? kind === 'time'
              ? 'Troppo facile: la prossima volta rendilo più difficile.'
              : 'Il carico è leggero: la prossima volta aumentalo.'
            : kind === 'time'
              ? 'Troppo difficile: la prossima volta rendilo più facile.'
              : 'Il carico è pesante: la prossima volta riducilo.',
      }
    : null;

  const tick = () => {
    if (set.done) {
      haptics.selection();
      onUpdate({ done: false });
      return;
    }
    const filled = values();
    const ok = kind === 'time' ? filled.seconds !== null : filled.reps !== null;
    if (!ok) {
      haptics.error();
      setMissing(true);
      return;
    }
    setMissing(false);
    onComplete(filled);
  };

  const field = (value: string, onChange: (text: string) => void, placeholder: string, label: string, flagged = false) => (
    <>
    <TextInput
      value={value}
      onChangeText={(text) => {
        setMissing(false);
        onChange(text);
      }}
      onEndEditing={() => onUpdate(values())}
      placeholder={placeholder}
      placeholderTextColor={theme.textTertiary}
      keyboardType="decimal-pad"
      inputAccessoryViewButtonLabel="Fine"
      selectTextOnFocus
      editable={!set.done}
      accessibilityLabel={label}
      style={[
        styles.input,
        { backgroundColor: set.done ? 'transparent' : theme.fill, color: flagged ? theme.warning : theme.text },
        current && !set.done && { borderColor: `${theme.accent}66`, borderWidth: 1 },
        missing && { borderColor: theme.danger, borderWidth: 1.5 },
      ]}
    />
    {flagged && flag ? (
      <Animated.View entering={FLAG_IN} style={styles.flag}>
        <RangeFlag
          title={flag.title}
          message={flag.message}
          onFix={() => {
            haptics.selection();
            onUpdate({ done: false });
          }}
        />
      </Animated.View>
    ) : null}
    </>
  );

  return (
    <View style={set.done && { backgroundColor: `${theme.accent}1F` }}>
    {divided ? <View style={[styles.setDivider, { backgroundColor: theme.separator }]} /> : null}
    {/* The set to do now sits in a soft green frame that moves on as sets are ticked. */}
    {current ? (
      <Animated.View
        entering={CURRENT_IN}
        pointerEvents="none"
        style={[styles.currentRing, { borderColor: `${theme.accent}8C`, backgroundColor: `${theme.accent}0D` }]}
      />
    ) : null}
    <View style={styles.setRow}>
      <View style={styles.colSet}>
        <SetTypeMenu badge={badge} type={set.type} done={set.done} onChange={(type) => onUpdate({ type })} onDelete={onDelete} />
      </View>
      <AppText variant="subhead" tone="textSecondary" numeric numberOfLines={1} style={styles.colPrev}>
        {previous ? formatSet(previous, kind).replace(' kg ×', ' ×') : '—'}
      </AppText>
      {kind === 'time' ? (
        <View style={styles.colInput}>{field(seconds, setSeconds, 's', 'Secondi', outside !== null)}</View>
      ) : (
        <>
          <View style={styles.colInput}>{field(weight, setWeight, 'kg', 'Chili')}</View>
          <View style={styles.colInput}>{field(reps, setReps, 'rip', 'Ripetizioni', outside !== null)}</View>
        </>
      )}
      {trackRir ? <View style={styles.colRir}>{field(rir, setRir, '–', 'Ripetizioni in riserva')}</View> : null}
      <Pressable
        onPress={tick}
        hitSlop={6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.done }}
        accessibilityLabel={set.done ? 'Serie fatta, tocca per riaprirla' : 'Segna la serie come fatta'}
        style={({ pressed }) => [
          styles.colCheck,
          styles.check,
          set.done
            ? { backgroundColor: theme.accent }
            : { borderWidth: 2, borderColor: current ? theme.accent : theme.separator, backgroundColor: theme.card },
          pressed && { opacity: 0.6 },
        ]}>
        <Icon name="checkmark" size={15} weight="bold" color={set.done ? theme.onAccent : current ? theme.accent : theme.textTertiary} />
      </Pressable>
    </View>
    </View>
  );
}

/**
 * The time of the workout, big in the bar at the top, with its name small above it. It ticks on
 * its own: the rest of the screen does not redraw every second, which got in the way of dragging.
 */
function WorkoutTitle({ name, startedAt }: { name: string; startedAt: string }) {
  const theme = useTheme();
  const now = useClock(1000);
  const elapsed = formatDuration((now - new Date(startedAt).getTime()) / 1000);
  return (
    <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel={`${name}, ${elapsed}`}>
      <AppText variant="caption" weight="600" tone="textSecondary" numberOfLines={1}>
        {name.toUpperCase()}
      </AppText>
      <AppText numeric style={[styles.titleTime, { color: theme.accent }]}>
        {elapsed}
      </AppText>
    </View>
  );
}

/** "Sali a 82,5 kg", "Aggiungi carico", "Rendilo più facile": what last time asks of today. */
function adviceTitle(advice: Progression, kind: WorkoutExercise['exercise']['kind']): string {
  const up = advice.direction === 'up';
  if (advice.weight !== null) return `${up ? 'Sali' : 'Scendi'} a ${formatNumber(advice.weight, 2)} kg`;
  if (kind === 'time') return up ? 'Rendilo più difficile' : 'Rendilo più facile';
  if (kind === 'bodyweight') return up ? 'Aggiungi carico' : 'Togli carico o ripetizioni';
  return up ? 'Aumenta il carico' : 'Riduci il carico';
}

/** The heaviest set (by estimated 1RM, or reps, or seconds) of an exercise, for its folded line. */
function bestSet(sets: readonly WorkoutSet[]): WorkoutSet | null {
  const work = sets.filter((set) => set.done && set.type !== 'warmup');
  if (work.length === 0) return null;
  const score = (set: WorkoutSet) => bestOneRepMax([set]) ?? (set.weight ?? 0) * 1000 + (set.reps ?? 0) + (set.seconds ?? 0);
  return work.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/**
 * The rest, big at the bottom of the screen: countdown, what comes next, −15 / +15 and skip.
 * When it is over it turns into "Vai!" and stays, with the phone buzzing, until "Vai" is
 * pressed or the next set is ticked.
 */
function RestBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rest = useRestTimer();
  const now = useClock(250, rest !== null);

  // ±15 s: the time gives a little jump and the change floats up from it.
  const pop = useSharedValue(1);
  const [bump, setBump] = useState<{ id: number; label: string } | null>(null);
  const adjust = (delta: number) => {
    restTimer.adjust(delta);
    pop.set(withSequence(withTiming(1.14, { duration: 90 }), withSpring(1, { duration: 380, dampingRatio: 0.45 })));
    const id = Date.now();
    setBump({ id, label: delta > 0 ? `+${delta} s` : `−${-delta} s` });
    setTimeout(() => setBump((current) => (current?.id === id ? null : current)), 900);
  };
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  // "Salta": the bar empties and the time gives way to "Saltato" for a moment, then the panel
  // dissolves where it is, shrinking a little as it fades.
  const [skipping, setSkipping] = useState(false);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ scale: 0.9 + 0.1 * fade.get() }],
  }));
  const done = () => {
    restTimer.stop();
    setSkipping(false);
    fade.set(1);
  };
  const skip = () => {
    setSkipping(true);
    haptics.medium();
    fade.set(
      withDelay(
        750,
        withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(done);
        }),
      ),
    );
  };

  if (!rest) return null;
  const left = (rest.endsAt - now) / 1000;
  const over = left <= 0 && !skipping;
  // Green with the whole rest ahead, through orange, to red as it runs out.
  const fraction = Math.max(0, Math.min(1, left / rest.total));
  const barColor = over ? theme.accent : fraction > 0.5 ? mix(theme.ringCloser, theme.ringOnTarget, (fraction - 0.5) * 2) : mix(theme.ringFar, theme.ringCloser, fraction * 2);

  const content = (
    <>
      <View style={styles.restTop}>
        <View style={styles.flex}>
          <View>
            <AppText variant="footnote" weight="600" tone={over ? 'accent' : 'textSecondary'}>
              {skipping ? 'RECUPERO SALTATO' : over ? 'RECUPERO FINITO' : 'RECUPERO'}
            </AppText>
            {bump ? (
              // Beside the label, in the free space above the buttons.
              <Animated.View key={bump.id} entering={FLOAT_UP} style={styles.bump}>
                <AppText variant="footnote" weight="700" tone="warning" numeric>
                  {bump.label}
                </AppText>
              </Animated.View>
            ) : null}
          </View>
          <Animated.View style={[styles.restTimeRow, popStyle]}>
            {skipping ? (
              <Animated.View key="skipped" entering={SKIPPED_IN} style={styles.skipped}>
                <Icon name="forward.end.fill" size={26} tone="textSecondary" />
                <AppText style={[styles.restTime, { color: theme.textSecondary }]}>Saltato</AppText>
              </Animated.View>
            ) : (
              <AppText numeric style={[styles.restTime, { color: over ? theme.accent : theme.text }]}>
                {over ? 'Vai!' : formatDuration(Math.max(0, left))}
              </AppText>
            )}
          </Animated.View>
        </View>
        {over || skipping ? null : (
          <>
            <RestButton label="−15" accessibilityLabel="Togli 15 secondi" disabled={left <= 15} onPress={() => adjust(-15)} />
            <RestButton label="+15" accessibilityLabel="Aggiungi 15 secondi" onPress={() => adjust(15)} />
          </>
        )}
        {over ? (
          <RestButton label="Vai" accessibilityLabel="Inizia la prossima serie" onPress={() => restTimer.stop()} prominent pulse />
        ) : skipping ? null : (
          <RestButton label="Salta" accessibilityLabel="Salta il recupero" onPress={skip} prominent />
        )}
      </View>
      <ProgressBar value={skipping ? 0 : Math.max(0, left)} target={rest.total} color={barColor} height={6} />
      <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
        {rest.label}
      </AppText>
    </>
  );

  // It rises into place when a set is ticked and drops away when done; a skipped one has
  // already dissolved, so it just goes.
  return (
    <Animated.View
      entering={REST_IN}
      exiting={skipping ? undefined : REST_OUT}
      style={[styles.restSlot, { bottom: insets.bottom + Spacing.sm }, fadeStyle]}>
      {glass ? (
        <GlassView style={styles.restBar} glassEffectStyle="regular">
          {content}
        </GlassView>
      ) : (
        <View style={[styles.restBar, styles.restSolid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{content}</View>
      )}
    </Animated.View>
  );
}

/** Blend of two #RRGGBB colours: `t` = 0 gives `from`, 1 gives `to`. */
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t));
  return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
}

const REST_IN = FadeInDown.springify().damping(18).stiffness(180);
const REST_OUT = FadeOutDown.duration(320);
const DONE_IN = FadeIn.duration(250);
const CURRENT_IN = FadeIn.duration(260);
const FLAG_IN = ZoomIn.springify().damping(14).stiffness(260);
const SETS_IN = FadeIn.duration(200).delay(60);
const SETS_OUT = FadeOut.duration(120);
const SKIPPED_IN = FadeInDown.duration(220).withInitialValues({ transform: [{ translateY: 10 }] });
const FLOAT_UP = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 6 }] },
  20: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -26 }] },
}).duration(850);

/**
 * Round button of the rest bar that sinks under the finger and springs back. With `pulse` it
 * beats gently, to be found at a glance when the rest is over.
 */
function RestButton({
  label,
  accessibilityLabel,
  onPress,
  prominent = false,
  disabled = false,
  pulse = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
  pulse?: boolean;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const beat = useSharedValue(1);
  useEffect(() => {
    if (!pulse) return;
    beat.set(withRepeat(withSequence(withTiming(1.1, { duration: 450 }), withTiming(1, { duration: 450 })), -1));
    return () => beat.set(1);
  }, [pulse, beat]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() * beat.get() }] }));
  return (
    <Pressable
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={disabled && styles.restDisabled}
      onPressIn={() => scale.set(withSpring(0.86, { duration: 180, dampingRatio: 1 }))}
      onPressOut={() => scale.set(withSpring(1, { duration: 400, dampingRatio: 0.5 }))}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <Animated.View style={[styles.restButton, { backgroundColor: prominent ? theme.accent : theme.fill }, style]}>
        <AppText variant="headline" numeric style={{ color: prominent ? theme.onAccent : theme.text }}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  title: { alignItems: 'center', maxWidth: 220 },
  titleTime: { fontSize: 22, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  notes: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  exercise: {},
  // Around a folded exercise that holds the set to do now.
  exerciseRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderRadius: Radius.lg + 2,
    borderCurve: 'continuous',
    zIndex: 1,
  },
  adviceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  adviceButton: { paddingHorizontal: Spacing.md, height: 32, borderRadius: 16, justifyContent: 'center' },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: 60,
  },
  exerciseTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingRight: Spacing.xs },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  // A soft frame around the set to do now.
  currentRing: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 3,
    bottom: 3,
    borderWidth: 1.5,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  setDivider: { position: 'absolute', top: 0, left: Spacing.md + 44, right: Spacing.md, height: StyleSheet.hairlineWidth, opacity: 0.6 },
  // On the top right corner of the reps box.
  flag: { position: 'absolute', top: -8, right: -9 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  colSet: { width: 44, alignItems: 'center', textAlign: 'center' },
  colPrev: { flex: 1 },
  colInput: { width: 62, textAlign: 'center' },
  colRir: { width: 44, textAlign: 'center' },
  colCheck: { width: 40 },
  input: {
    height: 40,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  check: { height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: Spacing.xl, gap: Spacing.md },
  dimmed: { opacity: 0.4 },
  bottomSpace: { height: 170 },
  skipped: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  restDisabled: { opacity: 0.35 },
  restSlot: { position: 'absolute', left: Spacing.md, right: Spacing.md },
  restTimeRow: { alignSelf: 'flex-start', transformOrigin: 'left center' },
  bump: { position: 'absolute', left: 84, top: 0, width: 64 },
  restBar: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    borderRadius: 28,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  restSolid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 10px 30px rgba(0, 0, 0, 0.22)' },
  restTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  restTime: { fontSize: 44, lineHeight: 50, fontWeight: '700', fontVariant: ['tabular-nums'] },
  restButton: {
    minWidth: 56,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
