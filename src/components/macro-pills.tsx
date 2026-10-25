import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/lib/format';
import type { Nutrients } from '@/lib/nutrition';

import { AppText } from './app-text';
import { MACROS } from './nutrition';

/**
 * Protein, carbs and fat as three small capsules in their colours ("P 12 g"), so each value
 * reads on its own instead of blending into one line of text.
 */
export function MacroPills({ totals }: { totals: Pick<Nutrients, 'protein' | 'carbs' | 'fat'> }) {
  const theme = useTheme();
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={MACROS.map((m) => `${m.label} ${Math.round(totals[m.key])} grammi`).join(', ')}>
      {MACROS.map((m) => (
        // Hex colour plus "22": the macro colour at about 13% opacity.
        <View key={m.key} style={[styles.pill, { backgroundColor: `${theme[m.key]}22` }]}>
          <AppText variant="caption" weight="700" numeric style={{ color: theme[m.key] }}>
            {`${m.short} ${formatNumber(totals[m.key], totals[m.key] < 10 ? 1 : 0)} g`}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs + 2 },
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
});
