import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import { copyEntry, copyMeal, deleteEntry, deleteMealEntries, getEntriesForDate, moveEntry, type Entry } from '@/db/entries';
import { prefetch, useLiveQuery } from '@/db/live';
import { recentFoodsScreen } from '@/db/screens';
import { saveMealFromDiary } from '@/db/saved-meals';
import { getDoseChanges, getDoseTimes, getSupplements, setDoseTaken } from '@/db/supplements';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, daysBetween, formatDaySubtitle, formatDayTitle, formatLongDate, weekdayOf, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { sameProduct } from '@/lib/links';
import { MEALS, mealForClock, mealLabel, type MealKey } from '@/lib/meals';
import { buildDay, DEFAULT_WEIGH_IN, isoAt, type DayEntry } from '@/lib/plan';
import { formatDose, supplementSymbol } from '@/lib/supplements';
import { sumNutrients } from '@/lib/nutrition';
import { QUICK_ADD_NAME } from '@/lib/quick-add';
import { CLEAR_MS, setDrainingDay } from '@/services/draining-day';
import { haptics } from '@/services/haptics';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

import { AppText } from './app-text';
import { Card, ListGroup } from './card';
import type { DayPageProps as PagerProps } from './day-pager';
import { Icon } from './icon';
import { openCoach, ReadyQuestion } from './coach-cards';
import { MenuButton } from './menu-button';
import { SMOOTH_MS } from './motion';
import { MacroBars } from './nutrient-grid';
import { CalorieRing, useCountedNumber } from './progress';
import { confirmDestructive } from './prompt';
import { SwipeToDelete } from './swipe-to-delete';
import { toast } from './toast';

const FADE_IN = FadeIn.duration(180);
// A short eased resize, no spring: the meals below must not bounce up and down.
const MEAL_LAYOUT = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));
const ENTRY_OUT = FadeOut.duration(150);
// What sits on the right of a meal's name when it fills or empties, fading where it is.
const MEAL_TOTAL_IN = FadeIn.duration(220).delay(120);
const MEAL_TOTAL_OUT = FadeOut.duration(180);
// While the day is emptied, the rows below wait for the one leaving to be gone before moving up:
// together they would slide over it as it fades.
const DRAIN_LAYOUT = LinearTransition.duration(240).delay(120).easing(Easing.inOut(Easing.cubic));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "120 g · Barilla", or for a quick entry just that it was typed by hand. */
function entryDetail(entry: Entry): string | null {
  if (entry.quick) return entry.name === QUICK_ADD_NAME ? null : QUICK_ADD_NAME;
  return [`${formatNumber(entry.quantity, 1)} ${entry.unit}`, entry.brand].filter(Boolean).join(' · ');
}

/**
 * Only the day on screen gets menus, swipe actions and context menus (`interactive`). The days
 * around it are drawn ahead as the same layout without them, so they cost little to keep ready
 * and nothing moves when a day becomes the current one.
 */
type DayPageProps = PagerProps & {
  date: DateKey;
  today: DateKey;
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
      const [entries, yesterday, plan, training, supplements, taken, changes] = await Promise.all([
        getEntriesForDate(database, date),
        getEntriesForDate(database, addDays(date, -1)),
        getDayPlan(database, date),
        getTrainingSettings(database),
        getSupplements(database),
        getDoseTimes(database, date),
        getDoseChanges(database, date, date),
      ]);
      // The day's doses, each in the meal of its time: what was taken where it was taken, the rest
      // until the day is over. A training day by the diary stands for the calendar's busy days.
      const doses = buildDay({
        date,
        supplements,
        taken,
        changes,
        active: new Set(plan.dayType === 'training' ? [date] : []),
        weighIn: { ...DEFAULT_WEIGH_IN, enabled: false },
        weight: null,
      })
        .flatMap((e) => (e.kind === 'supplement' && !e.skipped && (e.done || date >= today) ? [e] : []))
        // A shake taken is already in the meal as a food, with its calories: once is enough.
        .filter((d) => !d.done || !entries.some((e) => sameProduct(d.supplement.name, e.name)));
      return {
        entries,
        yesterdayMeals: new Set(yesterday.map((e) => e.meal)),
        plan,
        scheduledType: dayTypeFor(weekdayOf(date), training.trainingWeekdays, null),
        doses,
      };
    },
    ['food', 'settings', 'calendar'],
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
  // From the first food taken away the ring and bars head for empty all at once, slowly.
  const draining = gone !== null;
  const shownTotals = draining ? sumNutrients([]) : totals;
  // The day on screen moves slowly and evenly, its number counting along; only the ones kept ready beside it do not need to.
  const slowMs = draining ? CLEAR_MS : interactive ? SMOOTH_MS : undefined;
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
    const step = CLEAR_MS / order.length;
    const ids = new Set<number>();
    setDrainingDay(date);
    for (const [index, entry] of order.entries()) {
      ids.add(entry.id);
      setCleared({ from: data, ids: new Set(ids) });
      // A soft tick now and then, not a buzz: one every few foods on a full day.
      if (index % Math.ceil(order.length / 6) === 0) haptics.selection();
      await wait(step);
    }
    await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
    setDrainingDay(null);
    haptics.success();
  };

  const toggleDose = async (dose: SupplementDose) => {
    haptics.selection();
    const at = dose.done ? undefined : date === today ? new Date().toISOString() : isoAt(date, dose.planned);
    await setDoseTaken(db, dose.supplement.id, date, dose.index, !dose.done, at);
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
        <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
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
          <CalorieRing eaten={shownTotals.kcal} target={targets?.kcal ?? 0} slowMs={slowMs} />
          {targets ? (
            <MacroBars
              totals={shownTotals}
              targets={targets}
              slowMs={slowMs}
              onPress={(key) => router.push({ pathname: '/nutrients', params: { date, key } })}
            />
          ) : null}
        </View>

        {/* Today, from the afternoon: one question for the coach when the numbers ask for it. */}
        {interactive && date === today ? (
          <View style={styles.ready}>
            <ReadyQuestion
              eaten={totals}
              target={data.plan.isDefault ? null : (targets ?? null)}
              summary={targets ? `Oggi ${Math.round(totals.kcal)} kcal su ${Math.round(targets.kcal)}, proteine ${Math.round(totals.protein)} g su ${Math.round(targets.protein)}` : ''}
            />
          </View>
        ) : null}

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
              <Icon name="plus.circle.fill" size={18} tone="accent" />
              <AppText variant="callout" tone="accent">
                Aggiungi alimento
              </AppText>
            </View>
          );
          return (
            // The block follows its content's size smoothly, and the ones below follow it.
            <Animated.View key={meal.key} layout={draining ? DRAIN_LAYOUT : MEAL_LAYOUT} style={styles.meal}>
              <ListGroup>
                <View style={[styles.mealHeader, count > 0 && styles.mealHeaderWithMenu]}>
                  <Icon name={meal.symbol} size={17} tone="textSecondary" />
                  {/* The meal is the section's title: heavier than the rows and a point over them, no more. */}
                  <AppText variant="headline" style={styles.flex} numberOfLines={1}>
                    {meal.label}
                  </AppText>
                  {/* It counts along with the ring; with the meal's last food it fades where it is. */}
                  {count > 0 ? (
                    <Animated.View entering={interactive ? MEAL_TOTAL_IN : undefined} exiting={interactive ? MEAL_TOTAL_OUT : undefined}>
                      <MealKcal value={mealKcal} ms={slowMs} />
                    </Animated.View>
                  ) : null}
                  {/* An empty meal that was there yesterday: one tap fills it the same way. */}
                  {canCopy ? (
                    <Animated.View entering={interactive ? MEAL_TOTAL_IN : undefined} exiting={interactive ? MEAL_TOTAL_OUT : undefined}>
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
                    </Animated.View>
                  ) : null}
                  {count > 0 ? (
                    <Animated.View entering={interactive ? MEAL_TOTAL_IN : undefined} exiting={interactive ? MEAL_TOTAL_OUT : undefined}>
                    <MenuButton
                      inert={!interactive}
                      icon="ellipsis.circle"
                      accessibilityLabel={`Azioni per ${meal.label.toLowerCase()}`}
                      // What the row at the bottom does not: keep the meal for another day, or clear it.
                      groups={[
                        {
                          actions: [
                            {
                              label: 'Chiedi al coach',
                              icon: 'sparkles',
                              onPress: () =>
                                openCoach(router, {
                                  about: `${meal.label} di ${formatLongDate(date).toLowerCase()}`,
                                  context: mealEntries.map((e) => `${e.name} ${Math.round(e.totals.kcal)} kcal, P${Math.round(e.totals.protein)}`).join('; '),
                                }),
                            },
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
                    </Animated.View>
                  ) : null}
                </View>
                {mealEntries.map((entry) => {
                  const row = (pressed: boolean) => (
                    <View style={[styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
                      <View style={styles.entryText}>
                        <AppText variant="callout" numberOfLines={1}>{entry.name}</AppText>
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
                    <Animated.View key={entry.id} exiting={ENTRY_OUT} layout={draining ? DRAIN_LAYOUT : MEAL_LAYOUT}>
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
                {/* The supplements of the meal's hours, from the calendar: ticked here, ticked there. */}
                {data.doses
                  .filter((d) => mealForClock(d.at) === meal.key)
                  .map((dose) => (
                    <Animated.View key={dose.key} layout={draining ? DRAIN_LAYOUT : MEAL_LAYOUT}>
                      <DoseRow dose={dose} interactive={interactive} onToggle={() => void toggleDose(dose)} />
                    </Animated.View>
                  ))}
                {/* The sheet to add grows out of this row and shrinks back into it. */}
                {interactive ? (
                  <Animated.View key="add" layout={draining ? DRAIN_LAYOUT : MEAL_LAYOUT}>
                    <Link href={{ pathname: '/add', params: { meal: meal.key, date } }} asChild>
                      <Link.Trigger withAppleZoom>
                        {/* A plain style: Link's Slot drops a style given as a function. */}
                        <Pressable
                          onPressIn={() => void prefetch(db, recentFoodsScreen)}
                          accessibilityRole="button"
                          accessibilityLabel={`Aggiungi a ${meal.label.toLowerCase()}`}>
                          {({ pressed }) => addRow(pressed)}
                        </Pressable>
                      </Link.Trigger>
                    </Link>
                  </Animated.View>
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
            <AppText variant="subhead" tone="danger">
              Svuota giorno
            </AppText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
});

type SupplementDose = Extract<DayEntry, { kind: 'supplement' }>;

/**
 * A dose of a supplement among the foods of its meal: a circle to tick, as in the calendar, its
 * name and how much, and when it was taken or is meant to be.
 */
function DoseRow({ dose, interactive, onToggle }: { dose: SupplementDose; interactive: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const s = dose.supplement;
  const when = dose.done ? `presa alle ${dose.at}` : `alle ${dose.planned}`;
  return (
    <Pressable
      disabled={!interactive}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: dose.done }}
      accessibilityLabel={`${s.name}, ${formatDose(s.dose, s.unit)}, ${when}`}
      accessibilityHint="Segna l’integratore, anche nel calendario">
      {({ pressed }) => (
        <View style={[styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
          <View style={[styles.tick, { borderColor: dose.done ? theme.accent : theme.textTertiary, backgroundColor: dose.done ? theme.accent : 'transparent' }]}>
            {dose.done ? <Icon name="checkmark" size={11} color={theme.onAccent} weight="bold" /> : null}
          </View>
          <View style={styles.entryText}>
            <AppText variant="callout" numberOfLines={1} tone={dose.done ? 'text' : 'textSecondary'}>
              {s.name}
            </AppText>
            <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
              {`${formatDose(s.dose, s.unit)} · ${when}`}
            </AppText>
          </View>
          <Icon name={supplementSymbol(s.unit)} size={15} tone="textTertiary" />
        </View>
      )}
    </Pressable>
  );
}

/** A meal's calories, moving with the day's ring when a food comes or goes. */
function MealKcal({ value, ms }: { value: number; ms?: number }) {
  const counted = useCountedNumber(value, ms);
  return (
    <AppText variant="subhead" weight="600" tone="textSecondary" numeric>
      {formatKcal(counted)}
      <AppText variant="footnote" tone="textSecondary">
        {' kcal'}
      </AppText>
    </AppText>
  );
}

/** "435 kcal" on one line, the number leading. */
function Kcal({ value }: { value: number }) {
  return (
    <AppText variant="subhead" numeric tone="textSecondary">
      {formatKcal(value)}
      <AppText variant="footnote" tone="textSecondary">
        {' kcal'}
      </AppText>
    </AppText>
  );
}

const styles = StyleSheet.create({
  ready: { marginBottom: Spacing.md },
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
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, minHeight: 46 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 50,
  },
  entryText: { flex: 1, gap: 1 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
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
