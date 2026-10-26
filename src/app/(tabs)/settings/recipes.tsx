import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ActionRow, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { useLiveQuery } from '@/db/live';
import { deleteRecipe, getRecipes } from '@/db/recipes';
import { deleteSavedMeal, getSavedMeals } from '@/db/saved-meals';
import { recipeDraft } from '@/hooks/use-recipe-draft';
import { formatKcal } from '@/lib/format';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

export default function RecipesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const { data } = useLiveQuery('recipes-and-meals', async (database) => {
    const [recipes, savedMeals] = await Promise.all([getRecipes(database), getSavedMeals(database)]);
    return { recipes, savedMeals };
  }, ['food']);

  const newRecipe = () => {
    recipeDraft.start();
    router.push('/settings/recipe');
  };

  const hidden = usePendingDeletes();
  // What is already in the diary stays as it is.
  const removeRecipe = (id: number) => deleteWithUndo({ key: `recipe:${id}`, title: 'Ricetta eliminata', run: () => deleteRecipe(db, id) });
  const removeMeal = (id: number) => deleteWithUndo({ key: `meal:${id}`, title: 'Pasto eliminato', run: () => deleteSavedMeal(db, id) });

  return (
    <ScreenScroll>
      <SectionTitle>Ricette</SectionTitle>
      <ListGroup>
        {(data?.recipes ?? []).filter(({ food }) => !hidden.has(`recipe:${food.id}`)).map(({ food, ingredientCount }) => (
          <SwipeToDelete key={food.id} onDelete={() => removeRecipe(food.id)}>
            <Row
              title={food.name}
              subtitle={`${ingredientCount} ${ingredientCount === 1 ? 'ingrediente' : 'ingredienti'} · ${formatKcal(food.per100.kcal)} kcal / 100 g`}
              icon={<Icon name="frying.pan.fill" size={18} tone="accent" />}
              onPress={() => router.push({ pathname: '/settings/recipe', params: { id: food.id } })}
              onLongPress={() => removeRecipe(food.id)}
            />
          </SwipeToDelete>
        ))}
        <ActionRow label="Nuova ricetta" onPress={newRecipe} />
      </ListGroup>
      <SectionFooter>
        Ingredienti crudi e peso del piatto cotto: la ricetta si registra come un alimento.
      </SectionFooter>

      <SectionTitle>Pasti salvati</SectionTitle>
      {data && data.savedMeals.length > 0 ? (
        <ListGroup>
          {data.savedMeals.filter((meal) => !hidden.has(`meal:${meal.id}`)).map((meal) => (
            <SwipeToDelete key={meal.id} onDelete={() => removeMeal(meal.id)}>
              <Row
                title={meal.name}
                subtitle={`${meal.itemCount} ${meal.itemCount === 1 ? 'alimento' : 'alimenti'} · ${formatKcal(meal.totals.kcal)} kcal`}
                icon={<Icon name="bookmark.fill" size={18} tone="accent" />}
                onPress={() => router.push({ pathname: '/settings/saved-meal', params: { id: meal.id } })}
                onLongPress={() => removeMeal(meal.id)}
              />
            </SwipeToDelete>
          ))}
        </ListGroup>
      ) : null}
      <SectionFooter>
        Per salvarne uno: in Alimentazione tocca ⋯ su un pasto → Salva come pasto.
      </SectionFooter>
    </ScreenScroll>
  );
}
