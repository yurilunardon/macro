import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import { copyEntry, copyMeal, deleteEntry, deleteMealEntries, getEntriesForDate, moveEntry, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { saveMealFromDiary } from '@/db/saved-meals';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, daysBetween, formatDaySubtitle, formatDayTitle, formatLongDate, weekdayOf, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { QUICK_ADD_NAME } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

import { AppText } from './app-text';
import { Card, ListGroup } from './card';
import { Icon } from './icon';
import { MenuButton } from './menu-button';
import { MacroBars } from './nutrient-grid';
import { CalorieRing } from './progress';
import { confirmDestructive } from './prompt';
import { SwipeToDelete } from './swipe-to-delete';
import { toast } from './toast';

const FADE_IN = FadeIn.duration(180);
// A short eased resize, no spring: the meals below must not bounce up and down.
const MEAL_LAYOUT = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));
const ENTRY_OUT = FadeOut.duration(160);

/** Emptying the day takes its foods away one after the other, in about this long all together. */
const CLEAR_MS = 900;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "120 g · Barilla", or for a quick entry just that it was typed by hand. */
function entryDetail(entry: Entry): string | null {
  if (entry.quick) return entry.name === QUICK_ADD_NAME ? null : QUICK_ADD_NAME;
  return [`${formatNumber(entry.quantity, 1)} ${entry.unit}`, entry.brand].filter(Boolean).join(' · ');
}

type DayPageProps = {
  date: DateKey;
  today: DateKey;
  /**
   * Only the day on screen gets menus, swipe actions and context menus. The days around it are
   * drawn ahead as the same layout without them, so they cost little to keep ready and nothing
   * moves when a day becomes the current one.
   */
  interactive: boolean;
  /** Called once the day's data is on screen. */
  onReady?: (date: DateKey) => void;
  /** Scrolls the screen back up to the day's ring; resolved once there. */
  scrollToTop?: () => Promise<void>;
};

/**
 * One day of the food diary, read top to bottom as a list in Settings or Health: the date with
 * the kind of day, what is left of the day's calories and macros, then each meal as a section,
 * its name and calories as the header and the foods in a card under it. The macros of each food
 * are one tap away, on the food, instead of coloured numbers on every line.
 */
export const DayPage = memo(function DayPage({ date, today, interactive, onReady, scrollToTop }: DayPageProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const hidden = usePendingDeletes();

  const { data } = useLiveQuery(
    `diary:${date}`,
    async (database) => {
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
    },
    ['food', 'settings'],
  );
  const loaded = data !== undefined;
  // Read through a ref, so a new callback from the screen does not redraw the page.
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });
  useEffect(() => {
    if (loaded) readyRef.current?.(date);
  }, [loaded, date]);

  // The foods already taken away while the day is being emptied: only from the day as it was read
  // then, so once it is read again without them nothing is left to hide, or to flash back.
  const [cleared, setCleared] = useState<{ from: typeof data; ids: ReadonlySet<number> } | null>(null);
  const gone = cleared && cleared.from === data ? cleared.ids : null;
  const entries = (data?.entries ?? []).filter((e) => !hidden.has(`entry:${e.id}`) && !gone?.has(e.id));
  const totals = sumNutrients(entries.map((e) => e.totals));
  const targets = data?.plan.targets;
  // From today things are copied to tomorrow (to plan ahead), from any other day to today.
  const copyTarget = date === today ? { date: addDays(today, 1), label: 'domani' } : { date: today, label: 'oggi' };

  const removeEntry = (entry: Entry) =>
    deleteWithUndo({ key: `entry:${entry.id}`, title: `${entry.name} eliminato`, run: () => deleteEntry(db, entry.id) });

  const copied = (count: number, where: string) => {
    haptics.success();
    toast.show(`${countLabel(count, 'alimento copiato', 'alimenti copiati')} ${where}`, 'doc.on.doc.fill');
  };

  const copyFromYesterday = async (meal: MealKey) => {
    const count = await copyMeal(db, { date: addDays(date, -1), meal }, { date, meal });
    if (count > 0) copied(count, 'da ieri');
  };

  const saveAsMeal = (meal: MealKey, count: number) =>
    Alert.prompt(
      'Salva come pasto',
      countLabel(count, 'alimento', 'alimenti'),
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: async (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (trimmed === '') return;
            await saveMealFromDiary(db, { date, meal, name: trimmed });
            haptics.success();
            toast.show(`${trimmed} salvato`, 'bookmark.fill');
          },
        },
      ],
      'plain-text',
      `${mealLabel(meal)} tipo`,
    );

  const clearMeal = async (meal: MealKey, count: number, kcal: number) => {
    const ok = await confirmDestructive({
      title: `Svuotare ${mealLabel(meal).toLowerCase()}?`,
      message: `${countLabel(count, 'alimento', 'alimenti')}, ${formatKcal(kcal)} kcal.`,
      action: 'Svuota',
    });
    if (ok) await deleteMealEntries(db, date, meal);
  };

  // At the foot of the day, out of the way: rarely wanted, and never by accident.
  const clearDay = async () => {
    const ok = await confirmDestructive({
      title: `Svuotare ${formatDayTitle(date, today).toLowerCase()}?`,
      message: `${countLabel(entries.length, 'alimento', 'alimenti')}, ${formatKcal(totals.kcal)} kcal.`,
      action: 'Svuota',
    });
    if (!ok) return;
    // Up to the ring first, then the foods leave one by one from the top, as the ring empties.
    await scrollToTop?.();
    const order = MEALS.flatMap((m) => entries.filter((e) => e.meal === m.key));
    const step = Math.min(Math.max(CLEAR_MS / order.length, 45), 110);
    const ids = new Set<number>();
    for (const entry of order) {
      ids.add(entry.id);
      setCleared({ from: data, ids: new Set(ids) });
      haptics.selection();
      await wait(step);
    }
    await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
    haptics.success();
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

  const dayType = data?.plan.dayType ?? null;
  // "Oggi", "Ieri", "Domani", or how far away: the week strip above already marks today.
  const relative = Math.abs(daysBetween(today, date)) <= 1 ? formatDayTitle(date, today) : formatDaySubtitle(date, today);

  // The date belongs to the page, as in Calendar: dragging, the days on either side come in with
  // theirs. The kind of day sits beside it, since it sets the day's goals.
  const heading = (
    <View style={styles.heading}>
      <View style={styles.flex}>
        <AppText variant="headline" numberOfLines={1}>
          {formatLongDate(date)}
        </AppText>
        <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
          {relative}
        </AppText>
      </View>
      {dayType ? (
        <MenuButton
          inert={!interactive}
          icon={dayType === 'training' ? 'figure.strengthtraining.traditional' : 'bed.double.fill'}
          title={dayType === 'training' ? 'Allenamento' : 'Riposo'}
          accessibilityLabel="Tipo di giorno: cambia gli obiettivi"
          groups={[
            {
              title: 'Obiettivi del giorno',
              actions: [
                {
                  label: 'Allenamento',
                  icon: 'figure.strengthtraining.traditional',
                  checked: dayType === 'training',
                  onPress: () => changeDayType('training'),
                },
                { label: 'Riposo', icon: 'bed.double.fill', checked: dayType === 'rest', onPress: () => changeDayType('rest') },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );

  // Until its data is there the day shows only its date, then the rest fades in: never a
  // half-filled page.
  if (!data) {
    return (
      <View>
        {heading}
        <View style={styles.loading} />
      </View>
    );
  }

  return (
    <View>
      {heading}
      <Animated.View entering={FADE_IN}>
        {data.plan.isDefault ? (
          <Pressable onPress={() => router.navigate('/goals')} accessibilityRole="button">
            <Card style={[styles.banner, { backgroundColor: theme.accentSoft }]}>
              <Icon name="target" size={22} tone="accent" />
              <View style={styles.flex}>
                <AppText variant="headline">Imposta i tuoi obiettivi</AppText>
                <AppText variant="subhead" tone="textSecondary">
                  Calorie e macro da peso, altezza e attività.
                </AppText>
              </View>
              <Icon name="chevron.right" size={13} tone="textSecondary" weight="semibold" />
            </Card>
          </Pressable>
        ) : null}

        {/* Straight on the page, as the rings in Fitness: what is left of the day comes first. */}
        <View style={styles.summary}>
          <CalorieRing eaten={totals.kcal} target={targets?.kcal ?? 0} />
          {targets ? (
            <MacroBars totals={totals} targets={targets} onPress={(key) => router.push({ pathname: '/nutrients', params: { date, key } })} />
          ) : null}
        </View>

        {/*
          Each meal is one block, as in MyFitnessPal and FoodNoms: its name and calories at the
          top, the foods, and "Aggiungi alimento" at the bottom, so what is added plainly goes to
          that meal. Blocks are apart by a gap of the page, like groups in Settings.
        */}
        {MEALS.map((meal) => {
          const mealEntries = entries.filter((e) => e.meal === meal.key);
          const mealKcal = sumNutrients(mealEntries.map((e) => e.totals)).kcal;
          const count = mealEntries.length;
          const canCopy = count === 0 && data.yesterdayMeals.has(meal.key);
          const addRow = (pressed: boolean) => (
            <View style={[styles.addRow, pressed && { backgroundColor: theme.cardPressed }]}>
              <Icon name="plus.circle.fill" size={20} tone="accent" />
              <AppText weight="600" tone="accent">
                Aggiungi alimento
              </AppText>
            </View>
          );
          return (
            // The block follows its content's size smoothly, and the ones below follow it.
            <Animated.View key={meal.key} layout={MEAL_LAYOUT} style={styles.meal}>
              <ListGroup>
                <View style={[styles.mealHeader, count > 0 && styles.mealHeaderWithMenu]}>
                  <Icon name={meal.symbol} size={16} tone="textSecondary" />
                  <AppText variant="headline" style={styles.flex} numberOfLines={1}>
                    {meal.label}
                  </AppText>
                  {count > 0 ? (
                    <AppText variant="subhead" weight="600" tone="textSecondary" numeric>
                      {`${formatKcal(mealKcal)} kcal`}
                    </AppText>
                  ) : null}
                  {/* An empty meal that was there yesterday: one tap fills it the same way. */}
                  {canCopy ? (
                    <Pressable
                      disabled={!interactive}
                      onPress={() => void copyFromYesterday(meal.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`Copia ${meal.label.toLowerCase()} da ieri`}
                      style={({ pressed }) => [styles.copy, { backgroundColor: theme.fill }, pressed && styles.pressed]}>
                      <Icon name="clock.arrow.circlepath" size={13} tone="textSecondary" />
                      <AppText variant="footnote" weight="600" tone="textSecondary">
                        Copia da ieri
                      </AppText>
                    </Pressable>
                  ) : null}
                  {count > 0 ? (
                    <MenuButton
                      inert={!interactive}
                      icon="ellipsis.circle"
                      accessibilityLabel={`Azioni per ${meal.label.toLowerCase()}`}
                      // What the row at the bottom does not: keep the meal for another day, or clear it.
                      groups={[
                        {
                          actions: [
                            { label: 'Salva come pasto', icon: 'bookmark', onPress: () => saveAsMeal(meal.key, count) },
                            {
                              label: `Svuota ${meal.label.toLowerCase()}`,
                              icon: 'trash',
                              destructive: true,
                              onPress: () => void clearMeal(meal.key, count, mealKcal),
                            },
                          ],
                        },
                      ]}>
                      <View style={styles.headerButton}>
                        <Icon name="ellipsis.circle" size={22} tone="textSecondary" />
                      </View>
                    </MenuButton>
                  ) : null}
                </View>
                {mealEntries.map((entry) => {
                  const row = (pressed: boolean) => (
                    <View style={[styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
                      <View style={styles.entryText}>
                        <AppText numberOfLines={1}>{entry.name}</AppText>
                        {entryDetail(entry) ? (
                          <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                            {entryDetail(entry)}
                          </AppText>
                        ) : null}
                      </View>
                      <Kcal value={entry.totals.kcal} />
                    </View>
                  );
                  if (!interactive) return <View key={entry.id}>{row(false)}</View>;
                  return (
                    // It fades as it leaves and the rows under it close the gap.
                    <Animated.View key={entry.id} exiting={ENTRY_OUT} layout={MEAL_LAYOUT}>
                      <SwipeToDelete onDelete={() => removeEntry(entry)}>
                        <Link href={`/entry/${entry.id}`} asChild>
                          <Link.Trigger>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityHint="Tocca per modificare, tieni premuto per altre azioni, scorri a sinistra per eliminare">
                              {({ pressed }) => row(pressed)}
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
                            <Link.MenuAction icon="trash" destructive onPress={() => removeEntry(entry)}>
                              Elimina
                            </Link.MenuAction>
                          </Link.Menu>
                        </Link>
                      </SwipeToDelete>
                    </Animated.View>
                  );
                })}
                {/* The sheet to add grows out of this row and shrinks back into it. */}
                {interactive ? (
                  <Link key="add" href={{ pathname: '/add', params: { meal: meal.key, date } }} asChild>
                    <Link.Trigger withAppleZoom>
                      {/* A plain style: Link's Slot drops a style given as a function. */}
                      <Pressable accessibilityRole="button" accessibilityLabel={`Aggiungi a ${meal.label.toLowerCase()}`}>
                        {({ pressed }) => addRow(pressed)}
                      </Pressable>
                    </Link.Trigger>
                  </Link>
                ) : (
                  <View key="add">{addRow(false)}</View>
                )}
              </ListGroup>
            </Animated.View>
          );
        })}
        {entries.length > 0 ? (
          <Pressable
            disabled={!interactive}
            onPress={() => void clearDay()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.clearDay, pressed && styles.pressed]}>
            <AppText variant="subhead" weight="600" tone="danger">
              Svuota giorno
            </AppText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
});

/** "435 kcal" on one line, the number leading. */
function Kcal({ value }: { value: number }) {
  return (
    <AppText numeric tone="textSecondary">
      {formatKcal(value)}
      <AppText variant="footnote" tone="textSecondary">
        {' kcal'}
      </AppText>
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { minHeight: 700 },
  pressed: { opacity: 0.6 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm, minHeight: 64 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  meal: { marginTop: Spacing.lg },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 48,
  },
  // The ⋯ is drawn in a 40-wide button: this puts it in line with the calories under it.
  mealHeaderWithMenu: { paddingRight: Spacing.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, minHeight: 48 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    minHeight: 52,
  },
  entryText: { flex: 1, gap: 1 },
  clearDay: { alignSelf: 'center', paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  headerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 2,
    height: 28,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
});
