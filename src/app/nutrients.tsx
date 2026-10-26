import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { NUTRIENT_LABELS, nutrientTarget } from '@/components/nutrient-grid';
import { ProgressBar } from '@/components/progress';
import { Spacing } from '@/constants/theme';
import { getDayPlan } from '@/db/days';
import { getEntriesForDate } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { nutrientBreakdown, type BreakdownKey } from '@/lib/breakdown';
import { formatLongDate, isDateKey, todayKey } from '@/lib/dates';
import { formatGrams, formatNumber } from '@/lib/format';
import { mealLabel } from '@/lib/meals';
import { sumNutrients } from '@/lib/nutrition';

const KEYS: readonly BreakdownKey[] = ['protein', 'carbs', 'fat', 'fiber'];
const OPTIONS = KEYS.map((key) => ({ key, label: NUTRIENT_LABELS[key] }));

function isBreakdownKey(value: unknown): value is BreakdownKey {
  return KEYS.includes(value as BreakdownKey);
}

/** Sheet with the foods a nutrient came from on one day, largest first. */
export default function NutrientsSheet() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string; key?: string }>();
  const date = isDateKey(params.date) ? params.date : todayKey();
  const [key, setKey] = useState<BreakdownKey>(isBreakdownKey(params.key) ? params.key : 'protein');

  const { data } = useLiveQuery(`nutrients:${date}`, async (database) => {
    const [entries, plan] = await Promise.all([getEntriesForDate(database, date), getDayPlan(database, date)]);
    return { entries, plan };
  }, ['food', 'settings']);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const { total, items } = nutrientBreakdown(data.entries, key);
  const target = nutrientTarget(key, data.plan.targets);
  const totals = sumNutrients(data.entries.map((e) => e.totals));
  const others = [
    { label: 'Zuccheri', value: totals.sugars },
    { label: 'Grassi saturi', value: totals.satFat },
    { label: 'Sale', value: totals.salt },
  ];

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title2">Nutrienti</AppText>
        <AppText variant="subhead" tone="textSecondary">
          {formatLongDate(date)}
        </AppText>
      </View>
      <Segmented options={OPTIONS} value={key} onChange={setKey} />

      <Card style={styles.total}>
        <AppText variant="display" numeric style={{ color: theme[key] }}>
          {formatNumber(total, 0)}
          <AppText variant="headline" tone="textSecondary">{` / ${target} g`}</AppText>
        </AppText>
        <ProgressBar value={total} target={target} color={theme[key]} height={8} />
        <AppText variant="footnote" tone="textSecondary">
          {total >= target
            ? `Obiettivo raggiunto${total > target ? `, ${formatNumber(total - target, 0)} g in più` : ''}.`
            : `Ne mancano ${formatNumber(target - total, 0)} g.`}
        </AppText>
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
              <ProgressBar value={share} target={1} color={theme[key]} height={4} />
            </View>
          ))}
        </ListGroup>
      ) : (
        <AppText tone="textSecondary" style={styles.empty}>
          {key === 'fiber' && data.entries.length > 0
            ? 'Nessun alimento di questo giorno indica le fibre.'
            : `Nessun alimento con ${NUTRIENT_LABELS[key].toLowerCase()} in questo giorno.`}
        </AppText>
      )}
      {key === 'fiber' ? (
        <SectionFooter>
          Obiettivo indicativo: 14 g ogni 1000 kcal, minimo 25 g. Non tutte le etichette riportano le fibre.
        </SectionFooter>
      ) : null}

      <SectionTitle>Altri valori del giorno</SectionTitle>
      <ListGroup>
        {others.map((o) => (
          <View key={o.label} style={styles.otherRow}>
            <AppText style={styles.flex}>{o.label}</AppText>
            <AppText tone="textSecondary" numeric>
              {o.value === null ? '—' : formatGrams(o.value)}
            </AppText>
          </View>
        ))}
      </ListGroup>
      <SectionFooter>«—» quando nessun alimento del giorno riporta quel valore.</SectionFooter>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl * 2, gap: Spacing.md },
  header: { gap: 2, marginBottom: Spacing.xs },
  total: { gap: Spacing.sm },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  amount: { alignItems: 'flex-end' },
  empty: { paddingHorizontal: Spacing.lg },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
});
