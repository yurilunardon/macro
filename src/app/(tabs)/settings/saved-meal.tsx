import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { MacroInline } from '@/components/nutrition';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteSavedMeal, deleteSavedMealItem, getSavedMeal, renameSavedMeal } from '@/db/saved-meals';
import { formatKcal, formatNumber } from '@/lib/format';
import { sumNutrients } from '@/lib/nutrition';

export default function SavedMealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mealId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();

  const { data } = useLiveQuery(`saved-meal:${mealId}`, (database) => getSavedMeal(database, mealId));

  if (!data) {
    return (
      <View style={styles.center}>
        {data === null ? <AppText tone="textSecondary">Questo pasto non esiste più.</AppText> : <ActivityIndicator />}
      </View>
    );
  }
  const meal = data;
  const totals = sumNutrients(meal.items.map((i) => i.totals));

  const rename = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt(
      'Rinomina pasto',
      undefined,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (trimmed !== '') void renameSavedMeal(db, meal.id, trimmed);
          },
        },
      ],
      'plain-text',
      meal.name,
    );
  };

  const remove = () =>
    Alert.alert(`Eliminare «${meal.name}»?`, 'Le voci già nel diario restano invariate.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          await deleteSavedMeal(db, meal.id);
          router.back();
        },
      },
    ]);

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          title: meal.name,
          headerRight: () => (
            <Pressable onPress={rename} hitSlop={10} accessibilityRole="button">
              <AppText tone="accent" weight="600">
                Rinomina
              </AppText>
            </Pressable>
          ),
        }}
      />

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
                onLongPress={() =>
                  Alert.alert(item.name, 'Toglierlo da questo pasto salvato?', [
                    { text: 'Annulla', style: 'cancel' },
                    { text: 'Togli', style: 'destructive', onPress: () => void deleteSavedMealItem(db, item.id) },
                  ])
                }
                accessibilityHint="Tieni premuto per toglierlo dal pasto"
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
      <SectionFooter>Scorri a sinistra o tieni premuto su un alimento per toglierlo da questo pasto.</SectionFooter>

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
