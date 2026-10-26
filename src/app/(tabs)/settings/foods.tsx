import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ActionRow, ListGroup, SectionFooter } from '@/components/card';
import { FoodRow } from '@/components/food-row';
import { Segmented } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { deleteFood, getCustomFoods, getFavoriteFoods, getRecentFoods, setFavorite } from '@/db/foods';
import { deleteRecipe } from '@/db/recipes';
import { useLiveQuery } from '@/db/live';
import type { Food } from '@/lib/nutrition';

type ListKey = 'custom' | 'favorites' | 'recent';

const LISTS: readonly { key: ListKey; label: string }[] = [
  { key: 'custom', label: 'Creati da me' },
  { key: 'favorites', label: 'Preferiti' },
  { key: 'recent', label: 'Recenti' },
];

export default function FoodsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [list, setList] = useState<ListKey>('custom');

  const { data } = useLiveQuery(`foods:${list}`, (database) =>
    list === 'custom' ? getCustomFoods(database) : list === 'favorites' ? getFavoriteFoods(database) : getRecentFoods(database, 100),
    ['food'],
  );

  // A recipe's values come from its ingredients, so it opens in the recipe editor.
  const edit = (food: Food) =>
    food.source === 'recipe'
      ? router.push({ pathname: '/settings/recipe', params: { id: food.id } })
      : router.push({ pathname: '/settings/food-edit', params: { foodId: food.id } });
  const remove = (food: Food) => void (food.source === 'recipe' ? deleteRecipe(db, food.id) : deleteFood(db, food.id));
  const askDelete = (food: Food) =>
    Alert.alert(food.name, 'Eliminare l’alimento? Le voci già nel diario restano invariate.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: () => remove(food) },
    ]);

  const footer: Record<ListKey, string> = {
    custom: 'Alimenti creati o corretti da te.',
    favorites: 'In cima quando aggiungi un alimento.',
    recent: 'Gli ultimi registrati.',
  };

  return (
    <ScreenScroll>
      <Segmented options={LISTS} value={list} onChange={setList} />
      <View style={styles.gap} />
      <ListGroup>
        {list === 'custom' ? (
          <ActionRow label="Crea un alimento" onPress={() => router.push('/settings/food-edit')} />
        ) : list === 'favorites' ? (
          <ActionRow
            label="Aggiungi un preferito"
            symbol="star.circle.fill"
            onPress={() => router.push({ pathname: '/add', params: { mode: 'favorite' } })}
          />
        ) : null}
        {(data ?? []).map((food) => (
          <SwipeToDelete
            key={food.id}
            label={list === 'favorites' ? 'Rimuovi' : 'Elimina'}
            onDelete={() => (list === 'favorites' ? void setFavorite(db, food.id, false) : remove(food))}>
            <FoodRow food={food} onPress={() => edit(food)} onLongPress={list === 'favorites' ? undefined : () => askDelete(food)} />
          </SwipeToDelete>
        ))}
      </ListGroup>
      {data && data.length === 0 && list === 'recent' ? (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          Nessun alimento registrato di recente.
        </AppText>
      ) : null}
      <SectionFooter>{footer[list]}</SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  gap: { height: Spacing.md },
  empty: { paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
});
