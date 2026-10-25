import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, SectionFooter } from '@/components/card';
import { FoodRow } from '@/components/food-row';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { deleteFood, getCustomFoods, getFavoriteFoods, getRecentFoods } from '@/db/foods';
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

  const edit = (food: Food) => router.push({ pathname: '/settings/food-edit', params: { foodId: food.id } });
  const askDelete = (food: Food) =>
    Alert.alert(food.name, 'Eliminare l’alimento? Le voci già nel diario restano invariate.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: () => void deleteFood(db, food.id) },
    ]);

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings/food-edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Nuovo alimento">
              <Icon name="plus" size={20} tone="accent" weight="semibold" />
            </Pressable>
          ),
        }}
      />
      <Segmented options={LISTS} value={list} onChange={setList} />
      <View style={styles.gap} />
      {data && data.length > 0 ? (
        <>
          <ListGroup>
            {data.map((food) => (
              <FoodRow key={food.id} food={food} onPress={() => edit(food)} onLongPress={() => askDelete(food)} />
            ))}
          </ListGroup>
          <SectionFooter>Tocca un alimento per correggerlo, tieni premuto per eliminarlo.</SectionFooter>
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
