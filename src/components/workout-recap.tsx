import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedReaction, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { SFSymbol } from 'expo-symbols';

import { Radius, Spacing } from '@/constants/theme';
import type { getRecords, Workout, WorkoutExercise } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate } from '@/lib/dates';
import { isWarmUp } from '@/lib/exercises';
import { clockOf } from '@/lib/plan';
import { compareWorkouts, exerciseChange, formatSeconds, formatWorkoutLength, formatWorkoutLengthShort, isWorkSet, setTimes, tonnage, type ExerciseChange, type WorkoutNumbers } from '@/lib/training';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { EditableTitle } from './editable-title';
import { Fold } from './fold';
import { FoldChevron } from './fold-chevron';
import { Icon } from './icon';
import { SetSummaryLine, SetTable } from './set-lines';

type Records = Awaited<ReturnType<typeof getRecords>>;

/** One after the other, the first ones first, without any bounce, once the tick has gone. */
const STAGGER = 45;
export const RECAP_AFTER_MS = 1250;
const rowIn = (index: number) => FadeInDown.delay(RECAP_AFTER_MS + index * STAGGER).duration(280);

/** How long the numbers take to grow, each starting a little after the one above. */
const COUNT_MS = 1100;
const COUNT_STAGGER = 120;

/** Where the dot sits on each step of the line. */
const DOT_Y = 28;

type WorkoutRecapProps = {
  workout: Workout;
  records: Records;
  /** The last workout of the same day of the program: its numbers are beside these when reopened. */
  previous?: Workout | null;
  /** At the end of a workout, its rows come in one after the other and its numbers grow. */
  arriving?: boolean;
  /** With it, the name is renamed by tapping it, as a program's. */
  onRename?: (name: string) => void;
};

/**
 * What a workout was: its numbers, then a line from when it started to when it ended, as the line
 * in the training tab, with each exercise, all its sets and whether it grew, and last the note, in
 * the user's own words. At its end the numbers grow into place, on their own; reopened later they
 * have last time's beside them.
 */
export function WorkoutRecap({ workout, records, previous = null, arriving = false, onRename }: WorkoutRecapProps) {
  const theme = useTheme();
  const { names } = useExerciseNames();
  const numbersOf = (w: Workout): WorkoutNumbers => ({
    seconds: w.endedAt ? (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000 : 0,
    sets: w.exercises.flatMap((e) => e.sets).filter(isWorkSet).length,
    lifted: tonnage(w.exercises.flatMap((e) => e.sets)),
  });
  const numbers = numbersOf(workout);
  const compared = previous && !arriving ? compareWorkouts(numbers, numbersOf(previous)) : null;
  const rows: { label: string; value: number; format: (value: number) => string; compare?: string }[] = [
    { label: 'Durata', value: numbers.seconds, format: formatWorkoutLength, compare: compared ? sinceLastTime(compared.duration) : undefined },
  ];
  // At its end, the sets done, counting up; no kilos lifted, which the user does not want. Looked
  // at later, only the times: the sets and the load are with each exercise below.
  if (arriving) rows.push({ label: 'Serie fatte', value: numbers.sets, format: String });
  // Reopened later, also how the time went: known for the sets ticked since it is kept.
  const times = arriving ? null : setTimes(workout.exercises.flatMap((e) => e.sets));
  if (times?.between != null) rows.push({ label: 'Tempo medio tra due serie', value: times.between, format: formatSeconds });
  if (times?.work != null) rows.push({ label: 'Durata media di una serie', value: times.work, format: formatSeconds });
  const recordOf = (exercise: WorkoutExercise) => records.some((r) => r.exercise.id === exercise.exercise.id);

  return (
    <View style={styles.recap}>
      <Animated.View entering={arriving ? FadeIn.delay(RECAP_AFTER_MS).duration(280) : undefined} style={styles.head}>
        {onRename ? (
          <EditableTitle value={workout.name} accessibilityLabel="Nome dell’allenamento" onChange={onRename} style={styles.title} />
        ) : (
          <AppText variant="display" numberOfLines={2}>
            {workout.name}
          </AppText>
        )}
        <AppText variant="subhead" tone="textSecondary">
          {formatLongDate(workout.date)}
        </AppText>
      </Animated.View>

      <Animated.View entering={arriving ? rowIn(1) : undefined}>
        {rows.map((row, index) => (
          <View key={row.label} style={[styles.number, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
            <View style={styles.flex}>
              <AppText variant="subhead" tone="textSecondary">
                {row.label}
              </AppText>
              {row.compare ? (
                <AppText variant="footnote" tone="textSecondary">
                  {row.compare}
                </AppText>
              ) : null}
            </View>
            {arriving ? (
              <CountUp to={row.value} format={row.format} delay={RECAP_AFTER_MS + index * COUNT_STAGGER} />
            ) : (
              <AppText variant="title2" numeric numberOfLines={1}>
                {row.format(row.value)}
              </AppText>
            )}
          </View>
        ))}
      </Animated.View>

      <View>
        <Step first time index={2} arriving={arriving}>
          <AppText variant="footnote" weight="600" tone="textSecondary" numeric>
            {`Iniziato alle ${clockOf(workout.startedAt)}`}
          </AppText>
        </Step>
        {workout.exercises.map((exercise, index) => {
          if (isWarmUp(exercise.exercise)) {
            const seconds = exercise.sets[0]?.seconds ?? null;
            return (
              <Step key={exercise.id} done index={index + 3} arriving={arriving}>
                <View style={[styles.exercise, styles.warmUp, { backgroundColor: theme.card }]}>
                  <View style={[styles.flame, { backgroundColor: theme.warningSoft }]}>
                    <Icon name="flame.fill" size={15} tone="warning" />
                  </View>
                  <AppText numberOfLines={1} style={styles.flex}>
                    Riscaldamento
                  </AppText>
                  {seconds !== null ? (
                    <AppText variant="subhead" weight="600" numeric>
                      {formatWorkoutLengthShort(seconds)}
                    </AppText>
                  ) : null}
                </View>
              </Step>
            );
          }
          const work = exercise.sets.filter(isWorkSet);
          return (
            <Step key={exercise.id} done={work.length > 0} index={index + 3} arriving={arriving}>
              <ExerciseCard
                name={names(exercise.exercise).title}
                exercise={exercise}
                change={work.length > 0 ? exerciseChange(work, exercise.previous, exercise.exercise.kind) : null}
                record={recordOf(exercise)}
                withWas={!arriving}
              />
            </Step>
          );
        })}
        {workout.endedAt ? (
          <Step last time index={workout.exercises.length + 3} arriving={arriving}>
            <AppText variant="footnote" weight="600" tone="textSecondary" numeric>
              {`Finito alle ${clockOf(workout.endedAt)}`}
            </AppText>
          </Step>
        ) : null}
      </View>

      {/* The last word, the user's: with the rest, after the tick. */}
      {workout.notes ? (
        <Animated.View entering={arriving ? rowIn(workout.exercises.length + 4) : undefined} style={styles.note}>
          <AppText accessible={false} style={[styles.noteMark, { color: theme.textTertiary }]}>
            “
          </AppText>
          <AppText style={styles.noteText}>{workout.notes}</AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** "8 min in più dell’ultima volta", "Come l’ultima volta". */
function sinceLastTime(duration: string): string {
  const same = 'come l’ultima volta';
  return duration === same ? 'Come l’ultima volta' : `${duration} dell’ultima volta`;
}

/**
 * An exercise of the workout, folded: its name, how it went against last time and its sets in one
 * line. A tap opens every set, one per row.
 */
function ExerciseCard({
  name,
  exercise,
  change,
  record,
  withWas,
}: {
  name: string;
  exercise: WorkoutExercise;
  change: ExerciseChange | null;
  record: boolean;
  withWas: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const done = exercise.sets.filter((set) => set.done);
  const work = done.filter(isWorkSet);
  const kind = exercise.exercise.kind;
  if (work.length === 0) {
    return (
      <View style={[styles.exercise, { backgroundColor: theme.card }]}>
        <AppText variant="headline" numberOfLines={2} tone="textSecondary">
          {name}
        </AppText>
        <AppText variant="footnote" tone="textSecondary">
          Saltato
        </AppText>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        setOpen(!open);
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? 'Chiude le serie' : 'Mostra ogni serie'}
      style={({ pressed }) => [styles.exercise, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}>
      <View style={styles.exerciseHead}>
        <AppText variant="headline" numberOfLines={2} style={styles.flex}>
          {name}
        </AppText>
        <FoldChevron open={open} />
      </View>
      {change ? <Change change={change} record={record} withWas={withWas} /> : null}
      <SetSummaryLine sets={work} kind={kind} />
      <Fold open={open}>
        {/* Warm-up sets too, said as such: they count in no total, but they were done. */}
        <View style={styles.sets}>
          <SetTable
            sets={done}
            kind={kind}
            range={exercise.repMin !== null && exercise.repMax !== null ? { min: exercise.repMin, max: exercise.repMax } : null}
          />
        </View>
      </Fold>
    </Pressable>
  );
}

/** A number growing from nothing to its value, slowing down as it gets there. */
function CountUp({ to, format, delay }: { to: number; format: (value: number) => string; delay: number }) {
  const reduced = useReducedMotion();
  const value = useSharedValue(reduced ? to : 0);
  const [shown, setShown] = useState(reduced ? to : 0);
  useEffect(() => {
    if (!reduced) value.set(withDelay(delay, withTiming(to, { duration: COUNT_MS, easing: Easing.out(Easing.cubic) })));
  }, [value, to, delay, reduced]);
  useAnimatedReaction(
    () => Math.round(value.get()),
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(setShown, now);
    },
  );
  return (
    <AppText variant="title2" numeric numberOfLines={1}>
      {format(shown)}
    </AppText>
  );
}

/** In words, whether the exercise grew, stayed the same or set a record, and by how much. */
function Change({ change, record, withWas }: { change: ExerciseChange; record: boolean; withWas: boolean }) {
  const theme = useTheme();
  const look: { icon: SFSymbol; word: string; color: string } =
    change.trend === 'new'
      ? { icon: 'sparkles', word: 'Prima volta', color: theme.textSecondary }
      : record
        ? { icon: 'trophy.fill', word: 'Record', color: theme.ringCloser }
        : change.trend === 'up'
          ? { icon: 'arrow.up.right', word: 'Meglio dell’altra volta', color: theme.accent }
          : change.trend === 'down'
            ? { icon: 'arrow.down.right', word: 'Peggio dell’altra volta', color: theme.warning }
            : { icon: 'equal', word: 'Come l’altra volta', color: theme.textSecondary };
  const amount = change.trend === 'up' || change.trend === 'down' ? change.label : null;
  return (
    <View style={styles.change}>
      <Icon name={look.icon} size={13} weight="semibold" color={look.color} />
      <AppText variant="footnote" weight="600" numeric style={{ color: look.color }}>
        {amount ? `${look.word} · ${amount}` : look.word}
      </AppText>
      {withWas && change.was ? (
        <AppText variant="footnote" tone="textSecondary" numeric>
          {`era ${change.was}`}
        </AppText>
      ) : null}
    </View>
  );
}

/** A step of the line: a tick for an exercise done, a dot for the times at its two ends. */
function Step({
  first = false,
  last = false,
  time = false,
  done = false,
  index,
  arriving,
  children,
}: {
  first?: boolean;
  last?: boolean;
  time?: boolean;
  done?: boolean;
  index: number;
  arriving: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const dotY = time ? 9 : DOT_Y;
  return (
    <Animated.View entering={arriving ? rowIn(index) : undefined} style={styles.step}>
      <View style={styles.rail}>
        <View style={[styles.line, { backgroundColor: theme.separator }, first ? { top: dotY } : { top: 0 }, last ? { height: dotY } : { bottom: 0 }]} />
        <View style={[styles.dotSlot, { top: dotY - 10 }]}>
          {done ? (
            <View style={[styles.tick, { backgroundColor: theme.accent }]}>
              <Icon name="checkmark" size={11} weight="bold" color={theme.onAccent} />
            </View>
          ) : (
            <View style={[styles.dot, { backgroundColor: theme.separator }]} />
          )}
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  recap: { gap: Spacing.lg },
  head: { gap: 2 },
  // As the display text it replaces, without the page title's own spacing.
  title: { fontSize: 40, lineHeight: 46, letterSpacing: -0.5, marginBottom: 0, paddingHorizontal: 0 },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sets: { paddingTop: Spacing.sm },
  number: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, paddingVertical: Spacing.sm },
  step: { flexDirection: 'row', gap: Spacing.sm },
  rail: { width: 20, alignItems: 'center' },
  line: { position: 'absolute', width: 2, left: 9 },
  dotSlot: { position: 'absolute', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tick: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, paddingBottom: Spacing.sm },
  warmUp: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flame: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  exercise: { gap: 6, minHeight: 56, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, borderRadius: Radius.md, borderCurve: 'continuous' },
  change: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, marginBottom: 2 },
  // Set apart from the app's own words: the book's voice, with the opening quote hanging on its left.
  note: { paddingLeft: 28 },
  noteMark: { position: 'absolute', left: 0, top: -6, fontFamily: 'ui-serif', fontSize: 48, lineHeight: 56 },
  noteText: { fontFamily: 'ui-serif', fontStyle: 'italic', fontSize: 18, lineHeight: 24 },
});
