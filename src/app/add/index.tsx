import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, SectionTitle } from '@/components/card';
import { FoodRow } from '@/components/food-row';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { toast } from '@/components/toast';
import { Radius, Spacing } from '@/constants/theme';
import {
  getCustomFoods,
  getFavoriteFoods,
  getGenericFoods,
  getRecentFoods,
  saveOffFood,
  searchLocalFoods,
} from '@/db/foods';
import { useLiveQuery } from '@/db/live';
import { getRecipes } from '@/db/recipes';
import { addSavedMealToDiary, getSavedMeals, type SavedMealSummary } from '@/db/saved-meals';
import { useAddFlowParams, useCloseAddFlow } from '@/hooks/use-add-flow';
import { useTheme } from '@/hooks/use-theme';
import { formatDayTitle } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { mealLabel } from '@/lib/meals';
import type { Food, FoodDraft } from '@/lib/nutrition';
import { OffNetworkError, searchProducts } from '@/lib/off';
import { haptics } from '@/services/haptics';

type ListKey = 'recent' | 'favorites' | 'basic' | 'custom';

const LISTS: readonly { key: ListKey; label: string }[] = [
  { key: 'recent', label: 'Recenti' },
  { key: 'favorites', label: 'Preferiti' },
  { key: 'basic', label: 'Base' },
  { key: 'custom', label: 'Miei' },
];

const EMPTY_MESSAGES: Record<'recent' | 'favorites', string> = {
  recent: 'Qui compariranno gli alimenti che registri.',
  favorites: 'Tocca la stella su un alimento per averlo qui.',
};

type OnlineState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; results: FoodDraft[] }
  | { status: 'error'; query: string; message: string };

export default function AddScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const close = useCloseAddFlow();
  const { meal, date, mode, forward: params } = useAddFlowParams();
  const forDiary = mode === 'diary';
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListKey>('recent');
  const [online, setOnline] = useState<OnlineState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const trimmed = query.trim();

  const lists = useLiveQuery(`add-lists:${list}`, (database) =>
    list === 'recent' ? getRecentFoods(database) : list === 'favorites' ? getFavoriteFoods(database) : Promise.resolve([]),
    ['food'],
  );
  const mine = useLiveQuery(`add-mine:${list === 'custom'}:${forDiary}`, async (database) => {
    if (list !== 'custom') return null;
    const [savedMeals, recipes, custom] = await Promise.all([
      forDiary ? getSavedMeals(database) : Promise.resolve([]),
      getRecipes(database),
      getCustomFoods(database),
    ]);
    return { savedMeals, recipes: recipes.map((r) => r.food), custom };
  }, ['food']);
  const basic = useLiveQuery(`add-basic:${list === 'basic'}`, (database) =>
    list === 'basic' ? getGenericFoods(database) : Promise.resolve([]),
    ['food'],
  );
  const local = useLiveQuery(`add-local:${trimmed}`, (database) => searchLocalFoods(database, trimmed), ['food']);

  useEffect(() => () => abortRef.current?.abort(), []);

  const searchOnline = async () => {
    if (trimmed.length < 2) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOnline({ status: 'loading', query: trimmed });
    try {
      const results = await searchProducts(trimmed, controller.signal);
      if (!controller.signal.aborted) setOnline({ status: 'done', query: trimmed, results });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof OffNetworkError ? `${error.message}. Riprova tra poco.` : 'Ricerca non riuscita. Riprova.';
      setOnline({ status: 'error', query: trimmed, message });
    }
  };

  const openFood = (food: Food) => router.push({ pathname: '/add/food', params: { ...params, foodId: food.id } });
  const openOnline = async (draft: FoodDraft) => {
    const food = await saveOffFood(db, draft);
    openFood(food);
  };
  const addSavedMeal = async (saved: SavedMealSummary) => {
    await addSavedMealToDiary(db, saved.id, { date, meal });
    haptics.success();
    toast.show(`«${saved.name}» in ${mealLabel(meal)}`, 'bookmark.fill');
    close();
  };

  const onlineMatchesQuery = online.status !== 'idle' && online.query === trimmed;

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          title: forDiary
            ? `${mealLabel(meal)} · ${formatDayTitle(date)}`
            : mode === 'ingredient'
              ? 'Aggiungi ingrediente'
              : 'Aggiungi ai preferiti',
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Chiudi" onPress={close} />
      </Stack.Toolbar>

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Cerca: mela, petto di pollo, una marca…"
        onSubmitEditing={() => void searchOnline()}
        accessibilityLabel="Cerca un alimento"
      />

      {trimmed === '' ? (
        <>
          <View style={styles.actions}>
            <ActionTile
              symbol="barcode.viewfinder"
              label="Scansiona"
              onPress={() => router.push({ pathname: '/add/scan', params })}
            />
            {forDiary ? (
              <ActionTile
                symbol="bolt.fill"
                label="Aggiunta rapida"
                onPress={() => router.push({ pathname: '/add/quick', params })}
              />
            ) : null}
            <ActionTile
              symbol="square.and.pencil"
              label="Crea alimento"
              onPress={() => router.push({ pathname: '/add/custom', params })}
            />
          </View>
          <Segmented options={LISTS} value={list} onChange={setList} />
          <View style={styles.listGap} />
          {list === 'basic' ? (
            <BasicFoods groups={basic.data ?? []} onOpen={openFood} />
          ) : list === 'custom' ? (
            mine.data ? (
              <MyFoods
                savedMeals={mine.data.savedMeals}
                recipes={mine.data.recipes}
                custom={mine.data.custom}
                onAddSavedMeal={(saved) => void addSavedMeal(saved)}
                onOpen={openFood}
              />
            ) : null
          ) : lists.data && lists.data.length > 0 ? (
            <ListGroup>
              {lists.data.map((food) => (
                <FoodRow key={food.id} food={food} onPress={() => openFood(food)} />
              ))}
            </ListGroup>
          ) : lists.data ? (
            <AppText tone="textSecondary" align="center" style={styles.empty}>
              {EMPTY_MESSAGES[list]}
            </AppText>
          ) : null}
        </>
      ) : (
        <>
          {local.data && local.data.length > 0 ? (
            <>
              <SectionTitle>Sul telefono</SectionTitle>
              <ListGroup>
                {local.data.map((food) => (
                  <FoodRow key={food.id} food={food} onPress={() => openFood(food)} />
                ))}
              </ListGroup>
            </>
          ) : null}

          <SectionTitle>Prodotti confezionati · Open Food Facts</SectionTitle>
          {!onlineMatchesQuery ? (
            <ListGroup>
              <Pressable
                onPress={() => void searchOnline()}
                disabled={trimmed.length < 2}
                accessibilityRole="button"
                style={({ pressed }) => [styles.searchRow, pressed && { backgroundColor: theme.cardPressed }]}>
                <Icon name="globe" size={18} tone="accent" />
                <AppText tone="accent" weight="600" numberOfLines={1} style={styles.flex}>
                  {`Cerca «${trimmed}» online`}
                </AppText>
              </Pressable>
            </ListGroup>
          ) : online.status === 'loading' ? (
            <ActivityIndicator style={styles.empty} />
          ) : online.status === 'error' ? (
            <View style={styles.empty}>
              <AppText tone="textSecondary" align="center">
                {online.message}
              </AppText>
              <Pressable onPress={() => void searchOnline()} accessibilityRole="button" style={styles.retry}>
                <AppText tone="accent" weight="600" align="center">
                  Riprova
                </AppText>
              </Pressable>
            </View>
          ) : online.status === 'done' && online.results.length > 0 ? (
            <ListGroup>
              {online.results.map((food, index) => (
                <FoodRow key={food.barcode ?? `r${index}`} food={food} onPress={() => void openOnline(food)} />
              ))}
            </ListGroup>
          ) : (
            <View style={styles.empty}>
              <AppText tone="textSecondary" align="center">
                Nessun risultato. Prova con meno parole o crea l’alimento.
              </AppText>
              <Pressable
                onPress={() => router.push({ pathname: '/add/custom', params })}
                accessibilityRole="button"
                style={styles.retry}>
                <AppText tone="accent" weight="600" align="center">
                  Crea alimento
                </AppText>
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScreenScroll>
  );
}

/** Saved meals (logged with one tap), recipes and foods created by hand. */
function MyFoods({
  savedMeals,
  recipes,
  custom,
  onAddSavedMeal,
  onOpen,
}: {
  savedMeals: SavedMealSummary[];
  recipes: Food[];
  custom: Food[];
  onAddSavedMeal: (saved: SavedMealSummary) => void;
  onOpen: (food: Food) => void;
}) {
  const theme = useTheme();
  if (savedMeals.length + recipes.length + custom.length === 0) {
    return (
      <AppText tone="textSecondary" align="center" style={styles.empty}>
        Pasti salvati, ricette e alimenti creati da te.
      </AppText>
    );
  }
  return (
    <>
      {savedMeals.length > 0 ? (
        <>
          <SectionTitle>Pasti salvati</SectionTitle>
          <ListGroup>
            {savedMeals.map((saved) => (
              <Pressable
                key={saved.id}
                onPress={() => onAddSavedMeal(saved)}
                accessibilityRole="button"
                accessibilityHint="Aggiunge tutti gli alimenti di questo pasto"
                style={({ pressed }) => [styles.categoryRow, pressed && { backgroundColor: theme.cardPressed }]}>
                <Icon name="bookmark.fill" size={18} tone="accent" />
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{saved.name}</AppText>
                  <AppText variant="footnote" tone="textSecondary" numeric>
                    {`${saved.itemCount} ${saved.itemCount === 1 ? 'alimento' : 'alimenti'} · ${formatKcal(saved.totals.kcal)} kcal`}
                  </AppText>
                </View>
                <Icon name="plus.circle.fill" size={26} tone="accent" />
              </Pressable>
            ))}
          </ListGroup>
        </>
      ) : null}
      {recipes.length > 0 ? (
        <>
          <SectionTitle>Ricette</SectionTitle>
          <ListGroup>
            {recipes.map((food) => (
              <FoodRow key={food.id} food={food} onPress={() => onOpen(food)} />
            ))}
          </ListGroup>
        </>
      ) : null}
      {custom.length > 0 ? (
        <>
          <SectionTitle>Creati da me</SectionTitle>
          <ListGroup>
            {custom.map((food) => (
              <FoodRow key={food.id} food={food} onPress={() => onOpen(food)} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </>
  );
}

/** Basic foods by category; a category's foods are rendered only while it is open. */
function BasicFoods({ groups, onOpen }: { groups: { category: string; foods: Food[] }[]; onOpen: (food: Food) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <ListGroup>
        {groups.map((group) => {
          const expanded = open === group.category;
          return (
            <View key={group.category}>
              <Pressable
                onPress={() => setOpen(expanded ? null : group.category)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                style={({ pressed }) => [styles.categoryRow, pressed && { backgroundColor: theme.cardPressed }]}>
                <AppText weight={expanded ? '600' : '400'} style={styles.flex}>
                  {group.category}
                </AppText>
                <AppText tone="textSecondary" numeric>
                  {String(group.foods.length)}
                </AppText>
                <Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={13} tone="textTertiary" weight="semibold" />
              </Pressable>
              {expanded
                ? group.foods.map((food) => (
                    <View key={food.id} style={[styles.nested, { borderTopColor: theme.separator }]}>
                      <FoodRow food={food} onPress={() => onOpen(food)} />
                    </View>
                  ))
                : null}
            </View>
          );
        })}
      </ListGroup>
      <AppText variant="footnote" tone="textSecondary" style={styles.footnote}>
        Valori medi USDA per alimenti sfusi e freschi. Per i confezionati usa lo scanner.
      </AppText>
    </>
  );
}

function ActionTile({ symbol, label, onPress }: { symbol: SFSymbol; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.tile, { backgroundColor: theme.card }, pressed && { backgroundColor: theme.cardPressed }]}>
      <Icon name={symbol} size={24} tone="accent" />
      <AppText variant="footnote" weight="600" align="center" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 88,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  listGap: { height: Spacing.md },
  empty: { paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  searchRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  categoryRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  nested: { borderTopWidth: StyleSheet.hairlineWidth },
  footnote: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  retry: { paddingTop: Spacing.md, minHeight: 44, justifyContent: 'center' },
});
