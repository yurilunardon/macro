import * as Haptics from 'expo-haptics';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { CaloriesChart, WeightChart } from '@/components/charts';
import { Segmented } from '@/components/form';
import { MACROS } from '@/components/nutrition';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { deleteWeight, getLatestWeight, getWeightsSince, setWeight } from '@/db/body';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getTargets } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatDayTitle, lastDays } from '@/lib/dates';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';

type RangeKey = '30' | '90' | '365';

const RANGES: readonly { key: RangeKey; label: string }[] = [
  { key: '30', label: '30 giorni' },
  { key: '90', label: '3 mesi' },
  { key: '365', label: '1 anno' },
];

export default function ProgressScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [range, setRange] = useState<RangeKey>('90');
  const today = useToday();
  const from = addDays(today, -Number(range) + 1);
  const week = lastDays(today, 7);

  const { data } = useLiveQuery(`progress:${today}:${range}`, async (database) => {
    const [weights, latest, totals, goals] = await Promise.all([
      getWeightsSince(database, from),
      getLatestWeight(database),
      getDailyTotals(database, week[0], today),
      getTargets(database),
    ]);
    return { weights, latest, totals, targets: goals.targets };
  });

  const weights = data?.weights ?? [];
  const first = weights[0];
  const last = weights[weights.length - 1];
  const change = first && last && first.date !== last.date ? last.kg - first.kg : null;

  const totalsByDay = new Map((data?.totals ?? []).map((t) => [t.date, t]));
  const days = week.map((date) => ({ date, kcal: totalsByDay.get(date)?.kcal ?? 0 }));
  const logged = data?.totals ?? [];
  const average = (key: 'kcal' | 'protein' | 'carbs' | 'fat') =>
    logged.length > 0 ? logged.reduce((sum, t) => sum + t[key], 0) / logged.length : 0;

  const logWeight = () =>
    promptNumber({
      title: 'Peso di oggi',
      message: 'In chilogrammi.',
      defaultValue: data?.latest ? numberToInput(data.latest.kg) : '',
      min: 20,
      max: 400,
      onSubmit: (kg) => {
        void setWeight(db, today, kg);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    });

  const recent = [...weights].reverse().slice(0, 8);

  return (
    <ScreenScroll>
      <Card style={styles.weightCard}>
        <View style={styles.weightTop}>
          <View style={styles.flex}>
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
                {`${change > 0 ? '+' : change < 0 ? '−' : '±'}${formatNumber(Math.abs(change), 1)} kg nel periodo`}
              </AppText>
            ) : null}
          </View>
        </View>
        <Segmented options={RANGES} value={range} onChange={setRange} />
        <WeightChart points={weights} from={from} to={today} />
        <Button title="Registra il peso" variant="tinted" onPress={logWeight} compact />
      </Card>

      {recent.length > 0 ? (
        <>
          <SectionTitle>Pesate</SectionTitle>
          <ListGroup>
            {recent.map((w) => (
              <Row
                key={w.date}
                title={formatDayTitle(w.date, today)}
                detail={`${formatNumber(w.kg, 1)} kg`}
                chevron={false}
                onLongPress={() =>
                  Alert.alert('Eliminare questa pesata?', `${formatDayTitle(w.date, today)} · ${formatNumber(w.kg, 1)} kg`, [
                    { text: 'Annulla', style: 'cancel' },
                    { text: 'Elimina', style: 'destructive', onPress: () => void deleteWeight(db, w.date) },
                  ])
                }
              />
            ))}
          </ListGroup>
          <SectionFooter>Tieni premuto su una pesata per eliminarla. Una pesata al giorno: la nuova sostituisce quella vecchia.</SectionFooter>
        </>
      ) : null}

      <SectionTitle>Ultimi 7 giorni</SectionTitle>
      <Card style={styles.weekCard}>
        <CaloriesChart days={days} target={data?.targets.kcal ?? 0} />
        <View style={styles.averages}>
          <Average label="Media kcal" value={formatKcal(average('kcal'))} />
          {MACROS.map((m) => (
            <Average key={m.key} label={m.label} value={`${formatNumber(average(m.key), 0)} g`} color={theme[m.key]} />
          ))}
        </View>
      </Card>
      <SectionFooter>
        {logged.length > 0
          ? `Medie sui ${logged.length} giorni con almeno un alimento registrato. La linea tratteggiata è il tuo obiettivo.`
          : 'Registra qualche pasto per vedere l’andamento della settimana.'}
      </SectionFooter>
    </ScreenScroll>
  );
}

function Average({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.average}>
      <AppText variant="headline" numeric style={color ? { color } : undefined}>
        {value}
      </AppText>
      <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  weightCard: { gap: Spacing.lg },
  weightTop: { flexDirection: 'row', alignItems: 'flex-end' },
  weekCard: { gap: Spacing.lg },
  averages: { flexDirection: 'row', gap: Spacing.sm },
  average: { flex: 1 },
});
