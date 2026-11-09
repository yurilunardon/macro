import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { ExerciseKind } from '@/lib/exercises';
import { groupSets, type LoggedSet } from '@/lib/training';

import { AppText } from './app-text';

type SetLinesProps = {
  sets: readonly Pick<LoggedSet, 'type' | 'weight' | 'reps' | 'seconds'>[];
  kind: ExerciseKind;
  /** `small` under a row of the training line, `regular` in a workout's recap. */
  size?: 'small' | 'regular';
};

/**
 * An exercise's sets as a little table: how many sets, the load, the reps, each in its own column
 * with its unit, identical sets one after the other on one line.
 */
export function SetLines({ sets, kind, size = 'small' }: SetLinesProps) {
  const lines = groupSets(sets, kind);
  const variant = size === 'small' ? 'footnote' : 'subhead';
  // A column nobody fills (no load on a bodyweight exercise) takes no room.
  const anyWeight = lines.some((line) => line.weight !== null || line.time !== null);
  const anyReps = lines.some((line) => line.reps !== null);
  const wide = size === 'regular';
  return (
    <View style={styles.lines}>
      {lines.map((line, index) => (
        <View key={index} style={styles.line}>
          <AppText variant={variant} tone="textSecondary" numeric numberOfLines={1} style={wide ? styles.countWide : styles.count}>
            {line.count === 1 ? '1 serie' : `${line.count} serie`}
          </AppText>
          {anyWeight ? (
            <AppText variant={variant} weight="600" numeric numberOfLines={1} style={wide ? styles.valueWide : styles.value}>
              {line.weight ?? line.time ?? '—'}
            </AppText>
          ) : null}
          {anyReps ? (
            <AppText variant={variant} weight="600" numeric numberOfLines={1} style={wide ? styles.valueWide : styles.value}>
              {line.reps ?? '—'}
            </AppText>
          ) : null}
          {line.type ? (
            <AppText variant="caption" tone="textSecondary" numberOfLines={1} style={styles.type}>
              {line.type}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  count: { width: 56 },
  countWide: { width: 64 },
  value: { width: 64 },
  valueWide: { width: 74 },
  type: { flexShrink: 1 },
});
