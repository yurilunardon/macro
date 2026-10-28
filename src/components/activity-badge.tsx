import type { SFSymbol } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { useActivityColors } from '@/hooks/use-activity-colors';
import type { ActivityColor } from '@/lib/calendar';

import { Icon } from './icon';

/**
 * The symbol of an activity or a supplement on a square of its colour, as the icons in Settings:
 * white on the colour, so each kind reads at a glance in the lists.
 */
export function ActivityBadge({ symbol, color, size = 32 }: { symbol: string; color: ActivityColor; size?: number }) {
  const colors = useActivityColors();
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: colors[color] }]}>
      <Icon name={symbol as SFSymbol} size={size * 0.58} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
});
