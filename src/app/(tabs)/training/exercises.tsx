import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Row, SectionFooter } from '@/components/card';
import { Chip } from '@/components/form';
import { GroupedList } from '@/components/grouped-list';
import { SearchField } from '@/components/search-field';
import { Spacing } from '@/constants/theme';
import { searchExercises } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { equipmentLabel, isWarmUp, MUSCLES, muscleLabel, type Muscle } from '@/lib/exercises';

/** The whole exercise library, to look at an exercise's history or change its blocks. */
export default function ExercisesScreen() {
  const router = useRouter();
  const { names } = useExerciseNames();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const { data } = useLiveQuery(`exercises:${query}:${muscle ?? ''}`, (database) => searchExercises(database, { query, muscle }), ['training', 'settings']);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button separateBackground icon="plus" accessibilityLabel="Nuovo esercizio" onPress={() => router.push('/exercise-new')} />
      </Stack.Toolbar>
      <GroupedList
        data={data ?? []}
        keyOf={(exercise) => String(exercise.id)}
        header={
          <View>
          <SearchField value={query} onChangeText={setQuery} placeholder="Cerca: panca, squat, curl…" accessibilityLabel="Cerca un esercizio" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Tutti" selected={muscle === null} onPress={() => setMuscle(null)} />
            {MUSCLES.map((m) => (
              <Chip key={m.key} label={m.label} selected={muscle === m.key} onPress={() => setMuscle(muscle === m.key ? null : m.key)} />
            ))}
          </ScrollView>
          </View>
        }
        footer={<SectionFooter>I più usati in cima. La lingua dei nomi si cambia in Impostazioni.</SectionFooter>}
        renderRow={(exercise) => (
          <Row
            title={names(exercise).title}
            subtitle={
              exercise.ref
                ? isWarmUp(exercise)
                  ? 'Prima di iniziare: lo spunti quando hai finito'
                  : (names(exercise).subtitle ?? muscleLabel(exercise.muscle))
                : `${muscleLabel(exercise.muscle)} · ${equipmentLabel(exercise.equipment)} · creato da te`
            }
            onPress={() => router.push({ pathname: '/training/exercise', params: { id: exercise.id } })}
          />
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chips: { gap: Spacing.sm, paddingBottom: Spacing.md },
});
