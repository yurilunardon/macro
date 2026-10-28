import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ActionRow, Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { WeightChart } from '@/components/charts';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { getLatestWeight, getWeightsSince } from '@/db/body';
import { useLiveQuery } from '@/db/live';
import { getMeasurements } from '@/db/measurements';
import { deleteSetting, getSetting, setSetting } from '@/db/settings';
import { useToday } from '@/hooks/use-today';
import { addDays, formatDayTitle, formatShortDate } from '@/lib/dates';
import { forecastGoal, weightSlope } from '@/lib/expenditure';
import { formatNumber, numberToInput } from '@/lib/format';
import { measurementChanges } from '@/lib/measurements';
import { formatChange, withChanges } from '@/lib/weights';
import { logWeight } from '@/services/log-weight';
import { removeWeight } from '@/services/remove-weight';
import { usePendingDeletes } from '@/services/undo';

type WeightRange = '30' | '90' | '365';

const WEIGHT_RANGES: readonly { key: WeightRange; label: string }[] = [
  { key: '30', label: '30 giorni' },
  { key: '90', label: '3 mesi' },
  { key: '365', label: '1 anno' },
];

/** Days of weigh-ins used for the pace towards the goal weight. */
const TREND_DAYS = 28;

/** The weight over time, the goal and the body measurements. */
export default function WeightScreen() {
  const db = useSQLiteContext();
  const hidden = usePendingDeletes();
  const router = useRouter();
  const [range, setRange] = useState<WeightRange>('90');
  const today = useToday();
  const from = addDays(today, -Number(range) + 1);

  const { data } = useLiveQuery(`weight:${today}:${range}`, async (database) => {
    const [weights, recentWeights, latest, goalWeight, measurements] = await Promise.all([
      getWeightsSince(database, from),
      getWeightsSince(database, addDays(today, -TREND_DAYS + 1)),
      getLatestWeight(database),
      getSetting(database, 'goalWeight'),
      getMeasurements(database),
    ]);
    return { weights, recentWeights, latest, goalWeight, measurements };
  }, ['body', 'settings']);

  const weights = data?.weights ?? [];
  const first = weights[0];
  const last = weights[weights.length - 1];
  const change = first && last && first.date !== last.date ? last.kg - first.kg : null;
  const slope = data ? weightSlope(data.recentWeights) : null;
  const forecast = data?.latest && data.goalWeight !== null ? forecastGoal(data.latest, data.goalWeight, slope) : null;

  const editGoalWeight = () =>
    promptNumber({
      title: 'Peso obiettivo',
      message: 'In chilogrammi. Vuoto per eliminarlo.',
      defaultValue: data?.goalWeight ? numberToInput(data.goalWeight) : '',
      min: 20,
      max: 400,
      allowEmpty: true,
      onSubmit: (kg) => void (kg === null ? deleteSetting(db, 'goalWeight') : setSetting(db, 'goalWeight', kg)),
    });

  // The weigh-ins right under the chart; the full history has its own page.
  const recent = withChanges(weights.filter((w) => !hidden.has(`weight:${w.date}`))).slice(0, 3);
  const changes = data ? measurementChanges(data.measurements, addDays(today, -89)) : [];

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Registra il peso di oggi" onPress={() => logWeight(db, today, data?.latest ?? null)} />
      </Stack.Toolbar>

      <Card style={styles.card}>
        <View>
          <AppText variant="footnote" tone="textSecondary">
            {data?.latest ? `Ultimo peso · ${formatDayTitle(data.latest.date, today)}` : 'Peso'}
          </AppText>
          <AppText variant="display" numeric>
            {data?.latest ? formatNumber(data.latest.kg, 1) : '—'}
            <AppText variant="headline" tone="textSecondary">
              {' kg'}
            </AppText>
          </AppText>
          {change !== null ? (
            <AppText variant="subhead" tone="textSecondary" numeric>
              {`${formatChange(change, 'kg', (n) => formatNumber(n, 1))} nel periodo`}
            </AppText>
          ) : null}
        </View>
        <Segmented options={WEIGHT_RANGES} value={range} onChange={setRange} />
        <WeightChart points={weights} from={from} to={today} />
        <Pressable onPress={editGoalWeight} accessibilityRole="button" style={styles.goalRow}>
          <Icon name="flag.checkered" size={18} tone="accent" />
          <AppText variant="subhead" style={styles.flex}>
            {data?.goalWeight ? `Obiettivo ${formatNumber(data.goalWeight, 1)} kg · ${forecastText(forecast)}` : 'Imposta un peso obiettivo'}
          </AppText>
          <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
        </Pressable>
      </Card>

      <View style={styles.gap} />
      <ListGroup>
        <ActionRow label="Registra il peso di oggi" onPress={() => logWeight(db, today, data?.latest ?? null)} />
        {recent.map((w) => (
          <SwipeToDelete key={w.date} onDelete={() => removeWeight(db, w.date)}>
            <Row
              title={formatDayTitle(w.date, today)}
              subtitle={w.change !== null ? formatChange(w.change, 'kg', (n) => formatNumber(n, 1)) : null}
              detail={`${formatNumber(w.kg, 1)} kg`}
              chevron={false}
            />
          </SwipeToDelete>
        ))}
        {data?.latest ? (
          <Row
            title="Tutte le pesate"
            icon={<Icon name="list.bullet" size={18} tone="accent" />}
            onPress={() => router.push('/calendar/weights')}
          />
        ) : null}
      </ListGroup>
      <SectionFooter>Una pesata al giorno: l’ultima sostituisce la precedente.</SectionFooter>

      <SectionTitle>Misure</SectionTitle>
      <ListGroup>
        {changes.map((m) => (
          <Row
            key={m.kind}
            title={m.label}
            subtitle={
              m.change !== null ? `${formatChange(m.change, m.unit, (n) => formatNumber(n, 1))} in 3 mesi` : formatShortDate(m.latest.date)
            }
            detail={`${formatNumber(m.latest.value, 1)} ${m.unit}`}
            chevron={false}
          />
        ))}
        <Row
          title={changes.length > 0 ? 'Registra o vedi lo storico' : 'Registra le misure'}
          icon={<Icon name="ruler" size={18} tone="accent" />}
          onPress={() => router.push('/calendar/measurements')}
        />
      </ListGroup>
    </ScreenScroll>
  );
}

function forecastText(forecast: ReturnType<typeof forecastGoal> | null): string {
  if (!forecast) return 'servono più pesate';
  switch (forecast.kind) {
    case 'reached':
      return 'raggiunto!';
    case 'flat':
      return 'peso stabile nelle ultime settimane';
    case 'wrong-way':
      return 'il peso va nella direzione opposta';
    case 'eta':
      return `ci arrivi verso il ${formatShortDate(forecast.date)}`;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: Spacing.lg },
  gap: { height: Spacing.md },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 36 },
});
