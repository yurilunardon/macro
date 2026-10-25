import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card, ListGroup, Row, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { MacroInline, MacroProgress } from '@/components/nutrition';
import { CalorieRing, ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { addWater, getWater } from '@/db/body';
import { copyMeal, deleteEntry, getEntriesForDate, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { DEFAULT_WATER_GOAL_ML, getSetting, getTargets } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatDayTitle, type DateKey } from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';
import { MEALS, mealForTime, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { QUICK_ADD_NAME } from '@/lib/quick-add';

const WATER_STEP_ML = 250;

/** "120 g · Barilla", or for a quick entry just that it was typed by hand. */
function entryDetail(entry: Entry): string | null {
  if (entry.quick) return entry.name === QUICK_ADD_NAME ? null : QUICK_ADD_NAME;
  return [`${formatNumber(entry.quantity, 1)} ${entry.unit}`, entry.brand].filter(Boolean).join(' · ');
}

export default function DiaryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;
  const goTo = (day: DateKey) => setSelected(day === today ? null : day);

  const { data } = useLiveQuery(`diary:${date}`, async (database) => {
    const [entries, yesterday, goals, water, waterGoal] = await Promise.all([
      getEntriesForDate(database, date),
      getEntriesForDate(database, addDays(date, -1)),
      getTargets(database),
      getWater(database, date),
      getSetting(database, 'waterGoalMl'),
    ]);
    return {
      entries,
      yesterdayMeals: new Set(yesterday.map((e) => e.meal)),
      ...goals,
      water,
      waterGoal: waterGoal ?? DEFAULT_WATER_GOAL_ML,
    };
  });

  const entries = data?.entries ?? [];
  const totals = sumNutrients(entries.map((e) => e.totals));

  const openAdd = (meal: MealKey, scan = false) =>
    router.push({ pathname: scan ? '/add/scan' : '/add', params: { meal, date } });

  const confirmDelete = (entry: Entry) =>
    Alert.alert(entry.name, [entryDetail(entry), `${formatKcal(entry.totals.kcal)} kcal`].filter(Boolean).join(' · '), [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Modifica', onPress: () => router.push(`/entry/${entry.id}`) },
      { text: 'Elimina', style: 'destructive', onPress: () => void deleteEntry(db, entry.id) },
    ]);

  const copyFromYesterday = async (meal: MealKey) => {
    const copied = await copyMeal(db, { date: addDays(date, -1), meal }, { date, meal });
    if (copied > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const changeWater = (delta: number) => {
    void Haptics.selectionAsync();
    void addWater(db, date, delta);
  };

  return (
    <ScreenScroll>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => openAdd(mealForTime(), true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Scansiona un codice a barre">
              <Icon name="barcode.viewfinder" size={22} tone="accent" />
            </Pressable>
          ),
        }}
      />

      <View style={styles.dateBar}>
        <Pressable
          onPress={() => goTo(addDays(date, -1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Giorno precedente"
          style={styles.dateArrow}>
          <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
        </Pressable>
        <Pressable
          onPress={() => setSelected(null)}
          disabled={date === today}
          accessibilityRole="button"
          accessibilityHint="Torna a oggi"
          style={styles.dateTitle}>
          <AppText variant="headline" align="center">
            {formatDayTitle(date, today)}
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => goTo(addDays(date, 1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Giorno successivo"
          style={styles.dateArrow}>
          <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
        </Pressable>
      </View>

      {data?.isDefault ? (
        <Pressable onPress={() => router.navigate('/settings/goals')} accessibilityRole="button">
          <Card style={[styles.banner, { backgroundColor: theme.accentSoft }]}>
            <Icon name="target" size={22} tone="accent" />
            <View style={styles.flex}>
              <AppText variant="headline">Imposta i tuoi obiettivi</AppText>
              <AppText variant="subhead" tone="textSecondary">
                Calcola calorie e macro da peso, altezza e attività.
              </AppText>
            </View>
            <Icon name="chevron.right" size={13} tone="textSecondary" weight="semibold" />
          </Card>
        </Pressable>
      ) : null}

      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <CalorieRing eaten={totals.kcal} target={data?.targets.kcal ?? 0} />
          <View style={styles.summaryStats}>
            <Stat label="Obiettivo" value={formatKcal(data?.targets.kcal ?? 0)} />
            <Stat label="Mangiate" value={formatKcal(totals.kcal)} />
            {totals.fiber !== null ? <Stat label="Fibre" value={`${formatNumber(totals.fiber, 0)} g`} /> : null}
          </View>
        </View>
        {data ? <MacroProgress totals={totals} targets={data.targets} /> : null}
      </Card>

      {MEALS.map((meal) => {
        const mealEntries = entries.filter((e) => e.meal === meal.key);
        const mealKcal = mealEntries.reduce((sum, e) => sum + e.totals.kcal, 0);
        const canCopy = mealEntries.length === 0 && data?.yesterdayMeals.has(meal.key);
        return (
          <View key={meal.key}>
            <SectionTitle
              action={
                mealEntries.length > 0 ? (
                  <AppText variant="footnote" tone="textSecondary" weight="600" numeric>
                    {`${formatKcal(mealKcal)} kcal`}
                  </AppText>
                ) : undefined
              }>
              {meal.label}
            </SectionTitle>
            <ListGroup>
              {mealEntries.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => router.push(`/entry/${entry.id}`)}
                  onLongPress={() => confirmDelete(entry)}
                  accessibilityRole="button"
                  accessibilityHint="Tocca per modificare, tieni premuto per altre azioni"
                  style={({ pressed }) => [styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
                  <View style={styles.flex}>
                    <AppText numberOfLines={1}>{entry.name}</AppText>
                    {entryDetail(entry) ? (
                      <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                        {entryDetail(entry)}
                      </AppText>
                    ) : null}
                    <MacroInline totals={entry.totals} />
                  </View>
                  <AppText variant="callout" weight="600" numeric>
                    {formatKcal(entry.totals.kcal)}
                  </AppText>
                </Pressable>
              ))}
              <AddRow label={`Aggiungi a ${mealLabel(meal.key).toLowerCase()}`} onPress={() => openAdd(meal.key)} />
              {canCopy ? (
                <Row
                  title="Copia da ieri"
                  icon={<Icon name="doc.on.doc" size={18} tone="textSecondary" />}
                  onPress={() => void copyFromYesterday(meal.key)}
                  chevron={false}
                />
              ) : null}
            </ListGroup>
          </View>
        );
      })}

      <SectionTitle>Acqua</SectionTitle>
      <Card style={styles.water}>
        <View style={styles.waterTop}>
          <Icon name="drop.fill" size={22} tone="water" />
          <View style={styles.flex}>
            <AppText variant="headline" numeric>
              {`${formatNumber((data?.water ?? 0) / 1000, 2)} L`}
            </AppText>
            <AppText variant="footnote" tone="textSecondary" numeric>
              {`su ${formatNumber((data?.waterGoal ?? DEFAULT_WATER_GOAL_ML) / 1000, 1)} L`}
            </AppText>
          </View>
          <RoundButton
            symbol="minus"
            label="Togli un bicchiere"
            onPress={() => changeWater(-WATER_STEP_ML)}
            disabled={(data?.water ?? 0) === 0}
          />
          <RoundButton symbol="plus" label="Aggiungi un bicchiere" onPress={() => changeWater(WATER_STEP_ML)} />
        </View>
        <ProgressBar value={data?.water ?? 0} target={data?.waterGoal ?? DEFAULT_WATER_GOAL_ML} color={theme.water} />
      </Card>
    </ScreenScroll>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <AppText variant="footnote" tone="textSecondary">
        {label}
      </AppText>
      <AppText variant="title2" numeric>
        {value}
      </AppText>
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.addRow, pressed && { backgroundColor: theme.cardPressed }]}>
      <Icon name="plus.circle.fill" size={20} tone="accent" />
      <AppText tone="accent" weight="600">
        {label}
      </AppText>
    </Pressable>
  );
}

function RoundButton({
  symbol,
  label,
  onPress,
  disabled = false,
}: {
  symbol: 'plus' | 'minus';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: theme.track },
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 },
      ]}>
      <Icon name={symbol} size={16} tone="water" weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  dateArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dateTitle: { flex: 1, paddingVertical: Spacing.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  summary: { gap: Spacing.xl },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  summaryStats: { flex: 1, gap: Spacing.md },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  addRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  water: { gap: Spacing.md },
  waterTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
