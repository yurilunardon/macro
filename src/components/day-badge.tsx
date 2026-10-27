import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { dayIcon } from '@/lib/training';

import { Icon } from './icon';

/** The symbol of a training day (push, pull, legs…) on a tinted square, as app icons in lists. */
export function DayBadge({ name, size = 32 }: { name: string; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: theme.accentSoft }]}>
      <Icon name={dayIcon(name)} size={size * 0.6} tone="accent" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
});
