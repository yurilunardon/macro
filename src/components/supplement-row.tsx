import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDose, supplementSymbol, type Supplement } from '@/lib/supplements';
import { haptics } from '@/services/haptics';

import { ActivityBadge } from './activity-badge';
import { AppText } from './app-text';
import { Icon } from './icon';

type SupplementRowProps = {
  supplement: Supplement;
  /** Indexes of the doses ticked on the day. */
  taken: ReadonlySet<number>;
  /** Days to come cannot be ticked yet. */
  disabled: boolean;
  onToggle: (index: number, taken: boolean) => void;
  onPress: () => void;
};

/** A supplement of the day: what and how much, and a circle to tick for each dose, as in Reminders. */
export function SupplementRow({ supplement: s, taken, disabled, onToggle, onPress }: SupplementRowProps) {
  const theme = useTheme();
  const subtitle = [formatDose(s.dose, s.unit), s.schedule === 'asNeeded' ? 'al bisogno' : s.reminder].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Apre l’integratore"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <ActivityBadge symbol={supplementSymbol(s.unit)} color="indigo" />
      <View style={styles.text}>
        <AppText numberOfLines={1}>{s.name}</AppText>
        <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      <View style={styles.ticks}>
        {Array.from({ length: s.timesPerDay }, (_, index) => (
          <Tick
            key={index}
            on={taken.has(index)}
            disabled={disabled}
            label={s.timesPerDay > 1 ? `${s.name}, dose ${index + 1}` : s.name}
            onPress={() => onToggle(index, !taken.has(index))}
          />
        ))}
      </View>
    </Pressable>
  );
}

function Tick({ on, disabled, label, onPress }: { on: boolean; disabled: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      onPress={() => {
        if (!on) {
          haptics.success();
          scale.set(withSequence(withTiming(0.85, { duration: 80 }), withSpring(1, { duration: 320, dampingRatio: 0.5 })));
        } else {
          haptics.light();
        }
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      style={[styles.tickHit, disabled && styles.disabled]}>
      <Animated.View
        style={[
          styles.tick,
          on ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: theme.textTertiary },
          style,
        ]}>
        {on ? <Icon name="checkmark" size={15} color={theme.onAccent} weight="bold" /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  text: { flex: 1, gap: 2 },
  ticks: { flexDirection: 'row' },
  tickHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
});
