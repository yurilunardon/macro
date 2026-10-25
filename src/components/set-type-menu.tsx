import { Alert, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { SET_TYPES } from '@/lib/training';

import { AppText } from './app-text';
import type { SetTypeMenuProps } from './set-type-menu.types';

/** Fallback without SwiftUI menus. On iOS set-type-menu.ios.tsx is used. */
export function SetTypeMenu({ badge, type, done, onChange, onDelete }: SetTypeMenuProps) {
  const theme = useTheme();
  const open = () =>
    Alert.alert('Tipo di serie', undefined, [
      ...SET_TYPES.map((t) => ({ text: t.key === type ? `✓ ${t.label}` : t.label, onPress: () => onChange(t.key) })),
      { text: 'Elimina serie', style: 'destructive' as const, onPress: onDelete },
      { text: 'Annulla', style: 'cancel' as const },
    ]);
  return (
    <Pressable onPress={open} style={styles.badge} accessibilityRole="button" accessibilityLabel={`Serie ${badge}, cambia tipo`}>
      <AppText weight="700" style={{ color: done ? theme.accent : theme.text }}>
        {badge}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
