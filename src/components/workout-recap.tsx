import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import type { getRecords, Workout, WorkoutExercise } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate } from '@/lib/dates';
import { clockOf } from '@/lib/plan';
import { exerciseChange, formatLifted, formatSetShort, formatWorkoutLengthShort, isWorkSet, tonnage, type ExerciseChange } from '@/lib/training';

import { AppText } from './app-text';
import { Icon } from './icon';

type Records = Awaited<ReturnType<typeof getRecords>>;

/** One after the other, the first ones first, without any bounce. */
const STAGGER = 45;
const rowIn = (index: number) => FadeInDown.delay(index * STAGGER).duration(280);

/** Where the dot sits on each step of the line. */
const DOT_Y = 28;

type WorkoutRecapProps = {
  workout: Workout;
  records: Records;
  /** The last workout of the same day of the program, to compare with. */
  previous: Workout | null;
  /** At the end of a workout, its rows come in one after the other. */
  arriving?: boolean;
};

/**
 * What a workout was, the same at its end and reopened later: how it compares with the last one
 * and its numbers on top, then a line from when it started to when it ended, as the line in the
 * training tab, with each exercise, all its sets and what changed since last time.
 */
export function WorkoutRecap({ workout, records, previous, arriving = false }: WorkoutRecapProps) {
  const theme = useTheme();
  const { names } = useExerciseNames();
  const lifted = (w: Workout) => tonnage(w.exercises.flatMap((e) => e.sets));
  const sets = workout.exercises.flatMap((e) => e.sets).filter(isWorkSet);
  const seconds = workout.endedAt ? (new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000 : 0;
  const metrics = [
    { label: 'durata', value: formatWorkoutLengthShort(seconds) },
    { label: 'serie', value: String(sets.length) },
    { label: 'sollevati', value: formatLifted(lifted(workout)) },
  ];
  const verdict = previous ? verdictOf(lifted(workout), lifted(previous)) : null;
  const recordOf = (exercise: WorkoutExercise) => records.some((r) => r.exercise.id === exercise.exercise.id);

  return (
    <View style={styles.recap}>
      <Animated.View entering={arriving ? FadeIn.duration(280) : undefined} style={styles.head}>
        <AppText variant="display" numberOfLines={2}>
          {workout.name}
        </AppText>
        <AppText variant="subhead" tone="textSecondary">
          {formatLongDate(workout.date)}
        </AppText>
        {verdict ? (
          <View style={styles.verdict}>
            {verdict.trend !== 'same' ? <Icon name={verdict.trend === 'up' ? 'arrow.up.right' : 'arrow.down.right'} size={14} weight="semibold" tone={verdict.trend === 'up' ? 'accent' : 'warning'} /> : null}
            <AppText variant="subhead" weight="600" tone={verdict.trend === 'up' ? 'accent' : verdict.trend === 'down' ? 'warning' : 'textSecondary'}>
              {verdict.text}
            </AppText>
          </View>
        ) : null}
      </Animated.View>

      <Animated.View entering={arriving ? rowIn(1) : undefined} style={[styles.metrics, { backgroundColor: theme.card }]}>
        {metrics.map((m) => (
          <View key={m.label} style={styles.metric}>
            <AppText variant="title3" numeric numberOfLines={1}>
              {m.value}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {m.label}
            </AppText>
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
          const work = exercise.sets.filter(isWorkSet);
          const change = exerciseChange(work, exercise.previous, exercise.exercise.kind);
          return (
            <Step key={exercise.id} done={work.length > 0} index={index + 3} arriving={arriving}>
              <View style={[styles.exercise, { backgroundColor: theme.card }]}>
                <View style={styles.flex}>
                  <AppText numberOfLines={2} tone={work.length > 0 ? 'text' : 'textSecondary'}>
                    {names(exercise.exercise).title}
                  </AppText>
                  <AppText variant="footnote" tone="textSecondary" numeric>
                    {work.length > 0 ? work.map((set) => formatSetShort(set, exercise.exercise.kind)).join(' · ') : 'Saltato'}
                  </AppText>
                </View>
                {work.length > 0 ? <Change change={change} record={recordOf(exercise)} /> : null}
              </View>
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

      {workout.notes ? (
        <View style={[styles.notes, { backgroundColor: theme.card }]}>
          <AppText variant="subhead" tone="textSecondary">
            {workout.notes}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function verdictOf(now: number, before: number): { text: string; trend: 'up' | 'down' | 'same' } | null {
  if (before <= 0) return null;
  const diff = Math.round(now - before);
  if (Math.abs(diff) < 1) return { text: 'Come l’ultima volta', trend: 'same' };
  return diff > 0
    ? { text: `Meglio dell’ultima volta · ${formatLifted(diff)} in più`, trend: 'up' }
    : { text: `${formatLifted(-diff)} in meno dell’ultima volta`, trend: 'down' };
}

/** What changed since last time, with what it was, and a trophy on a record. */
function Change({ change, record }: { change: ExerciseChange; record: boolean }) {
  const theme = useTheme();
  const color = change.trend === 'up' ? theme.accent : change.trend === 'down' ? theme.warning : theme.textSecondary;
  return (
    <View style={styles.change}>
      <View style={styles.changeTop}>
        {record ? <Icon name="trophy.fill" size={13} color={theme.ringCloser} /> : null}
        <AppText variant="subhead" weight="700" numeric style={{ color }}>
          {change.label}
        </AppText>
      </View>
      {change.was ? (
        <AppText variant="caption" tone="textSecondary" numeric numberOfLines={1}>
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
  verdict: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  metrics: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous' },
  metric: { flex: 1, gap: 1 },
  step: { flexDirection: 'row', gap: Spacing.sm },
  rail: { width: 20, alignItems: 'center' },
  line: { position: 'absolute', width: 2, left: 9 },
  dotSlot: { position: 'absolute', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tick: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, paddingBottom: Spacing.sm },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, borderRadius: Radius.md, borderCurve: 'continuous' },
  change: { alignItems: 'flex-end', gap: 1 },
  changeTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  notes: { padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous' },
});
