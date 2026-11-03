import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { WorkoutRecap } from '@/components/workout-recap';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getPreviousOfSameDay, getRecords, getWorkout } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

/** The end of a workout: how it went, its rows coming in one after the other. */
export default function WorkoutSummaryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  // Read once: the screen is a moment, it does not follow later edits.
  const { data } = useLiveQuery(`summary:${id}`, async (database) => {
    const [workout, records, previous] = await Promise.all([getWorkout(database, id), getRecords(database, id), getPreviousOfSameDay(database, id)]);
    return { workout, records, previous };
  }, []);

  const hasWorkout = Boolean(data?.workout);
  useEffect(() => {
    if (hasWorkout) haptics.success();
  }, [hasWorkout]);

  // It may lie over the workout sheet it was ended from: closing goes back past both.
  const close = () => router.dismissAll();

  if (!data) return <View style={[styles.flex, { backgroundColor: theme.background }]} />;
  const { workout, records, previous } = data;
  if (!workout) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <AppText tone="textSecondary">Allenamento eliminato.</AppText>
        <Button title="Chiudi" variant="plain" onPress={close} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + 96 }]} showsVerticalScrollIndicator={false}>
        <WorkoutRecap workout={workout} records={records} previous={previous} arriving />
      </ScrollView>
      <Animated.View entering={FadeIn.delay(200).duration(280)} style={[styles.footer, { paddingBottom: insets.bottom + Spacing.sm, backgroundColor: theme.background }]}>
        <Button title="Fine" onPress={close} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  content: { paddingHorizontal: Spacing.lg },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
});
