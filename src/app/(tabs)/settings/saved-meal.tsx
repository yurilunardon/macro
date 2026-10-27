import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionTitle } from '@/components/card';
import { EditableTitle } from '@/components/editable-title';
import { MacroInline } from '@/components/nutrition';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteSavedMeal, deleteSavedMealItem, getSavedMeal, renameSavedMeal } from '@/db/saved-meals';
import { formatKcal, formatNumber } from '@/lib/format';
import { sumNutrients } from '@/lib/nutrition';
import { deleteWithUndo } from '@/services/undo';

export default function SavedMealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mealId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();

  const { data } = useLiveQuery(`saved-meal:${mealId}`, (database) => getSavedMeal(database, mealId), ['food']);

  if (!data) {
    return (
      <View style={styles.center}>
        {data === null ? <AppText tone="textSecondary">Questo pasto non esiste più.</AppText> : <ActivityIndicator />}
      </View>
    );
  }
  const meal = data;
  const totals = sumNutrients(meal.items.map((i) => i.totals));

  // As from the list of meals: back to it, where the meal is gone with "Annulla".
  const remove = () => {
    router.back();
    deleteWithUndo({ key: `meal:${meal.id}`, title: 'Pasto eliminato', run: () => deleteSavedMeal(db, meal.id) });
  };

  return (
    <ScreenScroll>
      {/* Renamed by tapping its name, as schede and giorni. */}
      <Stack.Screen options={{ title: '' }} />
      <EditableTitle value={meal.name} accessibilityLabel="Nome del pasto" onChange={(name) => void renameSavedMeal(db, meal.id, name)} />

      <Card style={styles.summary}>
        <AppText variant="title2" numeric>
          {`${formatKcal(totals.kcal)} kcal`}
        </AppText>
        <MacroInline totals={totals} />
      </Card>

      <SectionTitle>Alimenti</SectionTitle>
      {meal.items.length > 0 ? (
        <ListGroup>
          {meal.items.map((item) => (
            <SwipeToDelete key={item.id} onDelete={() => void deleteSavedMealItem(db, item.id)}>
              <Pressable
                onLongPress={async () => {
                  if (await confirmDestructive({ title: item.name, action: 'Elimina dal pasto' })) void deleteSavedMealItem(db, item.id);
                }}
                accessibilityHint="Tieni premuto per eliminarlo dal pasto"
                style={styles.row}>
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{item.name}</AppText>
                  <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                    {item.quantity > 0
                      ? [`${formatNumber(item.quantity, 1)} ${item.unit}`, item.brand].filter(Boolean).join(' · ')
                      : 'Aggiunta rapida'}
                  </AppText>
                </View>
                <AppText variant="callout" weight="600" numeric>
                  {formatKcal(item.totals.kcal)}
                </AppText>
              </Pressable>
            </SwipeToDelete>
          ))}
        </ListGroup>
      ) : (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          Questo pasto è vuoto.
        </AppText>
      )}

      <View style={styles.actions}>
        <Button title="Elimina pasto salvato" variant="destructive" onPress={remove} />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { gap: Spacing.xs },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  empty: { paddingVertical: Spacing.xl },
  actions: { paddingTop: Spacing.xl },
});
