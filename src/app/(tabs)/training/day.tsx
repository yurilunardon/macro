import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { restFor } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { deleteDay, getDay, moveDayExercise, removeDayExercise, renameDay } from '@/db/programs';
import { getActiveWorkout, startWorkout } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { formatDuration } from '@/lib/training';
import { haptics } from '@/services/haptics';

/** One day of a program: its exercises with sets, reps and rest, in order. */
export default function DayScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data } = useLiveQuery(`day:${id}`, async (database) => {
    const [day, active] = await Promise.all([getDay(database, id), getActiveWorkout(database)]);
    return { day, active };
  });

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const { day, active } = data;
  if (!day) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Giorno eliminato.</AppText>
      </View>
    );
  }

  const rename = () =>
    Alert.prompt(
      'Rinomina il giorno',
      undefined,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: (text?: string) => {
            if ((text ?? '').trim() !== '') void renameDay(db, day.id, text ?? '');
          },
        },
      ],
      'plain-text',
      day.name,
    );

  const remove = async () => {
    const ok = await confirmDestructive({
      title: `Eliminare «${day.name}»?`,
      message: 'Gli allenamenti già fatti restano nello storico.',
      action: 'Elimina',
    });
    if (!ok) return;
    await deleteDay(db, day.id);
    router.back();
  };

  const start = async () => {
    await startWorkout(db, { dayId: day.id });
    haptics.success();
    router.push('/workout');
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: day.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Azioni sul giorno">
          <Stack.Toolbar.MenuAction icon="pencil" onPress={rename}>
            Rinomina
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            Elimina giorno
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <ListGroup>
        {day.exercises.map((planned, index) => (
          <SwipeToDelete key={planned.id} label="Togli" onDelete={() => void removeDayExercise(db, planned.id)}>
            <Link href={{ pathname: '/plan-exercise', params: { id: planned.id } }} asChild>
              <Link.Trigger>
                <Pressable accessibilityRole="button" accessibilityHint="Tocca per serie e ripetizioni, tieni premuto per spostarlo">
                  {({ pressed }) => (
                    <View style={[styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
                      <View style={styles.flex}>
                        <AppText>{names(planned.exercise).title}</AppText>
                        <AppText variant="footnote" tone="textSecondary" numeric>
                          {`${planned.sets} × ${planned.repMin}–${planned.repMax}${planned.exercise.kind === 'time' ? ' s' : ''} · recupero ${formatDuration(
                            planned.restSeconds ?? restFor(planned.exercise),
                          )} · ${muscleLabel(planned.exercise.muscle)}`}
                        </AppText>
                        {planned.note ? (
                          <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                            {planned.note}
                          </AppText>
                        ) : null}
                      </View>
                      <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
                    </View>
                  )}
                </Pressable>
              </Link.Trigger>
              <Link.Menu>
                {index > 0 ? (
                  <Link.MenuAction icon="arrow.up" onPress={() => void moveDayExercise(db, planned.id, -1)}>
                    Sposta su
                  </Link.MenuAction>
                ) : null}
                {index < day.exercises.length - 1 ? (
                  <Link.MenuAction icon="arrow.down" onPress={() => void moveDayExercise(db, planned.id, 1)}>
                    Sposta giù
                  </Link.MenuAction>
                ) : null}
                <Link.MenuAction icon="trash" destructive onPress={() => void removeDayExercise(db, planned.id)}>
                  Togli dalla scheda
                </Link.MenuAction>
              </Link.Menu>
            </Link>
          </SwipeToDelete>
        ))}
        <ActionRow
          label="Aggiungi esercizio"
          onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'day', id: day.id } })}
        />
      </ListGroup>
      <SectionFooter>Tocca un esercizio per serie, ripetizioni e recupero; tienilo premuto per cambiarne l’ordine.</SectionFooter>

      {!active && day.exercises.length > 0 ? (
        <View style={styles.start}>
          <Button title={`Inizia ${day.name}`} onPress={() => void start()} />
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 56,
  },
  start: { paddingTop: Spacing.xl },
});
