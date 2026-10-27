import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter } from '@/components/card';
import { EditButton } from '@/components/edit-button';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { restFor } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { deleteDay, getDay, removeDayExercise, renameDay, reorderDayExercises, type PlannedExercise } from '@/db/programs';
import { getActiveWorkout, startWorkout } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { formatDuration } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

const ROW_HEIGHT = 60;

function planSummary(planned: PlannedExercise): string {
  const unit = planned.exercise.kind === 'time' ? ' s' : '';
  return `${planned.sets} × ${planned.repMin}–${planned.repMax}${unit} · recupero ${formatDuration(
    planned.restSeconds ?? restFor(planned.exercise),
  )} · ${muscleLabel(planned.exercise.muscle)}`;
}

/** One day of a program: its exercises with sets, reps and rest, in order. */
export default function DayScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data } = useLiveQuery(
    `day:${id}`,
    async (database) => {
      const [day, active] = await Promise.all([getDay(database, id), getActiveWorkout(database)]);
      return { day, active };
    },
    ['training'],
  );
  const hidden = usePendingDeletes();
  // "Modifica", as in the workout and in Clock: rows get a red ⊖ and a ≡ handle to drag.
  const [editing, setEditing] = useState(false);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const { day, active } = data;
  if (!day || hidden.has(`day:${day.id}`)) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Giorno eliminato</AppText>
      </View>
    );
  }
  const exercises = day.exercises.filter((e) => !hidden.has(`planned:${e.id}`));

  const remove = () => {
    deleteWithUndo({ key: `day:${day.id}`, title: `${day.name} eliminato`, run: () => deleteDay(db, day.id) });
    router.back();
  };

  const removeExercise = (planned: PlannedExercise) =>
    deleteWithUndo({
      key: `planned:${planned.id}`,
      title: `${names(planned.exercise).title} eliminato`,
      run: () => removeDayExercise(db, planned.id),
    });

  const start = async () => {
    await startWorkout(db, { dayId: day.id });
    haptics.success();
    router.push('/workout');
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: '' }} />
      <Stack.Toolbar placement="right">
        <EditButton editing={editing} disabled={exercises.length === 0} onChange={setEditing} />
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Azioni sul giorno">
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={remove}>
            Elimina giorno
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <EditableTitle value={day.name} accessibilityLabel="Nome del giorno" onChange={(name) => void renameDay(db, day.id, name)} />

      {!active && exercises.length > 0 && !editing ? (
        <View style={styles.start}>
          <Button title="Inizia allenamento" onPress={() => void start()} />
        </View>
      ) : null}

      {editing ? (
        <SortableList
          items={exercises}
          keyOf={(planned) => String(planned.id)}
          rowHeight={ROW_HEIGHT}
          onReorder={(keys) => void reorderDayExercises(db, keys.map(Number))}
          onRemove={removeExercise}
          renderRow={(planned) => (
            <View>
              <AppText numberOfLines={1}>{names(planned.exercise).title}</AppText>
              <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
                {planSummary(planned)}
              </AppText>
            </View>
          )}
        />
      ) : (
        <ListGroup>
          {exercises.map((planned) => (
            <SwipeToDelete key={planned.id} onDelete={() => removeExercise(planned)}>
              <Link href={{ pathname: '/plan-exercise', params: { id: planned.id } }} asChild>
                <Link.Trigger>
                  <Pressable accessibilityRole="button">
                    {({ pressed }) => (
                      <View style={[styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
                        <View style={styles.flex}>
                          <AppText numberOfLines={1}>{names(planned.exercise).title}</AppText>
                          <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
                            {planSummary(planned)}
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
                  <Link.MenuAction icon="trash" destructive onPress={() => removeExercise(planned)}>
                    Elimina
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
      )}
      {editing ? <SectionFooter>Trascina ≡ per cambiare l’ordine.</SectionFooter> : null}
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
    minHeight: ROW_HEIGHT,
  },
  start: { marginBottom: Spacing.lg },
});
