import { Pressable, StyleSheet } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { Icon } from './icon';

/** A − or + button beside a value, as the steppers in Settings. */
export function StepButton({ symbol, label, onPress, disabled = false }: { symbol: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepper, { backgroundColor: theme.fill }, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}>
      <Icon name={symbol} size={16} weight="bold" tone="accent" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: { width: 44, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
