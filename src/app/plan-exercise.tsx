import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, Row, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { RestPicker } from '@/components/rest-picker';
import { Radius, Spacing } from '@/constants/theme';
import { getExercise, restFor } from '@/db/exercises';
import { addDayExercise, DEFAULT_PLAN, getPlannedExercise, removeDayExercise, updateDayExercise, type PlannedExercise } from '@/db/programs';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { parseDecimal } from '@/lib/format';
import { formatDuration } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { deleteWithUndo } from '@/services/undo';

/**
 * Sets, rep range, rest and note of one exercise in a day of the program. Opened with `id`, it
 * changes one already there; with `day` and `exercise`, from the picker, it shows what the new one
 * would start with, to look at and change before adding it.
 */
export default function PlanExerciseScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; day?: string; exercise?: string; direct?: string }>();
  const adding = params.day !== undefined && params.exercise !== undefined;
  const [planned, setPlanned] = useState<PlannedExercise | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = adding
      ? getExercise(db, Number(params.exercise)).then((exercise) =>
          exercise
            ? { id: -1, exercise, ...DEFAULT_PLAN, ...(exercise.kind === 'time' ? { repMin: 30, repMax: 60 } : {}) }
            : null,
        )
      : getPlannedExercise(db, Number(params.id));
    void load.then((p) => {
      if (!cancelled) setPlanned(p);
    });
    return () => {
      cancelled = true;
    };
  }, [db, adding, params.id, params.exercise]);

  if (!planned) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <PlanForm planned={planned} dayId={adding ? Number(params.day) : null} direct={params.direct === '1'} />;
}

function PlanForm({ planned, dayId, direct = false }: { planned: PlannedExercise; dayId: number | null; direct?: boolean }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  const timed = planned.exercise.kind === 'time';
  const [sets, setSets] = useState(planned.sets);
  const [repMin, setRepMin] = useState(String(planned.repMin));
  const [repMax, setRepMax] = useState(String(planned.repMax));
  const [rest, setRest] = useState<number | null>(planned.restSeconds);
  const [note, setNote] = useState(planned.note ?? '');
  const min = parseDecimal(repMin);
  const max = parseDecimal(repMax);
  const valid = min !== null && max !== null && min > 0 && max > 0 && max < 1000;

  const step = (delta: number) => {
    const next = Math.min(10, Math.max(1, sets + delta));
    if (next !== sets) haptics.selection();
    setSets(next);
  };

  const save = async () => {
    if (!valid) return;
    const plan = { sets, repMin: Math.round(Math.min(min, max)), repMax: Math.round(Math.max(min, max)), restSeconds: rest, note };
    if (dayId !== null) {
      await addDayExercise(db, dayId, planned.exercise.id, { ...plan, note: note.trim() === '' ? null : note.trim() });
      haptics.success();
      // This sheet and the picker under it: back to the day, with the exercise in it. Opened
      // straight from the day (a hint of the program), there is no picker to close.
      if (direct) router.back();
      else router.dismiss(2);
      return;
    }
    await updateDayExercise(db, planned.id, plan);
    haptics.success();
    router.back();
  };

  // As from the day's list: back to it, where the exercise is gone with "Annulla".
  const remove = () => {
    router.back();
    deleteWithUndo({
      key: `planned:${planned.id}`,
      title: `${names(planned.exercise).title} eliminato`,
      run: () => removeDayExercise(db, planned.id),
    });
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <AppText variant="title2">{names(planned.exercise).title}</AppText>
        <AppText variant="subhead" tone="textSecondary">
          {[names(planned.exercise).subtitle, muscleLabel(planned.exercise.muscle)].filter(Boolean).join(' · ')}
        </AppText>
      </View>

      <ListGroup>
        <View style={styles.row}>
          <AppText style={styles.flex}>Serie</AppText>
          <Stepper onPress={() => step(-1)} symbol="minus" label="Una serie in meno" />
          <AppText variant="title2" numeric style={styles.sets}>
            {sets}
          </AppText>
          <Stepper onPress={() => step(1)} symbol="plus" label="Una serie in più" />
        </View>
        {/* One row, the two ends of the range side by side: "8 – 12". */}
        <View style={styles.row}>
          <AppText style={styles.flex}>{timed ? 'Secondi' : 'Ripetizioni'}</AppText>
          <RangeBox value={repMin} onChangeText={setRepMin} invalid={min === null} label={timed ? 'Secondi, il meno' : 'Ripetizioni, il meno'} />
          <AppText variant="title3" tone="textSecondary">
            –
          </AppText>
          <RangeBox value={repMax} onChangeText={setRepMax} invalid={max === null} label={timed ? 'Secondi, il più' : 'Ripetizioni, il più'} />
        </View>
      </ListGroup>

      <ListGroup style={styles.group}>
        <Row
          title="Recupero dopo ogni serie"
          subtitle={rest === null ? 'Come nell’esercizio' : 'Solo in questa scheda'}
          chevron={false}
          detail={<RestPicker value={rest ?? restFor(planned.exercise)} onChange={setRest} />}
        />
        {rest !== null ? (
          <ActionRow
            label={`Come nell’esercizio (${formatDuration(restFor(planned.exercise))})`}
            symbol="arrow.uturn.backward"
            onPress={() => setRest(null)}
          />
        ) : null}
      </ListGroup>

      <SectionTitle>Nota</SectionTitle>
      <ListGroup>
        <FieldRow label="Nota" value={note} onChangeText={setNote} placeholder="Es. fermo di 1 s in basso" autoCapitalize="sentences" />
      </ListGroup>

      <View style={styles.actions}>
        {dayId !== null ? (
          <Button title="Aggiungi al giorno" onPress={() => void save()} disabled={!valid} />
        ) : (
          <>
            <Button title="Salva" onPress={() => void save()} disabled={!valid} />
            <Button title="Elimina dalla scheda" variant="destructive" onPress={remove} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

/** One end of the range: a small box with the number in it. */
function RangeBox({ value, onChangeText, invalid, label }: { value: string; onChangeText: (text: string) => void; invalid: boolean; label: string }) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      inputAccessoryViewButtonLabel="Fine"
      selectTextOnFocus
      maxLength={3}
      accessibilityLabel={label}
      style={[
        styles.rangeBox,
        { backgroundColor: theme.fill, color: invalid ? theme.danger : theme.text },
        invalid && { borderColor: theme.danger, borderWidth: 1.5 },
      ]}
    />
  );
}

function Stepper({ symbol, label, onPress }: { symbol: 'plus' | 'minus'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.stepper, { backgroundColor: theme.track }, pressed && { opacity: 0.6 }]}>
      <Icon name={symbol} size={16} weight="bold" tone="accent" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingHorizontal: Spacing.lg },
  flex: { flex: 1 },
  sets: { minWidth: 28, textAlign: 'center' },
  stepper: { width: 40, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  rangeBox: {
    width: 56,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  // The space the footer under the sets used to leave.
  group: { marginTop: Spacing.md },
  actions: { paddingTop: Spacing.lg, gap: Spacing.sm },
});
