import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Chip, FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { restFor } from '@/db/exercises';
import { getPlannedExercise, removeDayExercise, updateDayExercise, type PlannedExercise } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { parseDecimal } from '@/lib/format';
import { formatDuration } from '@/lib/training';
import { haptics } from '@/services/haptics';

const RESTS = [60, 90, 120, 150, 180, 240];

/** Sets, rep range, rest and note of one exercise in a day of the program. */
export default function PlanExerciseScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [planned, setPlanned] = useState<PlannedExercise | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPlannedExercise(db, Number(id)).then((p) => {
      if (!cancelled) setPlanned(p);
    });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  if (!planned) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <PlanForm planned={planned} />;
}

function PlanForm({ planned }: { planned: PlannedExercise }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
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
    await updateDayExercise(db, planned.id, {
      sets,
      repMin: Math.round(min),
      repMax: Math.round(max),
      restSeconds: rest,
      note,
    });
    haptics.success();
    router.back();
  };

  const remove = async () => {
    await removeDayExercise(db, planned.id);
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <AppText variant="title2">{planned.exercise.name}</AppText>
        <AppText variant="subhead" tone="textSecondary">
          {muscleLabel(planned.exercise.muscle)}
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
        <FieldRow label={timed ? 'Secondi, da' : 'Ripetizioni, da'} value={repMin} onChangeText={setRepMin} numeric invalid={min === null} />
        <FieldRow label="a" value={repMax} onChangeText={setRepMax} numeric invalid={max === null} />
      </ListGroup>
      <SectionFooter>
        {timed
          ? 'Quando tieni il massimo in tutte le serie, l’app ti propone qualche secondo in più.'
          : 'Doppia progressione: resti sullo stesso carico aggiungendo ripetizioni; quando tutte le serie arrivano al massimo della fascia, l’app ti propone il carico successivo.'}
      </SectionFooter>

      <SectionTitle>Recupero</SectionTitle>
      <View style={styles.chips}>
        <Chip label={`Predefinito (${formatDuration(restFor(planned.exercise))})`} selected={rest === null} onPress={() => setRest(null)} />
        {RESTS.map((seconds) => (
          <Chip key={seconds} label={formatDuration(seconds)} selected={rest === seconds} onPress={() => setRest(seconds)} />
        ))}
      </View>

      <SectionTitle>Nota</SectionTitle>
      <ListGroup>
        <FieldRow label="Nota" value={note} onChangeText={setNote} placeholder="Es. fermo di 1 s in basso" autoCapitalize="sentences" />
      </ListGroup>

      <View style={styles.actions}>
        <Button title="Salva" onPress={() => void save()} disabled={!valid} />
        <Button title="Togli dalla scheda" variant="destructive" onPress={() => void remove()} />
      </View>
    </ScrollView>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  actions: { paddingTop: Spacing.lg, gap: Spacing.sm },
});
