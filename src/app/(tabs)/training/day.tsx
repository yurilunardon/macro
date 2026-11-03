import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, Keyframe, LayoutAnimationConfig } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter } from '@/components/card';
import { DayIconButton } from '@/components/day-badge';
import { editButton } from '@/components/edit-button';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { restFor } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { dayScreen } from '@/db/screens';
import { deleteDay, removeDayExercise, setDayIcon, renameDay, reorderDayExercises, type PlannedExercise } from '@/db/programs';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { formatDuration } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { startAndOpenWorkout } from '@/services/start-workout';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

const ROW_HEIGHT = 60;
/** With a note under an exercise: one line more. */
const ROW_HEIGHT_NOTES = 78;
/** How far the text moves to make room for the red ⊖: its width and its gap. */
const ROW_SHIFT = 34;
const EDIT_MS = 260;

// Going into edit mode and out of it, the rows are the same but drawn by another list: the text
// starts where the other left it and slides to its place, so nothing jumps.
const TEXT_TO_EDIT = new Keyframe({
  0: { transform: [{ translateX: -ROW_SHIFT }] },
  100: { transform: [{ translateX: 0 }] },
}).duration(EDIT_MS);
const TEXT_FROM_EDIT = new Keyframe({
  0: { transform: [{ translateX: ROW_SHIFT }] },
  100: { transform: [{ translateX: 0 }] },
}).duration(EDIT_MS);
const HINT_IN = FadeIn.duration(EDIT_MS);
const HINT_OUT = FadeOut.duration(160);

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
  const screen = dayScreen(id);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);
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

  const rowHeight = exercises.some((e) => e.note) ? ROW_HEIGHT_NOTES : ROW_HEIGHT;
  const rowText = (planned: PlannedExercise) => (
    <>
      <AppText numberOfLines={1}>{names(planned.exercise).title}</AppText>
      <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
        {planSummary(planned)}
      </AppText>
      {planned.note ? (
        <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
          {planned.note}
        </AppText>
      ) : null}
    </>
  );

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button {...editButton({ editing, disabled: exercises.length === 0, onChange: setEditing })} />
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Azioni sul giorno">
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={remove}>
            Elimina giorno
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <View style={styles.title}>
        <DayIconButton
          icon={day.icon}
          onPick={(icon) => {
            haptics.selection();
            void setDayIcon(db, day.id, icon);
          }}
        />
        <EditableTitle
          value={day.name}
          accessibilityLabel="Nome del giorno"
          onChange={(name) => void renameDay(db, day.id, name)}
          style={styles.titleText}
        />
      </View>

      {/* Stays in its place while editing, dimmed: taking it away moved everything under it. */}
      {!active && exercises.length > 0 ? (
        <View style={[styles.start, editing && styles.dimmed]} pointerEvents={editing ? 'none' : 'auto'}>
          <Button title="Inizia allenamento" onPress={() => void startAndOpenWorkout(db, router, day.id, day.name)} />
        </View>
      ) : null}

      <LayoutAnimationConfig skipEntering>
      {editing ? (
        <SortableList
          items={exercises}
          keyOf={(planned) => String(planned.id)}
          rowHeight={rowHeight}
          onReorder={(keys) => void reorderDayExercises(db, keys.map(Number))}
          onRemove={removeExercise}
          renderRow={(planned) => <Animated.View entering={TEXT_TO_EDIT}>{rowText(planned)}</Animated.View>}
        />
      ) : (
        <ListGroup>
          {exercises.map((planned) => (
            <SwipeToDelete key={planned.id} onDelete={() => removeExercise(planned)}>
              <Link href={{ pathname: '/plan-exercise', params: { id: planned.id } }} asChild>
                <Link.Trigger>
                  <Pressable accessibilityRole="button">
                    {({ pressed }) => (
                      <View style={[styles.row, { height: rowHeight }, pressed && { backgroundColor: theme.cardPressed }]}>
                        <Animated.View entering={TEXT_FROM_EDIT} style={styles.flex}>
                          {rowText(planned)}
                        </Animated.View>
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
      </LayoutAnimationConfig>
      {editing ? (
        <Animated.View entering={HINT_IN} exiting={HINT_OUT}>
          <SectionFooter>Trascina ≡ per cambiare l’ordine.</SectionFooter>
        </Animated.View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  titleText: { flex: 1, marginBottom: 0 },
  flex: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  start: { marginBottom: Spacing.lg },
  dimmed: { opacity: 0.35 },
});
