import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { Workout } from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/lib/format';
import { formatDuration, formatSet, workoutProgress } from '@/lib/training';
import { useRestTimer } from '@/services/rest-timer';

import { AppText } from './app-text';
import { DayBadge } from './day-badge';
import { Icon } from './icon';
import { ProgressBar } from './progress';

/**
 * Where the workout is at, shown when the bar of the workout in progress is held: time, sets and
 * volume so far, the set to do now and every exercise with its ticks.
 */
export function WorkoutPeek({ workout, startedAt }: { workout: Workout | null; startedAt: string }) {
  const theme = useTheme();
  const { names } = useExerciseNames();
  const rest = useRestTimer();
  const now = useClock(1000);
  if (!workout) return <View style={[styles.root, { backgroundColor: theme.background }]} />;
  const progress = workoutProgress(workout.exercises);
  const current = progress.current ? workout.exercises[progress.current.exercise] : null;
  const index = progress.current?.set ?? 0;
  const currentSet = current ? current.sets[index] : null;
  // What the set holds, or else what was done last time, as the tick would fill it in.
  const planned =
    currentSet && (currentSet.weight !== null || currentSet.reps !== null || currentSet.seconds !== null)
      ? currentSet
      : current?.previous[index];
  const resting = rest !== null && rest.endsAt > now;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <DayBadge name={workout.name} size={36} />
        <AppText variant="title2" numberOfLines={1} style={styles.flex}>
          {workout.name}
        </AppText>
        <AppText variant="title2" numeric tone={resting ? 'warning' : 'text'}>
          {formatDuration((resting ? rest.endsAt - now : now - new Date(startedAt).getTime()) / 1000)}
        </AppText>
      </View>

      <View style={[styles.stats, { backgroundColor: theme.card }]}>
        <Figure label="Serie" value={`${progress.done}/${progress.total}`} />
        <Figure label="Volume" value={`${formatNumber(progress.volume, 0)} kg`} />
        <Figure label="Esercizi" value={`${progress.exercisesDone}/${workout.exercises.length}`} />
      </View>
      <ProgressBar value={progress.done} target={Math.max(1, progress.total)} color={theme.accent} height={5} />

      {current && currentSet ? (
        <View style={[styles.now, { backgroundColor: theme.accentSoft }]}>
          <AppText variant="caption" weight="700" tone="accent">
            {resting ? 'DOPO IL RECUPERO' : 'ORA'}
          </AppText>
          <AppText variant="headline" numberOfLines={1}>
            {names(current.exercise).title}
          </AppText>
          <AppText variant="subhead" tone="textSecondary" numeric numberOfLines={1}>
            {[`Serie ${index + 1} di ${current.sets.length}`, planned ? formatSet(planned, current.exercise.kind) : null]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </View>
      ) : null}

      <View style={styles.list}>
        {workout.exercises.slice(0, 6).map((ex) => {
          const done = ex.sets.filter((s) => s.done).length;
          const complete = ex.sets.length > 0 && done === ex.sets.length;
          return (
            <View key={ex.id} style={styles.item}>
              <Icon
                name={complete ? 'checkmark.circle.fill' : ex === current ? 'circle.inset.filled' : 'circle'}
                size={15}
                tone={complete || ex === current ? 'accent' : 'textTertiary'}
              />
              <AppText variant="subhead" numberOfLines={1} style={styles.flex} tone={complete ? 'textSecondary' : 'text'}>
                {names(ex.exercise).title}
              </AppText>
              <AppText variant="subhead" tone="textSecondary" numeric>
                {`${done}/${ex.sets.length}`}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <AppText variant="headline" numeric numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stats: { flexDirection: 'row', borderRadius: 14, paddingVertical: Spacing.md },
  figure: { flex: 1, alignItems: 'center', gap: 2 },
  now: { borderRadius: 14, padding: Spacing.md, gap: 2 },
  list: { gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
