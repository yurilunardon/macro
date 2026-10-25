import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ActionRow, ListGroup, Row } from '@/components/card';
import { Chip } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { applyPick, isPickerTarget, type PickerTarget } from '@/db/exercise-picks';
import { searchExercises, type Exercise } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { equipmentLabel, MUSCLES, muscleLabel, type Muscle } from '@/lib/exercises';
import { haptics } from '@/services/haptics';

/** The exercise library to choose from: native search, a filter by muscle, the most used first. */
export default function ExercisePickerScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ target?: string; id?: string }>();
  const target: PickerTarget = isPickerTarget(params.target) ? params.target : 'workout';
  const id = Number(params.id);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const { names } = useExerciseNames();
  const { data } = useLiveQuery(`exercise-picker:${query}:${muscle ?? ''}`, (database) =>
    searchExercises(database, { query, muscle }),
  );

  const pick = async (exercise: Exercise) => {
    await applyPick(db, target, id, exercise);
    haptics.success();
    router.back();
  };

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          title: target === 'replace' ? 'Sostituisci esercizio' : 'Aggiungi esercizio',
          headerSearchBarOptions: {
            placeholder: 'Cerca: panca, squat, curl…',
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
          },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>Annulla</Stack.Toolbar.Button>
      </Stack.Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Tutti" selected={muscle === null} onPress={() => setMuscle(null)} />
        {MUSCLES.map((m) => (
          <Chip key={m.key} label={m.label} selected={muscle === m.key} onPress={() => setMuscle(muscle === m.key ? null : m.key)} />
        ))}
      </ScrollView>

      <ListGroup>
        <ActionRow
          label={query.trim() ? `Crea «${query.trim()}»` : 'Crea un esercizio'}
          onPress={() => router.push({ pathname: '/exercise-new', params: { target, id, name: query.trim() } })}
        />
        {(data ?? []).map((exercise) => (
          <Row
            key={exercise.id}
            title={names(exercise).title}
            subtitle={names(exercise).subtitle ?? `${muscleLabel(exercise.muscle)} · ${equipmentLabel(exercise.equipment)}`}
            onPress={() => void pick(exercise)}
            chevron={false}
          />
        ))}
      </ListGroup>
      {data && data.length === 0 ? (
        <View style={styles.empty}>
          <AppText tone="textSecondary" align="center">
            Nessun esercizio trovato. Puoi crearlo tu con il nome che usi in palestra.
          </AppText>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  chips: { gap: Spacing.sm, paddingBottom: Spacing.md },
  empty: { paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg },
});
