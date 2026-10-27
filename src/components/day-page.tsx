import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { getDayPlan, getTrainingSettings, setDayType } from '@/db/days';
import { copyEntry, copyMeal, deleteEntry, deleteMealEntries, getEntriesForDate, moveEntry, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { saveMealFromDiary } from '@/db/saved-meals';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDayTitle, weekdayOf, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dayTypeFor, type DayType } from '@/lib/goals';
import { MEALS, mealLabel, type MealKey } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';
import { QUICK_ADD_NAME } from '@/lib/quick-add';
import { haptics } from '@/services/haptics';
import { toggleMeal, useCollapsedMeals } from '@/services/collapsed-meals';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

import { AppText } from './app-text';
import { Card, ListGroup } from './card';
import { FoldChevron } from './fold-chevron';
import { Icon } from './icon';
import { MenuButton } from './menu-button';
import { MacroBars } from './nutrient-grid';
import { MacroInline } from './nutrition';
import { CalorieRing } from './progress';
import { confirmDestructive } from './prompt';
import { SwipeToDelete } from './swipe-to-delete';
import { toast } from './toast';

/**
 * Trying out the day's cards in Liquid Glass instead of solid white. To go back, make it
 * `false`: every card takes its solid colour again.
 */
const GLASS_CARDS = isLiquidGlassAvailable();

/** The glass behind a card's content, filling it, when GLASS_CARDS is on. */
function GlassBackground() {
  return <GlassView pointerEvents="none" glassEffectStyle="regular" style={styles.glass} />;
}

const FADE_IN = FadeIn.duration(180);
// A short eased resize, no spring: the cards must not bounce up and down.
const MEAL_LAYOUT = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));
const ROWS_IN = FadeIn.duration(180).delay(40);
const ROWS_OUT = FadeOut.duration(100);

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
};

/** One day of the food diary: summary of the day and its four meals. */
export const DayPage = memo(function DayPage({ date, today, interactive, onReady }: DayPageProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const hidden = usePendingDeletes();
  const collapsed = useCollapsedMeals(db);

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
    if (ok) await Promise.all(MEALS.map((m) => deleteMealEntries(db, date, m.key)));
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

  // Until its data is there the day stays empty, then fades in: never a half-filled page.
  if (!data) return <View style={styles.loading} />;

  return (
    <Animated.View entering={FADE_IN}>
      {data.plan.isDefault ? (
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

      <Card style={[styles.summary, GLASS_CARDS && styles.clear]}>
            {GLASS_CARDS ? <GlassBackground /> : null}
            <View style={styles.summaryHead}>
              {dayType ? (
                  <MenuButton
                    inert={!interactive}
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

      {MEALS.map((meal) => {
        const mealEntries = entries.filter((e) => e.meal === meal.key);
        const mealTotals = sumNutrients(mealEntries.map((e) => e.totals));
        const count = mealEntries.length;
        const canCopy = count === 0 && data?.yesterdayMeals.has(meal.key);
        const addIcon = <Icon name="plus.circle.fill" size={24} tone="accent" />;
        // An empty meal has nothing to fold: its title adds to it, as the + beside it.
        const foldable = count > 0;
        const open = !collapsed.has(meal.key);
        const menu = (
          <MenuButton
            inert={!interactive}
            icon="ellipsis.circle"
            accessibilityLabel={`Azioni per ${meal.label.toLowerCase()}`}
            // What the + beside it does not: keep the meal for another day, or clear it.
            groups={[
              {
                actions: [
                  { label: 'Salva come pasto', icon: 'bookmark', onPress: () => saveAsMeal(meal.key, count) },
                  {
                    label: `Svuota ${meal.label.toLowerCase()}`,
                    icon: 'trash',
                    destructive: true,
                    onPress: () => void clearMeal(meal.key, count, mealTotals.kcal),
                  },
                ],
              },
            ]}>
            {/* Grey, so the + beside it reads as the meal's main action. */}
            <View style={styles.headerButton}>
              <Icon name="ellipsis.circle" size={22} tone="textSecondary" />
            </View>
          </MenuButton>
        );
        return (
          // The card follows its content's size smoothly, and the cards below follow it, when a
          // meal is folded or unfolded.
          <Animated.View key={meal.key} layout={MEAL_LAYOUT} style={[styles.meal, { backgroundColor: GLASS_CARDS ? 'transparent' : theme.card }]}>
              {GLASS_CARDS ? <GlassBackground /> : null}
              <View style={styles.mealHeader}>
                <Pressable
                  onPress={() => {
                    if (!foldable) {
                      openAdd(meal.key);
                      return;
                    }
                    haptics.selection();
                    toggleMeal(db, meal.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={foldable ? { expanded: open } : undefined}
                  accessibilityHint={foldable ? (open ? 'Tocca per chiudere' : 'Tocca per aprire') : 'Tocca per aggiungere'}
                  style={styles.mealTitle}>
                  <View style={styles.mealName}>
                    <Icon name={meal.symbol} size={17} tone="textSecondary" />
                    <AppText variant="headline">{meal.label}</AppText>
                    {foldable ? <FoldChevron open={open} /> : null}
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
                </Pressable>
                {/* Adding is the one thing done to every meal, many times a day: always in sight,
                    folded or not. The sheet grows out of the + and shrinks back into it. */}
                {interactive ? (
                  <Link href={{ pathname: '/add', params: { meal: meal.key, date } }} asChild>
                    <Link.Trigger withAppleZoom>
                      <Pressable
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={`Aggiungi a ${meal.label.toLowerCase()}`}
                        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
                        {addIcon}
                      </Pressable>
                    </Link.Trigger>
                  </Link>
                ) : (
                  <View style={styles.headerButton}>{addIcon}</View>
                )}
                {count > 0 ? menu : null}
              </View>
              {open && (foldable || canCopy) ? (
              <Animated.View entering={ROWS_IN} exiting={ROWS_OUT}>
              <View style={[styles.divider, { backgroundColor: theme.separator }]} />
              <ListGroup style={GLASS_CARDS && styles.clear}>
              {mealEntries.map((entry) => {
                const row = (pressed: boolean) => (
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
                );
                if (!interactive) return <View key={entry.id}>{row(false)}</View>;
                return (
                  <SwipeToDelete key={entry.id} transparent={GLASS_CARDS} onDelete={() => removeEntry(entry)}>
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
                );
              })}
              {canCopy ? (
                <View style={styles.addRow}>
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
                </View>
              ) : null}
              </ListGroup>
              </Animated.View>
              ) : null}
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
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  summary: { gap: Spacing.md, paddingTop: Spacing.md },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  dayType: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, paddingVertical: Spacing.xs },
  summaryBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  meal: { marginTop: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg },
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
  clear: { backgroundColor: 'transparent' },
  glass: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  clearDay: { alignSelf: 'center', paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  headerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, minHeight: 52 },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: 16,
  },
});
