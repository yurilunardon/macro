import { useNavigation } from 'expo-router';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import type { ParamListBase } from 'expo-router/react-navigation';

import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow, Segmented } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { addQuickEntry } from '@/db/entries';
import { useAddFlowParams, useCloseAddFlow } from '@/hooks/use-add-flow';
import { formatKcal } from '@/lib/format';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { EMPTY_QUICK_FIELDS, parseQuickAdd, QUICK_ADD_NAME, type QuickFields } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';

const MEAL_OPTIONS = MEALS.map((m) => ({ key: m.key, label: m.label }));

/** Logs calories (and optionally macros) without choosing a food: a restaurant meal, a guess. */
export default function QuickAddScreen() {
  const db = useSQLiteContext();
  const close = useCloseAddFlow();
  const { meal: initialMeal, date } = useAddFlowParams();
  const [meal, setMeal] = useState<MealKey>(initialMeal);
  const [fields, setFields] = useState<QuickFields>(EMPTY_QUICK_FIELDS);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  // The calories take the keyboard once the screen has slid in: focused while it was still
  // moving, iOS scrolled the page to the field and it opened shifted down.
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const kcalInput = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(
    () =>
      navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) kcalInput.current?.focus();
      }),
    [navigation],
  );

  const { result, invalid, estimatedKcal } = parseQuickAdd(fields);
  const set = (key: keyof QuickFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));
  const bad = (key: keyof QuickFields) => showErrors && invalid.has(key);

  const save = async () => {
    setShowErrors(true);
    if (!result) return;
    setSaving(true);
    try {
      await addQuickEntry(db, { date, meal, ...result });
      haptics.success();
      toast.show(`${formatKcal(result.totals.kcal)} kcal in ${mealLabel(meal)}`, 'plus.circle.fill');
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <ListGroup>
        <FieldRow label="Descrizione" value={fields.name} onChangeText={set('name')} placeholder={QUICK_ADD_NAME} autoCapitalize="sentences" />
        <FieldRow
          label="Calorie"
          value={fields.kcal}
          onChangeText={set('kcal')}
          placeholder={estimatedKcal !== null ? formatKcal(estimatedKcal) : 'Obbligatorie'}
          suffix="kcal"
          numeric
          ref={kcalInput}
          invalid={bad('kcal')}
        />
      </ListGroup>

      <SectionTitle>Macro (facoltativi)</SectionTitle>
      <ListGroup>
        <FieldRow label="Proteine" value={fields.protein} onChangeText={set('protein')} placeholder="0" suffix="g" numeric invalid={bad('protein')} />
        <FieldRow label="Carboidrati" value={fields.carbs} onChangeText={set('carbs')} placeholder="0" suffix="g" numeric invalid={bad('carbs')} />
        <FieldRow label="Grassi" value={fields.fat} onChangeText={set('fat')} placeholder="0" suffix="g" numeric invalid={bad('fat')} />
      </ListGroup>
      <SectionFooter>
        {fields.kcal.trim() === '' && estimatedKcal !== null
          ? `Senza calorie le calcolo dai macro: ${formatKcal(estimatedKcal)} kcal.`
          : 'Per un pasto fuori casa o quando conosci solo le calorie.'}
      </SectionFooter>

      <SectionTitle>Pasto</SectionTitle>
      <Segmented options={MEAL_OPTIONS} value={meal} onChange={setMeal} />

      <View style={styles.actions}>
        <Button title={`Aggiungi a ${mealLabel(meal).toLowerCase()}`} onPress={() => void save()} loading={saving} />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  actions: { paddingTop: Spacing.xl },
});
