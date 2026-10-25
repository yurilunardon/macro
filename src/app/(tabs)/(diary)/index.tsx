import { Link, Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { ActionRow, Card, ListGroup, Row } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { EASE_OUT, project } from '@/components/motion';
import { MacroInline, MacroProgress } from '@/components/nutrition';
import { CalorieRing } from '@/components/progress';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import {
  copyDay,
  copyEntry,
  copyMeal,
  deleteEntry,
  deleteMealEntries,
  getEntriesForDate,
  moveEntry,
  type Entry,
} from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { saveMealFromDiary } from '@/db/saved-meals';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { remainingKcal } from '@/lib/calories';
import { addDays, formatDaySubtitle, formatDayTitle, weekdayOf, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { MEALS, mealForTime, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { formatExpiry, type ExpiryStatus } from '@/lib/provisioning';
import { QUICK_ADD_NAME } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';

const DAY_TYPES: readonly { key: DayType; label: string }[] = [
  { key: 'training', label: 'Allenamento' },
  { key: 'rest', label: 'Riposo' },
];

// Called back from the swipe worklet.
const tick = haptics.selection;

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
  const { width: screenWidth } = useWindowDimensions();
  // null means "today", so the diary moves to the new day when the app is reopened tomorrow.
  const [selected, setSelected] = useState<DateKey | null>(null);
  const date = selected ?? today;

  const { data, error } = useLiveQuery(`diary:${date}`, async (database) => {
    const [entries, yesterday, plan, training] = await Promise.all([
      getEntriesForDate(database, date),
      getEntriesForDate(database, addDays(date, -1)),
      getDayPlan(database, date),
      getTrainingSettings(database),
    ]);
    return {
      date,
      entries,
      yesterdayMeals: new Set(yesterday.map((e) => e.meal)),
      plan,
      scheduledType: dayTypeFor(weekdayOf(date), training.trainingWeekdays, null),
    };
  });

  const entries = data?.entries ?? [];
  const totals = sumNutrients(entries.map((e) => e.totals));
  const targets = data?.plan.targets;
  const remaining = remainingKcal(totals.kcal, targets?.kcal ?? 0);

  // Changing day: the old day slides out, and the new one slides in once its entries are loaded,
  // so the screen never shows one day's title over another day's food.
  const dayX = useSharedValue(0);
  const dayOpacity = useSharedValue(1);
  const arriving = useRef<{ date: DateKey; from: number } | null>(null);

  const arrive = (day: DateKey, from: number) => {
    arriving.current = { date: day, from };
    setSelected(day === today ? null : day);
  };

  const loadedDate = data?.date;
  useEffect(() => {
    const next = arriving.current;
    if (!next || (loadedDate !== next.date && !error)) return;
    arriving.current = null;
    dayX.set(next.from);
    dayX.set(withSpring(0, { duration: 420, dampingRatio: 1 }));
    dayOpacity.set(withTiming(1, { duration: 220, easing: EASE_OUT }));
  }, [loadedDate, error, dayX, dayOpacity]);

  /** From the arrows, the title or the menu: a short slide in the direction of the new day. */
  const goTo = (day: DateKey) => {
    if (day === date) return;
    const direction = day > date ? 1 : -1;
    tick();
    dayOpacity.set(withTiming(0, { duration: 120, easing: EASE_OUT }));
    dayX.set(
      withTiming(-direction * 40, { duration: 120, easing: EASE_OUT }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(arrive, day, direction * 40);
      }),
    );
  };

  const swipeTo = (direction: number) => arrive(addDays(date, direction), direction * screenWidth * 0.35);

  // Swiping the date or the summary card follows the finger; far or fast enough, it turns the day.
  const daySwipe = usePanGesture({
    activeOffsetX: [-16, 16],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      dayX.set(event.translationX);
      dayOpacity.set(1 - Math.min(1, Math.abs(event.translationX) / screenWidth) * 0.6);
    },
    onDeactivate: (event) => {
      'worklet';
      const projected = event.translationX + project(event.velocityX);
      if (!event.canceled && Math.abs(projected) > screenWidth * 0.3) {
        // Swiping left goes forward in time, as in Calendar.
        const direction = projected < 0 ? 1 : -1;
        scheduleOnRN(tick);
        dayOpacity.set(withTiming(0, { duration: 160, easing: EASE_OUT }));
        dayX.set(
          withTiming(-direction * screenWidth, { duration: 180, easing: EASE_OUT }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(swipeTo, direction);
          }),
        );
        return;
      }
      dayX.set(withSpring(0, { duration: 400, dampingRatio: 0.85, velocity: event.velocityX }));
      dayOpacity.set(withTiming(1, { duration: 200, easing: EASE_OUT }));
    },
  });

  const titleStyle = useAnimatedStyle(() => ({ opacity: dayOpacity.get(), transform: [{ translateX: dayX.get() }] }));
  const summaryStyle = useAnimatedStyle(() => ({ opacity: dayOpacity.get(), transform: [{ translateX: dayX.get() }] }));
  const mealsStyle = useAnimatedStyle(() => ({ opacity: dayOpacity.get(), transform: [{ translateX: dayX.get() }] }));

  const openAdd = (meal: MealKey, scan = false) =>
    router.push({ pathname: scan ? '/add/scan' : '/add', params: { meal, date } });

  // From today things are copied to tomorrow (to plan ahead), from any other day to today.
  const copyTarget = date === today ? { date: addDays(today, 1), label: 'domani' } : { date: today, label: 'oggi' };
  const dayName = formatDayTitle(date, today).toLowerCase();

  const copied = (count: number, where: string) => {
    haptics.success();
    toast.show(`${countLabel(count, 'alimento copiato', 'alimenti copiati')} ${where}`, 'doc.on.doc.fill');
  };

  const copyWholeDay = async () => copied(await copyDay(db, date, copyTarget.date), `in ${copyTarget.label}`);

  const clearDay = async () => {
    const ok = await confirmDestructive({
      title: `Svuotare ${dayName}?`,
      message: `Elimini ${countLabel(entries.length, 'alimento', 'alimenti')}, ${formatKcal(totals.kcal)} kcal in tutto.`,
      action: 'Svuota',
    });
    if (ok) await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
  };

  const copyMealTo = async (meal: MealKey) =>
    copied(await copyMeal(db, { date, meal }, { date: copyTarget.date, meal }), `in ${copyTarget.label}`);

  const copyFromYesterday = async (meal: MealKey) => {
    const count = await copyMeal(db, { date: addDays(date, -1), meal }, { date, meal });
    if (count > 0) copied(count, 'da ieri');
  };

  const saveAsMeal = (meal: MealKey, count: number) =>
    Alert.prompt(
      'Salva come pasto',
      `Dai un nome a questi ${countLabel(count, 'alimento', 'alimenti')}: li ritrovi in Aggiungi → Miei e li registri tutti insieme con un tocco.`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: async (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (trimmed === '') return;
            await saveMealFromDiary(db, { date, meal, name: trimmed });
            haptics.success();
            toast.show(`«${trimmed}» è tra i tuoi pasti`, 'bookmark.fill');
          },
        },
      ],
      'plain-text',
      `${mealLabel(meal)} tipo`,
    );

  const clearMeal = async (meal: MealKey, count: number, kcal: number) => {
    const ok = await confirmDestructive({
      title: `Svuotare ${mealLabel(meal).toLowerCase()}?`,
      message: `Elimini ${countLabel(count, 'alimento', 'alimenti')} (${formatKcal(kcal)} kcal) di ${dayName}.`,
      action: 'Svuota',
    });
    if (ok) await deleteMealEntries(db, date, meal);
  };

  const copyEntryTo = async (entry: Entry) => {
    await copyEntry(db, entry.id, copyTarget.date);
    haptics.success();
    toast.show(`Copiato in ${copyTarget.label}`, 'doc.on.doc.fill');
  };

  const moveEntryTo = async (entry: Entry, meal: MealKey) => {
    await moveEntry(db, entry.id, meal);
    haptics.success();
    toast.show(`Spostato in ${mealLabel(meal)}`, 'arrow.up.arrow.down');
  };

  // Picking the type the schedule already gives clears the manual choice.
  const changeDayType = (type: DayType) => void setDayType(db, date, type === data?.scheduledType ? null : type);

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu
          icon="ellipsis.circle"
          accessibilityLabel="Azioni sul giorno"
          hidden={entries.length === 0 && date === today}>
          {date !== today ? (
            <Stack.Toolbar.MenuAction icon="calendar" onPress={() => goTo(today)}>
              Torna a oggi
            </Stack.Toolbar.MenuAction>
          ) : null}
          {entries.length > 0 ? (
            <Stack.Toolbar.MenuAction
              icon="doc.on.doc"
              subtitle={countLabel(entries.length, 'alimento', 'alimenti')}
              onPress={() => void copyWholeDay()}>
              {`Copia tutto in ${copyTarget.label}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
          {entries.length > 0 ? (
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void clearDay()}>
              {`Svuota ${dayName}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="barcode.viewfinder"
          accessibilityLabel="Scansiona un codice a barre"
          onPress={() => openAdd(mealForTime(), true)}
        />
      </Stack.Toolbar>

      {expiry && expiry.level !== 'ok' ? <ExpiryBanner status={expiry} /> : null}

      <GestureDetector gesture={daySwipe} touchAction="pan-y">
        <View>
          <View style={styles.dateBar}>
            <Pressable
              onPress={() => goTo(addDays(date, -1))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Giorno precedente"
              style={styles.dateArrow}>
              <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
            </Pressable>
            <Animated.View style={[styles.flex, titleStyle]}>
              <Pressable
                onPress={() => goTo(today)}
                disabled={date === today}
                accessibilityRole="button"
                accessibilityHint={date === today ? undefined : 'Torna a oggi'}
                style={styles.dateTitle}>
                <AppText variant="headline" align="center">
                  {formatDayTitle(date, today)}
                </AppText>
                <AppText variant="footnote" tone="textSecondary" align="center">
                  {formatDaySubtitle(date, today)}
                </AppText>
              </Pressable>
            </Animated.View>
            <Pressable
              onPress={() => goTo(addDays(date, 1))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Giorno successivo"
              style={styles.dateArrow}>
              <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
            </Pressable>
          </View>

          <Animated.View style={summaryStyle}>
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
                  <Stat
                    label={remaining.over ? 'Oltre l’obiettivo' : 'Rimanenti'}
                    value={formatKcal(remaining.kcal)}
                    unit="kcal"
                    danger={remaining.over}
                  />
                  {totals.fiber !== null ? <Stat label="Fibre" value={formatNumber(totals.fiber, 0)} unit="g" /> : null}
                </View>
              </View>
              {targets ? <MacroProgress totals={totals} targets={targets} /> : null}
            </Card>
          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View style={mealsStyle}>
        {MEALS.map((meal) => {
          const mealEntries = entries.filter((e) => e.meal === meal.key);
          const mealTotals = sumNutrients(mealEntries.map((e) => e.totals));
          const count = mealEntries.length;
          const canCopy = count === 0 && data?.yesterdayMeals.has(meal.key);
          return (
            <View key={meal.key}>
              <View style={styles.mealHeader}>
                <View style={styles.flex}>
                  <AppText variant="title2">{meal.label}</AppText>
                  {count > 0 ? (
                    <View style={styles.mealTotals}>
                      <AppText variant="footnote" weight="600" numeric>
                        {`${formatKcal(mealTotals.kcal)} kcal`}
                      </AppText>
                      <MacroInline totals={mealTotals} />
                    </View>
                  ) : null}
                </View>
                <MenuButton
                  icon="ellipsis.circle"
                  accessibilityLabel={`Azioni per ${meal.label.toLowerCase()}`}
                  groups={[
                    {
                      actions: [
                        { label: 'Aggiungi alimento', icon: 'plus.circle', onPress: () => openAdd(meal.key) },
                        { label: 'Scansiona codice a barre', icon: 'barcode.viewfinder', onPress: () => openAdd(meal.key, true) },
                      ],
                    },
                    {
                      actions: [
                        ...(canCopy
                          ? [{ label: 'Copia da ieri', icon: 'clock.arrow.circlepath' as const, onPress: () => void copyFromYesterday(meal.key) }]
                          : []),
                        ...(count > 0
                          ? [
                              { label: 'Salva come pasto', icon: 'bookmark' as const, onPress: () => saveAsMeal(meal.key, count) },
                              { label: `Copia in ${copyTarget.label}`, icon: 'doc.on.doc' as const, onPress: () => void copyMealTo(meal.key) },
                            ]
                          : []),
                      ],
                    },
                    {
                      actions:
                        count > 0
                          ? [
                              {
                                label: `Svuota ${meal.label.toLowerCase()}`,
                                icon: 'trash' as const,
                                destructive: true,
                                onPress: () => void clearMeal(meal.key, count, mealTotals.kcal),
                              },
                            ]
                          : [],
                    },
                  ]}
                />
              </View>
              <ListGroup>
                {mealEntries.map((entry) => (
                  <SwipeToDelete key={entry.id} onDelete={() => void deleteEntry(db, entry.id)}>
                    <Link href={`/entry/${entry.id}`} asChild>
                      <Link.Trigger>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityHint="Tocca per modificare, tieni premuto per altre azioni, scorri a sinistra per eliminare"
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
                      </Link.Trigger>
                      <Link.Menu>
                        <Link.MenuAction icon="pencil" onPress={() => router.push(`/entry/${entry.id}`)}>
                          {entry.quick ? 'Modifica' : 'Modifica quantità'}
                        </Link.MenuAction>
                        <Link.Menu title="Sposta in" icon="arrow.up.arrow.down">
                          {MEALS.filter((m) => m.key !== entry.meal).map((m) => (
                            <Link.MenuAction key={m.key} icon={m.symbol} onPress={() => void moveEntryTo(entry, m.key)}>
                              {m.label}
                            </Link.MenuAction>
                          ))}
                        </Link.Menu>
                        <Link.MenuAction icon="doc.on.doc" onPress={() => void copyEntryTo(entry)}>
                          {`Copia in ${copyTarget.label}`}
                        </Link.MenuAction>
                        <Link.MenuAction icon="trash" destructive onPress={() => void deleteEntry(db, entry.id)}>
                          Elimina
                        </Link.MenuAction>
                      </Link.Menu>
                    </Link>
                  </SwipeToDelete>
                ))}
                <ActionRow label={`Aggiungi a ${mealLabel(meal.key).toLowerCase()}`} onPress={() => openAdd(meal.key)} />
                {canCopy ? (
                  <Row
                    title="Copia da ieri"
                    subtitle="Ripeti gli stessi alimenti di ieri"
                    icon={<Icon name="clock.arrow.circlepath" size={18} tone="textSecondary" />}
                    onPress={() => void copyFromYesterday(meal.key)}
                    chevron={false}
                  />
                ) : null}
              </ListGroup>
            </View>
          );
        })}
      </Animated.View>
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

function Stat({ label, value, unit, danger = false }: { label: string; value: string; unit: string; danger?: boolean }) {
  return (
    <View>
      <AppText variant="footnote" tone="textSecondary">
        {label}
      </AppText>
      <AppText variant="title2" numeric tone={danger ? 'danger' : 'text'}>
        {value}
        <AppText variant="subhead" tone="textSecondary">{` ${unit}`}</AppText>
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
  dateTitle: { paddingVertical: Spacing.xs },
  dayType: { marginBottom: Spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  expiry: { borderWidth: 1.5 },
  summary: { gap: Spacing.xl },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  summaryStats: { flex: 1, gap: Spacing.lg },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  mealTotals: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
});
