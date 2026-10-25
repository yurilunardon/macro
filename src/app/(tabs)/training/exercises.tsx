import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ListGroup, Row, SectionFooter } from '@/components/card';
import { Chip } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { searchExercises } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { setSetting } from '@/db/settings';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { equipmentLabel, MUSCLES, muscleLabel, type Muscle } from '@/lib/exercises';

/** The whole exercise library, to look at an exercise's history or change its blocks. */
export default function ExercisesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { language, names } = useExerciseNames();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const { data } = useLiveQuery(`exercises:${query}:${muscle ?? ''}`, (database) => searchExercises(database, { query, muscle }));

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Cerca un esercizio',
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="textformat" accessibilityLabel="Lingua dei nomi">
          <Stack.Toolbar.MenuAction isOn={language === 'en'} onPress={() => void setSetting(db, 'exerciseNames', 'en')}>
            Nome inglese per primo
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={language === 'it'} onPress={() => void setSetting(db, 'exerciseNames', 'it')}>
            Nome italiano per primo
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Nuovo esercizio" onPress={() => router.push('/exercise-new')} />
      </Stack.Toolbar>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Tutti" selected={muscle === null} onPress={() => setMuscle(null)} />
        {MUSCLES.map((m) => (
          <Chip key={m.key} label={m.label} selected={muscle === m.key} onPress={() => setMuscle(muscle === m.key ? null : m.key)} />
        ))}
      </ScrollView>
      <ListGroup>
        {(data ?? []).map((exercise) => (
          <Row
            key={exercise.id}
            title={names(exercise).title}
            subtitle={
              exercise.ref
                ? (names(exercise).subtitle ?? muscleLabel(exercise.muscle))
                : `${muscleLabel(exercise.muscle)} · ${equipmentLabel(exercise.equipment)} · creato da te`
            }
            onPress={() => router.push({ pathname: '/training/exercise', params: { id: exercise.id } })}
          />
        ))}
      </ListGroup>
      <SectionFooter>In cima gli esercizi che fai più spesso. Con «Aa» scegli se vedere prima il nome inglese o quello italiano; la ricerca li trova tutti e due.</SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  chips: { gap: Spacing.sm, paddingBottom: Spacing.md },
});
