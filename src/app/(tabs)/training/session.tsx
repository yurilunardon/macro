import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { WorkoutRecap } from '@/components/workout-recap';
import { useLiveQuery } from '@/db/live';
import { deleteWorkout, getPreviousOfSameDay, getRecords, getWorkout } from '@/db/workouts';

/** A finished workout, opened again: the same recap as at its end. */
export default function SessionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data } = useLiveQuery(`session:${id}`, async (database) => {
    const [workout, records, previous] = await Promise.all([getWorkout(database, id), getRecords(database, id), getPreviousOfSameDay(database, id)]);
    return { workout, records, previous };
  }, ['training', 'settings']);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const { workout, records, previous } = data;
  if (!workout) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Allenamento eliminato.</AppText>
      </View>
    );
  }

  const remove = async () => {
    const ok = await confirmDestructive({
      title: 'Eliminare l’allenamento?',
      message: 'Sparisce dallo storico e dai record.',
      action: 'Elimina allenamento',
    });
    if (!ok) return;
    await deleteWorkout(db, workout.id);
    router.back();
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: '' }} />
      <Stack.Toolbar placement="right">
        {/* The only action here: no need for a menu to hold it. */}
        <Stack.Toolbar.Button icon="trash" accessibilityLabel="Elimina allenamento" onPress={() => void remove()} />
      </Stack.Toolbar>
      <WorkoutRecap workout={workout} records={records} previous={previous} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
