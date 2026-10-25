import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { WeightChart } from '@/components/charts';
import { Chip } from '@/components/form';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { deleteExercise, getExercise, restFor, updateExerciseOptions } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { getExerciseHistory } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle } from '@/lib/dates';
import { equipmentLabel, muscleLabel } from '@/lib/exercises';
import { formatNumber } from '@/lib/format';
import { estimateOneRepMax, formatDuration, formatSet, isWorkSet } from '@/lib/training';

const RESTS = [60, 90, 120, 150, 180, 240];

/** One exercise: progress of the estimated 1RM, records, every session, and its optional blocks. */
export default function ExerciseScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data } = useLiveQuery(`exercise:${id}`, async (database) => {
    const [exercise, sessions] = await Promise.all([getExercise(database, id), getExerciseHistory(database, id)]);
    return { exercise, sessions };
  });

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const { exercise, sessions } = data;
  if (!exercise) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Esercizio non trovato.</AppText>
      </View>
    );
  }

  const work = sessions.flatMap((s) => s.sets.filter(isWorkSet));
  const best = Math.max(0, ...sessions.map((s) => s.oneRepMax ?? 0));
  const heaviest = Math.max(0, ...work.map((s) => s.weight ?? 0));
  const bestSet = work.reduce<(typeof work)[number] | null>((top, s) => {
    const e1rm = estimateOneRepMax(s.weight, s.reps) ?? 0;
    return e1rm > (top ? (estimateOneRepMax(top.weight, top.reps) ?? 0) : 0) ? s : top;
  }, null);
  const points = [...sessions]
    .reverse()
    .filter((s) => s.oneRepMax !== null)
    .map((s) => ({ date: s.date, kg: Math.round((s.oneRepMax ?? 0) * 10) / 10 }));
  const rest = restFor(exercise);

  const editNote = () =>
    Alert.prompt(
      'Nota fissa',
      'Compare in ogni allenamento con questo esercizio.',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Salva', onPress: (text?: string) => void updateExerciseOptions(db, exercise.id, { note: text ?? '' }) },
      ],
      'plain-text',
      exercise.note ?? '',
    );

  const remove = async () => {
    const ok = await confirmDestructive({
      title: `Eliminare «${names(exercise).title}»?`,
      message: 'Sparisce dalla libreria e dalle schede; gli allenamenti già fatti restano nello storico.',
      action: 'Elimina',
    });
    if (!ok) return;
    await deleteExercise(db, exercise.id);
    router.back();
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: names(exercise).title }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Azioni sull’esercizio">
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            {exercise.ref ? 'Nascondi dalla libreria' : 'Elimina esercizio'}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <AppText variant="subhead" tone="textSecondary" style={styles.subtitle}>
        {`${names(exercise).subtitle ? `${names(exercise).subtitle}\n` : ''}${muscleLabel(exercise.muscle)}${exercise.secondary.length ? ` (e ${exercise.secondary.map(muscleLabel).join(', ').toLowerCase()})` : ''} · ${equipmentLabel(exercise.equipment)}`}
      </AppText>

      {exercise.kind !== 'time' ? (
        <Card style={styles.card}>
          <View style={styles.stats}>
            <Stat label="Massimale stimato" value={best > 0 ? `${formatNumber(best, 1)} kg` : '—'} />
            <Stat label="Carico più alto" value={heaviest > 0 ? `${formatNumber(heaviest, 2)} kg` : '—'} />
            <Stat label="Sedute" value={String(sessions.length)} />
          </View>
          {points.length > 1 ? (
            <WeightChart points={points} from={points[0].date} to={points[points.length - 1].date} />
          ) : null}
          {bestSet ? (
            <AppText variant="footnote" tone="textSecondary">
              {`Serie migliore: ${formatSet(bestSet, exercise.kind)}. Il massimale è stimato con la formula di Epley dalle serie fino a 12 ripetizioni: non serve provarlo.`}
            </AppText>
          ) : (
            <AppText variant="footnote" tone="textSecondary">
              Dopo il primo allenamento qui vedrai come cresce il massimale stimato.
            </AppText>
          )}
        </Card>
      ) : null}

      <SectionTitle>Blocchi</SectionTitle>
      <ListGroup>
        <Row
          title="Registra il RIR"
          subtitle="Ripetizioni che ti restavano a fine serie"
          chevron={false}
          detail={
            <Switch
              value={exercise.trackRir}
              onValueChange={(trackRir) => void updateExerciseOptions(db, exercise.id, { trackRir })}
              trackColor={{ true: theme.accent }}
              accessibilityLabel="Registra il RIR"
            />
          }
        />
        <Row
          title="Nota fissa"
          subtitle={exercise.note ?? 'Regolazioni della macchina, presa, attenzioni'}
          onPress={editNote}
        />
      </ListGroup>
      <SectionTitle>{`Recupero · ${formatDuration(rest)}`}</SectionTitle>
      <View style={styles.chips}>
        {RESTS.map((seconds) => (
          <Chip
            key={seconds}
            label={formatDuration(seconds)}
            selected={seconds === rest}
            onPress={() => void updateExerciseOptions(db, exercise.id, { restSeconds: seconds })}
          />
        ))}
      </View>
      <SectionFooter>Il timer parte da solo quando spunti una serie. In una scheda puoi dare a questo esercizio un recupero diverso.</SectionFooter>

      {sessions.length > 0 ? <SectionTitle>Storico</SectionTitle> : null}
      {sessions.length > 0 ? (
        <ListGroup>
          {sessions.slice(0, 30).map((s) => (
            <Row
              key={s.workoutId}
              title={formatDayTitle(s.date, today)}
              subtitle={s.sets.filter(isWorkSet).map((set) => formatSet(set, exercise.kind)).join(' · ')}
              detail={s.oneRepMax !== null ? `${formatNumber(s.oneRepMax, 0)} kg` : undefined}
              onPress={() => router.push({ pathname: '/training/session', params: { id: s.workoutId } })}
            />
          ))}
        </ListGroup>
      ) : null}
    </ScreenScroll>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="headline" numeric>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  card: { gap: Spacing.lg },
  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
