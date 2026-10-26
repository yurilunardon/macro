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
import { addDays, weekdayOf, type DateKey } from '@/lib/dates';
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
import { project } from './motion';
import { MacroBars } from './nutrient-grid';
import { MacroInline } from './nutrition';
import { CalorieRing } from './progress';
import { confirmDestructive } from './prompt';
import { SwipeToDelete } from './swipe-to-delete';
import { toast } from './toast';

/** How the visible page moves: shared with the screen, which owns the pager. */
export type DayPager = {
  /** Horizontal position of the row of pages. */
  track: SharedValue<number>;
  /** Slot the pages are moving to (or resting on). */
  position: SharedValue<number>;
  /** Slot of the day the screen has settled on: a swipe moves at most one page from it. */
  settled: SharedValue<number>;
  /** Width of a page plus the gap to the next one. */
  stride: number;
  pageWidth: number;
  /** Called on the JS side as soon as a swipe lets go towards another slot. */
  onSwipe: (slot: number) => void;
  /** Called on the JS side once the pages have come to rest. */
  onSettle: (slot: number) => void;
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
  const hidden = usePendingDeletes();

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
  }, ['food', 'settings']);
  const loaded = data !== undefined;
  useEffect(() => {
    if (loaded) onReady(date);
  }, [loaded, date, onReady]);

  // Dragging the summary moves the whole row of pages; far or fast enough, it turns the day.
  const { track, position, settled, stride, pageWidth, onSwipe, onSettle } = pager;
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
      // Only the pages next to the settled one are drawn, so never go further than those.
      const base = settled.get();
      const next = Math.min(base + 1, Math.max(base - 1, position.get() + direction));
      const moved = next !== position.get();
      position.set(next);
      track.set(
        withSpring(-next * stride, { ...PAGE_SPRING, velocity: event.velocityX }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(onSettle, next);
        }),
      );
      if (moved) {
        scheduleOnRN(tick);
        scheduleOnRN(onSwipe, next);
      }
    },
  });

  const entries = (data?.entries ?? []).filter((e) => !hidden.has(`entry:${e.id}`));
  const totals = sumNutrients(entries.map((e) => e.totals));
  const targets = data?.plan.targets;
  // From today things are copied to tomorrow (to plan ahead), from any other day to today.
  const copyTarget = date === today ? { date: addDays(today, 1), label: 'domani' } : { date: today, label: 'oggi' };

  const openAdd = (meal: MealKey, scan = false) =>
    router.push({ pathname: scan ? '/add/scan' : '/add', params: { meal, date } });

  const removeEntry = (entry: Entry) =>
    deleteWithUndo({ key: `entry:${entry.id}`, title: `${entry.name} eliminato`, run: () => deleteEntry(db, entry.id) });

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
  const dayTypeLabel = dayType === 'training' ? 'Allenamento' : 'Riposo';
  const dayTypeIcon = dayType === 'training' ? 'figure.strengthtraining.traditional' : 'bed.double.fill';

  return (
    <View>
      {data?.plan.isDefault ? (
        <Pressable onPress={() => router.navigate('/settings/goals')} accessibilityRole="button">
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

      <GestureDetector gesture={pan} touchAction="pan-y">
        <View>
          <Card style={styles.summary}>
            <View style={styles.summaryHead}>
              {dayType ? (
                active ? (
                  <MenuButton
                    icon={dayTypeIcon}
                    title={dayTypeLabel}
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
                ) : (
                  <View style={styles.dayType}>
                    <Icon name={dayTypeIcon} size={15} tone="accent" />
                    <AppText variant="subhead" weight="600" tone="accent">
                      {dayTypeLabel}
                    </AppText>
                  </View>
                )
              ) : (
                <View />
              )}
              <AppText variant="subhead" tone="textSecondary" numeric>
                <AppText variant="subhead" weight="600" numeric>
                  {formatKcal(totals.kcal)}
                </AppText>
                {` / ${formatKcal(targets?.kcal ?? 0)} kcal`}
              </AppText>
            </View>
            <View style={styles.summaryBody}>
              <CalorieRing eaten={totals.kcal} target={targets?.kcal ?? 0} />
              {targets ? (
                <MacroBars
                  totals={totals}
                  targets={targets}
                  onPress={(key) => router.push({ pathname: '/nutrients', params: { date, key } })}
                />
              ) : null}
            </View>
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
                <View style={styles.mealTitle}>
                  <View style={styles.mealName}>
                    <Icon name={meal.symbol} size={17} tone="textSecondary" />
                    <AppText variant="headline">{meal.label}</AppText>
                  </View>
                  {count > 0 ? (
                    <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
                      <AppText variant="footnote" weight="600" numeric>
                        {`${formatKcal(mealTotals.kcal)} kcal`}
                      </AppText>
                      {'   '}
                      <MacroInline totals={mealTotals} />
                    </AppText>
                  ) : null}
                </View>
                {active ? menu : <Icon name="ellipsis.circle" size={22} tone="accent" />}
              </View>
              {mealEntries.map((entry) => (
                <SwipeToDelete key={entry.id} onDelete={() => removeEntry(entry)}>
                  <Link href={`/entry/${entry.id}`} asChild>
                    <Link.Trigger>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Tocca per modificare, tieni premuto per altre azioni, scorri a sinistra per eliminare">
                        {({ pressed }) => (
                          <View style={[styles.entry, pressed && { backgroundColor: theme.cardPressed }]}>
                            <View style={styles.entryText}>
                              <AppText numberOfLines={1}>{entry.name}</AppText>
                              <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                                {entryDetail(entry) ? `${entryDetail(entry)}   ` : ''}
                                <MacroInline totals={entry.totals} />
                              </AppText>
                            </View>
                            <Kcal value={entry.totals.kcal} />
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
                      <Link.MenuAction icon="trash" destructive onPress={() => removeEntry(entry)}>
                        Elimina
                      </Link.MenuAction>
                    </Link.Menu>
                  </Link>
                </SwipeToDelete>
              ))}
              <View style={styles.addRow}>
                <Pressable
                  onPress={() => openAdd(meal.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Aggiungi a ${meal.label.toLowerCase()}`}
                  style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
                  <Icon name="plus.circle.fill" size={20} tone="accent" />
                  <AppText tone="accent" weight="600">
                    Aggiungi
                  </AppText>
                </Pressable>
                {canCopy ? (
                  <Pressable
                    onPress={() => void copyFromYesterday(meal.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`Copia ${meal.label.toLowerCase()} da ieri`}
                    style={({ pressed }) => [styles.copy, { backgroundColor: theme.fill }, pressed && styles.pressed]}>
                    <Icon name="clock.arrow.circlepath" size={14} tone="textSecondary" />
                    <AppText variant="subhead" weight="600" tone="textSecondary">
                      Copia da ieri
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            </ListGroup>
          </View>
        );
      })}
    </View>
  );
}

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
  pressed: { opacity: 0.5 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  summary: { gap: Spacing.md, paddingTop: Spacing.md },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  dayType: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, paddingVertical: Spacing.xs },
  summaryBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  meal: { marginTop: Spacing.md },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  mealTitle: { flex: 1, gap: 2 },
  mealName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 3,
    minHeight: 56,
  },
  entryText: { flex: 1, gap: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.md },
  add: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, minHeight: 48 },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: 16,
  },
});
