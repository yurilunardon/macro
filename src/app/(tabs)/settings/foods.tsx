import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, SectionFooter } from '@/components/card';
import { FoodRow } from '@/components/food-row';
import { Segmented } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { deleteFood, getCustomFoods, getFavoriteFoods, getRecentFoods } from '@/db/foods';
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

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Nuovo alimento" onPress={() => router.push('/settings/food-edit')} />
      </Stack.Toolbar>
      <Segmented options={LISTS} value={list} onChange={setList} />
      <View style={styles.gap} />
      {data && data.length > 0 ? (
        <>
          <ListGroup>
            {data.map((food) => (
              <SwipeToDelete key={food.id} onDelete={() => remove(food)}>
                <FoodRow food={food} onPress={() => edit(food)} onLongPress={() => askDelete(food)} />
              </SwipeToDelete>
            ))}
          </ListGroup>
          <SectionFooter>
            Tocca un alimento per correggerlo, scorri a sinistra per eliminarlo. Le voci già nel diario restano
            invariate.
          </SectionFooter>
        </>
      ) : data ? (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          {list === 'custom'
            ? 'Non hai ancora creato alimenti. Tocca + per aggiungerne uno.'
            : list === 'favorites'
              ? 'Nessun preferito. Tocca la stella nella scheda di un alimento.'
              : 'Nessun alimento registrato di recente.'}
        </AppText>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  gap: { height: Spacing.md },
  empty: { paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
});
