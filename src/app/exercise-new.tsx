import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow, Segmented } from '@/components/form';
import { MenuButton } from '@/components/menu-button';
import { Spacing } from '@/constants/theme';
import { applyPick, isPickerTarget } from '@/db/exercise-picks';
import { getExercise, insertExercise } from '@/db/exercises';
import { useTheme } from '@/hooks/use-theme';
import { EQUIPMENT, MUSCLES, equipmentLabel, muscleLabel, type Equipment, type ExerciseKind, type Muscle } from '@/lib/exercises';
import { haptics } from '@/services/haptics';

const KINDS: readonly { key: ExerciseKind; label: string }[] = [
  { key: 'weight', label: 'Peso' },
  { key: 'bodyweight', label: 'Corpo libero' },
  { key: 'time', label: 'A tempo' },
];

/** A custom exercise, with the name used in the user's gym. */
export default function NewExerciseScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ target?: string; id?: string; name?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [muscle, setMuscle] = useState<Muscle>('chest');
  const [equipment, setEquipment] = useState<Equipment>('machine');
  const [kind, setKind] = useState<ExerciseKind>('weight');
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 1;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const id = await insertExercise(db, { name, muscle, secondary: [], equipment, kind });
      const exercise = await getExercise(db, id);
      haptics.success();
      if (exercise && isPickerTarget(params.target) && params.id) {
        await applyPick(db, params.target, Number(params.id), exercise);
        // Close this sheet and the picker under it.
        router.dismiss(2);
      } else {
        router.back();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppText variant="title2">Nuovo esercizio</AppText>
      <ListGroup>
        <FieldRow label="Nome" value={name} onChangeText={setName} placeholder="Es. Panca Technogym" autoCapitalize="sentences" autoFocus />
      </ListGroup>

      <SectionTitle>Muscolo e attrezzo</SectionTitle>
      <ListGroup>
        <View style={styles.row}>
          <AppText style={styles.flex}>Muscolo principale</AppText>
          <MenuButton
            icon="figure.arms.open"
            title={muscleLabel(muscle)}
            accessibilityLabel="Muscolo principale"
            groups={[{ actions: MUSCLES.map((m) => ({ label: m.label, icon: 'circle' as const, checked: m.key === muscle, onPress: () => setMuscle(m.key) })) }]}
          />
        </View>
        <View style={styles.row}>
          <AppText style={styles.flex}>Attrezzo</AppText>
          <MenuButton
            icon="dumbbell"
            title={equipmentLabel(equipment)}
            accessibilityLabel="Attrezzo"
            groups={[{ actions: EQUIPMENT.map((e) => ({ label: e.label, icon: 'circle' as const, checked: e.key === equipment, onPress: () => setEquipment(e.key) })) }]}
          />
        </View>
      </ListGroup>

      <SectionTitle>Come si misura</SectionTitle>
      <Segmented options={KINDS} value={kind} onChange={setKind} />
      <SectionFooter>
        {kind === 'weight'
          ? 'Chili e ripetizioni per ogni serie.'
          : kind === 'bodyweight'
            ? 'Ripetizioni, con l’eventuale zavorra in chili.'
            : 'Secondi di tenuta, come nel plank.'}
      </SectionFooter>

      <View style={styles.actions}>
        <Button title="Salva esercizio" onPress={() => void save()} disabled={!valid} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingLeft: Spacing.lg, paddingRight: Spacing.md },
  flex: { flex: 1 },
  actions: { paddingTop: Spacing.lg },
});
