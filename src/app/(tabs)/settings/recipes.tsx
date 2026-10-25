import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert } from 'react-native';

import { ActionRow, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { useLiveQuery } from '@/db/live';
import { deleteRecipe, getRecipes } from '@/db/recipes';
import { deleteSavedMeal, getSavedMeals } from '@/db/saved-meals';
import { recipeDraft } from '@/hooks/use-recipe-draft';
import { formatKcal } from '@/lib/format';

export default function RecipesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const { data } = useLiveQuery('recipes-and-meals', async (database) => {
    const [recipes, savedMeals] = await Promise.all([getRecipes(database), getSavedMeals(database)]);
    return { recipes, savedMeals };
  });

  const newRecipe = () => {
    recipeDraft.start();
    router.push('/settings/recipe');
  };

  const confirmDelete = (title: string, onConfirm: () => void) =>
    Alert.alert(title, 'Le voci già nel diario restano invariate.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: onConfirm },
    ]);

  return (
    <ScreenScroll>
      <SectionTitle>Ricette</SectionTitle>
      <ListGroup>
        {(data?.recipes ?? []).map(({ food, ingredientCount }) => (
          <SwipeToDelete
            key={food.id}
            onDelete={() => confirmDelete(`Eliminare «${food.name}»?`, () => void deleteRecipe(db, food.id))}>
            <Row
              title={food.name}
              subtitle={`${ingredientCount} ${ingredientCount === 1 ? 'ingrediente' : 'ingredienti'} · ${formatKcal(food.per100.kcal)} kcal / 100 g`}
              icon={<Icon name="frying.pan.fill" size={18} tone="accent" />}
              onPress={() => router.push({ pathname: '/settings/recipe', params: { id: food.id } })}
              onLongPress={() => confirmDelete(`Eliminare «${food.name}»?`, () => void deleteRecipe(db, food.id))}
            />
          </SwipeToDelete>
        ))}
        <ActionRow label="Nuova ricetta" onPress={newRecipe} />
      </ListGroup>
      <SectionFooter>
        Per il meal prep: metti gli ingredienti crudi e il peso del piatto finito, e la ricetta si registra come un
        qualsiasi alimento.
      </SectionFooter>

      <SectionTitle>Pasti salvati</SectionTitle>
      {data && data.savedMeals.length > 0 ? (
        <ListGroup>
          {data.savedMeals.map((meal) => (
            <SwipeToDelete
              key={meal.id}
              onDelete={() => confirmDelete(`Eliminare «${meal.name}»?`, () => void deleteSavedMeal(db, meal.id))}>
              <Row
                title={meal.name}
                subtitle={`${meal.itemCount} ${meal.itemCount === 1 ? 'alimento' : 'alimenti'} · ${formatKcal(meal.totals.kcal)} kcal`}
                icon={<Icon name="bookmark.fill" size={18} tone="accent" />}
                onPress={() => router.push({ pathname: '/settings/saved-meal', params: { id: meal.id } })}
                onLongPress={() => confirmDelete(`Eliminare «${meal.name}»?`, () => void deleteSavedMeal(db, meal.id))}
              />
            </SwipeToDelete>
          ))}
        </ListGroup>
      ) : null}
      <SectionFooter>
        Per salvare un pasto, nel Diario tocca ••• accanto al suo nome. Poi lo ritrovi in Aggiungi → Miei e lo
        registri con un tocco.
      </SectionFooter>
    </ScreenScroll>
  );
}
