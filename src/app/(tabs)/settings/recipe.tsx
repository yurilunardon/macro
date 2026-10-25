import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { MacroInline } from '@/components/nutrition';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { deleteRecipe, getRecipe, saveRecipe } from '@/db/recipes';
import { recipeDraft, useRecipeDraft } from '@/hooks/use-recipe-draft';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal, formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import { scaleNutrients, type Nutrients } from '@/lib/nutrition';
import { computeRecipe, parseRecipeFields } from '@/lib/recipes';
import { haptics } from '@/services/haptics';

/**
 * Create or edit a recipe. Open it after `recipeDraft.start()` for a new recipe, or with an `id`
 * to edit one. Ingredients are picked in the "add food" modal, which writes to the same draft.
 */
export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const parsedId = id ? Number(id) : NaN;
  const recipeId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
  const db = useSQLiteContext();
  const draft = useRecipeDraft();
  const [loadedId, setLoadedId] = useState<number | null>(null);

  useEffect(() => {
    if (recipeId === null) return;
    let cancelled = false;
    void getRecipe(db, recipeId).then((recipe) => {
      if (cancelled || !recipe) return;
      recipeDraft.start({
        id: recipeId,
        name: recipe.food.name,
        cookedWeight: numberToInput(recipe.cookedWeight, 0),
        servings: numberToInput(recipe.servings, 0),
        ingredients: recipe.ingredients,
      });
      setLoadedId(recipeId);
    });
    return () => {
      cancelled = true;
    };
  }, [db, recipeId]);

  if (recipeId !== null && (loadedId !== recipeId || draft.id !== recipeId)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return <RecipeEditor />;
}

function RecipeEditor() {
  const db = useSQLiteContext();
  const router = useRouter();
  const draft = useRecipeDraft();
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const { values, invalid } = parseRecipeFields(draft, draft.ingredients.length);
  const cooked = parseDecimal(draft.cookedWeight);
  const servings = parseDecimal(draft.servings);
  const result = computeRecipe(
    draft.ingredients,
    cooked !== null && cooked > 0 ? cooked : null,
    servings !== null && servings > 0 ? servings : null,
  );
  const bad = (key: 'name' | 'cookedWeight' | 'servings') => showErrors && invalid.has(key);

  const editQuantity = (index: number) => {
    const ing = draft.ingredients[index];
    promptNumber({
      title: ing.name,
      message: `Quantità in ${ing.unit}.`,
      defaultValue: numberToInput(ing.quantity),
      min: 0.1,
      max: 20_000,
      onSubmit: (quantity) => recipeDraft.setQuantity(index, quantity),
    });
  };

  const save = async () => {
    setShowErrors(true);
    if (!values) return;
    setSaving(true);
    try {
      await saveRecipe(db, { id: draft.id, ...values, ingredients: draft.ingredients });
      haptics.success();
      router.back();
    } catch {
      Alert.alert('Salvataggio non riuscito', 'Riprova tra un momento.');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    const id = draft.id;
    if (id === null) return;
    Alert.alert('Eliminare la ricetta?', 'Le voci già nel diario restano invariate.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          await deleteRecipe(db, id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: draft.id === null ? 'Nuova ricetta' : 'Modifica ricetta' }} />

      <ListGroup>
        <FieldRow
          label="Nome"
          value={draft.name}
          onChangeText={(name) => recipeDraft.set({ name })}
          placeholder="Es. pollo e riso"
          autoCapitalize="sentences"
          invalid={bad('name')}
        />
        <FieldRow
          label="Peso finale cotto"
          value={draft.cookedWeight}
          onChangeText={(cookedWeight) => recipeDraft.set({ cookedWeight })}
          placeholder={result ? formatNumber(result.rawWeight, 0) : '—'}
          suffix="g"
          numeric
          invalid={bad('cookedWeight')}
        />
        <FieldRow
          label="Porzioni"
          value={draft.servings}
          onChangeText={(servingsText) => recipeDraft.set({ servings: servingsText })}
          placeholder="—"
          numeric
          invalid={bad('servings')}
        />
      </ListGroup>
      <SectionFooter>
        Pesa il piatto finito: la cottura cambia il peso, la pasta assorbe acqua e la carne la perde. Se lo lasci vuoto
        uso la somma degli ingredienti crudi.
      </SectionFooter>

      <SectionTitle>Ingredienti</SectionTitle>
      <ListGroup>
        {draft.ingredients.map((ing, index) => (
          <SwipeToDelete key={ing.uid} onDelete={() => recipeDraft.removeIngredient(index)}>
            <IngredientRow
              name={ing.name}
              detail={[`${formatNumber(ing.quantity, 1)} ${ing.unit}`, ing.brand].filter(Boolean).join(' · ')}
              totals={scaleNutrients(ing.per100, ing.quantity)}
              onPress={() => editQuantity(index)}
              onLongPress={() =>
                Alert.alert(ing.name, 'Toglierlo dalla ricetta?', [
                  { text: 'Annulla', style: 'cancel' },
                  { text: 'Togli', style: 'destructive', onPress: () => recipeDraft.removeIngredient(index) },
                ])
              }
            />
          </SwipeToDelete>
        ))}
        <ActionRow
          label="Aggiungi ingrediente"
          onPress={() => router.push({ pathname: '/add', params: { mode: 'ingredient' } })}
        />
      </ListGroup>
      <SectionFooter>
        {draft.ingredients.length > 0
          ? 'Tocca un ingrediente per cambiare la quantità, scorri a sinistra per toglierlo.'
          : 'Aggiungi gli ingredienti con il loro peso crudo.'}
      </SectionFooter>
      {showErrors && invalid.has('ingredients') ? (
        <AppText variant="subhead" tone="danger" style={styles.error}>
          Aggiungi almeno un ingrediente.
        </AppText>
      ) : null}

      {result ? (
        <>
          <SectionTitle>Valori</SectionTitle>
          <Card style={styles.summary}>
            <SummaryLine label="Tutta la ricetta" detail={`${formatNumber(result.weight, 0)} g`} totals={result.totals} />
            <SummaryLine label="Per 100 g" totals={result.per100} />
            {result.servingSize ? (
              <SummaryLine
                label="Per porzione"
                detail={`${formatNumber(result.servingSize, 0)} g`}
                totals={scaleNutrients(result.per100, result.servingSize)}
              />
            ) : null}
          </Card>
        </>
      ) : null}

      <View style={styles.actions}>
        <Button title="Salva ricetta" onPress={() => void save()} loading={saving} />
        {draft.id !== null ? <Button title="Elimina ricetta" variant="destructive" onPress={remove} /> : null}
      </View>
    </ScreenScroll>
  );
}

function IngredientRow({
  name,
  detail,
  totals,
  onPress,
  onLongPress,
}: {
  name: string;
  detail: string;
  totals: Nutrients;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityHint="Tocca per cambiare la quantità, tieni premuto per toglierlo"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <View style={styles.flex}>
        <AppText numberOfLines={1}>{name}</AppText>
        <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <AppText variant="callout" weight="600" numeric>
        {formatKcal(totals.kcal)}
      </AppText>
    </Pressable>
  );
}

function SummaryLine({ label, detail, totals }: { label: string; detail?: string; totals: Nutrients }) {
  return (
    <View style={styles.summaryLine}>
      <View style={styles.summaryTop}>
        <AppText weight="600" style={styles.flex}>
          {detail ? `${label} · ${detail}` : label}
        </AppText>
        <AppText weight="600" numeric>
          {`${formatKcal(totals.kcal)} kcal`}
        </AppText>
      </View>
      <MacroInline totals={totals} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  error: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  summary: { gap: Spacing.md },
  summaryLine: { gap: 2 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actions: { gap: Spacing.sm, paddingTop: Spacing.xl },
});
