import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { formatLifted, formatWorkoutLengthShort, isWorkSet, tonnage } from '@/lib/training';
import { endFromSheet } from '@/services/end-workout';

/**
 * Rises by itself when the last set of the workout is ticked: everything is done, so ending it is
 * one tap away. "Non ancora", or a swipe, and the workout simply goes on.
 */
export default function WorkoutDoneSheet() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useLiveQuery(ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
  // As it was when the sheet rose: ending the workout from here takes it away before the sheet goes.
  const [workout] = useState(data?.workout ?? null);
  const [now] = useState(() => Date.now());
  const sets = workout?.exercises.flatMap((e) => e.sets) ?? [];
  const summary = workout
    ? [formatWorkoutLengthShort((now - new Date(workout.startedAt).getTime()) / 1000), `${sets.filter(isWorkSet).length} serie`, formatLifted(tonnage(sets))].join(' · ')
    : null;

  return (
    <View style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + Spacing.sm }]}>
      <View style={styles.text}>
        <AppText variant="title">Hai finito tutto</AppText>
        {summary ? (
          <AppText variant="subhead" tone="textSecondary" numeric>
            {summary}
          </AppText>
        ) : null}
      </View>
      <View style={styles.buttons}>
        <Button title="Termina allenamento" onPress={() => endFromSheet.run?.()} />
        <Button title="Non ancora" variant="plain" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
  text: { gap: Spacing.xs },
  buttons: { gap: Spacing.xs },
});
