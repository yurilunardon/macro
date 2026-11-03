import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { updateExerciseOptions } from '@/db/exercises';
import { updateWorkoutNotes } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';

/**
 * A note, on the workout (`kind` "workout") or fixed on an exercise ("exercise"), in a sheet: it
 * opens ready to type and saves itself. Emptied, the note is gone.
 */
export default function NoteSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ kind?: string; id?: string; text?: string }>();
  const id = Number(params.id);
  const fixed = params.kind === 'exercise';
  const [text, setText] = useState(params.text ?? '');
  const saved = useRef(params.text ?? '');
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  });
  const save = (next: string) => {
    if (next.trim() === saved.current.trim()) return;
    saved.current = next;
    if (fixed) void updateExerciseOptions(db, id, { note: next });
    else void updateWorkoutNotes(db, id, next);
  };
  useEffect(() => {
    const timer = setTimeout(() => save(text), 500);
    return () => clearTimeout(timer);
    // Only the text matters; `save` is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  // Swiped away with the last words not yet saved.
  useEffect(
    () => () => save(latest.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.header}>
        <AppText variant="title2" style={styles.flex}>
          {fixed ? 'Nota fissa' : 'Nota'}
        </AppText>
        <Button title="Fine" variant="plain" compact onPress={() => router.back()} />
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        multiline
        placeholder={fixed ? 'Sedile al 4, presa larga…' : 'Come è andata, sensazioni, dolori…'}
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel={fixed ? 'Nota fissa dell’esercizio' : 'Nota dell’allenamento'}
        style={[styles.input, { color: theme.text, backgroundColor: theme.card }]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  input: { minHeight: 140, fontSize: 17, lineHeight: 22, padding: Spacing.lg, borderRadius: 22, borderCurve: 'continuous', textAlignVertical: 'top' },
});
