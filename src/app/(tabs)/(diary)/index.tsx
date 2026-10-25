import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ActionRow, Card, ListGroup, Row, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MacroInline, MacroProgress } from '@/components/nutrition';
import { CalorieRing } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import { copyMeal, deleteEntry, deleteMealEntries, getEntriesForDate, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { saveMealFromDiary } from '@/db/saved-meals';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatDayTitle, weekdayOf, type DateKey } from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { MEALS, mealForTime, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { formatExpiry, type ExpiryStatus } from '@/lib/provisioning';
import { QUICK_ADD_NAME } from '@/lib/quick-add';

const DAY_TYPES: readonly { key: DayType; label: string }[] = [
  { key: 'training', label: 'Allenamento' },
  { key: 'rest', label: 'Riposo' },
];

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
  const expiry = useAppExpiry();
  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;
  const goTo = (day: DateKey) => setSelected(day === today ? null : day);

  const { data } = useLiveQuery(`diary:${date}`, async (database) => {
    const [entries, yesterday, plan, training] = await Promise.all([
      getEntriesForDate(database, date),
      getEntriesForDate(database, addDays(date, -1)),
      getDayPlan(database, date),
      getTrainingSettings(database),
    ]);
    return {
      entries,
      yesterdayMeals: new Set(yesterday.map((e) => e.meal)),
      plan,
      scheduledType: dayTypeFor(weekdayOf(date), training.trainingWeekdays, null),
    };
  });

  const entries = data?.entries ?? [];
  const totals = sumNutrients(entries.map((e) => e.totals));
  const targets = data?.plan.targets;

  const openAdd = (meal: MealKey, scan = false) =>
    router.push({ pathname: scan ? '/add/scan' : '/add', params: { meal, date } });

  const entryMenu = (entry: Entry) =>
    Alert.alert(entry.name, [entryDetail(entry), `${formatKcal(entry.totals.kcal)} kcal`].filter(Boolean).join(' · '), [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Modifica', onPress: () => router.push(`/entry/${entry.id}`) },
      { text: 'Elimina', style: 'destructive', onPress: () => void deleteEntry(db, entry.id) },
    ]);

  const copyFromYesterday = async (meal: MealKey) => {
    const copied = await copyMeal(db, { date: addDays(date, -1), meal }, { date, meal });
    if (copied > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const saveAsMeal = (meal: MealKey) =>
    Alert.prompt(
      'Salva come pasto',
      'Lo ritrovi in Aggiungi → Miei e lo registri con un tocco.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: async (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (trimmed === '') return;
            await saveMealFromDiary(db, { date, meal, name: trimmed });
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
      'plain-text',
      `${mealLabel(meal)} tipo`,
    );

  const mealMenu = (meal: MealKey) => {
    if (Platform.OS !== 'ios') return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: mealLabel(meal),
        options: ['Salva come pasto…', 'Elimina tutte le voci', 'Annulla'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) saveAsMeal(meal);
        if (index === 1) {
          Alert.alert(`Svuotare ${mealLabel(meal).toLowerCase()}?`, formatDayTitle(date, today), [
            { text: 'Annulla', style: 'cancel' },
            { text: 'Elimina', style: 'destructive', onPress: () => void deleteMealEntries(db, date, meal) },
          ]);
        }
      },
    );
  };

  // Picking the type the schedule already gives clears the manual choice.
  const changeDayType = (type: DayType) => {
    void Haptics.selectionAsync();
    void setDayType(db, date, type === data?.scheduledType ? null : type);
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

      {expiry && expiry.level !== 'ok' ? <ExpiryBanner status={expiry} /> : null}

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

      {data?.plan.dayType ? (
        <View style={styles.dayType}>
          <Segmented options={DAY_TYPES} value={data.plan.dayType} onChange={changeDayType} />
        </View>
      ) : null}

      {data?.plan.isDefault ? (
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
          <CalorieRing eaten={totals.kcal} target={targets?.kcal ?? 0} />
          <View style={styles.summaryStats}>
            <Stat label="Obiettivo" value={formatKcal(targets?.kcal ?? 0)} />
            <Stat label="Mangiate" value={formatKcal(totals.kcal)} />
            {totals.fiber !== null ? <Stat label="Fibre" value={`${formatNumber(totals.fiber, 0)} g`} /> : null}
          </View>
        </View>
        {targets ? <MacroProgress totals={totals} targets={targets} /> : null}
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
                  <View style={styles.mealActions}>
                    <AppText variant="footnote" tone="textSecondary" weight="600" numeric>
                      {`${formatKcal(mealKcal)} kcal`}
                    </AppText>
                    <Pressable
                      onPress={() => mealMenu(meal.key)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={`Altre azioni per ${meal.label.toLowerCase()}`}>
                      <Icon name="ellipsis.circle" size={20} tone="accent" />
                    </Pressable>
                  </View>
                ) : undefined
              }>
              {meal.label}
            </SectionTitle>
            <ListGroup>
              {mealEntries.map((entry) => (
                <SwipeToDelete key={entry.id} onDelete={() => void deleteEntry(db, entry.id)}>
                  <Pressable
                    onPress={() => router.push(`/entry/${entry.id}`)}
                    onLongPress={() => entryMenu(entry)}
                    accessibilityRole="button"
                    accessibilityHint="Tocca per modificare, scorri a sinistra per eliminare"
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
                </SwipeToDelete>
              ))}
              <ActionRow label={`Aggiungi a ${mealLabel(meal.key).toLowerCase()}`} onPress={() => openAdd(meal.key)} />
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
    </ScreenScroll>
  );
}

/** Shown from three days before the app's signature expires. */
function ExpiryBanner({ status }: { status: ExpiryStatus }) {
  const theme = useTheme();
  const tone = status.level === 'soon' ? 'warning' : 'danger';
  const openAltStore = () => {
    Linking.openURL('altstore://').catch(() => {
      Alert.alert('Apri AltStore', 'Apri AltStore dalla schermata Home e tocca My Apps → Refresh All.');
    });
  };
  return (
    <Pressable onPress={openAltStore} accessibilityRole="button" accessibilityHint="Apre AltStore">
      <Card style={[styles.banner, { backgroundColor: theme.card, borderColor: theme[tone] }, styles.expiry]}>
        <Icon name="clock.badge.exclamationmark" size={22} tone={tone} />
        <View style={styles.flex}>
          <AppText variant="headline">{`Macro scade ${formatExpiry(status.expiresAt)}`}</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Rinnovala in AltStore con Refresh All: Mac acceso, AltServer aperto, stessa Wi-Fi. I dati restano.
          </AppText>
        </View>
        <Icon name="chevron.right" size={13} tone="textSecondary" weight="semibold" />
      </Card>
    </Pressable>
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
  dayType: { marginBottom: Spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  expiry: { borderWidth: 1.5 },
  summary: { gap: Spacing.xl },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  summaryStats: { flex: 1, gap: Spacing.md },
  mealActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
});
