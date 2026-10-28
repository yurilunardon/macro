import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal, formatNumber } from '@/lib/format';
import type { PeriodSummary } from '@/lib/stats';

import { AppText } from './app-text';
import { MACROS } from './nutrition';

/** A period's averages: calories and macros, the share of energy from each, and how often the targets were met. */
export function NutritionSummary({ summary }: { summary: PeriodSummary }) {
  const theme = useTheme();
  return (
    <>
      <View style={styles.row}>
        <Figure label="Media kcal" value={formatKcal(summary.average.kcal)} />
        {MACROS.map((m) => (
          <Figure key={m.key} label={m.label} value={`${formatNumber(summary.average[m.key], 0)} g`} color={theme[m.key]} />
        ))}
      </View>
      <MacroSplit split={summary.split} />
      <View style={styles.row}>
        <Figure label="Calorie nell’obiettivo (±10%)" value={`${summary.onTarget}%`} lines={2} />
        <Figure label="Proteine raggiunte" value={`${summary.proteinReached}%`} lines={2} />
      </View>
    </>
  );
}

function Figure({ label, value, color, lines = 1 }: { label: string; value: string; color?: string; lines?: number }) {
  return (
    <View style={styles.figure}>
      <AppText variant="headline" numeric style={color ? { color } : undefined}>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary" numberOfLines={lines}>
        {label}
      </AppText>
    </View>
  );
}

/** One bar split by the share of energy from protein, carbs and fat. */
function MacroSplit({ split }: { split: PeriodSummary['split'] }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Energia da proteine ${Math.round(split.protein)}%, carboidrati ${Math.round(split.carbs)}%, grassi ${Math.round(split.fat)}%`}
      style={styles.split}>
      <View style={styles.splitBar}>
        {MACROS.map((m) => (
          <View key={m.key} style={{ flex: Math.max(split[m.key], 0.001), backgroundColor: theme[m.key] }} />
        ))}
      </View>
      <View style={styles.splitLegend}>
        {MACROS.map((m) => (
          <AppText key={m.key} variant="caption" tone="textSecondary" numeric>
            <AppText variant="caption" weight="700" style={{ color: theme[m.key] }}>
              {`${m.label} `}
            </AppText>
            {`${Math.round(split[m.key])}%`}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  figure: { flex: 1 },
  split: { gap: Spacing.xs },
  splitBar: { flexDirection: 'row', height: 10, borderRadius: Radius.pill, overflow: 'hidden' },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between' },
});
