import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ExerciseKind } from '@/lib/exercises';
import { setRows, summarizeSets, type LoggedSet } from '@/lib/training';

import { AppText } from './app-text';
import { Icon } from './icon';

type Sets = readonly Pick<LoggedSet, 'type' | 'weight' | 'reps' | 'seconds'>[];

/** An exercise done in one line, for a row of the training line: "3 serie · 75–80 kg · 6–8 rip". */
export function SetSummaryLine({ sets, kind }: { sets: Sets; kind: ExerciseKind }) {
  const summary = summarizeSets(sets, kind);
  const parts = [summary.weight ?? summary.time, summary.reps].filter(Boolean);
  return (
    <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
      {`${summary.count === 1 ? '1 serie' : `${summary.count} serie`}`}
      {parts.length > 0 ? <AppText variant="footnote" weight="600" numeric>{`  ${parts.join('  ·  ')}`}</AppText> : null}
    </AppText>
  );
}

/**
 * Every set of an exercise done, numbered as in the workout ("R" a warm-up set, with its flame),
 * the load and the reps each in its own column, and what was off the plan said beside it.
 */
export function SetTable({ sets, kind, range }: { sets: Sets; kind: ExerciseKind; range: { min: number; max: number } | null }) {
  const theme = useTheme();
  const rows = setRows(sets, kind, range);
  const anyWeight = rows.some((row) => row.weight !== null || row.time !== null);
  return (
    <View style={styles.table}>
      {rows.map((row, index) => (
        <View key={index} style={styles.row}>
          <View style={[styles.badge, { backgroundColor: row.warmUp ? theme.warningSoft : theme.fill }]}>
            {row.warmUp ? (
              <Icon name="flame.fill" size={11} tone="warning" />
            ) : (
              <AppText variant="caption" weight="700" tone="textSecondary" numeric>
                {row.badge}
              </AppText>
            )}
          </View>
          {anyWeight ? (
            <AppText variant="subhead" weight="600" numeric numberOfLines={1} tone={row.warmUp ? 'textSecondary' : 'text'} style={styles.value}>
              {row.weight ?? row.time ?? '—'}
            </AppText>
          ) : null}
          {kind === 'time' ? null : (
            <AppText
              variant="subhead"
              weight="600"
              numeric
              numberOfLines={1}
              tone={row.warmUp ? 'textSecondary' : 'text'}
              style={[styles.value, row.outside !== null && { color: theme.warning }]}>
              {row.reps ?? '—'}
            </AppText>
          )}
          {row.outside && range ? (
            <AppText variant="footnote" weight="600" numeric numberOfLines={1} style={[styles.note, { color: theme.warning }]}>
              {`${row.outside === 'above' ? '↑ sopra' : '↓ sotto'} ${range.min}–${range.max}`}
            </AppText>
          ) : row.warmUp ? (
            <AppText variant="footnote" tone="textSecondary" numberOfLines={1} style={styles.note}>
              riscaldamento
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  badge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  value: { width: 72 },
  note: { flex: 1 },
});
