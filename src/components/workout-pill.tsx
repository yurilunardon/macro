import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useWorkoutStatus } from '@/hooks/use-workout-status';
import { openActiveWorkout } from '@/services/start-workout';

import { AppText } from './app-text';
import { Icon } from './icon';
import { ProgressBar } from './progress';

const glass = isLiquidGlassAvailable();
const BAR_IN = FadeInDown.duration(260);
const BAR_OUT = FadeOutDown.duration(180);

/** How tall the bar is, and the air between it and the tab bar: the pages leave room for both. */
export const WORKOUT_BAR_HEIGHT = 58;
export const WORKOUT_BAR_GAP = Spacing.sm;

/**
 * The workout in progress on the other tabs, as the player of Music above iOS's tab bar: a bar of
 * glass just over ours, with the workout's name, what comes now, the time and how far along it is.
 * Within the thumb's reach; a tap brings the workout back. In its own tab it is on the line.
 */
export function WorkoutPill({ bottom }: { bottom: number }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const status = useWorkoutStatus();
  const { names } = useExerciseNames();
  if (!status) return null;
  const color = status.resting ? theme.warning : theme.accent;
  const caption = status.resting
    ? 'Recupero'
    : status.ready
      ? 'Recupero finito'
      : [`${status.done} di ${status.total} serie`, status.current ? names(status.current.exercise).title : null].filter(Boolean).join(' · ');
  const content = (
    <>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${color}26` }]}>
          <Icon name={status.resting ? 'timer' : 'dumbbell.fill'} size={16} color={color} />
        </View>
        <View style={styles.text}>
          <AppText variant="subhead" weight="600" numberOfLines={1}>
            {status.name}
          </AppText>
          <AppText variant="caption" tone="textSecondary" numeric numberOfLines={1}>
            {caption}
          </AppText>
        </View>
        <AppText variant="headline" weight="700" numeric style={{ color }}>
          {status.time}
        </AppText>
        <Icon name="chevron.up" size={13} weight="semibold" tone="textSecondary" />
      </View>
      <View style={styles.progress}>
        <ProgressBar value={status.done} target={Math.max(status.total, 1)} color={theme.accent} height={3} />
      </View>
    </>
  );
  return (
    <Animated.View entering={BAR_IN} exiting={BAR_OUT} pointerEvents="box-none" style={[styles.slot, { bottom }]}>
      <Pressable
        onPress={() => openActiveWorkout(db, router)}
        accessibilityRole="button"
        accessibilityLabel={`${status.name}, ${status.resting ? 'recupero' : 'in corso'}, ${status.time}. Torna all’allenamento`}
        style={styles.press}>
        {glass ? (
          <GlassView style={styles.bar} glassEffectStyle="regular" isInteractive>
            {content}
          </GlassView>
        ) : (
          <View style={[styles.bar, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{content}</View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: Spacing.lg, right: Spacing.lg },
  press: { width: '100%' },
  bar: { height: WORKOUT_BAR_HEIGHT, borderRadius: WORKOUT_BAR_HEIGHT / 2, borderCurve: 'continuous', paddingHorizontal: Spacing.md, justifyContent: 'center', overflow: 'hidden' },
  solid: { borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  // Along the bottom edge, inside the rounded ends.
  progress: { position: 'absolute', left: WORKOUT_BAR_HEIGHT / 2, right: WORKOUT_BAR_HEIGHT / 2, bottom: 5 },
});
