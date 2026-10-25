import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Chip, FieldRow, Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MACROS, NutrientTable } from '@/components/nutrition';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { addEntry } from '@/db/entries';
import { getFood, getFoodByBarcode, getLastQuantity, saveOffFood, setFavorite } from '@/db/foods';
import { useLiveQuery } from '@/db/live';
import { useAddFlowParams, useCloseAddFlow } from '@/hooks/use-add-flow';
import { useTheme } from '@/hooks/use-theme';
import type { DateKey } from '@/lib/dates';
import { formatGrams, formatKcal, formatNumber, numberToInput, parseDecimal, servingPresetLabel } from '@/lib/format';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { scaleNutrients } from '@/lib/nutrition';
import { barcodeCandidates, fetchProductByBarcode, OffNetworkError } from '@/lib/off';

type Resolution =
  | { kind: 'loading' }
  | { kind: 'food'; id: number }
  | { kind: 'missing'; barcode: string; incomplete: boolean }
  | { kind: 'error'; barcode: string | null; message: string };

const MEAL_OPTIONS = MEALS.map((m) => ({ key: m.key, label: m.label }));

const SOURCE_NOTES = {
  off: 'Dati da Open Food Facts (licenza ODbL), inseriti da volontari: controlla che corrispondano all’etichetta.',
  custom: 'Alimento creato da te.',
  generic:
    'Valori medi da USDA FoodData Central (pubblico dominio). Le porzioni sono indicative: per essere precisi, pesa.',
} as const;

export default function FoodScreen() {
  const db = useSQLiteContext();
  const { meal, date, foodId, barcode } = useAddFlowParams();
  const [resolution, setResolution] = useState<Resolution>(
    foodId !== null
      ? { kind: 'food', id: foodId }
      : barcode !== null
        ? { kind: 'loading' }
        : { kind: 'error', barcode: null, message: 'Alimento non trovato.' },
  );
  const [attempt, setAttempt] = useState(0);

  // A scanned code: use the copy on the phone if there is one, otherwise ask Open Food Facts.
  useEffect(() => {
    if (foodId !== null || barcode === null) return;
    const controller = new AbortController();
    const resolve = async () => {
      try {
        for (const code of barcodeCandidates(barcode)) {
          const local = await getFoodByBarcode(db, code);
          if (local) {
            setResolution({ kind: 'food', id: local.id });
            return;
          }
        }
        const result = await fetchProductByBarcode(barcode, controller.signal);
        if (controller.signal.aborted) return;
        if (result.kind === 'found') {
          const food = await saveOffFood(db, result.food);
          setResolution({ kind: 'food', id: food.id });
        } else {
          setResolution({ kind: 'missing', barcode, incomplete: result.kind === 'incomplete' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setResolution({
          kind: 'error',
          barcode,
          message: error instanceof OffNetworkError ? `${error.message}.` : 'Qualcosa è andato storto.',
        });
      }
    };
    void resolve();
    return () => controller.abort();
  }, [db, foodId, barcode, attempt]);

  if (resolution.kind === 'food') return <FoodDetail id={resolution.id} initialMeal={meal} date={date} />;
  if (resolution.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <AppText tone="textSecondary">Cerco il prodotto…</AppText>
      </View>
    );
  }
  return (
    <Missing
      resolution={resolution}
      meal={meal}
      date={date}
      onRetry={() => {
        setResolution({ kind: 'loading' });
        setAttempt((a) => a + 1);
      }}
    />
  );
}

function Missing({
  resolution,
  meal,
  date,
  onRetry,
}: {
  resolution: Extract<Resolution, { kind: 'missing' | 'error' }>;
  meal: MealKey;
  date: DateKey;
  onRetry: () => void;
}) {
  const router = useRouter();
  const code = resolution.barcode;
  const create = () =>
    router.replace({ pathname: '/add/custom', params: { meal, date, ...(code ? { barcode: code } : {}) } });

  const title =
    resolution.kind === 'error'
      ? 'Ricerca non riuscita'
      : resolution.incomplete
        ? 'Mancano i valori nutrizionali'
        : 'Prodotto non trovato';
  const message =
    resolution.kind === 'error'
      ? `${resolution.message} Controlla la connessione e riprova, oppure inserisci i valori a mano.`
      : resolution.incomplete
        ? `Il prodotto ${code} è su Open Food Facts ma senza tabella nutrizionale. Copia i valori dall’etichetta: lo salvo sul telefono e la prossima volta lo trovi subito.`
        : `Il codice ${code} non è su Open Food Facts. Copia i valori dall’etichetta: lo salvo sul telefono e la prossima volta lo trovi subito.`;

  return (
    <ScrollView contentContainerStyle={styles.missing} contentInsetAdjustmentBehavior="automatic">
      <Icon name={resolution.kind === 'error' ? 'wifi.exclamationmark' : 'barcode'} size={44} tone="textSecondary" />
      <AppText variant="title2" align="center">
        {title}
      </AppText>
      <AppText tone="textSecondary" align="center">
        {message}
      </AppText>
      <View style={styles.missingActions}>
        {resolution.kind === 'error' && code ? <Button title="Riprova" onPress={onRetry} /> : null}
        <Button title="Crea alimento" variant={resolution.kind === 'error' ? 'tinted' : 'filled'} onPress={create} />
        <Button
          title="Scansiona di nuovo"
          variant="plain"
          onPress={() => router.replace({ pathname: '/add/scan', params: { meal, date } })}
        />
      </View>
    </ScrollView>
  );
}

function FoodDetail({ id, initialMeal, date }: { id: number; initialMeal: MealKey; date: DateKey }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const close = useCloseAddFlow();
  const [meal, setMeal] = useState<MealKey>(initialMeal);
  // null until the user types, so the default can follow the data once it loads.
  const [quantityText, setQuantityText] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, loading } = useLiveQuery(`food:${id}`, async (database) => {
    const [food, lastQuantity] = await Promise.all([getFood(database, id), getLastQuantity(database, id)]);
    return { food, lastQuantity };
  });

  if (!data) {
    return <View style={styles.center}>{loading ? <ActivityIndicator /> : null}</View>;
  }
  const food = data.food;
  if (!food) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Questo alimento è stato eliminato.</AppText>
      </View>
    );
  }

  const unit = food.unit;
  const defaultQuantity = data.lastQuantity ?? food.servingSize ?? 100;
  const text = quantityText ?? numberToInput(defaultQuantity);
  const parsed = parseDecimal(text);
  const quantity = parsed !== null && parsed > 0 && parsed <= 5000 ? parsed : null;
  const portion = scaleNutrients(food.per100, quantity ?? 0);

  const presets = [
    ...(food.servingSize
      ? [{ label: servingPresetLabel(food.servingSize, food.servingLabel, unit), value: food.servingSize }]
      : []),
    ...(unit === 'ml' ? [100, 200, 250, 330, 500] : [30, 50, 100, 150, 200]).map((v) => ({ label: `${v} ${unit}`, value: v })),
  ];

  const add = async () => {
    if (quantity === null) return;
    setAdding(true);
    try {
      await addEntry(db, { date, meal, food, quantity });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      close();
    } finally {
      setAdding(false);
    }
  };

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                void setFavorite(db, food.id, !food.favorite);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={food.favorite ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}
              accessibilityState={{ selected: food.favorite }}>
              <Icon name={food.favorite ? 'star.fill' : 'star'} size={22} tone={food.favorite ? 'warning' : 'accent'} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.header}>
        {food.imageUrl ? (
          <Image source={food.imageUrl} style={[styles.image, { backgroundColor: theme.track }]} contentFit="cover" />
        ) : null}
        <View style={styles.flex}>
          <AppText variant="title2">{food.name}</AppText>
          {food.brand ? (
            <AppText variant="subhead" tone="textSecondary">
              {food.brand}
            </AppText>
          ) : null}
        </View>
      </View>

      <Card style={styles.preview}>
        <View accessible accessibilityLabel={`${formatKcal(portion.kcal)} chilocalorie`}>
          <AppText variant="display" numeric>
            {formatKcal(portion.kcal)}
          </AppText>
          <AppText variant="footnote" tone="textSecondary">
            {quantity !== null ? `kcal per ${formatNumber(quantity, 1)} ${unit}` : 'Inserisci una quantità'}
          </AppText>
        </View>
        <View style={styles.previewMacros}>
          {MACROS.map((m) => (
            <View key={m.key} style={styles.previewMacro}>
              <AppText variant="headline" numeric style={{ color: theme[m.key] }}>
                {formatGrams(portion[m.key])}
              </AppText>
              <AppText variant="caption" tone="textSecondary">
                {m.label}
              </AppText>
            </View>
          ))}
        </View>
      </Card>

      <SectionTitle>Quantità</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Quantità"
          value={text}
          onChangeText={setQuantityText}
          suffix={unit}
          numeric
          selectTextOnFocus
          invalid={quantity === null}
        />
      </ListGroup>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {presets.map((p) => (
          <Chip
            key={p.label}
            label={p.label}
            selected={quantity === p.value}
            onPress={() => setQuantityText(numberToInput(p.value))}
          />
        ))}
      </ScrollView>

      <SectionTitle>Pasto</SectionTitle>
      <Segmented options={MEAL_OPTIONS} value={meal} onChange={setMeal} />

      <View style={styles.addButton}>
        <Button
          title={`Aggiungi a ${mealLabel(meal).toLowerCase()}`}
          onPress={() => void add()}
          disabled={quantity === null}
          loading={adding}
        />
      </View>

      <SectionTitle>Tabella nutrizionale</SectionTitle>
      <NutrientTable per100={food.per100} quantity={quantity} unit={unit} />
      <SectionFooter>
        {SOURCE_NOTES[food.source]}
      </SectionFooter>
      <Pressable
        onPress={() => router.push({ pathname: '/add/custom', params: { foodId: food.id } })}
        accessibilityRole="button"
        style={styles.link}>
        <AppText tone="accent" weight="600">
          Correggi i valori
        </AppText>
      </Pressable>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  missing: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  missingActions: { alignSelf: 'stretch', gap: Spacing.sm, paddingTop: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  image: { width: 64, height: 64, borderRadius: Radius.md, borderCurve: 'continuous' },
  preview: { gap: Spacing.lg },
  previewMacros: { flexDirection: 'row', gap: Spacing.md },
  previewMacro: { flex: 1 },
  chips: { gap: Spacing.sm, paddingTop: Spacing.md, paddingRight: Spacing.lg },
  addButton: { paddingTop: Spacing.xl },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
