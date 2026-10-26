import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BreakdownKey } from '@/lib/breakdown';
import { fiberTarget } from '@/lib/calories';
import type { Targets } from '@/lib/goals';
import type { Nutrients } from '@/lib/nutrition';

import { AppText } from './app-text';
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

type MacroBarsProps = {
  totals: Nutrients;
  targets: Targets;
  /** Opens the foods behind one nutrient. */
  onPress?: (key: BreakdownKey) => void;
};

/**
 * Protein, carbs, fat and fibre stacked beside the calorie ring, as the metrics beside the rings
 * in Fitness: name in its colour, eaten / goal, and a bar. Each opens the foods it came from.
 */
export function MacroBars({ totals, targets, onPress }: MacroBarsProps) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      {ORDER.map((key) => {
        const value = totals[key] ?? 0;
        const target = nutrientTarget(key, targets);
        return (
          <Pressable
            key={key}
            disabled={!onPress}
            onPress={() => onPress?.(key)}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="button"
            accessibilityLabel={`${NUTRIENT_LABELS[key]}: ${Math.round(value)} su ${target} grammi`}
            accessibilityHint="Mostra da quali alimenti arrivano"
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <View style={styles.top}>
              <AppText variant="footnote" weight="600" style={[styles.flex, { color: theme[key] }]} numberOfLines={1}>
                {NUTRIENT_LABELS[key]}
              </AppText>
              <AppText variant="footnote" numeric numberOfLines={1}>
                <AppText variant="footnote" weight="600" numeric>
                  {Math.round(value)}
                </AppText>
                <AppText variant="footnote" tone="textSecondary" numeric>
                  {` / ${target} g`}
                </AppText>
              </AppText>
            </View>
            <ProgressBar value={value} target={target} color={theme[key]} height={5} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1, gap: Spacing.sm + 2 },
  item: { gap: Spacing.xs },
  pressed: { opacity: 0.5 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
});
