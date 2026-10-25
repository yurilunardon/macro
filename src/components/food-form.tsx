import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { getFood, insertFood, updateFood } from '@/db/foods';
import {
  EMPTY_FOOD_FIELDS,
  fieldsFromFood,
  validateFoodFields,
  type FoodFields,
} from '@/lib/food-validation';
import { formatKcal } from '@/lib/format';
import type { Food } from '@/lib/nutrition';

import { AppText } from './app-text';
import { Button } from './button';
import { ListGroup, SectionFooter, SectionTitle } from './card';
import { FieldRow, Segmented } from './form';
import { ScreenScroll } from './screen';

type FoodFormProps = {
  /** Edit this food; null creates a new one. */
  foodId: number | null;
  initialBarcode?: string | null;
  onSaved: (id: number, created: boolean) => void;
};

/** Form to create a food or correct one, with values per 100 g or 100 ml. */
export function FoodForm({ foodId, initialBarcode = null, onSaved }: FoodFormProps) {
  const db = useSQLiteContext();
  const [fields, setFields] = useState<FoodFields>({ ...EMPTY_FOOD_FIELDS, barcode: initialBarcode ?? '' });
  const [base, setBase] = useState<Food | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (foodId === null) return;
    let cancelled = false;
    void getFood(db, foodId).then((food) => {
      if (cancelled || !food) return;
      setBase(food);
      setFields(fieldsFromFood(food));
    });
    return () => {
      cancelled = true;
    };
  }, [db, foodId]);

  const set = (key: keyof FoodFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));
  const result = validateFoodFields(fields, base);
  const invalid = (key: keyof FoodFields) => showErrors && result.invalid.has(key);
  const unit = fields.unit;
  const messages = [...result.errors, ...(saveError ? [saveError] : [])];

  const save = async () => {
    setShowErrors(true);
    setSaveError(null);
    if (!result.draft) return;
    setSaving(true);
    try {
      if (foodId !== null) {
        await updateFood(db, foodId, result.draft);
        onSaved(foodId, false);
      } else {
        onSaved(await insertFood(db, result.draft), true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(
        message.includes('UNIQUE') ? 'Esiste già un alimento con questo codice a barre.' : 'Salvataggio non riuscito.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <ListGroup>
        <FieldRow
          label="Nome"
          value={fields.name}
          onChangeText={set('name')}
          placeholder="Obbligatorio"
          autoCapitalize="sentences"
          invalid={invalid('name')}
        />
        <FieldRow label="Marca" value={fields.brand} onChangeText={set('brand')} placeholder="Facoltativa" autoCapitalize="words" />
        <FieldRow
          label="Codice a barre"
          value={fields.barcode}
          onChangeText={set('barcode')}
          placeholder="Facoltativo"
          numeric
          invalid={invalid('barcode')}
        />
      </ListGroup>

      <SectionTitle>Misura</SectionTitle>
      <Segmented
        options={[
          { key: 'g', label: 'Grammi (g)' },
          { key: 'ml', label: 'Millilitri (ml)' },
        ]}
        value={fields.unit}
        onChange={(u) => setFields((f) => ({ ...f, unit: u }))}
      />
      <View style={styles.gap} />
      <ListGroup>
        <FieldRow
          label="Una porzione"
          value={fields.servingSize}
          onChangeText={set('servingSize')}
          placeholder="—"
          suffix={unit}
          numeric
          invalid={invalid('servingSize')}
        />
      </ListGroup>
      <SectionFooter>Facoltativa: ad esempio 125 g per un vasetto di yogurt.</SectionFooter>

      <SectionTitle>{`Valori per 100 ${unit}`}</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Energia"
          value={fields.kcal}
          onChangeText={set('kcal')}
          placeholder={result.estimatedKcal !== null ? formatKcal(result.estimatedKcal) : '—'}
          suffix="kcal"
          numeric
          invalid={invalid('kcal')}
        />
        <FieldRow label="Proteine" value={fields.protein} onChangeText={set('protein')} placeholder="0" suffix="g" numeric invalid={invalid('protein')} />
        <FieldRow label="Carboidrati" value={fields.carbs} onChangeText={set('carbs')} placeholder="0" suffix="g" numeric invalid={invalid('carbs')} />
        <FieldRow label="di cui zuccheri" value={fields.sugars} onChangeText={set('sugars')} placeholder="—" suffix="g" numeric invalid={invalid('sugars')} />
        <FieldRow label="Grassi" value={fields.fat} onChangeText={set('fat')} placeholder="0" suffix="g" numeric invalid={invalid('fat')} />
        <FieldRow label="di cui saturi" value={fields.satFat} onChangeText={set('satFat')} placeholder="—" suffix="g" numeric invalid={invalid('satFat')} />
        <FieldRow label="Fibre" value={fields.fiber} onChangeText={set('fiber')} placeholder="—" suffix="g" numeric invalid={invalid('fiber')} />
        <FieldRow label="Sale" value={fields.salt} onChangeText={set('salt')} placeholder="—" suffix="g" numeric invalid={invalid('salt')} />
      </ListGroup>
      <SectionFooter>
        {fields.kcal.trim() === '' && result.estimatedKcal !== null
          ? `Senza calorie le calcolo dai macro: ${formatKcal(result.estimatedKcal)} kcal.`
          : 'Copia i valori dalla tabella nutrizionale sulla confezione.'}
      </SectionFooter>

      {showErrors && messages.length > 0 ? (
        <View style={styles.errors}>
          {messages.map((e) => (
            <AppText key={e} variant="subhead" tone="danger">
              {e}
            </AppText>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title={foodId !== null ? 'Salva modifiche' : 'Salva alimento'} onPress={() => void save()} loading={saving} />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  gap: { height: Spacing.md },
  errors: { gap: Spacing.xs, paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg },
  actions: { paddingTop: Spacing.xl },
});
