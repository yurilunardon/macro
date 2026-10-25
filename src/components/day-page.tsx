import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import { copyEntry, copyMeal, deleteEntry, deleteMealEntries, getEntriesForDate, moveEntry, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { saveMealFromDiary } from '@/db/saved-meals';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { remainingKcal } from '@/lib/calories';
import { addDays, formatDayTitle, weekdayOf, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { QUICK_ADD_NAME } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { ActionRow, Card, ListGroup, Row } from './card';
import { Icon } from './icon';
import { MacroPills } from './macro-pills';
import { MenuButton } from './menu-button';
import { project } from './motion';
import { NutrientGrid } from './nutrient-grid';
import { CalorieRing } from './progress';
import { confirmDestructive } from './prompt';
import { SwipeToDelete } from './swipe-to-delete';
import { toast } from './toast';

/** How the visible page moves: shared with the screen, which owns the pager. */
export type DayPager = {
  /** Horizontal position of the row of pages. */
  track: SharedValue<number>;
  /** Index of the page being shown, in days from the pager's anchor date. */
  position: SharedValue<number>;
  /** Width of a page plus the gap to the next one. */
  stride: number;
  pageWidth: number;
  /** Called on the JS side once a swipe has settled on another day. */
  onSwipe: (position: number) => void;
};

const PAGE_SPRING = { duration: 450, dampingRatio: 1 };
const tick = haptics.selection;

/** "120 g · Barilla", or for a quick entry just that it was typed by hand. */
function entryDetail(entry: Entry): string | null {
  if (entry.quick) return entry.name === QUICK_ADD_NAME ? null : QUICK_ADD_NAME;
  return [`${formatNumber(entry.quantity, 1)} ${entry.unit}`, entry.brand].filter(Boolean).join(' · ');
}

type DayPageProps = {
  date: DateKey;
  today: DateKey;
  /** The page on screen; its neighbours are drawn ahead so a swipe never shows stale data. */
  active: boolean;
  pager: DayPager;
  /** Called once this day's data is on screen. */
  onReady: (date: DateKey) => void;
};

/** One day of the food diary: summary of the day and its four meals. */
export function DayPage({ date, today, active, pager, onReady }: DayPageProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

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
  const loaded = data !== undefined;
  useEffect(() => {
    if (loaded) onReady(date);
  }, [loaded, date, onReady]);

  // Dragging the summary moves the whole row of pages; far or fast enough, it turns the day.
  const { track, position, stride, pageWidth, onSwipe } = pager;
  const dragStart = useSharedValue(0);
  const pan = usePanGesture({
    enabled: active,
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      // Grabbing the pages mid-animation continues from where they are.
      dragStart.set(track.get());
    },
    onUpdate: (event) => {
      'worklet';
      track.set(dragStart.get() + event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      // Where the pages would come to rest, relative to the page that was showing.
      const projected = track.get() + project(event.velocityX, 0.99) + position.get() * stride;
      // Swiping left goes forward in time, as in Calendar.
      const direction = !event.canceled && Math.abs(projected) > pageWidth * 0.3 ? (projected < 0 ? 1 : -1) : 0;
      const next = position.get() + direction;
      position.set(next);
      track.set(withSpring(-next * stride, { ...PAGE_SPRING, velocity: event.velocityX }));
      if (direction !== 0) {
        scheduleOnRN(tick);
        scheduleOnRN(onSwipe, next);
      }
    },
  });

  const entries = data?.entries ?? [];
  const totals = sumNutrients(entries.map((e) => e.totals));
  const targets = data?.plan.targets;
  const remaining = remainingKcal(totals.kcal, targets?.kcal ?? 0);
  const dayName = formatDayTitle(date, today).toLowerCase();
  // From today things are copied to tomorrow (to plan ahead), from any other day to today.
  const copyTarget = date === today ? { date: addDays(today, 1), label: 'domani' } : { date: today, label: 'oggi' };

  const openAdd = (meal: MealKey, scan = false) =>
    router.push({ pathname: scan ? '/add/scan' : '/add', params: { meal, date } });

  const copied = (count: number, where: string) => {
    haptics.success();
    toast.show(`${countLabel(count, 'alimento copiato', 'alimenti copiati')} ${where}`, 'doc.on.doc.fill');
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
  const changeDayType = (type: DayType) => {
    if (type === data?.plan.dayType) return;
    haptics.selection();
    void setDayType(db, date, type === data?.scheduledType ? null : type);
  };

  return (
    <View>
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

      <GestureDetector gesture={pan} touchAction="pan-y">
        <View>
          <Card style={styles.summary}>
            <View style={styles.summaryTop}>
              <CalorieRing eaten={totals.kcal} target={targets?.kcal ?? 0} />
              <View style={styles.summaryStats}>
                <View>
                  <AppText variant="footnote" tone="textSecondary">
                    {remaining.over ? 'Oltre l’obiettivo' : 'Rimanenti'}
                  </AppText>
                  <AppText variant="title2" numeric tone={remaining.over ? 'danger' : 'text'}>
                    {formatKcal(remaining.kcal)}
                    <AppText variant="subhead" tone="textSecondary">
                      {' kcal'}
                    </AppText>
                  </AppText>
                </View>
                {data?.plan.dayType ? (
                  active ? (
                    <MenuButton
                      icon={data.plan.dayType === 'training' ? 'figure.strengthtraining.traditional' : 'bed.double.fill'}
                      title={data.plan.dayType === 'training' ? 'Allenamento' : 'Riposo'}
                      accessibilityLabel="Tipo di giorno: cambia gli obiettivi"
                      groups={[
                        {
                          title: 'Obiettivi del giorno',
                          actions: [
                            {
                              label: 'Allenamento',
                              icon: 'figure.strengthtraining.traditional',
                              checked: data.plan.dayType === 'training',
                              onPress: () => changeDayType('training'),
                            },
                            {
                              label: 'Riposo',
                              icon: 'bed.double.fill',
                              checked: data.plan.dayType === 'rest',
                              onPress: () => changeDayType('rest'),
                            },
                          ],
                        },
                      ]}
                    />
                  ) : (
                    <AppText variant="subhead" weight="600" tone="accent">
                      {data.plan.dayType === 'training' ? 'Allenamento' : 'Riposo'}
                    </AppText>
                  )
                ) : null}
              </View>
            </View>
            {targets ? (
              <NutrientGrid
                totals={totals}
                targets={targets}
                onPress={(key) => router.push({ pathname: '/nutrients', params: { date, key } })}
              />
            ) : null}
          </Card>
        </View>
      </GestureDetector>

      {MEALS.map((meal) => {
        const mealEntries = entries.filter((e) => e.meal === meal.key);
        const mealTotals = sumNutrients(mealEntries.map((e) => e.totals));
        const count = mealEntries.length;
        const canCopy = count === 0 && data?.yesterdayMeals.has(meal.key);
        const menu = (
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
        );
        return (
          <View key={meal.key} style={styles.meal}>
            <ListGroup>
              <View style={styles.mealHeader}>
                <Icon name={meal.symbol} size={18} tone="textSecondary" />
                <View style={styles.flex}>
                  <AppText variant="headline">{meal.label}</AppText>
                  {count > 0 ? <MacroPills totals={mealTotals} /> : null}
                </View>
                {count > 0 ? (
                  <AppText variant="headline" numeric>
                    {formatKcal(mealTotals.kcal)}
                    <AppText variant="footnote" tone="textSecondary">
                      {' kcal'}
                    </AppText>
                  </AppText>
                ) : null}
                {active ? menu : <Icon name="ellipsis.circle" size={22} tone="accent" />}
              </View>
              {mealEntries.map((entry) => (
                <SwipeToDelete key={entry.id} onDelete={() => void deleteEntry(db, entry.id)}>
                  <Link href={`/entry/${entry.id}`} asChild>
                    <Link.Trigger>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Tocca per modificare, tieni premuto per altre azioni, scorri a sinistra per eliminare">
                        {({ pressed }) => (
                          <View style={[styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
                            <View style={styles.entryText}>
                              <AppText numberOfLines={1}>{entry.name}</AppText>
                              {entryDetail(entry) ? (
                                <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                                  {entryDetail(entry)}
                                </AppText>
                              ) : null}
                              <View style={styles.entryPills}>
                                <MacroPills totals={entry.totals} />
                              </View>
                            </View>
                            <View style={styles.entryKcal}>
                              <AppText variant="headline" numeric>
                                {formatKcal(entry.totals.kcal)}
                              </AppText>
                              <AppText variant="caption" tone="textSecondary">
                                kcal
                              </AppText>
                            </View>
                          </View>
                        )}
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
              <ActionRow label="Aggiungi" onPress={() => openAdd(meal.key)} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: Spacing.xs + 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  summary: { gap: Spacing.lg },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  summaryStats: { flex: 1, gap: Spacing.md, alignItems: 'flex-start' },
  meal: { marginTop: Spacing.lg },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: 56,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  entryText: { flex: 1, gap: 2 },
  entryPills: { marginTop: Spacing.xs },
  entryKcal: { alignItems: 'flex-end' },
});
