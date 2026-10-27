import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import type { RangeFlagProps } from './range-flag.types';

/** The "!" on the corner of a count outside the planned range; elsewhere than iOS, an alert. */
export function RangeFlag({ title, message, onFix }: RangeFlagProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${message}`}
      onPress={() => Alert.alert(title, message, [{ text: 'Correggi', onPress: onFix }, { text: 'Ok' }])}
      style={styles.flag}>
      <View style={[styles.dot, { backgroundColor: theme.warning }]}>
        <AppText variant="caption" weight="800" style={{ color: theme.card }}>
          !
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flag: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
