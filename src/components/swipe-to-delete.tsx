import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';

type SwipeToDeleteProps = {
  children: ReactNode;
  onDelete: () => void;
  label?: string;
};

/**
 * Swipe left to reveal a red delete button, as in iOS lists. Rows that use it should keep
 * another way to delete (a long press or a detail screen) for people who cannot swipe.
 */
export function SwipeToDelete({ children, onDelete, label = 'Elimina' }: SwipeToDeleteProps) {
  const theme = useTheme();
  return (
    <ReanimatedSwipeable
      friction={1.5}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <Pressable
          onPress={() => {
            methods.close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.action, { backgroundColor: theme.danger }, pressed && styles.pressed]}>
          <Icon name="trash.fill" size={18} color="#FFFFFF" />
          <AppText variant="caption" weight="600" style={styles.label}>
            {label}
          </AppText>
        </Pressable>
      )}>
      <View style={{ backgroundColor: theme.card }}>{children}</View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  pressed: { opacity: 0.8 },
  label: { color: '#FFFFFF' },
});
