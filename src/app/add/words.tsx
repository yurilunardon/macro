/**
 * Food in words: the ingredients of a recipe pasted from a message, or a meal described. The
 * coach reads them into foods of the app; the user unticks what was not there, fixes the grams
 * and adds them to the recipe or to the meal.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter } from '@/components/card';
import { KeyForm } from '@/components/coach-chat';
import { Icon } from '@/components/icon';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { Radius, Spacing } from '@/constants/theme';
import { addEntry } from '@/db/entries';
import { resolveWords } from '@/db/food-words';
import { useAddFlowParams, useCloseAddFlow } from '@/hooks/use-add-flow';
import { recipeDraft } from '@/hooks/use-recipe-draft';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';
import type { WordsKind } from '@/lib/food-words';
import { mealLabel } from '@/lib/meals';
import { coachFailure, useCoachKey } from '@/services/coach';
import { readWords, type ReadItem } from '@/services/food-words';
import { haptics } from '@/services/haptics';

type State =
  | { phase: 'write' }
  | { phase: 'reading' }
  | { phase: 'error'; message: string }
  | { phase: 'review'; title: string; items: (ReadItem & { on: boolean })[] };

export default function WordsScreen() {
  const { key } = useCoachKey();
  return key ? <Words /> : <KeyForm />;
}

function Words() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const close = useCloseAddFlow();
  const { meal, date, mode } = useAddFlowParams();
  const kind: WordsKind = mode === 'ingredient' ? 'recipe' : 'meal';
  const given = useLocalSearchParams<{ text?: string }>().text?.trim() ?? '';
  const [text, setText] = useState(given);
  const [state, setState] = useState<State>(given ? { phase: 'reading' } : { phase: 'write' });
  const [adding, setAdding] = useState(false);

  const read = (words: string) => {
    if (!words.trim()) return;
    setState({ phase: 'reading' });
    readWords(db, kind, words)
      .then((result) => {
        haptics.success();
        setState({ phase: 'review', title: result.title, items: result.items.map((i) => ({ ...i, on: !i.optional })) });
      })
      .catch((e: unknown) => {
        haptics.error();
        setState({ phase: 'error', message: coachFailure(e) });
      });
  };

  // A meal typed in the search is read at once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !given) return;
    started.current = true;
    read(given);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = kind === 'recipe' ? 'Incolla la ricetta' : 'Componi il pasto';

  if (state.phase === 'reading') {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator />
        <AppText tone="textSecondary" align="center">
          {kind === 'recipe' ? 'Il coach sta leggendo la ricetta…' : 'Il coach sta componendo il pasto…'}
        </AppText>
      </View>
    );
  }

  if (state.phase === 'review') {
    const chosen = state.items.filter((i) => i.on);
    const kcal = chosen.reduce((sum, i) => sum + (i.per100.kcal * i.amount) / 100, 0);
    const setItem = (index: number, change: Partial<ReadItem & { on: boolean }>) =>
      setState({ ...state, items: state.items.map((i, k) => (k === index ? { ...i, ...change } : i)) });

    const add = async () => {
      if (chosen.length === 0) return;
      setAdding(true);
      try {
        const foods = await resolveWords(db, chosen);
        if (kind === 'recipe') {
          for (const { food, amount } of foods) {
            recipeDraft.addIngredient({ foodId: food.id, name: food.name, brand: food.brand, unit: food.unit, quantity: amount, per100: food.per100 });
          }
          const draft = recipeDraft.get();
          if (!draft.name.trim()) recipeDraft.set({ name: state.title });
          toast.show(foods.length === 1 ? '1 ingrediente aggiunto' : `${foods.length} ingredienti aggiunti`, 'frying.pan.fill');
        } else {
          for (const { food, amount } of foods) await addEntry(db, { date, meal, food, quantity: amount });
          toast.show(`${formatKcal(kcal)} kcal in ${mealLabel(meal)}`, 'plus.circle.fill');
        }
        haptics.success();
        close();
      } catch {
        haptics.error();
        toast.show('Non è stato possibile aggiungere', 'exclamationmark.triangle.fill');
      } finally {
        setAdding(false);
      }
    };

    return (
      <ScreenScroll>
        <Stack.Screen options={{ title: state.title }} />
        <ListGroup>
          {state.items.map((item, index) => (
            <ItemRow
              key={index}
              item={item}
              onToggle={() => {
                haptics.selection();
                setItem(index, { on: !item.on });
              }}
              onPress={() =>
                promptNumber({
                  title: item.name,
                  message: `Quantità in ${item.unit}.`,
                  defaultValue: numberToInput(item.amount),
                  min: 0.1,
                  max: 5000,
                  onSubmit: (amount) => setItem(index, { amount, guessed: false, why: null, on: true }),
                })
              }
            />
          ))}
        </ListGroup>
        <SectionFooter>
          {kind === 'recipe'
            ? 'In arancione quello che il coach ha dovuto indovinare. Tocca una riga per cambiare i grammi, il cerchio per toglierla. Se un alimento è sbagliato, toglilo e aggiungi quello giusto dalla ricetta.'
            : 'Le porzioni in arancione sono quelle tipiche. Tocca una riga per cambiare i grammi, il cerchio per toglierla.'}
        </SectionFooter>
        <View style={styles.actions}>
          <Button
            title={
              kind === 'recipe'
                ? chosen.length === 1
                  ? 'Aggiungi 1 ingrediente'
                  : `Aggiungi ${chosen.length} ingredienti`
                : `Aggiungi a ${mealLabel(meal)} · ${formatKcal(kcal)} kcal`
            }
            onPress={() => void add()}
            loading={adding}
            disabled={chosen.length === 0}
          />
          <Button title="Riscrivi" variant="plain" onPress={() => setState({ phase: 'write' })} />
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        autoFocus={!given}
        placeholder={
          kind === 'recipe'
            ? 'Incolla qui il messaggio con gli ingredienti. Es. mezzo chilo di pasta, 300 di macinato, una bottiglia di passata…'
            : 'Cosa hai mangiato? Es. cornetto e cappuccino al bar'
        }
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { backgroundColor: theme.card, color: theme.text }]}
        accessibilityLabel={kind === 'recipe' ? 'Ingredienti della ricetta' : 'Cosa hai mangiato'}
      />
      <SectionFooter>
        {state.phase === 'error'
          ? `${state.message}.`
          : kind === 'recipe'
            ? 'Così com’è: quantità a parole, «q.b.», ingredienti dimenticati. Il coach li traduce in grammi e li cerca tra gli alimenti dell’app.'
            : 'Il coach lo scompone in alimenti con le porzioni tipiche; prima di aggiungerli li controlli.'}
      </SectionFooter>
      <View style={styles.actions}>
        <Button
          title={state.phase === 'error' ? 'Riprova' : kind === 'recipe' ? 'Leggi la ricetta' : 'Componi il pasto'}
          icon={<Icon name="sparkles" size={17} color={theme.onAccent} />}
          onPress={() => read(text)}
          disabled={!text.trim()}
        />
      </View>
    </ScreenScroll>
  );
}

function ItemRow({ item, onToggle, onPress }: { item: ReadItem & { on: boolean }; onToggle: () => void; onPress: () => void }) {
  const theme = useTheme();
  const kcal = (item.per100.kcal * item.amount) / 100;
  const notes = [item.guessed ? (item.why ?? 'stimato') : null, item.food.kind === 'new' ? 'valori stimati' : null].filter(Boolean);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Tocca per cambiare la quantità"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.on }}
        accessibilityLabel={item.on ? `Togli ${item.name}` : `Rimetti ${item.name}`}>
        <Icon name={item.on ? 'checkmark.circle.fill' : 'circle'} size={24} tone={item.on ? 'accent' : 'textTertiary'} />
      </Pressable>
      <View style={styles.flex}>
        <AppText numberOfLines={2} tone={item.on ? 'text' : 'textTertiary'}>
          {item.name}
        </AppText>
        <AppText variant="footnote" tone="textSecondary" numberOfLines={2}>
          {`${formatNumber(item.amount, 1)} ${item.unit}`}
          {notes.length > 0 ? (
            <AppText variant="footnote" tone="warning">{` · ${notes.join(' · ')}`}</AppText>
          ) : null}
        </AppText>
      </View>
      <AppText variant="callout" weight="600" numeric tone={item.on ? 'text' : 'textTertiary'}>
        {formatKcal(kcal)}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  input: { minHeight: 150, borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.lg, paddingTop: Spacing.md, fontSize: 17, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minHeight: 56 },
  actions: { gap: Spacing.sm, marginTop: Spacing.lg },
});
