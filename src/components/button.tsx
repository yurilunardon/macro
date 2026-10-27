import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';

type ButtonProps = {
  title: string;
  onPress: () => void;
  /** `stop` is the tinted red of ending something, as "Termina" in Apple's Workout app. */
  variant?: 'filled' | 'tinted' | 'plain' | 'destructive' | 'stop';
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  /** Smaller height for buttons inside cards. */
  compact?: boolean;
};

export function Button({
  title,
  onPress,
  variant = 'filled',
  icon,
  disabled = false,
  loading = false,
  compact = false,
}: ButtonProps) {
  const theme = useTheme();
  const background =
    variant === 'filled'
      ? theme.accent
      : variant === 'tinted'
        ? theme.accentSoft
        : variant === 'stop'
          ? `${theme.danger}24`
          : 'transparent';
  const color =
    variant === 'filled' ? theme.onAccent : variant === 'destructive' || variant === 'stop' ? theme.danger : theme.accent;
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: background },
        (pressed || inactive) && { opacity: inactive ? 0.45 : 0.75 },
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <View style={styles.content}>
          {icon}
          <AppText variant={compact ? 'callout' : 'headline'} weight="600" style={{ color }}>
            {title}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  compact: { minHeight: 40 },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
