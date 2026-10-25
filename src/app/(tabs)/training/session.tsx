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
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate } from '@/lib/dates';
import { countLabel, formatNumber } from '@/lib/format';
import { formatSet, formatWorkoutLength, isWorkSet, SET_TYPES, tonnage } from '@/lib/training';

/** A finished workout: totals, records and every set. Opened right after "Fine" with a summary on top. */
export default function SessionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; done?: string }>();
  const id = Number(params.id);
  const justDone = params.done === '1';
  const { data } = useLiveQuery(`session:${id}`, async (database) => {
    const [workout, records] = await Promise.all([getWorkout(database, id), getRecords(database, id)]);
    return { workout, records };
  });

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
      title: 'Eliminare questo allenamento?',
      message: 'Sparisce dallo storico, dai grafici e dai record.',
      action: 'Elimina',
    });
    if (!ok) return;
    await deleteWorkout(db, workout.id);
    router.back();
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: workout.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Azioni sull’allenamento">
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            Elimina allenamento
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {justDone ? (
        <Card style={[styles.done, { backgroundColor: theme.accentSoft }]}>
          <Icon name="checkmark.seal.fill" size={28} tone="accent" />
          <AppText variant="title2">Allenamento completato</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Salvato: la prossima volta trovi questi carichi come riferimento.
          </AppText>
        </Card>
      ) : null}

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
              <View key={r.name} style={styles.record}>
                <Icon name="trophy.fill" size={18} tone="warning" />
                <AppText style={styles.flex}>{r.name}</AppText>
                <AppText tone="textSecondary" numeric>{`1RM stimato ${formatNumber(r.oneRepMax, 1)} kg`}</AppText>
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}

      {workout.exercises.map((ex) => (
        <View key={ex.id}>
          <SectionTitle>{ex.exercise.name}</SectionTitle>
          <ListGroup>
            {ex.sets.map((set) => (
              <View key={set.id} style={styles.set}>
                <AppText variant="subhead" tone="textSecondary" numeric style={styles.setNumber}>
                  {set.type === 'normal' ? '•' : SET_TYPES.find((t) => t.key === set.type)?.short}
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
      ))}
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
  done: { gap: Spacing.xs, marginBottom: Spacing.md },
  card: { gap: Spacing.md },
  stats: { flexDirection: 'row', gap: Spacing.md },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 48 },
  set: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 44 },
  setNumber: { width: 20 },
});
