import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { CaloriesChart, WeightChart } from '@/components/charts';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MACROS } from '@/components/nutrition';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { getLatestWeight, getWeightsSince, setWeight } from '@/db/body';
import { getDayPlans, getTrainingSettings, setTrainingSettings } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getMeasurements } from '@/db/measurements';
import { deleteSetting, getSetting, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatDayTitle, formatShortDate, lastDays } from '@/lib/dates';
import { estimateExpenditure, forecastGoal, weightSlope } from '@/lib/expenditure';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';
import { deriveRestTargets, targetsFromExpenditure } from '@/lib/goals';
import { measurementChanges } from '@/lib/measurements';
import { summarizePeriod } from '@/lib/stats';
import { formatChange, withChanges } from '@/lib/weights';
import { haptics } from '@/services/haptics';
import { removeWeight } from '@/services/remove-weight';
import { usePendingDeletes } from '@/services/undo';

type WeightRange = '30' | '90' | '365';
type StatsRange = '7' | '30' | '90';

const WEIGHT_RANGES: readonly { key: WeightRange; label: string }[] = [
  { key: '30', label: '30 giorni' },
  { key: '90', label: '3 mesi' },
  { key: '365', label: '1 anno' },
];

const STATS_RANGES: readonly { key: StatsRange; label: string }[] = [
  { key: '7', label: '7 giorni' },
  { key: '30', label: '30 giorni' },
  { key: '90', label: '90 giorni' },
];

/** Days of weigh-ins used for the pace towards the goal weight. */
const TREND_DAYS = 28;

export default function ProgressScreen() {
  const db = useSQLiteContext();
  const hidden = usePendingDeletes();
  const router = useRouter();
  const theme = useTheme();
  const [weightRange, setWeightRange] = useState<WeightRange>('90');
  const [statsRange, setStatsRange] = useState<StatsRange>('7');
  const today = useToday();
  const weightFrom = addDays(today, -Number(weightRange) + 1);
  // 90 days are always loaded: the longest statistics period and the 28 days of the estimate.
  const days90 = lastDays(today, 90);

  const { data } = useLiveQuery(`progress:${today}:${weightRange}`, async (database) => {
    const [weights, recentWeights, latest, totals, plans, goalWeight, profile, training, measurements] =
      await Promise.all([
        getWeightsSince(database, weightFrom),
        getWeightsSince(database, addDays(today, -TREND_DAYS + 1)),
        getLatestWeight(database),
        getDailyTotals(database, days90[0], today),
        getDayPlans(database, days90),
        getSetting(database, 'goalWeight'),
        getSetting(database, 'profile'),
        getTrainingSettings(database),
        getMeasurements(database),
      ]);
    return { weights, recentWeights, latest, totals, plans, goalWeight, profile, training, measurements };
  }, ['body', 'food', 'settings']);

  const weights = data?.weights ?? [];
  const first = weights[0];
  const last = weights[weights.length - 1];
  const change = first && last && first.date !== last.date ? last.kg - first.kg : null;

  const totalsByDay = new Map((data?.totals ?? []).map((t) => [t.date, t]));
  const dayRows = days90.map((date) => {
    const totals = totalsByDay.get(date);
    const targets = data?.plans.get(date)?.targets;
    return {
      date,
      kcal: totals?.kcal ?? 0,
      protein: totals?.protein ?? 0,
      carbs: totals?.carbs ?? 0,
      fat: totals?.fat ?? 0,
      targetKcal: targets?.kcal ?? 0,
      targetProtein: targets?.protein ?? 0,
    };
  });
  const periodRows = dayRows.slice(-Number(statsRange));
  const summary = summarizePeriod(periodRows);

  const expenditure = data
    ? estimateExpenditure(
        dayRows.map((d) => ({ date: d.date, kcal: d.kcal, target: d.targetKcal })),
        data.recentWeights,
        today,
      )
    : null;

  const slope = data ? weightSlope(data.recentWeights) : null;
  const forecast =
    data?.latest && data.goalWeight !== null ? forecastGoal(data.latest, data.goalWeight, slope) : null;

  const logWeight = () =>
    promptNumber({
      title: 'Peso di oggi',
      message: 'In chilogrammi.',
      defaultValue: data?.latest ? numberToInput(data.latest.kg) : '',
      min: 20,
      max: 400,
      onSubmit: (kg) => {
        void setWeight(db, today, kg);
        haptics.success();
      },
    });

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

  const applyExpenditure = () => {
    if (!expenditure?.ok || !data?.latest) return;
    const profile = data.profile ?? { goal: 'maintain' as const, proteinPerKg: 2, fatPercent: 25 };
    const targets = targetsFromExpenditure(expenditure.estimate.tdee, data.latest.kg, profile);
    Alert.alert(
      'Aggiornare gli obiettivi?',
      `${formatKcal(targets.kcal)} kcal · P ${targets.protein} g · C ${targets.carbs} g · G ${targets.fat} g\n\nCalcolati dal tuo fabbisogno reale, con l’obiettivo, le proteine per kg e la quota di grassi del profilo.${
        data.training.restTargets ? '\nI giorni di riposo restano il 15% sotto.' : ''
      }`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Aggiorna',
          onPress: async () => {
            await setSetting(db, 'targets', targets);
            if (data.training.restTargets) {
              await setTrainingSettings(db, { ...data.training, restTargets: deriveRestTargets(targets) });
            }
            haptics.success();
          },
        },
      ],
    );
  };

  // The weigh-ins right under the chart; the full history has its own page.
  const recent = withChanges(weights.filter((w) => !hidden.has(`weight:${w.date}`))).slice(0, 3);
  const changes = data ? measurementChanges(data.measurements, addDays(today, -89)) : [];

  return (
    <ScreenScroll>
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
        <Segmented options={WEIGHT_RANGES} value={weightRange} onChange={setWeightRange} />
        <WeightChart points={weights} from={weightFrom} to={today} />
        <Pressable onPress={editGoalWeight} accessibilityRole="button" style={styles.goalRow}>
          <Icon name="flag.checkered" size={18} tone="accent" />
          <AppText variant="subhead" style={styles.flex}>
            {data?.goalWeight
              ? `Obiettivo ${formatNumber(data.goalWeight, 1)} kg · ${forecastText(forecast)}`
              : 'Imposta un peso obiettivo'}
          </AppText>
          <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
        </Pressable>
      </Card>

      <View style={styles.gap} />
      <ListGroup>
        <ActionRow label="Registra il peso di oggi" onPress={logWeight} />
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
            onPress={() => router.push('/progress/weights')}
          />
        ) : null}
      </ListGroup>
      <SectionFooter>Una pesata al giorno: l’ultima sostituisce la precedente.</SectionFooter>

      <SectionTitle>Fabbisogno reale</SectionTitle>
      <Card style={styles.card}>
        {expenditure?.ok ? (
          <>
            <View>
              <AppText variant="title" numeric>
                {`${formatKcal(expenditure.estimate.tdee)} kcal`}
              </AppText>
              <AppText variant="subhead" tone="textSecondary">
                {`al giorno per mantenere il peso · stima ${expenditure.estimate.confidence === 'high' ? 'affidabile' : 'indicativa'}`}
              </AppText>
            </View>
            <AppText variant="footnote" tone="textSecondary" numeric>
              {`Ultime 4 settimane: hai mangiato in media ${formatKcal(expenditure.estimate.averageIntake)} kcal (${expenditure.estimate.loggedDays} giorni completi) e il peso è cambiato di ${expenditure.estimate.weeklyChange >= 0 ? '+' : '−'}${formatNumber(Math.abs(expenditure.estimate.weeklyChange), 2)} kg a settimana (${expenditure.estimate.weighIns} pesate).`}
            </AppText>
            <Button title="Usa per i miei obiettivi" variant="tinted" compact onPress={applyExpenditure} disabled={!data?.latest} />
          </>
        ) : (
          <AppText variant="subhead" tone="textSecondary">
            {`Incrociando calorie e peso calcolo quanto consumi davvero, meglio delle formule. ${
              expenditure && !expenditure.ok ? expenditure.reason : ''
            }`}
          </AppText>
        )}
      </Card>

      <SectionTitle>Calorie e macro</SectionTitle>
      <Segmented options={STATS_RANGES} value={statsRange} onChange={setStatsRange} />
      <View style={styles.gap} />
      <Card style={styles.card}>
        <CaloriesChart days={periodRows.map((d) => ({ date: d.date, kcal: d.kcal, target: d.targetKcal }))} />
        {summary ? (
          <>
            <View style={styles.averages}>
              <Average label="Media kcal" value={formatKcal(summary.average.kcal)} />
              {MACROS.map((m) => (
                <Average
                  key={m.key}
                  label={m.label}
                  value={`${formatNumber(summary.average[m.key], 0)} g`}
                  color={theme[m.key]}
                />
              ))}
            </View>
            <MacroSplit split={summary.split} />
            <View style={styles.adherence}>
              <Adherence label="Calorie nell’obiettivo (±10%)" value={summary.onTarget} />
              <Adherence label="Proteine raggiunte" value={summary.proteinReached} />
            </View>
          </>
        ) : null}
      </Card>
      <SectionFooter>
        {summary
          ? `Medie sui ${summary.loggedDays} giorni con almeno un alimento registrato. Il tratteggio è l’obiettivo del giorno.`
          : 'Registra qualche pasto per vedere l’andamento.'}
      </SectionFooter>

      <SectionTitle>Misure</SectionTitle>
      <ListGroup>
        {changes.map((m) => (
          <Row
            key={m.kind}
            title={m.label}
            subtitle={
              m.change !== null
                ? `${formatChange(m.change, m.unit, (n) => formatNumber(n, 1))} in 3 mesi`
                : formatShortDate(m.latest.date)
            }
            detail={`${formatNumber(m.latest.value, 1)} ${m.unit}`}
            chevron={false}
          />
        ))}
        <Row
          title={changes.length > 0 ? 'Registra o vedi lo storico' : 'Registra le misure'}
          icon={<Icon name="ruler" size={18} tone="accent" />}
          onPress={() => router.push('/progress/measurements')}
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

/** One bar split by the share of energy from protein, carbs and fat. */
function MacroSplit({ split }: { split: { protein: number; carbs: number; fat: number } }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Energia da proteine ${Math.round(split.protein)}%, carboidrati ${Math.round(split.carbs)}%, grassi ${Math.round(split.fat)}%`}
      style={styles.split}>
      <View style={styles.splitBar}>
        {MACROS.map((m) => (
          <View key={m.key} style={{ flex: Math.max(split[m.key], 0.001), backgroundColor: theme[m.key] }} />
        ))}
      </View>
      <View style={styles.splitLegend}>
        {MACROS.map((m) => (
          <AppText key={m.key} variant="caption" tone="textSecondary" numeric>
            <AppText variant="caption" weight="700" style={{ color: theme[m.key] }}>
              {`${m.label} `}
            </AppText>
            {`${Math.round(split[m.key])}%`}
          </AppText>
        ))}
      </View>
    </View>
  );
}

function Adherence({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.average}>
      <AppText variant="headline" numeric>{`${value}%`}</AppText>
      <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: Spacing.lg },
  gap: { height: Spacing.md },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 36 },
  averages: { flexDirection: 'row', gap: Spacing.sm },
  average: { flex: 1 },
  split: { gap: Spacing.xs },
  splitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  adherence: { flexDirection: 'row', gap: Spacing.sm },
});
