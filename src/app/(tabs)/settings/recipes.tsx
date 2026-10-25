import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ActionRow, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
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

  const confirmDelete = (name: string) => () =>
    confirmDestructive({
      title: `Eliminare «${name}»?`,
      message: 'Le voci già nel diario restano invariate.',
      action: 'Elimina',
    });
  const askDelete = async (name: string, remove: () => Promise<void>) => {
    if (await confirmDelete(name)()) await remove();
  };

  return (
    <ScreenScroll>
      <SectionTitle>Ricette</SectionTitle>
      <ListGroup>
        {(data?.recipes ?? []).map(({ food, ingredientCount }) => (
          <SwipeToDelete key={food.id} confirm={confirmDelete(food.name)} onDelete={() => void deleteRecipe(db, food.id)}>
            <Row
              title={food.name}
              subtitle={`${ingredientCount} ${ingredientCount === 1 ? 'ingrediente' : 'ingredienti'} · ${formatKcal(food.per100.kcal)} kcal / 100 g`}
              icon={<Icon name="frying.pan.fill" size={18} tone="accent" />}
              onPress={() => router.push({ pathname: '/settings/recipe', params: { id: food.id } })}
              onLongPress={() => void askDelete(food.name, () => deleteRecipe(db, food.id))}
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
            <SwipeToDelete key={meal.id} confirm={confirmDelete(meal.name)} onDelete={() => void deleteSavedMeal(db, meal.id)}>
              <Row
                title={meal.name}
                subtitle={`${meal.itemCount} ${meal.itemCount === 1 ? 'alimento' : 'alimenti'} · ${formatKcal(meal.totals.kcal)} kcal`}
                icon={<Icon name="bookmark.fill" size={18} tone="accent" />}
                onPress={() => router.push({ pathname: '/settings/saved-meal', params: { id: meal.id } })}
                onLongPress={() => void askDelete(meal.name, () => deleteSavedMeal(db, meal.id))}
              />
            </SwipeToDelete>
          ))}
        </ListGroup>
      ) : null}
      <SectionFooter>
        Per salvare un pasto, nel Diario tocca ⋯ accanto al suo nome e scegli «Salva come pasto». Poi lo ritrovi in Aggiungi → Miei e lo
        registri con un tocco.
      </SectionFooter>
    </ScreenScroll>
  );
}
