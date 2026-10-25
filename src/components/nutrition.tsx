import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatGrams, formatKcal, formatNumber } from '@/lib/format';
import type { Targets } from '@/lib/goals';
import { scaleNutrients, type Nutrients, type Unit } from '@/lib/nutrition';

import { AppText } from './app-text';
import { ListGroup } from './card';
import { ProgressBar } from './progress';

type MacroKey = 'protein' | 'carbs' | 'fat';

export const MACROS: readonly { key: MacroKey; label: string; short: string }[] = [
  { key: 'protein', label: 'Proteine', short: 'P' },
  { key: 'carbs', label: 'Carboidrati', short: 'C' },
  { key: 'fat', label: 'Grassi', short: 'G' },
];

/** Three columns with eaten / target grams and a bar for each macro. */
export function MacroProgress({ totals, targets }: { totals: Pick<Nutrients, MacroKey>; targets: Targets }) {
  const theme = useTheme();
  return (
    <View style={styles.macroRow}>
      {MACROS.map((m) => (
        <View
          key={m.key}
          style={styles.macroColumn}
          accessible
          accessibilityLabel={`${m.label}: ${Math.round(totals[m.key])} su ${targets[m.key]} grammi`}>
          <AppText variant="footnote" weight="600" style={{ color: theme[m.key] }}>
            {m.label}
          </AppText>
          <ProgressBar value={totals[m.key]} target={targets[m.key]} color={theme[m.key]} />
          <AppText variant="subhead" numeric>
            <AppText variant="subhead" weight="600" numeric>
              {Math.round(totals[m.key])}
            </AppText>
            <AppText variant="subhead" tone="textSecondary" numeric>
              {` / ${targets[m.key]} g`}
            </AppText>
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** "P 12 · C 40 · G 5" in macro colours, for list rows. */
export function MacroInline({ totals }: { totals: Pick<Nutrients, MacroKey> }) {
  const theme = useTheme();
  return (
    <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
      {MACROS.map((m, i) => (
        <AppText key={m.key} variant="footnote" numeric>
          {i > 0 ? '  ' : ''}
          <AppText variant="footnote" weight="700" style={{ color: theme[m.key] }}>
            {m.short}
          </AppText>
          <AppText variant="footnote" tone="textSecondary" numeric>
            {` ${formatNumber(totals[m.key], totals[m.key] < 10 ? 1 : 0)}`}
          </AppText>
        </AppText>
      ))}
    </AppText>
  );
}

type TableRow = { label: string; value: number | null; indent?: boolean; kcal?: boolean };

function rowsFor(n: Nutrients): TableRow[] {
  return [
    { label: 'Energia', value: n.kcal, kcal: true },
    { label: 'Grassi', value: n.fat },
    { label: 'di cui saturi', value: n.satFat, indent: true },
    { label: 'Carboidrati', value: n.carbs },
    { label: 'di cui zuccheri', value: n.sugars, indent: true },
    { label: 'Fibre', value: n.fiber },
    { label: 'Proteine', value: n.protein },
    { label: 'Sale', value: n.salt },
  ];
}

function cell(row: TableRow): string {
  if (row.value === null) return '—';
  return row.kcal ? `${formatKcal(row.value)} kcal` : formatGrams(row.value);
}

/** Nutrition label: per 100 g/ml and, when a quantity is given, for that quantity. */
export function NutrientTable({ per100, quantity, unit }: { per100: Nutrients; quantity: number | null; unit: Unit }) {
  const theme = useTheme();
  const portion = quantity !== null && quantity > 0 ? rowsFor(scaleNutrients(per100, quantity)) : null;
  const base = rowsFor(per100);
  return (
    <ListGroup>
      <View style={styles.tableRow}>
        <AppText variant="footnote" tone="textSecondary" style={styles.tableLabel}>
          Valori nutrizionali
        </AppText>
        <AppText variant="footnote" tone="textSecondary" style={styles.tableValue} numeric>
          {`100 ${unit}`}
        </AppText>
        {portion ? (
          <AppText variant="footnote" tone="textSecondary" style={styles.tableValue} numeric>
            {`${formatNumber(quantity ?? 0, 1)} ${unit}`}
          </AppText>
        ) : null}
      </View>
      {base.map((row, i) => (
        <View key={row.label} style={styles.tableRow}>
          <AppText
            variant="subhead"
            tone={row.indent ? 'textSecondary' : 'text'}
            style={[styles.tableLabel, row.indent && styles.indent]}>
            {row.label}
          </AppText>
          <AppText variant="subhead" numeric style={styles.tableValue} tone="textSecondary">
            {cell(row)}
          </AppText>
          {portion ? (
            <AppText variant="subhead" numeric weight="600" style={[styles.tableValue, { color: theme.text }]}>
              {cell(portion[i])}
            </AppText>
          ) : null}
        </View>
      ))}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  macroRow: { flexDirection: 'row', gap: Spacing.lg },
  macroColumn: { flex: 1, gap: Spacing.xs + 2 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.sm,
  },
  tableLabel: { flex: 1 },
  indent: { paddingLeft: Spacing.md },
  tableValue: { width: 84, textAlign: 'right' },
});
