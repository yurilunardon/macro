import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import Animated, { FadeIn, LayoutAnimationConfig } from 'react-native-reanimated';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ProgressBar } from '@/components/progress';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SetTypeMenu } from '@/components/set-type-menu';
import { SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { restFor, updateExerciseOptions } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import {
  addSet,
  deleteSet,
  deleteWorkout,
  finishWorkout,
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
import { formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import { formatDuration, formatSet, tonnage, type LoggedSet } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { restTimer, useRestTimer } from '@/services/rest-timer';

const REST_PRESETS = [60, 90, 120, 150, 180, 240];
const glass = isLiquidGlassAvailable();

/** "Lat pulldown · serie 3": the first set still to do after `setId`, for the rest timer. */
function nextSetLabel(workout: Workout, setId: number, title: (e: WorkoutExercise) => string): string | null {
  let passed = false;
  for (const ex of workout.exercises) {
    let ordinal = 0;
    for (const set of ex.sets) {
      if (set.type !== 'warmup') ordinal += 1;
      if (set.id === setId) {
        passed = true;
        continue;
      }
      if (passed && !set.done) return `${title(ex)} · ${set.type === 'warmup' ? 'riscaldamento' : `serie ${ordinal}`}`;
    }
  }
  return null;
}

/** The workout in progress. Swiping the sheet down keeps it running; it comes back from the bar above the tabs. */
export default function WorkoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const now = useClock(1000);
  const { names } = useExerciseNames();
  const [reordering, setReordering] = useState(false);
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

  const allSets = workout.exercises.flatMap((e) => e.sets);
  const doneCount = allSets.filter((s) => s.done).length;
  const elapsed = (now - new Date(workout.startedAt).getTime()) / 1000;
  const title = (e: WorkoutExercise) => names(e.exercise).title;

  const onSetDone = (setId: number, rest: number) => {
    const next = nextSetLabel(workout, setId, title);
    restTimer.start(rest, next ? `Poi: ${next}` : 'Ultima serie completata', { sound: data.sound });
  };

  const finish = async () => {
    if (doneCount === 0) {
      const discard = await confirmDestructive({
        title: 'Nessuna serie spuntata',
        message: 'Non c’è niente da salvare.',
        action: 'Annulla allenamento',
      });
      if (!discard) return;
      await deleteWorkout(db, workout.id);
      restTimer.stop();
      router.back();
      return;
    }
    const pending = allSets.length - doneCount;
    if (pending > 0) {
      const ok = await confirmDestructive({
        title: 'Terminare l’allenamento?',
        message: `${pending === 1 ? '1 serie non spuntata non verrà salvata' : `${pending} serie non spuntate non verranno salvate`}.`,
        action: 'Termina',
      });
      if (!ok) return;
    }
    await finishWorkout(db, workout.id);
    restTimer.stop();
    haptics.success();
    router.back();
    router.push({ pathname: '/training/session', params: { id: workout.id, done: '1' } });
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
      <ScreenScroll>
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
            <>
              <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altre azioni">
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
              <Stack.Toolbar.Button variant="prominent" onPress={() => void finish()}>
                Termina
              </Stack.Toolbar.Button>
            </>
          )}
        </Stack.Toolbar>

        <View style={styles.stats}>
          <Stat label="Tempo" value={formatDuration(elapsed)} />
          <Stat label="Serie fatte" value={`${doneCount} di ${allSets.length}`} />
          <Stat label="Volume" value={`${formatNumber(tonnage(allSets), 0)} kg`} />
        </View>
        {doneCount === 0 ? (
          <AppText variant="footnote" tone="textSecondary" align="center" style={styles.howTo}>
            Tocca ✓ a fine serie: parte il recupero.
          </AppText>
        ) : null}

        {workout.notes ? (
          <Pressable onPress={editNotes} accessibilityRole="button" style={styles.notes}>
            <Icon name="note.text" size={15} tone="textSecondary" />
            <AppText variant="footnote" tone="textSecondary" style={styles.flex}>
              {workout.notes}
            </AppText>
          </Pressable>
        ) : null}

        {reordering ? (
          <View style={styles.reorder}>
            <SortableList
              items={workout.exercises}
              keyOf={(ex) => String(ex.id)}
              rowHeight={60}
              onReorder={(keys) => void reorderWorkoutExercises(db, keys.map(Number))}
              renderRow={(ex) => (
                <View>
                  <AppText numberOfLines={1}>{title(ex)}</AppText>
                  <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                    {`${ex.sets.length} serie · ${ex.sets.filter((set) => set.done).length} fatte`}
                  </AppText>
                </View>
              )}
            />
            <AppText variant="footnote" tone="textSecondary" style={styles.reorderHint}>
              Tieni premuto un esercizio e trascinalo.
            </AppText>
          </View>
        ) : (
          // Rows already there when the screen opens appear with it; new sets slide in.
          <LayoutAnimationConfig skipEntering>
            {workout.exercises.map((ex) => (
              <ExerciseBlock
                key={ex.id}
                item={ex}
                names={names(ex.exercise)}
                onSetDone={onSetDone}
                onReorder={() => {
                  haptics.medium();
                  setReordering(true);
                }}
              />
            ))}
          </LayoutAnimationConfig>
        )}

        <View style={[styles.footer, reordering && styles.hidden]}>
          <Button
            title="Aggiungi esercizio"
            variant="tinted"
            icon={<Icon name="plus" size={16} tone="accent" weight="semibold" />}
            onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'workout', id: workout.id } })}
          />
          <Button title="Termina allenamento" onPress={() => void finish()} />
        </View>
        <View style={styles.bottomSpace} />
      </ScreenScroll>
      <RestBar />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="title2" numeric>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

type ExerciseBlockProps = {
  item: WorkoutExercise;
  names: { title: string; subtitle: string | null };
  onSetDone: (setId: number, rest: number) => void;
  /** Switches the screen to dragging the exercises into another order. */
  onReorder: () => void;
};

function ExerciseBlock({ item, names, onSetDone, onReorder }: ExerciseBlockProps) {
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
          <Pressable
            onLongPress={onReorder}
            delayLongPress={350}
            accessibilityHint="Tieni premuto per riordinare gli esercizi"
            style={styles.flex}>
            <AppText variant="headline" tone="accent">
              {names.title}
            </AppText>
            <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
              {[names.subtitle, range ? `${item.sets.length} × ${range}` : muscleLabel(exercise.muscle)].filter(Boolean).join(' · ')}
            </AppText>
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
                  { label: 'Elimina esercizio', icon: 'trash', destructive: true, onPress: () => void removeWorkoutExercise(db, item.id) },
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
          <AppText variant="caption" tone="textSecondary" weight="600" style={styles.colPrev}>
            ULTIMA VOLTA
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
  onUpdate: (fields: SetFields) => void;
  onComplete: (fields: SetFields) => void;
  onDelete: () => void;
};

/**
 * One set: its number (tap for warm-up, drop or failure), what was done last time, the values
 * (already filled in with last time's, to change if needed) and the tick that closes the set.
 */
function SetRow({ set, badge, previous, kind, trackRir, onUpdate, onComplete, onDelete }: SetRowProps) {
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
    <View style={[styles.setRow, set.done && { backgroundColor: `${theme.accent}1F` }]}>
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
  if (!rest || expired) return null;
  const left = (rest.endsAt - now) / 1000;
  const over = left <= 0;

  const content = (
    <>
      <View style={styles.restTop}>
        <View style={styles.flex}>
          <AppText variant="footnote" weight="600" tone={over ? 'accent' : 'textSecondary'}>
            {over ? 'RECUPERO FINITO' : 'RECUPERO'}
          </AppText>
          <AppText numeric style={[styles.restTime, { color: over ? theme.accent : theme.text }]}>
            {over ? 'Vai!' : formatDuration(left)}
          </AppText>
        </View>
        {over ? null : (
          <>
            <RestButton label="−15" accessibilityLabel="Togli 15 secondi" onPress={() => restTimer.adjust(-15)} />
            <RestButton label="+15" accessibilityLabel="Aggiungi 15 secondi" onPress={() => restTimer.adjust(15)} />
          </>
        )}
        <RestButton label={over ? 'Ok' : 'Salta'} accessibilityLabel={over ? 'Chiudi' : 'Salta il recupero'} onPress={() => restTimer.stop()} prominent />
      </View>
      <ProgressBar value={Math.max(0, left)} target={rest.total} color={over ? theme.accent : theme.warning} height={6} />
      <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
        {rest.label}
      </AppText>
    </>
  );

  return glass ? (
    <GlassView style={[styles.restBar, { bottom: insets.bottom + Spacing.sm }]} glassEffectStyle="regular">
      {content}
    </GlassView>
  ) : (
    <View style={[styles.restBar, styles.restSolid, { bottom: insets.bottom + Spacing.sm, backgroundColor: theme.card, borderColor: theme.separator }]}>
      {content}
    </View>
  );
}

function RestButton({
  label,
  accessibilityLabel,
  onPress,
  prominent = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  prominent?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.restButton,
        { backgroundColor: prominent ? theme.accent : theme.fill },
        pressed && { opacity: 0.6 },
      ]}>
      <AppText variant="headline" numeric style={{ color: prominent ? theme.onAccent : theme.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  stats: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.xs },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  howTo: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  notes: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  exercise: { marginTop: Spacing.lg },
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
  hidden: { display: 'none' },
  reorder: { marginTop: Spacing.lg },
  reorderHint: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  bottomSpace: { height: 170 },
  restBar: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
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
