import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutDown,
  Keyframe,
  LayoutAnimationConfig,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
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
import { SetTypeMenu } from '@/components/set-type-menu';
import { Jiggle } from '@/components/jiggle';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { restFor, updateExerciseOptions } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import {
  addSet,
  deleteSet,
  deleteWorkout,
  getActiveWorkout,
  getWorkout,
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
import { muscleLabel } from '@/lib/exercises';
import { numberToInput, parseDecimal } from '@/lib/format';
import { formatDuration, formatSet, type LoggedSet } from '@/lib/training';
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
  const { data } = useLiveQuery('workout:active', async (database) => {
    const active = await getActiveWorkout(database);
    const [workout, restAlert] = await Promise.all([
      active ? getWorkout(database, active.id) : Promise.resolve(null),
      getSetting(database, 'restAlert'),
    ]);
    return { workout, sound: restAlert === 'sound' };
  }, ['training', 'settings']);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  const workout = data.workout;
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
    const result = await endWorkout(db, workout.id);
    if (!result) return;
    router.back();
    if (result === 'finished') router.push({ pathname: '/training/session', params: { id: workout.id, done: '1' } });
  };


  const discard = async () => {
    const ok = await confirmDestructive({
      title: 'Annullare l’allenamento?',
      message: 'Le serie registrate verranno eliminate.',
      action: 'Annulla allenamento',
    });
    if (!ok) return;
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

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScreenScroll animatedRef={scrollRef}>
        {/* While reordering, a tap anywhere outside the exercises ends it, as on the Home Screen. */}
        <View onStartShouldSetResponder={() => reordering} onResponderRelease={() => setReordering(false)}>
        <Stack.Screen options={{ title: workout.name }} />
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

        {/* While training only the time matters; sets and volume are in the summary at the end. */}
        <ElapsedTime startedAt={workout.startedAt} />

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
    </View>
  );
}

type ExerciseBlockProps = {
  item: WorkoutExercise;
  names: { title: string; subtitle: string | null };
  onSetDone: (setId: number, rest: number) => void;
  /** Switches the screen to dragging the exercises into another order. */
  onReorder: () => void;
  onRemove: () => void;
};

function ExerciseBlock({ item, names, onSetDone, onReorder, onRemove }: ExerciseBlockProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const { exercise } = item;
  const rest = item.restSeconds ?? restFor(exercise);
  const range =
    item.repMin !== null && item.repMax !== null ? `${item.repMin}–${item.repMax}${exercise.kind === 'time' ? ' s' : ''}` : null;
  const timed = exercise.kind === 'time';
  let ordinal = 0;

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
      <ListGroup>
        <View style={styles.exerciseHeader}>
          <View style={styles.flex} accessible accessibilityHint="Tieni premuto per spostare l’esercizio">
              <AppText variant="headline" tone="accent">
                {names.title}
              </AppText>
              <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                {[names.subtitle, range ? `${item.sets.length} × ${range}` : muscleLabel(exercise.muscle)].filter(Boolean).join(' · ')}
              </AppText>
          </View>
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
        {exercise.note ? (
          <View style={styles.noteRow}>
            <Icon name="pin.fill" size={12} tone="warning" />
            <AppText variant="footnote" style={styles.flex}>
              {exercise.note}
            </AppText>
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
                badge={badge}
                previous={item.previous[index]}
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
      </ListGroup>
    </View>
  );
}

function toText(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? '' : numberToInput(value, decimals);
}

type SetRowProps = {
  set: WorkoutSet;
  badge: string;
  previous: LoggedSet | undefined;
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
function SetRow({ set, badge, previous, kind, trackRir, range, onUpdate, onComplete, onDelete }: SetRowProps) {
  const theme = useTheme();
  // A set not touched yet starts from what was done last time, so most sets are just a tick.
  const start = set.done || set.weight !== null || set.reps !== null || set.seconds !== null ? set : previous;
  const [weight, setWeight] = useState(toText(start?.weight));
  const [reps, setReps] = useState(toText(start?.reps, 0));
  const [seconds, setSeconds] = useState(toText(start?.seconds, 0));
  const [rir, setRir] = useState(toText(set.rir, 1));
  const [missing, setMissing] = useState(false);

  const values = (): SetFields => {
    const r = parseDecimal(reps);
    const s = parseDecimal(seconds);
    return { weight: parseDecimal(weight), reps: r === null ? null : Math.round(r), seconds: s === null ? null : Math.round(s), rir: parseDecimal(rir) };
  };

  // Once a set is ticked, a count outside the planned range (often a typo, 20 for 10) gets a
  // small "!" on the tick; tapping it says why. Warm-ups and drop sets follow their own counts.
  const counted = kind === 'time' ? set.seconds : set.reps;
  const outside =
    set.done &&
    range !== null &&
    counted !== null &&
    (set.type === 'normal' || set.type === 'failure') &&
    (counted > range.max || counted < range.min);
  const explain = () => {
    if (!range || counted === null) return;
    const unit = kind === 'time' ? 'secondi' : 'ripetizioni';
    Alert.alert(
      `Fuori dalla fascia ${range.min}–${range.max}`,
      `Hai registrato ${counted} ${unit}. Se è un errore, tocca ✓ per riaprire la serie e correggerla.`,
    );
  };

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

  const field = (value: string, onChange: (text: string) => void, placeholder: string, label: string) => (
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
        { backgroundColor: set.done ? 'transparent' : theme.fill, color: theme.text },
        missing && { borderColor: theme.danger, borderWidth: 1.5 },
      ]}
    />
  );

  return (
    <View style={set.done && { backgroundColor: `${theme.accent}1F` }}>
    <View style={styles.setRow}>
      <View style={styles.colSet}>
        <SetTypeMenu badge={badge} type={set.type} done={set.done} onChange={(type) => onUpdate({ type })} onDelete={onDelete} />
      </View>
      <AppText variant="subhead" tone="textSecondary" numeric numberOfLines={1} style={styles.colPrev}>
        {previous ? formatSet(previous, kind).replace(' kg ×', ' ×') : '—'}
      </AppText>
      {kind === 'time' ? (
        <View style={styles.colInput}>{field(seconds, setSeconds, 's', 'Secondi')}</View>
      ) : (
        <>
          <View style={styles.colInput}>{field(weight, setWeight, 'kg', 'Chili')}</View>
          <View style={styles.colInput}>{field(reps, setReps, 'rip', 'Ripetizioni')}</View>
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
            : { borderWidth: 2, borderColor: theme.separator, backgroundColor: theme.card },
          pressed && { opacity: 0.6 },
        ]}>
        <Icon name="checkmark" size={15} weight="bold" color={set.done ? theme.onAccent : theme.textTertiary} />
      </Pressable>
      {outside ? (
        <Animated.View entering={ZoomIn.duration(200)} exiting={ZoomOut.duration(120)} style={styles.flag}>
          <Pressable
            onPress={explain}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Valore fuori dalla fascia, tocca per i dettagli"
            style={[styles.flagDot, { backgroundColor: theme.warning, borderColor: theme.card }]}>
            <AppText style={styles.flagText}>!</AppText>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
    </View>
  );
}

/**
 * The time since the start, ticking on its own: the rest of the screen does not redraw every
 * second, which kept rebuilding every exercise and got in the way of dragging them.
 */
function ElapsedTime({ startedAt }: { startedAt: string }) {
  const theme = useTheme();
  const now = useClock(1000);
  const elapsed = formatDuration((now - new Date(startedAt).getTime()) / 1000);
  // A capsule like the time of a workout on the Lock Screen: quieter than a big headline.
  return (
    <View style={styles.clockRow} accessible accessibilityLabel={`Tempo: ${elapsed}`}>
      <View style={[styles.clock, { backgroundColor: `${theme.accent}1F` }]}>
        <Icon name="stopwatch" size={16} tone="accent" weight="semibold" />
        <AppText numeric weight="600" tone="accent" style={styles.clockText}>
          {elapsed}
        </AppText>
      </View>
    </View>
  );
}

/**
 * The rest, big at the bottom of the screen: countdown, what comes next, −15 / +15 and skip.
 * When it is over it says so for a few seconds and goes away.
 */
function RestBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rest = useRestTimer();
  const now = useClock(250, rest !== null);
  const expired = rest !== null && now - rest.endsAt > 5000;
  useEffect(() => {
    if (expired) restTimer.stop();
  }, [expired]);

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

  // "Salta": the bar runs down to empty and the panel drops away, so the skip can be seen.
  const [skipping, setSkipping] = useState(false);
  const skip = () => {
    setSkipping(true);
    haptics.light();
    setTimeout(() => {
      restTimer.stop();
      setSkipping(false);
    }, 380);
  };

  if (!rest || expired) return null;
  const left = skipping ? 0 : (rest.endsAt - now) / 1000;
  const over = !skipping && left <= 0;
  // Green with the whole rest ahead, through orange, to red as it runs out.
  const fraction = Math.max(0, Math.min(1, left / rest.total));
  const barColor = over ? theme.accent : fraction > 0.5 ? mix(theme.ringCloser, theme.ringOnTarget, (fraction - 0.5) * 2) : mix(theme.ringFar, theme.ringCloser, fraction * 2);

  const content = (
    <>
      <View style={styles.restTop}>
        <View style={styles.flex}>
          <View>
            <AppText variant="footnote" weight="600" tone={over ? 'accent' : 'textSecondary'}>
              {over ? 'RECUPERO FINITO' : skipping ? 'SALTATO' : 'RECUPERO'}
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
            <AppText numeric style={[styles.restTime, { color: over ? theme.accent : theme.text }]}>
              {over ? 'Vai!' : formatDuration(Math.max(0, left))}
            </AppText>
          </Animated.View>
        </View>
        {over ? null : (
          <>
            <RestButton label="−15" accessibilityLabel="Togli 15 secondi" disabled={left <= 15 || skipping} onPress={() => adjust(-15)} />
            <RestButton label="+15" accessibilityLabel="Aggiungi 15 secondi" disabled={skipping} onPress={() => adjust(15)} />
          </>
        )}
        <RestButton label={over ? 'Ok' : 'Salta'} accessibilityLabel={over ? 'Chiudi' : 'Salta il recupero'} onPress={over ? () => restTimer.stop() : skip} prominent />
      </View>
      <ProgressBar value={Math.max(0, left)} target={rest.total} color={barColor} height={6} />
      <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
        {rest.label}
      </AppText>
    </>
  );

  // It rises into place when a set is ticked and drops away when skipped or done.
  return (
    <Animated.View entering={REST_IN} exiting={REST_OUT} style={[styles.restSlot, { bottom: insets.bottom + Spacing.sm }]}>
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
const FLOAT_UP = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 6 }] },
  20: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -26 }] },
}).duration(850);

/** Round button of the rest bar that sinks under the finger and springs back. */
function RestButton({
  label,
  accessibilityLabel,
  onPress,
  prominent = false,
  disabled = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
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
  clockRow: { alignItems: 'center', paddingTop: Spacing.xs },
  clock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 40, paddingHorizontal: Spacing.lg, borderRadius: 20 },
  clockText: { fontSize: 20, lineHeight: 24, fontVariant: ['tabular-nums'] },
  notes: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  exercise: {},
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: 60,
  },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  // A small "!" on the top-right edge of the tick.
  flag: { position: 'absolute', right: Spacing.md - 4, top: Spacing.sm - 5 },
  flagDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  flagText: { color: '#FFFFFF', fontSize: 11, lineHeight: 13, fontWeight: '800' },
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
