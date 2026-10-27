import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionTitle } from '@/components/card';
import { Chip, FieldRow } from '@/components/form';
import { MenuButton } from '@/components/menu-button';
import { MACROS } from '@/components/nutrition';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { deleteEntry, getEntry, moveEntry, updateEntry, updateQuickEntry, type Entry } from '@/db/entries';
import { getFood } from '@/db/foods';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { formatGrams, formatKcal, formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { rescaleNutrients, type Nutrients } from '@/lib/nutrition';
import { parseQuickAdd, QUICK_ADD_NAME, type QuickFields } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';
import { deleteWithUndo } from '@/services/undo';

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);
  const theme = useTheme();

  const { data } = useLiveQuery(`entry:${entryId}`, async (database) => {
    const entry = await getEntry(database, entryId);
    const food = entry?.foodId ? await getFood(database, entry.foodId) : null;
    return { entry, servingSize: food?.servingSize ?? null };
  }, ['food']);

  if (!data || !data.entry) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {data ? <AppText tone="textSecondary">Questa voce non esiste più.</AppText> : <ActivityIndicator />}
      </View>
    );
  }
  // Keyed by id so each editor starts from the saved values once and then keeps what is typed.
  return data.entry.quick ? (
    <QuickEditor key={data.entry.id} entry={data.entry} />
  ) : (
    <QuantityEditor key={data.entry.id} entry={data.entry} servingSize={data.servingSize} />
  );
}

function QuantityEditor({ entry, servingSize }: { entry: Entry; servingSize: number | null }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const [text, setText] = useState(numberToInput(entry.quantity));
  const [saving, setSaving] = useState(false);

  const parsed = parseDecimal(text);
  const quantity = parsed !== null && parsed > 0 && parsed <= 5000 ? parsed : null;
  const preview = rescaleNutrients(entry.totals, entry.quantity, quantity ?? entry.quantity);
  const presets = [
    ...(servingSize ? [servingSize] : []),
    ...[0.5, 2].map((f) => Math.round(entry.quantity * f * 10) / 10),
  ].filter((v, i, all) => v > 0 && all.indexOf(v) === i && v !== entry.quantity);

  const save = async () => {
    if (quantity === null) return;
    setSaving(true);
    try {
      await updateEntry(db, entry, { quantity, meal: entry.meal });
      haptics.success();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntryLayout entry={entry} preview={preview} onSave={() => void save()} canSave={quantity !== null} saving={saving}>
      <SectionTitle>Quantità</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Quantità"
          value={text}
          onChangeText={setText}
          suffix={entry.unit}
          numeric
          selectTextOnFocus
          invalid={quantity === null}
        />
      </ListGroup>
      {presets.length > 0 ? (
        <View style={styles.chips}>
          {presets.map((v) => (
            <Chip
              key={v}
              label={`${formatNumber(v, 1)} ${entry.unit}`}
              selected={quantity === v}
              onPress={() => setText(numberToInput(v))}
            />
          ))}
        </View>
      ) : null}

    </EntryLayout>
  );
}

function QuickEditor({ entry }: { entry: Entry }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const [fields, setFields] = useState<QuickFields>({
    name: entry.name === QUICK_ADD_NAME ? '' : entry.name,
    kcal: numberToInput(entry.totals.kcal, 0),
    protein: entry.totals.protein > 0 ? numberToInput(entry.totals.protein) : '',
    carbs: entry.totals.carbs > 0 ? numberToInput(entry.totals.carbs) : '',
    fat: entry.totals.fat > 0 ? numberToInput(entry.totals.fat) : '',
  });
  const [saving, setSaving] = useState(false);

  const { result, invalid, estimatedKcal } = parseQuickAdd(fields);
  const set = (key: keyof QuickFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await updateQuickEntry(db, entry.id, { meal: entry.meal, ...result });
      haptics.success();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntryLayout
      entry={entry}
      preview={result?.totals ?? entry.totals}
      onSave={() => void save()}
      canSave={result !== null}
      saving={saving}>
      <SectionTitle>Aggiunta rapida</SectionTitle>
      <ListGroup>
        <FieldRow label="Descrizione" value={fields.name} onChangeText={set('name')} placeholder={QUICK_ADD_NAME} autoCapitalize="sentences" />
        <FieldRow
          label="Calorie"
          value={fields.kcal}
          onChangeText={set('kcal')}
          placeholder={estimatedKcal !== null ? formatKcal(estimatedKcal) : '—'}
          suffix="kcal"
          numeric
          invalid={invalid.has('kcal')}
        />
        <FieldRow label="Proteine" value={fields.protein} onChangeText={set('protein')} placeholder="0" suffix="g" numeric invalid={invalid.has('protein')} />
        <FieldRow label="Carboidrati" value={fields.carbs} onChangeText={set('carbs')} placeholder="0" suffix="g" numeric invalid={invalid.has('carbs')} />
        <FieldRow label="Grassi" value={fields.fat} onChangeText={set('fat')} placeholder="0" suffix="g" numeric invalid={invalid.has('fat')} />
      </ListGroup>

    </EntryLayout>
  );
}

/** Title, live preview of kcal and macros, the editor's fields, then Save and Delete. */
function EntryLayout({
  entry,
  preview,
  children,
  onSave,
  canSave,
  saving,
}: {
  entry: Entry;
  preview: Nutrients;
  children: ReactNode;
  onSave: () => void;
  canSave: boolean;
  saving: boolean;
}) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const currentMeal = MEALS.find((m) => m.key === entry.meal) ?? MEALS[0];
  const moveTo = async (meal: MealKey) => {
    if (meal === entry.meal) return;
    await moveEntry(db, entry.id, meal);
    haptics.success();
    toast.show(`Spostato in ${mealLabel(meal)}`, 'arrow.up.arrow.down');
  };

  // As from the diary: back to it, where the entry is gone with "Annulla".
  const remove = () => {
    router.back();
    deleteWithUndo({ key: `entry:${entry.id}`, title: `${entry.name} eliminato`, run: () => deleteEntry(db, entry.id) });
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled">
      <View style={styles.title}>
        <AppText variant="title2">{entry.name}</AppText>
        {entry.brand ? (
          <AppText variant="subhead" tone="textSecondary">
            {entry.brand}
          </AppText>
        ) : null}
      </View>

      <Card style={styles.preview}>
        <AppText variant="display" numeric align="center">
          {formatKcal(preview.kcal)}
          <AppText variant="headline" tone="textSecondary">
            {' kcal'}
          </AppText>
        </AppText>
        {/* Three equal columns, centred and divided, so the three values line up evenly. */}
        <View style={styles.macros}>
          {MACROS.map((m, index) => (
            <View key={m.key} style={[styles.macro, index > 0 && { borderLeftColor: theme.separator, borderLeftWidth: StyleSheet.hairlineWidth }]}>
              <AppText variant="headline" numeric align="center" style={{ color: theme[m.key] }}>
                {formatGrams(preview[m.key])}
              </AppText>
              <AppText variant="caption" tone="textSecondary" align="center">
                {m.label}
              </AppText>
            </View>
          ))}
        </View>
      </Card>

      {/* Moving to another meal happens right away, as a choice of its own, not on Save. */}
      <ListGroup>
        <View style={styles.mealRow}>
          <AppText style={styles.flex}>Pasto</AppText>
          <MenuButton
            icon={currentMeal.symbol}
            title={currentMeal.label}
            accessibilityLabel="Sposta in un altro pasto"
            groups={[
              {
                title: 'Sposta in',
                actions: MEALS.map((m) => ({
                  label: m.label,
                  icon: m.symbol,
                  checked: m.key === entry.meal,
                  onPress: () => void moveTo(m.key),
                })),
              },
            ]}
          />
        </View>
      </ListGroup>

      {children}

      <View style={styles.actions}>
        <Button title="Salva" onPress={onSave} disabled={!canSave} loading={saving} />
        <Button title="Elimina dal diario" variant="destructive" onPress={remove} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl },
  title: { marginBottom: Spacing.lg, gap: 2 },
  preview: { gap: Spacing.lg, marginBottom: Spacing.lg },
  macros: { flexDirection: 'row' },
  macro: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  mealRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.lg, paddingRight: Spacing.md, minHeight: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingTop: Spacing.md },
  actions: { gap: Spacing.sm, paddingTop: Spacing.xl },
});
