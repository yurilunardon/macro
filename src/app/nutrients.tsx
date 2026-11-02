import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { isOver, NUTRIENT_LABELS, nutrientTarget } from '@/components/nutrient-grid';
import { ProgressBar } from '@/components/progress';
import { Spacing } from '@/constants/theme';
import { getDayPlan, type DayPlan } from '@/db/days';
import { getEntriesForDate, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getLimits } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { nutrientBreakdown, type BreakdownKey } from '@/lib/breakdown';
import { formatLongDate, isDateKey, todayKey } from '@/lib/dates';
import { countLabel, formatGrams, formatNumber } from '@/lib/format';
import { LIMIT_KEYS, LIMIT_LABELS, limitGrams, type LimitKey, type NutrientLimits } from '@/lib/limits';
import { mealLabel } from '@/lib/meals';
import { haptics } from '@/services/haptics';

const KEYS: readonly BreakdownKey[] = ['protein', 'carbs', 'fat', 'fiber'];
type Tab = BreakdownKey | 'other';
/** Five segments in the sheet's width: "Carboidrati" in full would be cut. */
const OPTIONS: readonly { key: Tab; label: string }[] = [
  ...KEYS.map((key) => ({ key, label: key === 'carbs' ? 'Carbo' : NUTRIENT_LABELS[key] })),
  { key: 'other', label: 'Altro' },
];

/** How the list under the limits names each. */
const LIMIT_WORDS: Record<LimitKey, string> = { sugars: 'zuccheri', satFat: 'saturi', salt: 'sale' };

function isBreakdownKey(value: unknown): value is BreakdownKey {
  return KEYS.includes(value as BreakdownKey);
}

/** Sheet with the foods a nutrient came from on one day, largest first, and the day's limits. */
export default function NutrientsSheet() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string; key?: string }>();
  const date = isDateKey(params.date) ? params.date : todayKey();

  const { data } = useLiveQuery(`nutrients:${date}`, async (database) => {
    const [entries, plan, limits] = await Promise.all([getEntriesForDate(database, date), getDayPlan(database, date), getLimits(database)]);
    return { entries, plan, limits };
  }, ['food', 'settings']);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return <NutrientPages date={formatLongDate(date)} initial={isBreakdownKey(params.key) ? params.key : 'protein'} {...data} />;
}

/**
 * The nutrients as pages side by side, as the days in the diary: swiped with the finger or picked
 * above, the two following each other.
 */
function NutrientPages({ date, initial, entries, plan, limits }: { date: string; initial: Tab; entries: readonly Entry[]; plan: DayPlan; limits: NutrientLimits }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>(initial);
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  const indexOf = (key: Tab) => OPTIONS.findIndex((o) => o.key === key);

  // The pager is as tall as the page on screen; while moving it only grows, so nothing is cut.
  const heights = useRef(new Map<Tab, number>());
  const [height, setHeight] = useState<number | undefined>(undefined);
  const shown = useRef(initial);
  const grow = (key: Tab) => {
    const h = heights.current.get(key);
    if (h !== undefined) setHeight((current) => Math.max(current ?? 0, h));
  };
  const fit = () => {
    const h = heights.current.get(shown.current);
    if (h !== undefined) setHeight(h);
  };

  // A slide started by a tap: the pages going past it must not change the segment on the way.
  const sliding = useRef(false);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(slideTimer.current), []);
  const endSlide = () => {
    clearTimeout(slideTimer.current);
    sliding.current = false;
    fit();
  };

  const pick = (key: Tab) => {
    setTab(key);
    shown.current = key;
    grow(key);
    sliding.current = true;
    pager.current?.scrollTo({ x: indexOf(key) * width, animated: true });
    // Should the end of the animation not be reported, finish anyway.
    clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(endSlide, 600);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (sliding.current) return;
    const key = OPTIONS[Math.round(event.nativeEvent.contentOffset.x / width)]?.key;
    if (!key || key === shown.current) return;
    shown.current = key;
    setTab(key);
    grow(key);
    haptics.selection();
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title2">Nutrienti</AppText>
        <AppText variant="subhead" tone="textSecondary">
          {date}
        </AppText>
      </View>
      <Segmented options={OPTIONS} value={tab} onChange={pick} />
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentOffset={{ x: indexOf(initial) * width, y: 0 }}
        onScroll={onScroll}
        onMomentumScrollEnd={endSlide}
        contentContainerStyle={styles.pages}
        style={[styles.pager, { width, height }]}>
        {OPTIONS.map(({ key }) => (
          <View
            key={key}
            onLayout={(event) => {
              heights.current.set(key, event.nativeEvent.layout.height);
              if (key === shown.current) setHeight(event.nativeEvent.layout.height);
            }}
            style={[styles.page, { width }]}>
            {key === 'other' ? <OtherTab entries={entries} limits={limits} kcal={plan.targets.kcal} /> : <MacroTab nutrient={key} entries={entries} target={nutrientTarget(key, plan.targets)} />}
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

/** How far a macro is from its goal, and where it came from. */
function MacroTab({ nutrient, entries, target }: { nutrient: BreakdownKey; entries: readonly Entry[]; target: number }) {
  const theme = useTheme();
  const { total, items } = nutrientBreakdown(entries, nutrient);
  return (
    <>
      <Card style={styles.total}>
        <AppText variant="display" numeric style={{ color: theme[nutrient] }}>
          {formatNumber(total, 0)}
          <AppText variant="headline" tone="textSecondary">{` / ${target} g`}</AppText>
        </AppText>
        <ProgressBar value={total} target={target} color={theme[nutrient]} height={8} />
        {isOver(total, target) ? (
          <View style={styles.over}>
            <Icon name="exclamationmark.circle.fill" size={15} tone="warning" />
            <AppText variant="footnote" tone="warning" weight="600">
              {`Obiettivo superato di ${formatNumber(total - target, 0)} g.`}
            </AppText>
          </View>
        ) : (
          <AppText variant="footnote" tone="textSecondary">
            {total >= target ? 'Obiettivo raggiunto.' : `Ne mancano ${formatNumber(target - total, 0)} g.`}
          </AppText>
        )}
      </Card>

      <SectionTitle>Da dove arrivano</SectionTitle>
      {items.length > 0 ? (
        <ListGroup>
          {items.map(({ entry, amount, share }) => (
            <View key={entry.id} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{entry.name}</AppText>
                  <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                    {entry.quick ? mealLabel(entry.meal) : `${mealLabel(entry.meal)} · ${formatNumber(entry.quantity, 0)} ${entry.unit}`}
                  </AppText>
                </View>
                <View style={styles.amount}>
                  <AppText variant="headline" numeric>
                    {formatGrams(amount)}
                  </AppText>
                  <AppText variant="caption" tone="textSecondary" numeric>
                    {`${Math.round(share * 100)}%`}
                  </AppText>
                </View>
              </View>
              <ProgressBar value={share} target={1} color={theme[nutrient]} height={4} />
            </View>
          ))}
        </ListGroup>
      ) : (
        <AppText tone="textSecondary" style={styles.empty}>
          {nutrient === 'fiber' && entries.length > 0
            ? 'Nessun alimento di questo giorno indica le fibre.'
            : `Nessun alimento con ${NUTRIENT_LABELS[nutrient].toLowerCase()} in questo giorno.`}
        </AppText>
      )}
      {nutrient === 'fiber' ? (
        <SectionFooter>
          Obiettivo indicativo: 14 g ogni 1000 kcal, minimo 25 g. Non tutte le etichette riportano le fibre.
        </SectionFooter>
      ) : null}
    </>
  );
}

/**
 * Sugars, saturated fat and salt against their daily limits, as the bars beside the calorie ring,
 * then the foods they came from, all of the first, then all of the next.
 */
function OtherTab({ entries, limits, kcal }: { entries: readonly Entry[]; limits: NutrientLimits; kcal: number }) {
  const theme = useTheme();
  const router = useRouter();
  const sources = LIMIT_KEYS.flatMap((key) => nutrientBreakdown(entries, key).items.map((item) => ({ ...item, key })));
  // Without a value on the label a food counts as nothing: the totals may be short by that much.
  const missing = entries.filter((e) => LIMIT_KEYS.some((key) => e.totals[key] === null)).length;

  return (
    <>
      <Card style={styles.limits}>
        {LIMIT_KEYS.map((key) => {
          const known = entries.some((e) => e.totals[key] !== null);
          const value = nutrientBreakdown(entries, key).total;
          const limit = limitGrams(key, limits[key], kcal);
          const over = known && value > limit;
          return (
            <View
              key={key}
              accessible
              accessibilityLabel={`${LIMIT_LABELS[key]}: ${known ? `${formatNumber(value, 1)} su ${limit} grammi${over ? ', oltre il limite' : ''}` : 'nessun dato'}`}
              style={styles.limit}>
              <View style={styles.limitTop}>
                <View style={styles.limitName}>
                  <AppText variant="subhead" weight="600" style={{ color: theme[key] }} numberOfLines={1}>
                    {LIMIT_LABELS[key]}
                  </AppText>
                  {over ? <Icon name="exclamationmark.circle.fill" size={14} tone="warning" /> : null}
                </View>
                <AppText variant="subhead" numeric>
                  <AppText variant="subhead" weight="600" numeric>
                    {known ? formatNumber(value, value < 10 ? 1 : 0) : '—'}
                  </AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {` / ${formatNumber(limit, 0)} g`}
                  </AppText>
                </AppText>
              </View>
              <ProgressBar value={value} target={limit} color={theme[key]} height={5} />
            </View>
          );
        })}
      </Card>

      {sources.length > 0 ? (
        <>
          <SectionTitle>Da dove arrivano</SectionTitle>
          <ListGroup>
            {sources.map(({ entry, amount, key }) => (
              <View key={`${key}:${entry.id}`} style={styles.source}>
                <View style={[styles.dot, { backgroundColor: theme[key] }]} />
                <AppText numberOfLines={1} style={styles.flex}>
                  {entry.name}
                </AppText>
                <AppText variant="subhead" tone="textSecondary" numeric>
                  {`${formatGrams(amount)} ${LIMIT_WORDS[key]}`}
                </AppText>
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}
      {missing > 0 ? <SectionFooter>{`${countLabel(missing, 'alimento non li indica', 'alimenti non li indicano')} tutti.`}</SectionFooter> : null}

      <Button title="Modifica limiti" variant="plain" compact onPress={() => router.push('/limits')} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl * 2, gap: Spacing.md },
  header: { gap: 2, marginBottom: Spacing.xs },
  // Out of the sheet's side margins, as the pages in the diary.
  pager: { marginHorizontal: -Spacing.lg },
  pages: { alignItems: 'flex-start' },
  page: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  total: { gap: Spacing.sm },
  over: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  amount: { alignItems: 'flex-end' },
  empty: { paddingHorizontal: Spacing.lg },
  limits: { gap: Spacing.lg },
  limit: { gap: Spacing.xs + 2 },
  limitTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  limitName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  source: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
