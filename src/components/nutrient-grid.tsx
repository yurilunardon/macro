import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BreakdownKey } from '@/lib/breakdown';
import { fiberTarget } from '@/lib/calories';
import type { Targets } from '@/lib/goals';
import type { Nutrients } from '@/lib/nutrition';

import { AppText } from './app-text';
import { Icon } from './icon';
import { ProgressBar } from './progress';

export const NUTRIENT_LABELS: Record<BreakdownKey, string> = {
  protein: 'Proteine',
  carbs: 'Carboidrati',
  fat: 'Grassi',
  fiber: 'Fibre',
};

const ORDER: readonly BreakdownKey[] = ['protein', 'carbs', 'fat', 'fiber'];

export function nutrientTarget(key: BreakdownKey, targets: Targets): number {
  return key === 'fiber' ? fiberTarget(targets.kcal) : targets[key];
}

type NutrientGridProps = {
  totals: Nutrients;
  targets: Targets;
  /** Opens the foods behind one nutrient. */
  onPress: (key: BreakdownKey) => void;
};

/** Protein, carbs, fat and fibre as four tiles, eaten / goal with a bar; each opens its sources. */
export function NutrientGrid({ totals, targets, onPress }: NutrientGridProps) {
  const theme = useTheme();
  return (
    <View style={styles.grid}>
      {ORDER.map((key) => {
        const value = totals[key] ?? 0;
        const target = nutrientTarget(key, targets);
        return (
          <Pressable
            key={key}
            onPress={() => onPress(key)}
            accessibilityRole="button"
            accessibilityLabel={`${NUTRIENT_LABELS[key]}: ${Math.round(value)} su ${target} grammi`}
            accessibilityHint="Mostra da quali alimenti arrivano"
            style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.cardPressed : theme.background }]}>
            <View style={styles.tileTop}>
              <AppText variant="footnote" weight="600" style={[styles.flex, { color: theme[key] }]} numberOfLines={1}>
                {NUTRIENT_LABELS[key]}
              </AppText>
              <Icon name="chevron.right" size={11} tone="textTertiary" weight="semibold" />
            </View>
            <AppText variant="subhead" numeric numberOfLines={1}>
              <AppText variant="subhead" weight="700" numeric>
                {Math.round(value)}
              </AppText>
              <AppText variant="subhead" tone="textSecondary" numeric>
                {` / ${target} g`}
              </AppText>
            </AppText>
            <ProgressBar value={value} target={target} color={theme[key]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: Spacing.xs + 2,
    padding: Spacing.md,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
