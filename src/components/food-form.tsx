import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { getFood, insertFood, updateFood } from '@/db/foods';
import { labelScan, useLabelScan } from '@/hooks/use-label-scan';
import { useTheme } from '@/hooks/use-theme';
import {
  EMPTY_FOOD_FIELDS,
  fieldsFromFood,
  validateFoodFields,
  type FoodFields,
} from '@/lib/food-validation';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';
import type { LabelValues } from '@/lib/label-parser';
import type { Food } from '@/lib/nutrition';

import { AppText } from './app-text';
import { Button } from './button';
import { ActionRow, Card, ListGroup, SectionFooter, SectionTitle } from './card';
import { canReadLabels } from './label-scanner';
import { FieldRow, Segmented } from './form';
import { ScreenScroll } from './screen';

type FoodFormProps = {
  /** Edit this food; null creates a new one. */
  foodId: number | null;
  initialBarcode?: string | null;
  onSaved: (id: number, created: boolean) => void;
  /** Screen that photographs the nutrition label, in the same stack as the form. */
  labelRoute?: Href;
};

/** "359 kcal · P 13 · C 71 · G 2 g", only the values that were found. */
function scanSummary(v: LabelValues): string {
  return [
    v.kcal !== null ? `${formatKcal(v.kcal)} kcal` : null,
    v.protein !== null ? `P ${formatNumber(v.protein, 1)}` : null,
    v.carbs !== null ? `C ${formatNumber(v.carbs, 1)}` : null,
    v.fat !== null ? `G ${formatNumber(v.fat, 1)}` : null,
    v.salt !== null ? `sale ${formatNumber(v.salt, 2)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Form to create a food or correct one, with values per 100 g or 100 ml. */
export function FoodForm({ foodId, initialBarcode = null, onSaved, labelRoute }: FoodFormProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const scan = useLabelScan();
  // Results from before the form opened, or already used or dismissed, are not offered.
  const [handledScan, setHandledScan] = useState(() => labelScan.latestId());
  const pendingScan = scan && scan.id > handledScan ? scan : null;
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

  const applyScan = () => {
    if (!pendingScan) return;
    const v = pendingScan.values;
    const text = (value: number | null, decimals: number, fallback: string) =>
      value === null ? fallback : numberToInput(value, decimals);
    setFields((f) => ({
      ...f,
      unit: v.unit ?? f.unit,
      kcal: text(v.kcal, 0, f.kcal),
      protein: text(v.protein, 1, f.protein),
      carbs: text(v.carbs, 1, f.carbs),
      sugars: text(v.sugars, 1, f.sugars),
      fat: text(v.fat, 1, f.fat),
      satFat: text(v.satFat, 1, f.satFat),
      fiber: text(v.fiber, 1, f.fiber),
      salt: text(v.salt, 2, f.salt),
    }));
    setHandledScan(pendingScan.id);
  };

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
      {pendingScan ? (
        <Card style={[styles.scan, { backgroundColor: theme.accentSoft }]}>
          <AppText variant="headline">Valori letti dalla foto</AppText>
          <AppText variant="subhead" tone="textSecondary" numeric>
            {scanSummary(pendingScan.values)}
          </AppText>
          <View style={styles.scanActions}>
            <View style={styles.flex}>
              <Button title="Usa questi valori" onPress={applyScan} compact />
            </View>
            <View style={styles.flex}>
              <Button title="Ignora" variant="plain" onPress={() => setHandledScan(pendingScan.id)} compact />
            </View>
          </View>
          <AppText variant="footnote" tone="textSecondary">
            Verifica con l’etichetta.
          </AppText>
        </Card>
      ) : null}
      {canReadLabels && labelRoute ? (
        <View style={styles.scanLink}>
          <ListGroup>
            <ActionRow label="Leggi l’etichetta con la fotocamera" symbol="text.viewfinder" onPress={() => router.push(labelRoute)} />
          </ListGroup>
        </View>
      ) : null}
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
  flex: { flex: 1 },
  scan: { gap: Spacing.sm, marginBottom: Spacing.lg },
  scanActions: { flexDirection: 'row', gap: Spacing.sm },
  scanLink: { marginBottom: Spacing.lg },
  gap: { height: Spacing.md },
  errors: { gap: Spacing.xs, paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg },
  actions: { paddingTop: Spacing.xl },
});
