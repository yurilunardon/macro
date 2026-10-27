import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card, ListGroup, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteWorkout, getRecords, getWorkout } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { formatLongDate } from '@/lib/dates';
import { countLabel, formatNumber } from '@/lib/format';
import { formatSet, formatWorkoutLength, isWorkSet, SET_TYPES, tonnage } from '@/lib/training';

/** A finished workout: totals, records and every set. */
export default function SessionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data } = useLiveQuery(`session:${id}`, async (database) => {
    const [workout, records] = await Promise.all([getWorkout(database, id), getRecords(database, id)]);
    return { workout, records };
  }, ['training', 'settings']);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const { workout, records } = data;
  if (!workout) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Allenamento eliminato.</AppText>
      </View>
    );
  }
  const sets = workout.exercises.flatMap((e) => e.sets);
  const seconds = workout.endedAt ? (new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000 : 0;

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
      <Stack.Screen options={{ title: workout.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sull’allenamento">
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            Elimina allenamento
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <Card style={styles.card}>
        <AppText variant="subhead" tone="textSecondary">
          {formatLongDate(workout.date)}
        </AppText>
        <View style={styles.stats}>
          <Stat label="Durata" value={formatWorkoutLength(seconds)} />
          <Stat label="Serie" value={String(sets.filter(isWorkSet).length)} />
          <Stat label="Volume" value={`${formatNumber(tonnage(sets), 0)} kg`} />
        </View>
        {workout.notes ? (
          <AppText variant="subhead" tone="textSecondary">
            {workout.notes}
          </AppText>
        ) : null}
      </Card>

      {records.length > 0 ? (
        <>
          <SectionTitle>{countLabel(records.length, 'nuovo record', 'nuovi record')}</SectionTitle>
          <ListGroup>
            {records.map((r) => (
              <View key={r.exercise.id} style={styles.record}>
                <Icon name="trophy.fill" size={18} tone="warning" />
                <AppText style={styles.flex}>{names(r.exercise).title}</AppText>
                <AppText tone="textSecondary" numeric>{`Massimale stimato ${formatNumber(r.oneRepMax, 1)} kg`}</AppText>
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}

      {workout.exercises.map((ex) => {
        // Numbered as in the workout: 1, 2, 3 for work sets, R, D, C for the others.
        let ordinal = 0;
        return (
        <View key={ex.id}>
          <SectionTitle>{names(ex.exercise).title}</SectionTitle>
          <ListGroup>
            {ex.sets.map((set) => (
              <View key={set.id} style={styles.set}>
                <AppText variant="subhead" tone="textSecondary" numeric style={styles.setNumber}>
                  {set.type === 'normal' ? String(++ordinal) : SET_TYPES.find((t) => t.key === set.type)?.short}
                </AppText>
                <AppText numeric style={styles.flex}>
                  {formatSet(set, ex.exercise.kind)}
                </AppText>
                {set.rir !== null ? (
                  <AppText variant="subhead" tone="textSecondary" numeric>{`RIR ${formatNumber(set.rir, 1)}`}</AppText>
                ) : null}
              </View>
            ))}
          </ListGroup>
        </View>
        );
      })}
    </ScreenScroll>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.flex}>
      <AppText variant="headline" numeric>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  card: { gap: Spacing.md },
  stats: { flexDirection: 'row', gap: Spacing.md },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 48 },
  set: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 44 },
  setNumber: { width: 20 },
});
