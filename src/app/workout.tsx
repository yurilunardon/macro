import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  Keyframe,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withDelay,
  withRepeat,
  withTiming,
  type ExitAnimationsValues,
  type LayoutAnimation,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable from 'react-native-sortables';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ProgressBar } from '@/components/progress';
import { confirmDestructive, editText } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { RangeFlag } from '@/components/range-flag';
import { RestPicker } from '@/components/rest-picker';
import { SetTypeMenu } from '@/components/set-type-menu';
import { editButton } from '@/components/edit-button';
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
  type SetFields,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useSettled } from '@/hooks/use-settled';
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
import { useWorkoutStarting } from '@/services/start-workout';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

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

/** The exercises open while the sheet rises: about what fits on screen. The rest arrive as it lands. */
const FIRST_OPEN_EXERCISES = 2;

/** The workout in progress. Swiping the sheet down keeps it running; it comes back from the tab bar. */
export default function WorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  // "Modifica", as apps on the Home Screen: the exercises wobble, staying as they are, and can be
  // dragged or removed. Only the exercises change; sets are deleted with a swipe at any time.
  const [editing, setEditing] = useState(false);
  const scroll = useScrollTop();
  // The order just dragged into, shown until the saved order comes back from the database.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const [foldedIds, setFoldedIds] = useState<ReadonlySet<number>>(() => new Set(folded));
  const { data } = useLiveQuery(ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  // Ending or cancelling it, the sheet keeps showing the workout while the summary covers it or
  // it slides away, instead of flashing "Nessun allenamento in corso".
  const [closing, setClosing] = useState(false);
  // While the sheet slides up, the native menus and pickers of every set and exercise are drawn
  // as plain views: built all at once, their SwiftUI views made the slide stutter. They take
  // over once the sheet is up, when the exercises further down are built too.
  const settled = useSettled(700);
  // Just started: the sheet rises while the workout is being written, with its name already there.
  const starting = useWorkoutStarting();
  const { title: startingTitle } = useLocalSearchParams<{ title?: string }>();
  const [openedAt] = useState(() => new Date().toISOString());
  // A workout just started rises with its name only: its rows, all new at once, made the sheet
  // stutter on the way up. They come in together as it lands.
  const [justStarted] = useState(starting);
  const [shown, setShown] = useState<Workout | null>(null);
  if (data?.workout && data.workout !== shown) setShown(data.workout);
  // What a ticked set starts: the rest, with what comes next. Kept outside, so every set's
  // handler stays the same function and a tick redraws the set ticked, not every row.
  useEffect(() => {
    const current = data?.workout;
    latest.onSetDone = current
      ? (setId, rest) => restTimer.start(rest, nextLabel(current, setId, (e) => names(e.exercise).title), { sound: data.sound })
      : null;
  });

  // An exercise added lands in view, open: it is the one about to be done.
  const count = data?.workout?.exercises.length ?? 0;
  const lastCount = useRef(count);
  const adding = useRef(false);
  useEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (!grew || !adding.current) return;
    adding.current = false;
    // Once the picker has gone and the list has made room for it.
    const timer = setTimeout(() => scroll.ref.current?.scrollToEnd({ animated: true }), 350);
    return () => clearTimeout(timer);
  }, [count, scroll.ref]);

  const workout = data?.workout ?? (closing ? shown : null);
  if (!workout && !starting && data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Allenamento' }} />
        <AppText tone="textSecondary">Nessun allenamento in corso.</AppText>
        <Button title="Chiudi" variant="plain" onPress={() => router.back()} />
      </View>
    );
  }

  const allExercises = workout?.exercises ?? [];
  const exercises =
    localOrder && localOrder.length === allExercises.length
      ? localOrder.map((id) => allExercises.find((ex) => ex.id === id)).filter((ex) => ex !== undefined)
      : allExercises;
  // While the sheet rises only what is on screen is built: everything down to the second open
  // exercise. Each open one costs a row of inputs per set, and the sheet only leaves after this.
  let openSoFar = 0;
  const firstExercises = settled
    ? exercises
    : justStarted
      ? []
      : exercises.slice(
        0,
          exercises.findIndex((ex) => !foldedIds.has(ex.id) && ++openSoFar === FIRST_OPEN_EXERCISES) + 1 || exercises.length,
        );
  const title = (e: WorkoutExercise) => names(e.exercise).title;
  // The set to do now is picked out, so the eye finds it at once after a rest.
  const progress = workoutProgress(exercises);
  const currentSetId = progress.current ? exercises[progress.current.exercise].sets[progress.current.set].id : null;

  /** Folds and unfolds exercises; kept in `folded` while the sheet is closed and reopened. */
  const fold = (changes: readonly (readonly [number, boolean])[]) =>
    setFoldedIds((previous) => {
      const next = new Set(previous);
      for (const [id, value] of changes) {
        if (value) next.add(id);
        else next.delete(id);
      }
      folded.clear();
      for (const id of next) folded.add(id);
      return next;
    });

  // The last set of an exercise folds it away and opens the next one still to do, so with
  // everything folded the workout reads one exercise at a time.
  const onCompleted = (id: number) => {
    const at = exercises.findIndex((ex) => ex.id === id);
    const todo = (ex: WorkoutExercise) => ex.sets.some((set) => !set.done);
    const next = exercises.slice(at + 1).find(todo) ?? exercises.slice(0, at).find(todo);
    fold(next ? [[id, true], [next.id, false]] : [[id, true]]);
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
    if (!workout) return;
    Keyboard.dismiss();
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
    if (!workout) return;
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

  const addExercise = () => {
    if (!workout) return;
    adding.current = true;
    router.push({ pathname: '/exercise-picker', params: { target: 'workout', id: workout.id } });
  };

  // The scroll view is the first view of the screen, as iOS expects for the bar above it.
  return (
    <>
      <ScreenScroll scroll={scroll}>
        {/* While editing, a tap anywhere outside the exercises ends it, as on the Home Screen. */}
        <View onStartShouldSetResponder={() => editing} onResponderRelease={() => setEditing(false)}>
        {/* The time, big in the bar at the top, with the name of the workout above it. */}
        <Stack.Screen
          options={{
            title: workout?.name ?? startingTitle ?? 'Allenamento',
            headerTitle: () => (
              <WorkoutTitle
                name={workout?.name ?? startingTitle ?? 'Allenamento'}
                startedAt={workout?.startedAt ?? openedAt}
                onPress={editing ? () => setEditing(false) : undefined}
              />
            ),
          }}
        />
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.down" accessibilityLabel="Riduci: l’allenamento continua" onPress={() => router.back()} />
        </Stack.Toolbar>
        {/*
          As in Strong and Hevy, ending the workout is the one button on the right, green; the rest
          is in ⋯. While editing, only ✓ to stop.
        */}
        <Stack.Toolbar placement="right">
          {editing ? <Stack.Toolbar.Button {...editButton({ editing, onChange: setEditing })} /> : null}
          {editing ? null : (
            <Stack.Toolbar.Button
              // Filled in once there is a note.
              icon={workout?.notes ? 'note.text' : 'square.and.pencil'}
              accessibilityLabel={workout?.notes ? 'Nota dell’allenamento' : 'Aggiungi una nota'}
              onPress={() => workout && router.push({ pathname: '/workout-note', params: { id: workout.id, text: workout.notes ?? '' } })}
            />
          )}
          {editing ? null : (
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sull’allenamento">
            <Stack.Toolbar.MenuAction
              icon="pencil"
              onPress={() => {
                haptics.selection();
                setEditing(true);
              }}>
              Modifica esercizi
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="plus" onPress={addExercise}>
              Aggiungi esercizio
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="xmark.circle" destructive onPress={() => void discard()}>
              Annulla allenamento
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          )}
          {editing ? null : (
            <Stack.Toolbar.Button variant="prominent" separateBackground accessibilityLabel="Termina allenamento" onPress={() => void finish()}>
              Termina
            </Stack.Toolbar.Button>
          )}
        </Stack.Toolbar>

        {/* Keeps the first exercise's buttons out of the reach of the bar's own, which take touches a good way below it. */}
        <View style={styles.topSpace} />

        {/* Rows already there when the screen opens appear with it; new sets slide in. */}
        <LayoutAnimationConfig skipEntering>
          {/*
            Hold an exercise's name, or tap "Modifica": they wobble where they are, as apps on the
            Home Screen. Then one can be dragged: it follows the finger, the others make room and
            the page scrolls at its edges. ✓, or a tap outside them, ends the editing.
          */}
          <Sortable.Grid
            data={firstExercises}
            keyExtractor={(ex) => String(ex.id)}
            columns={1}
            rowGap={Spacing.lg}
            scrollableRef={scroll.ref}
            autoScrollActivationOffset={100}
            dragActivationDelay={300}
            activeItemScale={1.03}
            inactiveItemOpacity={1}
            activeItemShadowOpacity={0.25}
            overDrag="vertical"
            // The block stays where it was grabbed instead of jumping to centre on the finger,
            // which threw tall exercises far above or below it.
            enableActiveItemSnap={false}
            // Exercises added or removed fade, and the list's height follows them instead of
            // jumping, so what is under it slides too.
            itemEntering={EXERCISE_IN}
            itemExiting={EXERCISE_OUT}
            dimensionsAnimationType="worklet"
            hapticsEnabled
            // Out of edit mode a hold never fights the swipes on the sets.
            sortEnabled={editing}
            onDragEnd={({ data: ordered }) => {
              if (ordered === exercises) return;
              setLocalOrder(ordered.map((ex) => ex.id));
              void reorderWorkoutExercises(
                db,
                ordered.map((ex) => ex.id),
              );
            }}
            renderItem={({ item: ex }) => (
              <Jiggle editing={editing} inset={0} removeLabel={`Elimina ${title(ex)}`} onRemove={() => void removeExercise(ex)}>
                <ExerciseBlock
                  item={ex}
                  currentSetId={currentSetId}
                  names={names(ex.exercise)}
                  settled={settled}
                  editing={editing}
                  collapsed={foldedIds.has(ex.id)}
                  onEdit={() => setEditing(true)}
                  onFold={(value) => fold([[ex.id, value]])}
                  onCompleted={() => onCompleted(ex.id)}
                  onRemove={() => void removeExercise(ex)}
                />
              </Jiggle>
            )}
          />
        </LayoutAnimationConfig>

        <View style={[styles.footer, editing && styles.dimmed]} pointerEvents={editing ? 'none' : 'auto'}>
          <Button
            title="Aggiungi esercizio"
            variant="tinted"
            icon={<Icon name="plus" size={16} tone="accent" weight="semibold" />}
            onPress={addExercise}
          />
        </View>
        <View style={styles.bottomSpace} />
        </View>
      </ScreenScroll>
      {/* Out of edit mode, "Termina" waits at the bottom whenever no rest is running. */}
      <RestBar />
      <KeyboardBar />
    </>
  );
}

/** An exercise's fixed note: a tap changes or deletes it. */
function NoteRow({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Modifica o elimina la nota" style={styles.noteRow}>
      <Icon name="pin.fill" size={12} tone="warning" />
      <AppText variant="footnote" tone="text" style={styles.flex}>
        {text}
      </AppText>
    </Pressable>
  );
}

type ExerciseBlockProps = {
  item: WorkoutExercise;
  currentSetId: number | null;
  names: { title: string; subtitle: string | null };
  /** Edit mode: only to drag or remove. */
  editing: boolean;
  /** The sheet is up: native menus and pickers can be built. */
  settled: boolean;
  collapsed: boolean;
  /** Held on its name: edit mode starts. */
  onEdit: () => void;
  onFold: (collapsed: boolean) => void;
  /** Its last set was just ticked. */
  onCompleted: () => void;
  onRemove: () => void;
};

/** Exercises folded by hand or once done, kept while the workout is closed and reopened. */
const folded = new Set<number>();
/** The load suggested from last time, once taken, by exercise of the workout. */
const taken = new Map<number, number>();

function ExerciseBlock({ item: given, currentSetId, names, editing, settled, collapsed, onEdit, onFold, onCompleted, onRemove }: ExerciseBlockProps) {
  const db = useSQLiteContext();
  // A set deleted is gone at once, with "Annulla" for a few seconds, as every row in the app.
  const hidden = usePendingDeletes();
  const item = { ...given, sets: given.sets.filter((set) => !hidden.has(`set:${set.id}`)) };
  const theme = useTheme();
  const router = useRouter();
  const { exercise } = item;
  const complete = item.sets.length > 0 && item.sets.every((set) => set.done);
  // The last set ticked: a green light runs across the exercise and fades, then it folds away;
  // reopening one of its sets opens it again.
  const [wasComplete, setWasComplete] = useState(complete);
  const [change, setChange] = useState<'completed' | 'reopened' | null>(null);
  if (complete !== wasComplete) {
    setWasComplete(complete);
    setChange(complete ? 'completed' : 'reopened');
  }
  const sweep = useSharedValue(0);
  const glow = useSharedValue(0);
  const sweepStyle = useAnimatedStyle(() => ({ opacity: glow.get(), transform: [{ scaleX: sweep.get() }] }));
  useEffect(() => {
    if (change === null) return;
    if (change === 'completed') {
      haptics.success();
      sweep.set(0);
      sweep.set(withTiming(1, { duration: SWEEP_MS, easing: Easing.bezier(0.33, 0, 0.2, 1) }));
      glow.set(0.2);
      glow.set(withDelay(SWEEP_MS, withTiming(0, { duration: GLOW_OUT_MS, easing: Easing.out(Easing.quad) })));
    }
    const timer = setTimeout(
      () => {
        if (change === 'completed') onCompleted();
        else onFold(false);
        setChange(null);
      },
      change === 'completed' ? SWEEP_MS + 200 : 0,
    );
    return () => clearTimeout(timer);
    // Only the change matters; the callbacks are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change]);
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

  // Folded with the set to do now inside, the exercise is picked out as that set would be.
  const currentIndex = item.sets.findIndex((set) => set.id === currentSetId);
  const holdsCurrent = collapsed && currentIndex >= 0;

  const editNote = () =>
    editText({
      title: 'Nota fissa',
      message: 'Visibile in ogni allenamento con questo esercizio.',
      value: exercise.note,
      onSave: (text) => void updateExerciseOptions(db, exercise.id, { note: text }),
    });

  return (
    <View style={styles.exercise}>
      <ListGroup layout={BLOCK_LAYOUT}>
        <View style={styles.exerciseHeader}>
          {holdsCurrent && !editing ? (
            <Animated.View entering={CURRENT_IN} exiting={SETS_OUT} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.fill }]} />
          ) : null}
          {/* The name opens the exercise's history, charts and records, as in Strong; ⌄ folds it. */}
          <Pressable
            // In edit mode the whole block is the sortable list's, to drag.
            disabled={editing}
            onPress={() => router.push({ pathname: '/exercise-info', params: { id: exercise.id } })}
            onLongPress={() => {
              haptics.medium();
              onEdit();
            }}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityHint="Mostra storico e record. Tieni premuto per modificare gli esercizi"
            style={styles.exerciseTitle}>
            {complete ? (
              <Animated.View entering={DONE_IN}>
                <Icon name="checkmark.circle.fill" size={24} tone="accent" />
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
          </Pressable>
          <Pressable
            disabled={editing}
            onPress={() => {
              haptics.selection();
              onFold(!collapsed);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 2 }}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsed }}
            accessibilityLabel={collapsed ? 'Mostra le serie' : 'Nascondi le serie'}
            style={styles.fold}>
            <FoldChevron open={!collapsed} />
          </Pressable>
          {/* Still there in edit mode, so nothing moves; only the drag takes the block then. */}
          <MenuButton
            inert={editing || !settled}
            icon="ellipsis.circle"
            accessibilityLabel={`Opzioni per ${names.title}`}
            groups={[
              {
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
        <Animated.View entering={SETS_IN} exiting={SETS_OUT} pointerEvents={editing ? 'none' : 'auto'}>
        {exercise.note ? <NoteRow text={exercise.note} onPress={editNote} /> : null}
        {advice ? (
          // What to do today and why, both in sight.
          <View style={styles.adviceRow}>
            <View style={styles.adviceText}>
              <View style={styles.adviceTitle}>
                <Icon
                  name={advice.direction === 'up' ? 'arrow.up.circle.fill' : 'arrow.down.circle.fill'}
                  size={17}
                  tone={advice.direction === 'up' ? 'accent' : 'warning'}
                />
                <AppText variant="subhead" weight="600" numberOfLines={1} style={styles.shrink}>
                  {adviceTitle(advice, exercise.kind)}
                </AppText>
              </View>
              <AppText variant="footnote" tone="textSecondary" numeric>
                {adviceReason(advice, timed, range)}
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
            <SetRow
              key={set.id}
              set={set}
              badge={badge}
              previous={item.previous[index]}
              suggested={weight}
              divided={index > 0}
              kind={exercise.kind}
              trackRir={exercise.trackRir}
              repMin={item.repMin}
              repMax={item.repMax}
              rest={rest}
              loadStep={loadIncrement(exercise.equipment)}
              settled={settled}
            />
          );
        })}
        {/* Adding a set and the rest after each one: what is changed most while training. */}
        <Animated.View layout={BLOCK_LAYOUT} style={styles.exerciseFooter}>
          <View style={styles.flex}>
            <ActionRow label="Aggiungi serie" symbol="plus" onPress={() => void addSet(db, item.id)} />
          </View>
          <RestPicker inert={!settled} value={rest} onChange={(seconds) => void setWorkoutExerciseRest(db, item.id, seconds)} />
        </Animated.View>
        </Animated.View>
        )}
      </ListGroup>
      <View pointerEvents="none" style={styles.sweepClip}>
        <Animated.View style={[styles.sweep, { backgroundColor: theme.accent }, sweepStyle]} />
      </View>
    </View>
  );
}

function toText(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? '' : numberToInput(value, decimals);
}

/** The bar over the keyboard of every value box: − and + by a step, and "Fine". */
const KEYBOARD_BAR = Platform.OS === 'ios' ? 'workout-keyboard' : undefined;

/** The value box being typed in: how far − and + move it, and how. */
type Nudge = { step: number; by: (delta: number) => void };
const nudge = (() => {
  let current: Nudge | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next: Nudge | null) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => current,
  };
})();

/**
 * Over the keyboard while a value is typed: − and + by the step of that box (the load by the
 * smallest plates of its equipment, reps by one), as the keypad of Strong, so a load changes with
 * a thumb instead of retyping it. "Fine" closes the keyboard.
 */
function KeyboardBar() {
  const theme = useTheme();
  const target = useSyncExternalStore(nudge.subscribe, nudge.get);
  if (!KEYBOARD_BAR) return null;
  const step = target ? formatNumber(target.step, 2) : '';
  const press = (delta: number) => {
    haptics.selection();
    target?.by(delta);
  };
  return (
    <InputAccessoryView nativeID={KEYBOARD_BAR} backgroundColor="transparent">
      <View style={styles.keyboardBar}>
        {target ? (
          <>
            <Pressable
              onPress={() => press(-target.step)}
              accessibilityRole="button"
              accessibilityLabel={`Togli ${step}`}
              style={({ pressed }) => [styles.keyButton, { backgroundColor: theme.card }, pressed && { opacity: 0.6 }]}>
              <AppText variant="headline" numeric>{`−${step}`}</AppText>
            </Pressable>
            <Pressable
              onPress={() => press(target.step)}
              accessibilityRole="button"
              accessibilityLabel={`Aggiungi ${step}`}
              style={({ pressed }) => [styles.keyButton, { backgroundColor: theme.card }, pressed && { opacity: 0.6 }]}>
              <AppText variant="headline" numeric>{`+${step}`}</AppText>
            </Pressable>
          </>
        ) : null}
        <View style={styles.flex} />
        <Pressable
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.keyButton, { backgroundColor: theme.card }, pressed && { opacity: 0.6 }]}>
          <AppText variant="headline" tone="accent">
            Fine
          </AppText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** Started by a ticked set; see WorkoutScreen. */
const latest: { onSetDone: ((setId: number, rest: number) => void) | null } = { onSetDone: null };

type SetRowProps = {
  set: WorkoutSet;
  badge: string;
  /** What was done in the same set last time. */
  previous: LoggedSet | undefined;
  /** The load suggested for today, once taken: an untouched set starts from it. */
  suggested: number | null;
  /** A faint line above the set. */
  divided: boolean;
  kind: WorkoutExercise['exercise']['kind'];
  trackRir: boolean;
  /** The planned range of reps (or seconds), to flag a value well outside it. */
  repMin: number | null;
  repMax: number | null;
  /** The rest started when it is ticked. */
  rest: number;
  /** What − and + over the keyboard take off or add to the load. */
  loadStep: number;
  /** The sheet is up: the set's native menu can be built. */
  settled: boolean;
};

/**
 * One set: its number (tap for warm-up, drop or failure), what was done last time, the values
 * (already filled in with last time's, to change if needed) and the tick that closes the set.
 * It takes only data and handles its own changes, so it is drawn again only when it changes.
 */
const SetRow = memo(function SetRow({ set, badge, previous, suggested, divided, kind, trackRir, repMin, repMax, rest, loadStep, settled }: SetRowProps) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const range = repMin !== null && repMax !== null ? { min: repMin, max: repMax } : null;
  const prefill: LoggedSet | undefined =
    suggested === null
      ? previous
      : previous
        ? // A new load makes last time's reps meaningless: they are left to fill in.
          { ...previous, weight: suggested, reps: null }
        : { type: 'normal', weight: suggested, reps: null, seconds: null, rir: null, done: false };
  const onUpdate = (fields: SetFields) => void updateSet(db, set.id, fields);
  const onComplete = async (fields: SetFields) => {
    await updateSet(db, set.id, { ...fields, done: true });
    haptics.light();
    latest.onSetDone?.(set.id, rest);
  };
  // A set deleted is gone at once, with "Annulla" for a few seconds, as every row in the app.
  const onDelete = () => deleteWithUndo({ key: `set:${set.id}`, title: 'Serie eliminata', run: () => deleteSet(db, set.id) });
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

  // A tick with a value missing: the row shakes, as a wrong passcode does, and the empty boxes
  // turn red for a moment.
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setMissing(false), 1200);
    return () => clearTimeout(timer);
  }, [missing]);

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
        title: `${counted} ${kind === 'time' ? 's' : 'rip'}: ${outside === 'above' ? 'sopra' : 'sotto'} ${range.min}–${range.max}`,
        // What happens next time must match `progression`: all sets at the top, half under the bottom.
        message:
          outside === 'above'
            ? `${kind === 'time' ? 'Troppo facile' : 'Carico leggero'}. Se succede in tutte le serie, la prossima volta ti suggerisco di ${kind === 'time' ? 'renderlo più difficile' : 'aumentarlo'}.`
            : `${kind === 'time' ? 'Troppo difficile' : 'Carico pesante'}. Se succede in metà delle serie, la prossima volta ti suggerisco di ${kind === 'time' ? 'renderlo più facile' : 'ridurlo'}.`,
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
      shake.set(
        withSequence(
          withTiming(-7, { duration: 50 }),
          withTiming(7, { duration: 70 }),
          withTiming(-5, { duration: 70 }),
          withTiming(4, { duration: 60 }),
          withTiming(0, { duration: 50 }),
        ),
      );
      return;
    }
    setMissing(false);
    onComplete(filled);
  };

  /** A value box. `step` is what − and + over the keyboard move it by while it is being typed in. */
  const field = (
    value: string,
    onChange: Dispatch<SetStateAction<string>>,
    placeholder: string,
    label: string,
    step: number,
    decimals: number,
    flagged = false,
  ) => (
    <>
    <TextInput
      value={value}
      onChangeText={(text) => {
        setMissing(false);
        onChange(text);
      }}
      onFocus={() =>
        nudge.set({
          step,
          by: (delta) => {
            setMissing(false);
            onChange((text) => toText(Math.max(0, Math.round(((parseDecimal(text) ?? 0) + delta) * 100) / 100), decimals));
          },
        })
      }
      onEndEditing={() => onUpdate(values())}
      placeholder={placeholder}
      placeholderTextColor={theme.textTertiary}
      keyboardType="decimal-pad"
      inputAccessoryViewID={KEYBOARD_BAR}
      selectTextOnFocus
      editable={!set.done}
      accessibilityLabel={label}
      style={[
        styles.input,
        {
          backgroundColor: set.done ? 'transparent' : theme.fill,
          color: flagged ? theme.warning : theme.text,
        },
        missing && value === '' && { borderColor: theme.danger, borderWidth: 1.5 },
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
    <Animated.View entering={SET_IN} exiting={SET_OUT} layout={BLOCK_LAYOUT} style={styles.setSlot}>
    <SwipeToDelete collapse={false} onDelete={onDelete}>
    <View style={set.done && { backgroundColor: `${theme.accent}1F` }}>
    {divided ? <View style={[styles.setDivider, { backgroundColor: theme.separator }]} /> : null}
    <Animated.View style={[styles.setRow, shakeStyle]}>
      {/* No mark for the set to do now, as in Strong and Hevy: the sets done turn green, and the
          next one is the first still white. */}
      <View style={styles.colSet}>
        <SetTypeMenu inert={!settled} badge={badge} type={set.type} done={set.done} onChange={(type) => onUpdate({ type })} onDelete={onDelete} />
      </View>
      <AppText variant="subhead" tone="textSecondary" numeric numberOfLines={1} style={styles.colPrev}>
        {previous ? formatSet(previous, kind).replace(' kg ×', ' ×') : '—'}
      </AppText>
      {kind === 'time' ? (
        <View style={styles.colInput}>{field(seconds, setSeconds, 's', 'Secondi', 5, 0, outside !== null)}</View>
      ) : (
        <>
          <View style={styles.colInput}>{field(weight, setWeight, 'kg', 'Chili', loadStep, 2)}</View>
          <View style={styles.colInput}>{field(reps, setReps, 'rip', 'Ripetizioni', 1, 0, outside !== null)}</View>
        </>
      )}
      {trackRir ? <View style={styles.colRir}>{field(rir, setRir, '–', 'Ripetizioni in riserva', 1, 1)}</View> : null}
      <Pressable
        onPress={tick}
        hitSlop={6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.done }}
        accessibilityLabel={set.done ? 'Serie fatta, tocca per riaprirla' : 'Segna la serie come fatta'}
        style={({ pressed }) => [
          styles.colCheck,
          styles.check,
          set.done ? { backgroundColor: theme.accent } : { borderWidth: 2, borderColor: theme.separator, backgroundColor: theme.card },
          pressed && { opacity: 0.6 },
        ]}>
        <Icon name="checkmark" size={15} weight="bold" color={set.done ? theme.onAccent : theme.textTertiary} />
      </Pressable>
    </Animated.View>
    </View>
    </SwipeToDelete>
    </Animated.View>
  );
});

/**
 * The time of the workout, big in the bar at the top, with its name small above it. It ticks on
 * its own: the rest of the screen does not redraw every second, which got in the way of dragging.
 */
function WorkoutTitle({ name, startedAt, onPress }: { name: string; startedAt: string; onPress?: () => void }) {
  const theme = useTheme();
  const now = useClock(1000);
  const elapsed = formatDuration((now - new Date(startedAt).getTime()) / 1000);
  return (
    // While editing, a tap here ends it too, as a tap anywhere else on the page does.
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={styles.title}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${name}, ${elapsed}`}>
      <AppText variant="caption" weight="600" tone="textSecondary" numberOfLines={1}>
        {name.toUpperCase()}
      </AppText>
      <AppText numeric style={[styles.titleTime, { color: theme.accent }]}>
        {elapsed}
      </AppText>
    </Pressable>
  );
}

/** Why: what was done last time, against the goal. */
function adviceReason(advice: Progression, timed: boolean, range: string | null): string {
  const done = `L’ultima volta ${advice.counts.join(', ')} ${timed ? 's' : 'rip'}`;
  if (!range) return done;
  return `${done}: ${advice.direction === 'up' ? 'tutte al massimo di' : 'troppe sotto'} ${range}`;
}

/** "Oggi prova 82,5 kg", "Aggiungi carico", "Rendilo più facile": what last time asks of today. */
function adviceTitle(advice: Progression, kind: WorkoutExercise['exercise']['kind']): string {
  const up = advice.direction === 'up';
  if (advice.weight !== null) return `Oggi prova ${formatNumber(advice.weight, 2)} kg`;
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
        1500,
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
/** The tick appears with the light, growing into place without going past it. */
const DONE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.5 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(340);
/** The green light across a finished exercise, and its fading. */
const SWEEP_MS = 520;
const GLOW_OUT_MS = 420;
const CURRENT_IN = FadeIn.duration(260);
const FLAG_IN = FadeIn.duration(220);
// Folding and unfolding: the sets fade across most of the card's resize, so the two read as one.
const SETS_IN = FadeIn.duration(220).delay(80);
const SETS_OUT = FadeOut.duration(200);
// The same timing react-native-sortables moves the exercises with (withTiming's default), so a
// card that grows or shrinks and the cards below it that make room move as one.
const BLOCK_LAYOUT = LinearTransition.duration(300).easing(Easing.inOut(Easing.quad));
const COLLAPSE = { duration: 300, easing: Easing.inOut(Easing.quad) };
/**
 * A set deleted closes its gap while the rows under it move up, on their curve, as in Mail: the
 * red of the swipe shrinks away instead of lingering under the rows sliding over it.
 */
const SET_IN = FadeIn.duration(200);
const SET_OUT = (values: ExitAnimationsValues): LayoutAnimation => {
  'worklet';
  return {
    initialValues: { height: values.currentHeight, opacity: 1 },
    animations: { height: withTiming(0, COLLAPSE), opacity: withTiming(0, COLLAPSE) },
  };
};
const EXERCISE_IN = FadeIn.duration(250);
const EXERCISE_OUT = FadeOut.duration(200);
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
  // Narrow enough to leave room for ⌄ on the left and the note, ⋯ and "Termina" on the right: a
  // wider title makes iOS fold them away into an overflow menu.
  title: { alignItems: 'center', maxWidth: 110 },
  titleTime: { fontSize: 22, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  topSpace: { height: Spacing.xl },
  exercise: {},
  sweepClip: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  sweep: { ...StyleSheet.absoluteFill, opacity: 0, transformOrigin: 'left center' },
  exerciseFooter: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.md },
  adviceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  adviceText: { flex: 1, gap: 2 },
  adviceTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2 },
  shrink: { flexShrink: 1 },
  adviceButton: { paddingHorizontal: Spacing.md, height: 28, borderRadius: 14, justifyContent: 'center' },
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
  fold: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minHeight: 36 },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  // Clips a deleted set as it closes.
  setSlot: { overflow: 'hidden' },
  setDivider: { position: 'absolute', top: 0, left: Spacing.md + 40, right: Spacing.md, height: StyleSheet.hairlineWidth, opacity: 0.6 },
  // On the top right corner of the reps box.
  flag: { position: 'absolute', top: -8, right: -9 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  colSet: { width: 40, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  colPrev: { flex: 1 },
  colInput: { width: 62, textAlign: 'center' },
  colRir: { width: 44, textAlign: 'center' },
  colCheck: { width: 44 },
  input: {
    height: 44,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // 44 points high, the least Apple asks for a target: tapped mid-workout, often in a hurry.
  check: { height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: Spacing.xl, gap: Spacing.md },
  dimmed: { opacity: 0.4 },
  bottomSpace: { height: 170 },
  skipped: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  restDisabled: { opacity: 0.35 },
  restSlot: { position: 'absolute', left: Spacing.md, right: Spacing.md },
  keyboardBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  keyButton: { minWidth: 64, height: 40, paddingHorizontal: Spacing.md, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
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
