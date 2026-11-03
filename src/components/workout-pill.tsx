import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkoutStatus } from '@/hooks/use-workout-status';
import { openActiveWorkout } from '@/services/start-workout';

import { AppText } from './app-text';

const glass = isLiquidGlassAvailable();
const PILL_IN = FadeInUp.duration(240);
const PILL_OUT = FadeOutUp.duration(180);

/**
 * The workout in progress, at the top of the other tabs as a call in progress on iOS: its name and
 * time, in the middle of the bar. A tap brings the workout back. In its own tab it is on the line.
 */
export function WorkoutPill() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const status = useWorkoutStatus();
  if (!status) return null;
  const color = status.resting ? theme.warning : theme.accent;
  const content = (
    <>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="subhead" weight="600" numberOfLines={1} style={styles.name}>
        {status.name}
      </AppText>
      <AppText variant="subhead" weight="700" numeric style={{ color }}>
        {status.time}
      </AppText>
    </>
  );
  return (
    <Animated.View entering={PILL_IN} exiting={PILL_OUT} pointerEvents="box-none" style={[styles.slot, { top: insets.top + 6 }]}>
      <Pressable
        onPress={() => openActiveWorkout(db, router)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${status.name}, ${status.resting ? 'recupero' : 'in corso'}, ${status.time}. Torna all’allenamento`}>
        {glass ? (
          <GlassView style={styles.pill} glassEffectStyle="regular" isInteractive>
            {content}
          </GlassView>
        ) : (
          <View style={[styles.pill, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{content}</View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 36, paddingHorizontal: Spacing.md, borderRadius: 18, maxWidth: 200 },
  solid: { borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flexShrink: 1 },
});
