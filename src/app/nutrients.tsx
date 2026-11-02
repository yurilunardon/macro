import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { isOver, NUTRIENT_LABELS, nutrientTarget } from '@/components/nutrient-grid';
import { ProgressBar } from '@/components/progress';
import { Radius, Spacing } from '@/constants/theme';
import { getDayPlan } from '@/db/days';
import { getEntriesForDate, type Entry } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getLimits } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { nutrientBreakdown, type BreakdownKey } from '@/lib/breakdown';
import { formatLongDate, isDateKey, todayKey } from '@/lib/dates';
import { countLabel, formatGrams, formatNumber } from '@/lib/format';
import { LIMIT_KEYS, LIMIT_LABELS, limitGrams, type LimitKey, type NutrientLimits } from '@/lib/limits';
import { mealLabel } from '@/lib/meals';

const KEYS: readonly BreakdownKey[] = ['protein', 'carbs', 'fat', 'fiber'];
type Tab = BreakdownKey | 'limits';
/** Five segments in the sheet's width: "Carboidrati" in full would be cut. */
const OPTIONS: readonly { key: Tab; label: string }[] = [
  ...KEYS.map((key) => ({ key, label: key === 'carbs' ? 'Carbo' : NUTRIENT_LABELS[key] })),
  { key: 'limits', label: 'Limiti' },
];

function isBreakdownKey(value: unknown): value is BreakdownKey {
  return KEYS.includes(value as BreakdownKey);
}

/** Sheet with the foods a nutrient came from on one day, largest first, and the day's limits. */
export default function NutrientsSheet() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string; key?: string }>();
  const date = isDateKey(params.date) ? params.date : todayKey();
  const [tab, setTab] = useState<Tab>(isBreakdownKey(params.key) ? params.key : 'protein');

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

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title2">Nutrienti</AppText>
        <AppText variant="subhead" tone="textSecondary">
          {formatLongDate(date)}
        </AppText>
      </View>
      <Segmented options={OPTIONS} value={tab} onChange={setTab} />
      {tab === 'limits' ? (
        <LimitsTab entries={data.entries} limits={data.limits} kcal={data.plan.targets.kcal} />
      ) : (
        <MacroTab nutrient={tab} entries={data.entries} target={nutrientTarget(tab, data.plan.targets)} />
      )}
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
        <Sources items={items} color={theme[nutrient]} />
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
 * Sugars, saturated fat and salt against their daily ceilings. Not goals to fill: the bars stay
 * grey and turn orange only past the limit. Tapping one shows the foods it came from.
 */
function LimitsTab({ entries, limits, kcal }: { entries: readonly Entry[]; limits: NutrientLimits; kcal: number }) {
  const theme = useTheme();
  const router = useRouter();
  const [picked, setPicked] = useState<LimitKey>('sugars');
  const { items } = nutrientBreakdown(entries, picked);
  // Without a value on the label a food counts as nothing: the total may be short by that much.
  const missing = entries.filter((e) => e.totals[picked] === null).length;

  return (
    <>
      <View style={styles.limits}>
        {LIMIT_KEYS.map((key) => {
          const known = entries.some((e) => e.totals[key] !== null);
          const value = nutrientBreakdown(entries, key).total;
          const limit = limitGrams(key, limits[key], kcal);
          const over = known && value > limit;
          const left = limit - value;
          return (
            <Pressable
              key={key}
              onPress={() => setPicked(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: key === picked }}
              accessibilityLabel={`${LIMIT_LABELS[key]}: ${known ? `${formatNumber(value, 1)} su ${limit} grammi` : 'nessun dato'}`}
              accessibilityHint="Mostra da quali alimenti arriva"
              style={({ pressed }) => [
                styles.limit,
                { backgroundColor: pressed ? theme.cardPressed : theme.card, borderColor: key === picked ? theme.textSecondary : 'transparent' },
              ]}>
              <View style={styles.limitTop}>
                <AppText variant="headline" style={styles.flex}>
                  {LIMIT_LABELS[key]}
                </AppText>
                {over ? <Icon name="exclamationmark.circle.fill" size={15} tone="warning" /> : null}
                <AppText variant="headline" numeric tone={over ? 'warning' : 'text'}>
                  {known ? `${Math.round((value / limit) * 100)}%` : '—'}
                </AppText>
              </View>
              <ProgressBar value={value} target={limit} color={over ? theme.warning : theme.textSecondary} height={6} />
              <AppText variant="footnote" tone={over ? 'warning' : 'textSecondary'} numeric>
                {!known
                  ? `Limite ${formatGrams(limit)} · nessun dato`
                  : over
                    ? `${formatGrams(value)} di ${formatGrams(limit)} · oltre di ${formatGrams(-left)}`
                    : `${formatGrams(value)} di ${formatGrams(limit)} · restano ${formatGrams(left)}`}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>{`${LIMIT_LABELS[picked]}: da dove arrivano`}</SectionTitle>
      {items.length > 0 ? (
        <Sources items={items} color={theme.textSecondary} />
      ) : (
        <AppText tone="textSecondary" style={styles.empty}>
          Nessun alimento di questo giorno lo indica.
        </AppText>
      )}
      {missing > 0 && items.length > 0 ? (
        <SectionFooter>{`${countLabel(missing, 'alimento non lo indica', 'alimenti non lo indicano')}.`}</SectionFooter>
      ) : null}

      <View style={styles.edit}>
        <Button title="Modifica limiti" variant="tinted" compact onPress={() => router.push('/limits')} />
      </View>
    </>
  );
}

function Sources({ items, color }: { items: ReturnType<typeof nutrientBreakdown<Entry>>['items']; color: string }) {
  return (
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
          <ProgressBar value={share} target={1} color={color} height={4} />
        </View>
      ))}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl * 2, gap: Spacing.md },
  header: { gap: 2, marginBottom: Spacing.xs },
  total: { gap: Spacing.sm },
  over: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  amount: { alignItems: 'flex-end' },
  empty: { paddingHorizontal: Spacing.lg },
  limits: { gap: Spacing.sm },
  limit: { gap: Spacing.sm, padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous', borderWidth: 1.5 },
  limitTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  edit: { marginTop: Spacing.sm },
});
