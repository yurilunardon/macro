import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { applyPick } from '@/db/exercise-picks';
import type { Exercise } from '@/db/exercises';
import { prefetch, useLiveQuery } from '@/db/live';
import { getMuscleSuggestions, programCheckScreen } from '@/db/program-check';
import { DEFAULT_PLAN, removeDayExercise } from '@/db/programs';
import { dayScreen } from '@/db/screens';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { equipmentLabel, isMuscle, muscleLabel, type Muscle } from '@/lib/exercises';
import { joinNames, levelLabel, missingLabel, muscleWithArticle, type MuscleLevel } from '@/lib/program-check';
import { WEEKLY_SETS } from '@/lib/training';
import { haptics } from '@/services/haptics';

/** How long the sheet takes to go, before what opens next. */
const SHEET_GONE_MS = 320;

const TONE: Record<MuscleLevel, 'accent' | 'warning' | 'danger'> = { good: 'accent', low: 'warning', bad: 'danger' };

/**
 * One muscle of a program, opened from the figure: the sets it gets in a week against the ones
 * that make it grow, what trains it now, and exercises to add to the day it belongs in.
 */
export default function MuscleCheckSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ program?: string; muscle?: string }>();
  const programId = Number(params.program);
  const muscle: Muscle = isMuscle(params.muscle) ? params.muscle : 'chest';
  const screen = programCheckScreen(programId, today);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);
  // Chosen once as the sheet opens: an exercise just added stays in its row, with a tick.
  const [suggestions, setSuggestions] = useState<Exercise[]>([]);
  useEffect(() => {
    void getMuscleSuggestions(db, programId, muscle).then(setSuggestions);
  }, [db, programId, muscle]);

  const check = data?.muscles.find((m) => m.muscle === muscle);
  if (!data || !check) return <View style={[styles.sheet, { backgroundColor: theme.background }]} />;

  const day = data.days.find((d) => d.id === check.dayId) ?? null;
  const planned = [...data.planned.values()];
  const title = (planId: number) => {
    const exercise = data.planned.get(planId)?.exercise;
    return exercise ? names(exercise).title : '';
  };
  const direct = check.direct.map(title).filter(Boolean);
  const indirect = check.indirect.map(title).filter(Boolean);
  const tone = TONE[check.level];

  const toggle = async (exercise: Exercise) => {
    if (!day) return;
    const there = planned.find((p) => p.dayId === day.id && p.exercise.id === exercise.id);
    haptics.selection();
    if (there) await removeDayExercise(db, there.id);
    else await applyPick(db, 'day', day.id, exercise);
  };

  // The sheet goes first, then the page it was over moves on.
  const leaveTo = (go: () => void) => {
    router.back();
    setTimeout(go, SHEET_GONE_MS);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
      <View style={styles.title}>
        <AppText variant="title">{muscleLabel(muscle)}</AppText>
        <AppText variant="headline" tone={tone}>
          {levelLabel(check.level)}
        </AppText>
      </View>

      <SetsBar sets={check.sets} tone={theme[tone]} />

      <AppText numeric>
        {check.missing === 0
          ? `${check.shown} serie a settimana: va bene così.`
          : `${check.shown} serie a settimana, ne ${missingLabel(check.missing, { short: true })} per crescere.`}
      </AppText>
      <View>
        <AppText variant="subhead" tone="textSecondary">
          {direct.length > 0 ? `Lo alleni con ${joinNames(direct)}.` : 'Nessun esercizio apposta.'}
        </AppText>
        {indirect.length > 0 ? (
          <AppText variant="subhead" tone="textSecondary">
            {`Lavora in parte anche in ${joinNames(indirect)}.`}
          </AppText>
        ) : null}
      </View>

      {day ? (
        <View>
          <SectionTitle>{`Aggiungi a ${day.name}`}</SectionTitle>
          <ListGroup>
            {suggestions.map((exercise) => {
              const on = planned.some((p) => p.dayId === day.id && p.exercise.id === exercise.id);
              return (
                <Row
                  key={exercise.id}
                  title={names(exercise).title}
                  subtitle={`${equipmentLabel(exercise.equipment)} · ${DEFAULT_PLAN.sets} serie`}
                  detail={
                    <Pressable
                      onPress={() => void toggle(exercise)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${on ? 'Togli' : 'Aggiungi'} ${names(exercise).title}`}
                      style={[styles.plus, { backgroundColor: on ? theme.accent : theme.accentSoft }]}>
                      <Icon name={on ? 'checkmark' : 'plus'} size={15} color={on ? theme.onAccent : theme.accent} weight="bold" />
                    </Pressable>
                  }
                />
              );
            })}
            <Row
              title={`Tutti gli esercizi per ${muscleWithArticle(muscle)}`}
              onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'day', id: day.id, muscle } })}
            />
            <Row
              title={`Apri ${day.name}`}
              onPress={() => {
                void prefetch(db, dayScreen(day.id));
                leaveTo(() => router.push({ pathname: '/training/day', params: { id: day.id } }));
              }}
            />
          </ListGroup>
          {data.assumed ? <SectionFooter>In calendario non ci sono giorni di palestra: ogni giorno è contato una volta a settimana.</SectionFooter> : null}
        </View>
      ) : (
        <SectionFooter>La scheda non ha ancora giorni.</SectionFooter>
      )}
    </ScrollView>
  );
}

/** The week's sets on a line from 0 to twice the least useful, the useful part tinted. */
function SetsBar({ sets, tone }: { sets: number; tone: string }) {
  const theme = useTheme();
  const full = WEEKLY_SETS.high;
  return (
    <View>
      <View style={[styles.bar, { backgroundColor: theme.track }]}>
        <View style={[styles.band, { left: `${(WEEKLY_SETS.low / full) * 100}%`, backgroundColor: theme.accentSoft }]} />
        <View style={[styles.fill, { width: `${(Math.min(sets, full) / full) * 100}%`, backgroundColor: tone }]} />
      </View>
      <View style={styles.scale}>
        <AppText variant="caption" tone="textSecondary" numeric>
          0
        </AppText>
        <AppText variant="caption" tone="textSecondary" numeric>
          {`${WEEKLY_SETS.low} serie`}
        </AppText>
        <AppText variant="caption" tone="textSecondary" numeric>
          {String(full)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flexGrow: 1, gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
  title: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.md },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 4 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  plus: { width: 32, height: 32, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
});
