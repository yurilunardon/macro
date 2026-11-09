import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import Animated, {
  css,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  Keyframe,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withDelay,
  withRepeat,
  withTiming,
  type ExitAnimationsValues,
  type LayoutAnimation,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
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
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { RestPicker } from '@/components/rest-picker';
import { SetTypeMenu } from '@/components/set-type-menu';
import { editButton } from '@/components/edit-button';
import { ExpandingRings } from '@/components/expanding-rings';
import { FoldChevron } from '@/components/fold-chevron';
import { Jiggle } from '@/components/jiggle';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { restFor, updateExerciseOptions } from '@/db/exercises';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { addWarmUp } from '@/db/exercise-picks';
import { setSetting } from '@/db/settings';
import { holdLiveQueries, useLiveQuery } from '@/db/live';
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
import { useScrollTop, type ScrollTop } from '@/hooks/use-scroll-top';
import { useSettled } from '@/hooks/use-settled';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { useTheme } from '@/hooks/use-theme';
import { isWarmUp, loadIncrement, muscleLabel } from '@/lib/exercises';
import { formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import {
  allSetsDone,
  bestOneRepMax,
  formatDuration,
  formatSet,
  formatWorkoutLengthShort,
  progression,
  workoutProgress,
  type LoggedSet,
  type Progression,
} from '@/lib/training';
import { clockOf } from '@/lib/plan';
import { haptics } from '@/services/haptics';
import { endFromSheet, endWorkout } from '@/services/end-workout';
import { restTimer, useRestTimer } from '@/services/rest-timer';
import { useWorkoutStarting } from '@/services/start-workout';
import { deleteWithUndo, isPendingDelete, usePendingDeletes } from '@/services/undo';

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
/**
 * The last set ticked, its bar fills and a wave of light runs across the exercise's bars, each
 * swelling after the one before it: the first as the fill ends, the whole wave in about the same
 * time however many sets there are. Then the exercise folds.
 */
const WAVE_AFTER_MS = 200;
const WAVE_STEP_MS = 110;
const WAVE_SPAN_MS = 420;
const WAVE_BAR_MS = 380;
const waveStep = (bars: number) => (bars > 1 ? Math.min(WAVE_STEP_MS, WAVE_SPAN_MS / (bars - 1)) : 0);
const foldAfter = (bars: number) => WAVE_AFTER_MS + waveStep(bars) * Math.max(0, bars - 1) + WAVE_BAR_MS;
/** How long the rings around the tick take, once it has appeared. */
const TICK_RINGS_MS = 1000;
/** Once it has folded and its rings have gone, the offer to end a workout with nothing left to do. */
const OFFER_END_AFTER_MS = 1800;
const isSetHidden = (setId: number) => isPendingDelete(`set:${setId}`);
/** After turning it down this many times in a row, it stops offering a warm-up. */
const WARM_UP_OFFERS = 3;
/** The workouts where the offer of a warm-up was turned down, kept while the sheet is closed and reopened. */
const warmUpTurnedDown = new Set<number>();
/**
 * Once the sheet is up, what was left for later is built one exercise at a time, this far apart:
 * all at once it took one long moment, with the page stuck just as it landed.
 */
const BUILD_EVERY_MS = 80;

/** The workout in progress. Swiping the sheet down keeps it running; it comes back from the tab bar. */
export default function WorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { names } = useExerciseNames();
  // "Modifica", as apps on the Home Screen: the exercises wobble, staying as they are, and can be
  // dragged or removed. Only the exercises change; sets are deleted with a swipe at any time.
  const [editing, setEditing] = useState(false);
  const scroll = useScrollTop();
  /** Where the big time at the top of the page ends: scrolled past it, the time shows in the bar. */
  const timeBottom = useSharedValue(Number.POSITIVE_INFINITY);
  // The order just dragged into, shown until the saved order comes back from the database.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const [foldedIds, setFoldedIds] = useState<ReadonlySet<number>>(() => new Set(folded));
  const [concludedIds, setConcludedIds] = useState<ReadonlySet<number>>(() => new Set(concluded));
  const { data } = useLiveQuery(ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  // Ending or cancelling it, the sheet keeps showing the workout while the summary covers it or
  // it slides away, instead of flashing "Nessun allenamento in corso".
  const [closing, setClosing] = useState(false);
  // While the sheet slides up, the native menus and pickers of every set and exercise are drawn
  // as plain views: built all at once, their SwiftUI views made the slide stutter. They take over
  // once the sheet is up, exercise by exercise, when those further down are built too.
  const settled = useSettled(700);
  const [built, setBuilt] = useState(0);
  // Just started, the workout may still be being written if that took long: its name is already there.
  const starting = useWorkoutStarting();
  const { title: startingTitle } = useLocalSearchParams<{ title?: string }>();
  const [openedAt] = useState(() => new Date().toISOString());
  const [shown, setShown] = useState<Workout | null>(null);
  if (data?.workout && data.workout !== shown) setShown(data.workout);

  // While this is on top, what is under it does not read and draw at every set ticked.
  useFocusEffect(useCallback(() => holdLiveQueries([ACTIVE_WORKOUT_KEY]), []));

  // What a ticked set starts: the rest, with what comes next. Kept outside, so every set's
  // handler stays the same function and a tick redraws the set ticked, not every row.
  const offerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(offerTimer.current), []);
  const current = useRef(data?.workout);
  useEffect(() => {
    current.current = data?.workout;
    const workoutNow = data?.workout;
    // Even after the last set: one more may be added before the exercise is concluded, and
    // concluding the last one stops it.
    latest.onSetDone = workoutNow
      ? (setId, rest) => restTimer.start(rest, nextLabel(workoutNow, setId, (e) => names(e.exercise).title), { alert: data?.alert ?? 'vibrate', title: workoutNow.name })
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
  // A workout opened again after the app was closed: what was all done then counts as concluded.
  if (workout && seedConcluded(workout)) setConcludedIds(new Set(concluded));
  const allExercises = workout?.exercises ?? [];
  const exercises =
    localOrder && localOrder.length === allExercises.length
      ? localOrder.map((id) => allExercises.find((ex) => ex.id === id)).filter((ex) => ex !== undefined)
      : allExercises;

  useEffect(() => {
    if (!settled || built >= exercises.length) return;
    const timer = setTimeout(() => setBuilt((n) => n + 1), BUILD_EVERY_MS);
    return () => clearTimeout(timer);
  }, [settled, built, exercises.length]);

  // While the sheet rises only what is on screen is built: everything down to the second open
  // exercise. Each open one costs a row of inputs per set, and the sheet only leaves after this.
  let openSoFar = 0;
  const onScreen = exercises.findIndex((ex) => !foldedIds.has(ex.id) && ++openSoFar === FIRST_OPEN_EXERCISES) + 1 || exercises.length;
  const firstExercises = exercises.slice(0, Math.max(onScreen, built));
  const title = (e: WorkoutExercise) => names(e.exercise).title;
  // The set to do now is picked out, so the eye finds it at once after a rest.
  const progress = workoutProgress(exercises);
  const counted = workoutProgress(exercises.filter((ex) => !isWarmUp(ex.exercise)));
  const setsDone = counted.done;
  const setsTotal = counted.total;
  const currentSetId = progress.current ? exercises[progress.current.exercise].sets[progress.current.set].id : null;

  /** Folds and unfolds exercises; kept in `folded` while the sheet is closed and reopened. */
  const fold = useStableCallback((changes: readonly (readonly [number, boolean])[]) =>
    setFoldedIds((previous) => {
      const next = new Set(previous);
      for (const [id, value] of changes) {
        if (value) next.add(id);
        else next.delete(id);
      }
      folded.clear();
      for (const id of next) folded.add(id);
      return next;
    }),
  );
  const foldOne = useStableCallback((id: number, value: boolean) => fold([[id, value]]));

  // The last set of an exercise folds it away and opens the next one still to do, so with
  // everything folded the workout reads one exercise at a time.
  const onCompleted = useStableCallback((id: number) => {
    const at = exercises.findIndex((ex) => ex.id === id);
    const todo = (ex: WorkoutExercise) => ex.sets.some((set) => !set.done);
    const next = exercises.slice(at + 1).find(todo) ?? exercises.slice(0, at).find(todo);
    fold(next ? [[id, true], [next.id, false]] : [[id, true]]);
  });

  /**
   * "Concludi" on an exercise with all its sets done: it folds away with its wave. With every
   * exercise concluded the rest stops, and on a day of the program the offer to end comes up; a
   * free workout goes on as long as exercises are added.
   */
  const conclude = useStableCallback((id: number, value: boolean) => {
    if (value) concluded.add(id);
    else concluded.delete(id);
    setConcludedIds(new Set(concluded));
    if (!value) return;
    const done = (ex: WorkoutExercise) => ex.sets.every((set) => set.done || isSetHidden(set.id));
    const all = exercises.filter((ex) => !isWarmUp(ex.exercise));
    if (!all.every((ex) => concluded.has(ex.id) && done(ex))) return;
    restTimer.stop();
    if (workout?.dayId == null) return;
    clearTimeout(offerTimer.current);
    offerTimer.current = setTimeout(() => {
      // Still so, and still here: a set may have been opened again, or the sheet closed.
      const now = current.current?.exercises.filter((ex) => !isWarmUp(ex.exercise));
      if (now && allSetsDone(now, isSetHidden) && now.every((ex) => concluded.has(ex.id)) && navigation.isFocused()) router.push('/workout-done');
    }, OFFER_END_AFTER_MS);
  });

  const removeExercise = useStableCallback(async (id: number) => {
    const ex = exercises.find((e) => e.id === id);
    if (!ex) return;
    const done = ex.sets.filter((set) => set.done).length;
    const ok = await confirmDestructive({
      title: `Eliminare ${title(ex)}?`,
      message: done > 0 ? `${done === 1 ? '1 serie completata verrà eliminata' : `${done} serie completate verranno eliminate`}.` : undefined,
      action: 'Elimina esercizio',
    });
    if (!ok) return;
    haptics.light();
    await removeWorkoutExercise(db, ex.id);
  });

  const finish = useStableCallback(async () => {
    const active = data?.workout;
    if (!active) return;
    Keyboard.dismiss();
    setClosing(true);
    const result = await endWorkout(db, active.id);
    if (!result) {
      setClosing(false);
      return;
    }
    // The summary covers this sheet straight away; closing it closes both.
    if (result === 'finished') router.push({ pathname: '/workout-summary', params: { id: active.id } });
    else router.back();
  });
  // The sheet offering to end it, when nothing is left, does it from here.
  useEffect(() => {
    endFromSheet.run = () => void finish();
    return () => {
      endFromSheet.run = null;
    };
  }, [finish]);

  const discard = useStableCallback(async () => {
    const active = data?.workout;
    if (!active) return;
    const ok = await confirmDestructive({
      title: 'Annullare l’allenamento?',
      message: 'Le serie registrate verranno eliminate.',
      action: 'Annulla allenamento',
    });
    if (!ok) return;
    setClosing(true);
    await deleteWorkout(db, active.id);
    restTimer.stop();
    router.back();
  });

  const addExercise = useStableCallback(() => {
    const active = data?.workout;
    if (!active) return;
    adding.current = true;
    router.push({ pathname: '/exercise-picker', params: { target: 'workout', id: active.id } });
  });

  const openNote = useStableCallback(() => {
    const active = data?.workout;
    if (active) router.push({ pathname: '/note-sheet', params: { kind: 'workout', id: active.id, text: active.notes ?? '' } });
  });

  const startEditing = useStableCallback(() => setEditing(true));

  // A warm-up is offered on a day of the program without one, before the first set.
  const [offerGone, setOfferGone] = useState(false);
  const offersWarmUp =
    workout !== null &&
    workout.dayId !== null &&
    !editing &&
    !offerGone &&
    !warmUpTurnedDown.has(workout.id) &&
    (data?.warmUpSkips ?? 0) < WARM_UP_OFFERS &&
    !workout.exercises.some((ex) => isWarmUp(ex.exercise)) &&
    !workout.exercises.some((ex) => ex.sets.some((set) => set.done));
  const takeWarmUp = useStableCallback(() => {
    const active = data?.workout;
    setOfferGone(true);
    if (!active) return;
    haptics.light();
    void addWarmUp(db, { dayId: active.dayId, workoutId: active.id });
    void setSetting(db, 'warmUpSkips', 0);
  });
  const turnDownWarmUp = useStableCallback(() => {
    const active = data?.workout;
    setOfferGone(true);
    if (!active) return;
    warmUpTurnedDown.add(active.id);
    void setSetting(db, 'warmUpSkips', (data?.warmUpSkips ?? 0) + 1);
  });

  const onDragEnd = useStableCallback((ordered: readonly WorkoutExercise[]) => {
    if (ordered === exercises) return;
    setLocalOrder(ordered.map((ex) => ex.id));
    void reorderWorkoutExercises(
      db,
      ordered.map((ex) => ex.id),
    );
  });

  if (!workout && !starting && data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Allenamento' }} />
        <AppText tone="textSecondary">Nessun allenamento in corso.</AppText>
        <Button title="Chiudi" variant="plain" onPress={() => router.back()} />
      </View>
    );
  }

  // The scroll view is the first view of the screen, as iOS expects for the bar above it.
  return (
    <>
      {/* Dragging an exercise scrolls the page, and counts on iOS to stop it at its ends. */}
      {/* The bar over the keyboard cannot follow a keyboard dragged by the finger: it leaves at once. */}
      <ScreenScroll scroll={scroll} scrollToOverflowEnabled={false} keyboardDismissMode="on-drag">
        {/* While editing, a tap anywhere outside the exercises ends it, as on the Home Screen. */}
        <View onStartShouldSetResponder={() => editing} onResponderRelease={() => setEditing(false)}>
        {/*
          The name and the time are at the top of the page, with room for a long name. Once the big
          time has gone under the bar, it comes into the bar, as a large title does.
        */}
        <Stack.Screen
          options={{
            title: workout?.name ?? startingTitle ?? 'Allenamento',
            headerTitle: () => (
              <WorkoutTitle
                name={workout?.name ?? startingTitle ?? 'Allenamento'}
                startedAt={workout?.startedAt ?? openedAt}
                offset={scroll.offset}
                after={timeBottom}
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
              onPress={openNote}
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

        {/* Also keeps the first exercise's buttons out of the reach of the bar's own, which take touches a good way below it. */}
        <WorkoutHead
          name={workout?.name ?? startingTitle ?? 'Allenamento'}
          startedAt={workout?.startedAt ?? openedAt}
          done={setsDone}
          total={setsTotal}
          onTimeLayout={(bottom) => timeBottom.set(bottom)}
        />

        {offersWarmUp && workout ? <WarmUpOffer dayName={workout.name} onTake={takeWarmUp} onTurnDown={turnDownWarmUp} /> : null}

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
            onDragEnd={({ data: ordered }) => onDragEnd(ordered)}
            renderItem={({ item: ex, index }) => (
              <Jiggle editing={editing} inset={0} removeLabel={`Elimina ${title(ex)}`} onRemove={() => void removeExercise(ex.id)}>
                {isWarmUp(ex.exercise) ? (
                  <WarmUpBlock item={ex} startedAt={workout?.startedAt ?? openedAt} editing={editing} />
                ) : (
                <ExerciseBlock
                  item={ex}
                  // Only to the one holding it: a tick moves it on without touching the others.
                  currentSetId={ex.sets.some((set) => set.id === currentSetId) ? currentSetId : null}
                  title={names(ex.exercise).title}
                  subtitle={names(ex.exercise).subtitle}
                  settled={settled && index < built}
                  editing={editing}
                  collapsed={foldedIds.has(ex.id)}
                  concluded={concludedIds.has(ex.id)}
                  onEdit={startEditing}
                  onFold={foldOne}
                  onConclude={conclude}
                  onCompleted={onCompleted}
                  onRemove={removeExercise}
                />
                )}
              </Jiggle>
            )}
          />
        </LayoutAnimationConfig>

        {/* After the last exercise, once they are all there: on its own or between them it would jump. */}
        {workout && firstExercises.length === exercises.length ? (
          <View style={[styles.footer, editing && styles.dimmed]} pointerEvents={editing ? 'none' : 'auto'}>
            <Button
              title="Aggiungi esercizio"
              variant="tinted"
              icon={<Icon name="plus" size={16} tone="accent" weight="semibold" />}
              onPress={addExercise}
            />
          </View>
        ) : null}
        <View style={styles.bottomSpace} />
        </View>
      </ScreenScroll>
      {/* Out of edit mode, "Termina" waits at the bottom whenever no rest is running. */}
      <RestBar />
      <KeyboardBar scroll={scroll} />
    </>
  );
}

/**
 * The offer of a warm-up, at the top of a workout that has none. Taking it puts one first in the
 * day of the program too, as it says, so it is there the next times.
 */
function WarmUpOffer({ dayName, onTake, onTurnDown }: { dayName: string; onTake: () => void; onTurnDown: () => void }) {
  const theme = useTheme();
  // It closes by itself before anything happens: gone at once, all the page under it jumped up.
  const natural = useSharedValue(0);
  const closed = useSharedValue(0);
  const style = useAnimatedStyle(() => (closed.get() === 0 ? {} : { height: natural.get() * (1 - closed.get()), opacity: 1 - closed.get(), overflow: 'hidden' }));
  const close = (then: () => void) => {
    closed.set(
      withTiming(1, COLLAPSE, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(then);
      }),
    );
  };
  return (
    <Animated.View onLayout={(event) => closed.get() === 0 && natural.set(event.nativeEvent.layout.height)} style={style}>
      <View style={[styles.warmUpOffer, { backgroundColor: theme.card }]}>
        <Icon name="flame.fill" size={20} tone="warning" />
        <View style={styles.flex}>
          <AppText variant="subhead" weight="600">
            Ti scaldi prima?
          </AppText>
          <AppText variant="footnote" tone="textSecondary">
            {`In cima a ${dayName}, anche le prossime volte.`}
          </AppText>
        </View>
        <Button title="Aggiungi" variant="tinted" compact onPress={() => close(onTake)} />
        <Pressable onPress={() => close(onTurnDown)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Non ora" style={styles.warmUpClose}>
          <Icon name="xmark" size={13} weight="semibold" tone="textSecondary" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** The warm-up: no sets, only how long it has been going and a tick when it is over. */
const WarmUpBlock = memo(function WarmUpBlock({ item, startedAt, editing }: { item: WorkoutExercise; startedAt: string; editing: boolean }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const set = item.sets[0] as WorkoutSet | undefined;
  const [ticking, setTicking] = useState<boolean | null>(null);
  if (ticking !== null && ticking === set?.done) setTicking(null);
  const done = ticking ?? set?.done ?? false;
  const now = useClock(1000, !done);
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => setRinging(false), TICK_RINGS_MS);
    return () => clearTimeout(timer);
  }, [ringing]);
  const tick = () => {
    if (!set) return;
    if (done) {
      haptics.selection();
      setTicking(false);
      void updateSet(db, set.id, { done: false, seconds: null });
      return;
    }
    haptics.success();
    setTicking(true);
    setRinging(true);
    // The first set starts about now.
    restTimer.markEnded();
    void updateSet(db, set.id, { done: true, seconds: Math.round((Date.now() - new Date(startedAt).getTime()) / 1000) });
  };
  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  return (
    <ListGroup>
      <View style={styles.warmUp} pointerEvents={editing ? 'none' : 'auto'}>
        <View style={styles.flex}>
          <AppText variant="headline" tone={done ? 'text' : 'accent'} numberOfLines={1}>
            Riscaldamento
          </AppText>
          <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
            {done ? `Fatto in ${formatWorkoutLengthShort(set?.seconds ?? elapsed)}` : `Da ${formatDuration(elapsed)} · spunta quando hai finito`}
          </AppText>
        </View>
        <View>
          {ringing ? <ExpandingRings size={44} color={theme.accent} reach={1.9} /> : null}
          <Pressable
            onPress={tick}
            hitSlop={6}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={done ? 'Riscaldamento finito, tocca per riaprirlo' : 'Ho finito il riscaldamento'}
            style={({ pressed }) => [
              styles.colCheck,
              styles.check,
              done ? { backgroundColor: theme.accent } : { borderWidth: 2, borderColor: theme.separator, backgroundColor: theme.card },
              pressed && { opacity: 0.6 },
            ]}>
            <Icon name="checkmark" size={15} weight="bold" color={done ? theme.onAccent : theme.textTertiary} />
          </Pressable>
        </View>
      </View>
    </ListGroup>
  );
});

/** An exercise's fixed note: a tap changes or deletes it. */
function NoteRow({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Modifica la nota" style={styles.noteRow}>
      <Icon name="pin.fill" size={12} tone="warning" />
      <AppText variant="footnote" tone="text" style={styles.flex}>
        {text}
      </AppText>
    </Pressable>
  );
}

type ExerciseBlockProps = {
  item: WorkoutExercise;
  /** The set to do now, if it is in this exercise. */
  currentSetId: number | null;
  title: string;
  subtitle: string | null;
  /** Edit mode: only to drag or remove. */
  editing: boolean;
  /** The sheet is up: native menus and pickers can be built. */
  settled: boolean;
  collapsed: boolean;
  /** "Concludi" was pressed: with its sets all done, it is over. */
  concluded: boolean;
  /** Held on its name: edit mode starts. */
  onEdit: () => void;
  onFold: (id: number, collapsed: boolean) => void;
  onConclude: (id: number, concluded: boolean) => void;
  /** It was just concluded, and has had its wave. */
  onCompleted: (id: number) => void;
  onRemove: (id: number) => void;
};

/** Exercises folded by hand or once done, kept while the workout is closed and reopened. */
const folded = new Set<number>();
/** Exercises concluded, of the workout in `concludedFor`, kept the same way. */
const concluded = new Set<number>();
const concludedFor: { id: number | null } = { id: null };

/** For a workout not seen since the app opened, counts what is all done as concluded. Says whether it did. */
function seedConcluded(workout: Workout): boolean {
  if (concludedFor.id === workout.id) return false;
  concludedFor.id = workout.id;
  concluded.clear();
  for (const ex of workout.exercises) if (ex.sets.length > 0 && ex.sets.every((set) => set.done)) concluded.add(ex.id);
  return true;
}
/** The load suggested from last time, once taken, by exercise of the workout. */
const taken = new Map<number, number>();

const ExerciseBlock = memo(function ExerciseBlock({ item: given, currentSetId, title, subtitle, editing, settled, collapsed, concluded: isConcluded, onEdit, onFold, onConclude, onCompleted, onRemove }: ExerciseBlockProps) {
  const db = useSQLiteContext();
  const names = { title, subtitle };
  // A set deleted is gone at once, with "Annulla" for a few seconds, as every row in the app.
  const hidden = usePendingDeletes();
  const item = { ...given, sets: given.sets.filter((set) => !hidden.has(`set:${set.id}`)) };
  const theme = useTheme();
  const router = useRouter();
  const { exercise } = item;
  const allDone = item.sets.length > 0 && item.sets.every((set) => set.done);
  // With the last set ticked it asks: conclude it, or add a set; the values can still be changed
  // until "Concludi". Concluded, its bars fill with a wave and it folds away; reopening one of its
  // sets opens it again. Until it folds it stays as it is, or everything under it would jump.
  const complete = allDone && isConcluded;
  const asking = allDone && !isConcluded;
  useEffect(() => {
    if (isConcluded && !allDone) onConclude(item.id, false);
  }, [isConcluded, allDone, onConclude, item.id]);
  const [wasComplete, setWasComplete] = useState(complete);
  const [change, setChange] = useState<'completed' | 'reopened' | null>(null);
  if (complete !== wasComplete) {
    setWasComplete(complete);
    setChange(complete ? 'completed' : 'reopened');
  }
  const shownComplete = complete && change !== 'completed';
  // The rings around the tick: only when it has just been earned, not whenever the tick is drawn.
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (change === null) return;
    if (change === 'completed') haptics.success();
    const timer = setTimeout(
      () => {
        if (change === 'completed') {
          onCompleted(item.id);
          setRinging(true);
        } else {
          onFold(item.id, false);
        }
        setChange(null);
      },
      change === 'completed' ? foldAfter(item.sets.length) : 0,
    );
    return () => clearTimeout(timer);
    // Only the change matters; the callbacks are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change]);
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => setRinging(false), TICK_RINGS_MS);
    return () => clearTimeout(timer);
  }, [ringing]);
  const best = bestSet(item.sets);
  const rest = item.restSeconds ?? restFor(exercise);
  const plan = item.repMin !== null && item.repMax !== null ? { min: item.repMin, max: item.repMax } : null;
  const range = plan ? `${plan.min}–${plan.max}${exercise.kind === 'time' ? ' s' : ''}` : null;
  const timed = exercise.kind === 'time';
  let ordinal = 0;

  // Last time against the planned range: all sets at the top means more load today, most of
  // them under the bottom means less. Taking the suggested weight fills the sets still to do.
  const advice = shownComplete ? null : progression(item.previous, plan, exercise.kind, loadIncrement(exercise.equipment));
  const [weight, setWeight] = useState<number | null>(() => taken.get(item.id) ?? null);
  const takeWeight = (value: number) => {
    haptics.light();
    taken.set(item.id, value);
    setWeight(value);
  };

  // Folded with the set to do now inside, the exercise is picked out as that set would be.
  const currentIndex = item.sets.findIndex((set) => set.id === currentSetId);
  const holdsCurrent = collapsed && currentIndex >= 0;

  const editNote = () => router.push({ pathname: '/note-sheet', params: { kind: 'exercise', id: exercise.id, text: exercise.note ?? '' } });

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
            {shownComplete ? (
              <View>
                {ringing ? <ExpandingRings size={TICK_SIZE} color={theme.accent} /> : null}
                <Animated.View entering={DONE_IN}>
                  <Icon name="checkmark.circle.fill" size={TICK_SIZE} tone="accent" />
                </Animated.View>
              </View>
            ) : null}
            {/* The name makes room for the tick as the exercise folds, instead of jumping aside. */}
            <Animated.View layout={BLOCK_LAYOUT} style={styles.flex}>
              <AppText variant="headline" tone={shownComplete ? 'text' : 'accent'} numberOfLines={collapsed ? 1 : undefined}>
                {names.title}
              </AppText>
              <AppText variant="footnote" tone={holdsCurrent ? 'accent' : 'textSecondary'} weight={holdsCurrent ? '600' : undefined} numberOfLines={1}>
                {holdsCurrent
                  ? `Ora: serie ${currentIndex + 1} di ${item.sets.length}`
                  : shownComplete && best
                  ? `${item.sets.length === 1 ? '1 serie' : `${item.sets.length} serie`} · migliore ${formatSet(best, exercise.kind)}`
                  : [names.subtitle, plan ? `${item.sets.length === 1 ? '1 serie' : `${item.sets.length} serie`} · ${plan.min}–${plan.max} ${timed ? 's' : 'rip'}` : muscleLabel(exercise.muscle)].filter(Boolean).join(' · ')}
              </AppText>
            </Animated.View>
          </Pressable>
          <Pressable
            disabled={editing}
            onPress={() => {
              haptics.selection();
              onFold(item.id, !collapsed);
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
                  { label: 'Elimina esercizio', icon: 'trash', destructive: true, onPress: () => onRemove(item.id) },
                ],
              },
            ]}
          />
        </View>
        {collapsed ? null : (
        <Animated.View entering={SETS_IN} exiting={SETS_OUT} pointerEvents={editing ? 'none' : 'auto'}>
        <SetBars sets={item.sets} wave={change === 'completed'} />
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
        {asking ? (
          // The sets planned are done: one more, or it is over. Until then the values can still be changed.
          <Animated.View entering={ASK_IN} layout={BLOCK_LAYOUT} style={[styles.ask, { borderTopColor: theme.separator }]}>
            <View style={styles.askText}>
              <AppText variant="subhead" weight="600">
                Tutte le serie fatte
              </AppText>
              <AppText variant="footnote" tone="textSecondary">
                Puoi ancora correggere i dati, poi tocca Concludi.
              </AppText>
            </View>
            <View style={styles.askButtons}>
              <View style={styles.askMore}>
                <Button
                  title="Aggiungi serie"
                  variant="tinted"
                  onPress={() => {
                    haptics.light();
                    void addSet(db, item.id);
                  }}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  title="Concludi"
                  onPress={() => onConclude(item.id, true)}
                />
              </View>
            </View>
          </Animated.View>
        ) : (
          // Adding a set and the rest after each one: what is changed most while training.
          <Animated.View layout={BLOCK_LAYOUT} style={styles.exerciseFooter}>
            <View style={styles.flex}>
              <ActionRow label="Aggiungi serie" symbol="plus" onPress={() => void addSet(db, item.id)} />
            </View>
            <RestPicker inert={!settled} value={rest} onChange={(seconds) => void setWorkoutExerciseRest(db, item.id, seconds)} />
          </Animated.View>
        )}
        </Animated.View>
        )}
      </ListGroup>
    </View>
  );
});

/**
 * A bar for each set of the exercise, filling as they are ticked: how far along it is, at a glance.
 * With the last one, `wave` runs a light across them.
 */
function SetBars({ sets, wave }: { sets: readonly WorkoutSet[]; wave: boolean }) {
  return (
    <View style={styles.setBars} accessible accessibilityLabel={`${sets.filter((set) => set.done).length} serie fatte su ${sets.length}`}>
      {sets.map((set, index) => (
        <SetBar key={set.id} done={set.done} waveAfter={wave ? WAVE_AFTER_MS + index * waveStep(sets.length) : null} />
      ))}
    </View>
  );
}

function SetBar({ done, waveAfter }: { done: boolean; waveAfter: number | null }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const swell = useSharedValue(0);
  useEffect(() => {
    if (waveAfter === null || reduced) return;
    swell.set(
      withDelay(
        waveAfter,
        withSequence(
          withTiming(1, { duration: WAVE_BAR_MS * 0.45, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: WAVE_BAR_MS * 0.55, easing: Easing.inOut(Easing.quad) }),
        ),
      ),
    );
  }, [swell, waveAfter, reduced]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + 1.6 * swell.get() }] }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: 0.55 * swell.get() }));
  return (
    <Animated.View style={[styles.setBar, { backgroundColor: theme.track }, barStyle]}>
      <Animated.View style={[styles.setBarFill, barTransition.fill, { transform: [{ scaleX: done ? 1 : 0 }], backgroundColor: theme.accent }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.setBarLight, lightStyle]} />
    </Animated.View>
  );
}

function toText(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? '' : numberToInput(value, decimals);
}

const KEY_BAR_HEIGHT = 56;
/** About the curve the keyboard moves on. */
const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);

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
 *
 * Our own view, moved along with the keyboard: the system's bar for this attaches to the first text
 * box with its id and to no other, so only the first box of the whole workout had it.
 */
function KeyboardBar({ scroll }: { scroll: ScrollTop }) {
  const theme = useTheme();
  const { height: screen } = useWindowDimensions();
  const target = useSyncExternalStore(nudge.subscribe, nudge.get);
  const lift = useSharedValue(0);
  const keyboard = useRef(0);
  // iOS brings the box being typed in just above the keyboard, which here is under this bar.
  const reveal = useStableCallback(() => {
    // Only for a value box of the workout: the keyboard of a note, in its own sheet over this one,
    // scrolled the exercises behind it.
    if (keyboard.current === 0 || !nudge.get()) return;
    TextInput.State.currentlyFocusedInput()?.measureInWindow((_x, y, _width, height) => {
      const under = y + height + Spacing.sm - (screen - keyboard.current - KEY_BAR_HEIGHT);
      if (under > 0) scroll.ref.current?.scrollTo({ y: scroll.offset.get() + under, animated: true });
    });
  });
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', (event) => {
        keyboard.current = event.endCoordinates.height;
        lift.set(withTiming(event.endCoordinates.height, { duration: event.duration || 250, easing: KEYBOARD_EASING }));
      }),
      Keyboard.addListener('keyboardDidShow', () => reveal()),
      Keyboard.addListener('keyboardWillHide', (event) => {
        keyboard.current = 0;
        lift.set(withTiming(0, { duration: event.duration || 250, easing: KEYBOARD_EASING }));
      }),
      // Not before: it goes down with the keyboard. And the note's sheet has a keyboard of its own.
      Keyboard.addListener('keyboardDidHide', () => nudge.set(null)),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, [lift, reveal]);
  // From box to box the keyboard stays where it is, and only this says the box has changed.
  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(reveal, 80);
    return () => clearTimeout(timer);
  }, [target, reveal]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));
  if (!target) return null;
  const step = formatNumber(target.step, 2);
  const press = (delta: number) => {
    haptics.selection();
    target.by(delta);
  };
  return (
    <Animated.View style={[styles.keyboardBar, { backgroundColor: theme.background, borderTopColor: theme.separator }, style]}>
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
      <View style={styles.flex} />
      <Pressable
        onPress={() => Keyboard.dismiss()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.keyButton, { backgroundColor: theme.card }, pressed && { opacity: 0.6 }]}>
        <AppText variant="headline" tone="accent">
          Fine
        </AppText>
      </Pressable>
    </Animated.View>
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
  // A tick answers at once, and the rest starts: the write and the read after it follow.
  const [ticking, setTicking] = useState<boolean | null>(null);
  if (ticking !== null && ticking === set.done) setTicking(null);
  const done = ticking ?? set.done;
  const onComplete = (fields: SetFields) => {
    const startedAt = restTimer.endedAt();
    setTicking(true);
    haptics.light();
    latest.onSetDone?.(set.id, rest);
    void updateSet(db, set.id, { ...fields, done: true, startedAt });
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

  // Once a set is ticked, a count outside the planned range turns orange, and where last time
  // was it says by how much. Warm-ups and drop sets follow their own counts.
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

  const tick = () => {
    if (done) {
      haptics.selection();
      setTicking(false);
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
      selectTextOnFocus
      editable={!done}
      accessibilityLabel={label}
      style={[
        styles.input,
        {
          backgroundColor: done ? 'transparent' : theme.fill,
          color: flagged ? theme.warning : theme.text,
        },
        missing && value === '' && { borderColor: theme.danger, borderWidth: 1.5 },
      ]}
    />
    </>
  );

  return (
    <Animated.View entering={SET_IN} exiting={SET_OUT} layout={BLOCK_LAYOUT} style={styles.setSlot}>
    <SwipeToDelete collapse={false} onDelete={onDelete}>
    <View style={done && { backgroundColor: `${theme.accent}1F` }}>
    {divided ? <View style={[styles.setDivider, { backgroundColor: theme.separator }]} /> : null}
    <Animated.View style={[styles.setRow, shakeStyle]}>
      {/* No mark for the set to do now, as in Strong and Hevy: the sets done turn green, and the
          next one is the first still white. */}
      <View style={styles.colSet}>
        <SetTypeMenu inert={!settled} badge={badge} type={set.type} done={done} onChange={(type) => onUpdate({ type })} onDelete={onDelete} />
      </View>
      {outside && range ? (
        // A count outside the plan, said where last time was, in place: nothing to fix, it was done.
        <View style={styles.colPrev} accessible accessibilityLabel={`${outside === 'above' ? 'Sopra' : 'Sotto'} ${range.min}–${range.max}`}>
          <AppText variant="footnote" weight="600" numeric numberOfLines={1} style={{ color: theme.warning }}>
            {`${outside === 'above' ? '↑ sopra' : '↓ sotto'} ${range.min}–${range.max}`}
          </AppText>
        </View>
      ) : (
        <AppText variant="subhead" tone="textSecondary" numeric numberOfLines={1} style={styles.colPrev}>
          {previous ? formatSet(previous, kind).replace(' kg ×', ' ×') : '—'}
        </AppText>
      )}
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
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? 'Serie fatta, tocca per riaprirla' : 'Segna la serie come fatta'}
        style={({ pressed }) => [
          styles.colCheck,
          styles.check,
          done ? { backgroundColor: theme.accent } : { borderWidth: 2, borderColor: theme.separator, backgroundColor: theme.card },
          pressed && { opacity: 0.6 },
        ]}>
        <Icon name="checkmark" size={15} weight="bold" color={done ? theme.onAccent : theme.textTertiary} />
      </Pressable>
    </Animated.View>
    </View>
    </SwipeToDelete>
    </Animated.View>
  );
});

/**
 * The time of the workout in the bar, shown once the big one at the top of the page has scrolled
 * under it. It ticks on its own: the rest of the screen does not redraw every second, which got in
 * the way of dragging.
 */
function WorkoutTitle({
  name,
  startedAt,
  offset,
  after,
  onPress,
}: {
  name: string;
  startedAt: string;
  offset: SharedValue<number>;
  after: SharedValue<number>;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const now = useClock(1000);
  const elapsed = formatDuration((now - new Date(startedAt).getTime()) / 1000);
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (offset.get() - after.get() + 8) / 16));
    return { opacity: t, transform: [{ translateY: (1 - t) * 6 }] };
  });
  return (
    // While editing, a tap here ends it too, as a tap anywhere else on the page does.
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={styles.title}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${name}, ${elapsed}`}>
      <Animated.View style={style}>
        <AppText numeric style={[styles.titleTime, { color: theme.accent }]}>
          {elapsed}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The top of the page: the workout's name, with room for two lines, then its time, big, with the
 * sets done and a bar of how far along it is.
 */
function WorkoutHead({
  name,
  startedAt,
  done,
  total,
  onTimeLayout,
}: {
  name: string;
  startedAt: string;
  done: number;
  total: number;
  onTimeLayout: (bottom: number) => void;
}) {
  const theme = useTheme();
  const now = useClock(1000);
  const elapsed = formatDuration((now - new Date(startedAt).getTime()) / 1000);
  // The head is the first thing in the page, so its own measures are the page's.
  const [top, setTop] = useState(0);
  return (
    <View style={styles.head} onLayout={(event) => setTop(event.nativeEvent.layout.y)}>
      <AppText variant="title" numberOfLines={2}>
        {name}
      </AppText>
      <View style={styles.headTime} onLayout={(event) => onTimeLayout(top + event.nativeEvent.layout.y + event.nativeEvent.layout.height)}>
        <AppText numeric accessibilityLabel={`In corso da ${elapsed}`} style={[styles.headClock, { color: theme.accent }]}>
          {elapsed}
        </AppText>
        <View style={styles.headCount}>
          <AppText variant="subhead" weight="600" numeric numberOfLines={1}>
            {`${done} di ${total} serie`}
          </AppText>
          <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
            {`dalle ${clockOf(startedAt)}`}
          </AppText>
        </View>
      </View>
      <ProgressBar value={done} target={Math.max(total, 1)} color={theme.accent} height={6} />
    </View>
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
    restTimer.markEnded();
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

const TICK_SIZE = 24;
const REST_IN = FadeInDown.springify().damping(18).stiffness(180);
const REST_OUT = FadeOutDown.duration(320);
/** The tick appears as the exercise folds, growing into place without going past it. */
const DONE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.5 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(340);
const CURRENT_IN = FadeIn.duration(260);
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
const ASK_IN = FadeIn.duration(240);
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

const barTransition = css.create({
  // Scaled rather than widened: a width lays out the whole screen at every frame.
  fill: { transitionProperty: 'transform', transitionDuration: 300, transitionTimingFunction: 'ease-out' },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  // Narrow enough to leave room for ⌄ on the left and the note, ⋯ and "Termina" on the right: a
  // wider title makes iOS fold them away into an overflow menu.
  title: { alignItems: 'center', maxWidth: 110 },
  titleTime: { fontSize: 20, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  head: { gap: Spacing.sm, paddingTop: Spacing.lg, paddingBottom: Spacing.xl, paddingHorizontal: Spacing.xs },
  headTime: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
  headClock: { flex: 1, fontSize: 48, lineHeight: 54, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  headCount: { alignItems: 'flex-end', paddingBottom: 6, gap: 1 },
  exercise: {},
  setBars: { flexDirection: 'row', gap: 3, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  setBar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  setBarFill: { width: '100%', height: '100%', borderRadius: 2, transformOrigin: 'left center' },
  setBarLight: { backgroundColor: '#FFFFFF' },
  exerciseFooter: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.md },
  ask: { gap: Spacing.md, padding: Spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  askText: { gap: 2 },
  askButtons: { flexDirection: 'row', gap: Spacing.sm },
  // The longer label gets the room it needs on one line.
  askMore: { flex: 1.35 },
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
  keyboardBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: KEY_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  warmUpOffer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, paddingRight: Spacing.xs, marginBottom: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous' },
  warmUpClose: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  warmUp: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingLeft: Spacing.lg, paddingRight: Spacing.md, paddingVertical: Spacing.sm, minHeight: 60 },
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
