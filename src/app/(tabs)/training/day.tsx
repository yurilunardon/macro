import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState, type ReactNode } from 'react';
import Animated, {
  Keyframe,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { DayIconButton } from '@/components/day-badge';
import { editButton } from '@/components/edit-button';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SORTABLE_ENTER_MS, SORTABLE_SHIFT, SORTABLE_TEXT_SLACK, SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { restFor, type Exercise } from '@/db/exercises';
import { getMuscleSuggestions, getProgramCheck } from '@/db/program-check';
import { useLiveQuery } from '@/db/live';
import { addWarmUp } from '@/db/exercise-picks';
import { dayScreen } from '@/db/screens';
import { deleteDay, removeDayExercise, setDayIcon, renameDay, reorderDayExercises, type PlannedExercise } from '@/db/programs';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { isWarmUp, muscleLabel } from '@/lib/exercises';
import { dayHints, muscleWithArticle, type DayHint } from '@/lib/program-check';
import { formatDuration, WEEKLY_SETS } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { startAndOpenWorkout } from '@/services/start-workout';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

const ROW_HEIGHT = 60;
/** With a note under an exercise: one line more. */
const ROW_HEIGHT_NOTES = 78;
/** How far the text moves to make room for the red ⊖: its width and its gap. */
const ROW_SHIFT = SORTABLE_SHIFT;
const EDIT_MS = SORTABLE_ENTER_MS;
/** An exercise opened from a muscle stands out, then fades back. */
const HIGHLIGHT_HOLD_MS = 900;
const HIGHLIGHT_FADE_MS = 1400;

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

function planSummary(planned: PlannedExercise): string {
  if (isWarmUp(planned.exercise)) return 'Prima di iniziare: lo spunti quando hai finito';
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
  const params = useLocalSearchParams<{ id?: string; highlight?: string }>();
  const id = Number(params.id);
  const highlight = Number(params.highlight);
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

  // What adds to the day: under the list, and still there while editing, dimmed as "Inizia".
  const addRows = (
    <View style={editing && styles.dimmed} pointerEvents={editing ? 'none' : 'auto'}>
      {/* A day is best started warm: offered until it has one. */}
      {exercises.some((planned) => isWarmUp(planned.exercise)) ? null : (
        <>
          <ActionRow label="Aggiungi riscaldamento" symbol="flame" onPress={() => void addWarmUp(db, { dayId: day.id })} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
        </>
      )}
      <ActionRow label="Aggiungi esercizio" onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'day', id: day.id } })} />
    </View>
  );

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button {...editButton({ editing, disabled: exercises.length === 0, onChange: setEditing })} />
        {/* The only action besides editing: no menu to hold it. */}
        <Stack.Toolbar.Button separateBackground icon="trash" accessibilityLabel="Elimina giorno" onPress={remove} />
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
          footer={addRows}
          renderRow={(planned) => <Animated.View entering={TEXT_TO_EDIT}>{rowText(planned)}</Animated.View>}
        />
      ) : (
        <ListGroup>
          {exercises.map((planned) => (
            <SwipeToDelete key={planned.id} onDelete={() => removeExercise(planned)}>
              <Highlight on={planned.id === highlight}>
              {/* Nothing to set on the warm-up: no sets, no reps, no rest. */}
              {isWarmUp(planned.exercise) ? (
                <View style={[styles.row, { height: rowHeight }]}>
                  <Animated.View entering={TEXT_FROM_EDIT} style={[styles.flex, styles.slackWide]}>
                    {rowText(planned)}
                  </Animated.View>
                </View>
              ) : (
              <Link href={{ pathname: '/plan-exercise', params: { id: planned.id } }} asChild>
                <Link.Trigger>
                  <Pressable accessibilityRole="button">
                    {({ pressed }) => (
                      <View style={[styles.row, { height: rowHeight }, pressed && { backgroundColor: theme.cardPressed }]}>
                        <Animated.View entering={TEXT_FROM_EDIT} style={[styles.flex, styles.slack]}>
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
              )}
              </Highlight>
            </SwipeToDelete>
          ))}
          {addRows}
        </ListGroup>
      )}
      </LayoutAnimationConfig>

      {/* What this day could change for the whole week, from the program's Validità. */}
      {editing ? null : <DayHints dayId={day.id} programId={day.programId} />}
    </ScreenScroll>
  );
}

type HintRow = { hint: DayHint; exercise: Exercise | null };

/**
 * "Per la scheda": the muscles of the week this day is the place for, with an exercise to add, and
 * the ones past what helps, with the sets to take off. Nothing when the program is fine.
 */
function DayHints({ dayId, programId }: { dayId: number; programId: number }) {
  const router = useRouter();
  const today = useToday();
  const { names } = useExerciseNames();
  const { data } = useLiveQuery(
    `day-hints:${dayId}:${today}`,
    async (database): Promise<HintRow[]> => {
      const check = await getProgramCheck(database, programId, today);
      if (!check) return [];
      return Promise.all(
        dayHints(check.days, check.muscles, dayId).map(async (hint): Promise<HintRow> => {
          if (hint.kind === 'trim') return { hint, exercise: check.planned.get(hint.planId)?.exercise ?? null };
          const [first] = await getMuscleSuggestions(database, programId, hint.muscle, { count: 1 });
          return { hint, exercise: first ?? null };
        }),
      );
    },
    ['training', 'calendar'],
  );
  if (!data || data.length === 0) return null;

  return (
    <View>
      <SectionTitle>Per la scheda</SectionTitle>
      <ListGroup>
        {data.map(({ hint, exercise }) => {
          const muscle = muscleLabel(hint.muscle);
          if (hint.kind === 'add') {
            return (
              <Row
                key={`add-${hint.muscle}`}
                icon={<Icon name="plus.circle.fill" size={22} tone={hint.level === 'bad' ? 'danger' : 'warning'} />}
                title={exercise ? `Aggiungi ${names(exercise).title} qui` : `Aggiungi un esercizio per ${muscleWithArticle(hint.muscle)}`}
                subtitle={`${muscle}: ${hint.shown} serie a settimana su ${WEEKLY_SETS.low}`}
                onPress={() =>
                  exercise
                    ? router.push({ pathname: '/plan-exercise', params: { day: dayId, exercise: exercise.id, direct: '1' } })
                    : router.push({ pathname: '/exercise-picker', params: { target: 'day', id: dayId } })
                }
              />
            );
          }
          const name = exercise ? names(exercise).title : 'un esercizio';
          return (
            <Row
              key={`trim-${hint.muscle}`}
              icon={<Icon name="minus.circle.fill" size={22} tone="textSecondary" />}
              title={`Togli ${hint.remove === 1 ? '1 serie' : `${hint.remove} serie`} a ${name}`}
              subtitle={`${muscle}: ${hint.shown} a settimana, oltre ${WEEKLY_SETS.high} non serve`}
              onPress={() => router.push({ pathname: '/plan-exercise', params: { id: hint.planId } })}
            />
          );
        })}
      </ListGroup>
      <SectionFooter>Dai muscoli di tutta la settimana, come in Validità: questo è il giorno dove vanno.</SectionFooter>
    </View>
  );
}

/** Tinted at first, then back to the card's colour: the exercise that was asked for. */
function Highlight({ on, children }: { on: boolean; children: ReactNode }) {
  const theme = useTheme();
  const tint = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    if (on) tint.set(withDelay(HIGHLIGHT_HOLD_MS, withTiming(0, { duration: HIGHLIGHT_FADE_MS })));
  }, [on, tint]);
  const style = useAnimatedStyle(() => ({ opacity: tint.get() }));
  if (!on) return children;
  return (
    <View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.accentSoft }, style]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  titleText: { flex: 1, marginBottom: 0 },
  flex: { flex: 1, gap: 2 },
  // The text as wide as in edit mode, so it is cut at the same letter in both.
  slack: { marginRight: SORTABLE_TEXT_SLACK },
  // The warm-up has no chevron: its room too.
  slackWide: { marginRight: SORTABLE_TEXT_SLACK + 13 + Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  start: { marginBottom: Spacing.lg },
  dimmed: { opacity: 0.35 },
  divider: { marginLeft: Spacing.lg, height: StyleSheet.hairlineWidth },
});
