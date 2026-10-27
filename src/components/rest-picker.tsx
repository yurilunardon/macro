import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/training';

import { AppText } from './app-text';
import { Icon } from './icon';
import { MenuButton } from './menu-button';
import type { RestPickerProps } from './rest-picker.types';

const PRESETS = [60, 90, 120, 150, 180, 240];

/** The rest after each set; elsewhere than iOS, a few presets in a menu. */
export function RestPicker({ value, onChange }: RestPickerProps) {
  const theme = useTheme();
  return (
    <MenuButton
      icon="timer"
      accessibilityLabel={`Recupero dopo ogni serie: ${formatDuration(value)}. Cambia`}
      groups={[
        {
          title: 'Recupero dopo ogni serie',
          actions: PRESETS.map((seconds) => ({
            label: formatDuration(seconds),
            icon: 'timer' as const,
            checked: seconds === value,
            onPress: () => onChange(seconds),
          })),
        },
      ]}>
      <View style={[styles.pill, { backgroundColor: theme.fill }]}>
        <Icon name="timer" size={13} tone="textSecondary" />
        <AppText variant="subhead" weight="600" numeric>
          {formatDuration(value)}
        </AppText>
      </View>
    </MenuButton>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16 },
});
