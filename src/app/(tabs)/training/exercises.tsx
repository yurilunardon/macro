import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Row, SectionFooter } from '@/components/card';
import { Chip } from '@/components/form';
import { GroupedList } from '@/components/grouped-list';
import { Spacing } from '@/constants/theme';
import { searchExercises } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { setSetting } from '@/db/settings';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { equipmentLabel, MUSCLES, muscleLabel, type Muscle } from '@/lib/exercises';
import { exerciseSearch } from '@/services/search-query';

/** The whole exercise library, to look at an exercise's history or change its blocks. */
export default function ExercisesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { language, names } = useExerciseNames();
  const query = exerciseSearch.useQuery();
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const { data } = useLiveQuery(`exercises:${query}:${muscle ?? ''}`, (database) => searchExercises(database, { query, muscle }), ['training', 'settings']);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu separateBackground icon="textformat" accessibilityLabel="Lingua dei nomi">
          <Stack.Toolbar.MenuAction isOn={language === 'en'} onPress={() => void setSetting(db, 'exerciseNames', 'en')}>
            Nome inglese per primo
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={language === 'it'} onPress={() => void setSetting(db, 'exerciseNames', 'it')}>
            Nome italiano per primo
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button separateBackground icon="plus" accessibilityLabel="Nuovo esercizio" onPress={() => router.push('/exercise-new')} />
      </Stack.Toolbar>
      <GroupedList
        data={data ?? []}
        keyOf={(exercise) => String(exercise.id)}
        header={
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Tutti" selected={muscle === null} onPress={() => setMuscle(null)} />
            {MUSCLES.map((m) => (
              <Chip key={m.key} label={m.label} selected={muscle === m.key} onPress={() => setMuscle(muscle === m.key ? null : m.key)} />
            ))}
          </ScrollView>
        }
        footer={<SectionFooter>I più usati in cima. «Aa» cambia la lingua dei nomi.</SectionFooter>}
        renderRow={(exercise) => (
          <Row
            title={names(exercise).title}
            subtitle={
              exercise.ref
                ? (names(exercise).subtitle ?? muscleLabel(exercise.muscle))
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
