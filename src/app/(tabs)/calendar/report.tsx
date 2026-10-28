import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AgendaRow } from '@/components/agenda-row';
import { AppText } from '@/components/app-text';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { CaloriesChart } from '@/components/charts';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { NutritionSummary } from '@/components/nutrition-summary';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { getWeightsSince } from '@/db/body';
import { getDayPlans } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getDosesTaken, getPurchasesBetween, getSupplements } from '@/db/supplements';
import { getWorkoutHistory } from '@/db/workouts';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useAgenda } from '@/hooks/use-agenda';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { busyDates, formatMinutes, summarizeActivity, type AgendaItem } from '@/lib/calendar';
import { daysFrom, formatShortDate, isDateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { buckets, formatDelta, formatPeriod, formatPrevious, isPeriod, periodRange, shiftPeriod, type Period } from '@/lib/report';
import { summarizePeriod } from '@/lib/stats';
import { adherence, formatEuro, percent } from '@/lib/supplements';
import { formatChange } from '@/lib/weights';
import { haptics } from '@/services/haptics';

const PERIODS = [
  { key: 'week', label: 'Settimana' },
  { key: 'month', label: 'Mese' },
  { key: 'year', label: 'Anno' },
] as const;

/** Up to this many done activities listed at the bottom, newest first. */
const LOG_LIMIT = 60;

/**
 * What was done in a week, a month or a year: active days, time, the gym, every kind of
 * activity, what was eaten, the weight and the supplements with what they cost, each against
 * the period before.
 */
export default function ReportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const today = useToday();
  const params = useLocalSearchParams<{ period?: string; anchor?: string }>();
  const [period, setPeriod] = useState<Period>(isPeriod(params.period) ? params.period : 'month');
  const [anchor, setAnchor] = useState(isDateKey(params.anchor) ? params.anchor : today);

  const range = periodRange(period, anchor);
  const before = periodRange(period, shiftPeriod(period, anchor, -1));
  const { data, agenda, types } = useAgenda(before.from, range.to, today);
  const gymTypeId = data?.gymTypeId ?? null;
  const allTypes = data?.types ?? [];
  const now = summarizeActivity(agenda, allTypes, gymTypeId, range.from, range.to);
  const then = summarizeActivity(agenda, allTypes, gymTypeId, before.from, before.to);
  const countOf = (summary: typeof now, typeId: number | null) => summary.byType.find((t) => t.typeId === typeId)?.count ?? 0;

  const { data: extra } = useLiveQuery(
    `report:${before.from}:${range.to}`,
    async (database) => {
      const [supplements, doses, purchases, previousPurchases, workouts] = await Promise.all([
        getSupplements(database, { archived: true }),
        getDosesTaken(database, range.from, range.to),
        getPurchasesBetween(database, range.from, range.to),
        getPurchasesBetween(database, before.from, before.to),
        getWorkoutHistory(database, 2000),
      ]);
      return { supplements, doses, purchases, previousPurchases, workouts };
    },
    ['calendar', 'training'],
  );

  // Food and weight, up to today: the days to come have nothing logged yet.
  const lastDay = range.to < today ? range.to : today;
  const { data: body } = useLiveQuery(
    `report-body:${before.from}:${lastDay}`,
    async (database) => {
      const dates = range.from <= lastDay ? daysFrom(range.from, lastDay) : [];
      const [totals, plans, weights] = await Promise.all([
        dates.length > 0 ? getDailyTotals(database, range.from, lastDay) : Promise.resolve([]),
        getDayPlans(database, dates),
        getWeightsSince(database, before.from),
      ]);
      const eaten = new Map(totals.map((t) => [t.date, t]));
      const food = dates.map((date) => {
        const t = eaten.get(date);
        const target = plans.get(date)?.targets;
        return {
          date,
          kcal: t?.kcal ?? 0,
          protein: t?.protein ?? 0,
          carbs: t?.carbs ?? 0,
          fat: t?.fat ?? 0,
          targetKcal: target?.kcal ?? 0,
          targetProtein: target?.protein ?? 0,
        };
      });
      return { food, weights: weights.filter((w) => w.date <= lastDay) };
    },
    ['food', 'body', 'settings', 'calendar'],
  );
  const nutrition = body ? summarizePeriod(body.food) : null;
  const weighIns = (body?.weights ?? []).filter((w) => w.date >= range.from);
  const lastWeight = weighIns[weighIns.length - 1] ?? null;
  // From the last weigh-in before the period, or its first one.
  const startWeight = [...(body?.weights ?? [])].reverse().find((w) => w.date < range.from) ?? weighIns[0] ?? null;
  const weightChange = lastWeight && startWeight && lastWeight.date !== startWeight.date ? lastWeight.kg - startWeight.kg : null;

  const spent = (extra?.purchases ?? []).reduce((sum, p) => sum + p.price, 0);
  const spentBefore = (extra?.previousPurchases ?? []).reduce((sum, p) => sum + p.price, 0);
  const days = daysFrom(range.from, range.to);
  const busy = busyDates(agenda);
  const supplementRows = (extra?.supplements ?? [])
    .map((s) => ({
      supplement: s,
      result: adherence(s, extra?.doses ?? new Map(), days, busy, today),
      spent: (extra?.purchases ?? []).filter((p) => p.supplementId === s.id).reduce((sum, p) => sum + p.price, 0),
      taken: days.reduce((sum, d) => sum + (extra?.doses.get(`${s.id}:${d}`) ?? 0), 0),
    }))
    .filter((r) => r.result.due > 0 || r.taken > 0 || r.spent > 0);

  const workouts = (extra?.workouts ?? []).filter((w) => w.date >= range.from && w.date <= range.to);
  const workSets = workouts.reduce((sum, w) => sum + w.workSets, 0);
  const tonnage = workouts.reduce((sum, w) => sum + w.tonnage, 0);
  const byDay = new Map<string, number>();
  for (const w of workouts) byDay.set(w.name, (byDay.get(w.name) ?? 0) + 1);
  const topDays = [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  // The chart: per part of the period, the done activities of each kind stacked.
  const bars = buckets(period, anchor).map((b) => {
    const counts = new Map<number, number>();
    for (const t of summarizeActivity(agenda, allTypes, gymTypeId, b.from, b.to).byType) counts.set(t.typeId, t.count);
    return { ...b, counts, total: [...counts.values()].reduce((sum, n) => sum + n, 0) };
  });
  const highest = Math.max(1, ...bars.map((b) => b.total));

  const log: AgendaItem[] = [];
  for (const day of [...days].reverse()) {
    for (const item of [...(agenda.get(day) ?? [])].reverse()) {
      if (item.kind === 'workout' ? item.workout.endedAt !== null : item.status === 'done') log.push(item);
    }
  }

  const isCurrent = range.from <= today && today <= range.to;
  const canGoForward = shiftPeriod(period, anchor, 1) <= today;
  const go = (direction: number) => {
    haptics.selection();
    setAnchor(shiftPeriod(period, anchor, direction));
  };
  const previous = formatPrevious(period, anchor);

  const share = () => {
    const lines = [
      `Fuel · ${formatPeriod(period, anchor)}`,
      `Giorni attivi: ${now.activeDays}`,
      `Tempo: ${formatMinutes(now.minutes)}`,
      ...now.byType.map((t) => `${types.get(t.typeId)?.name ?? 'Attività'}: ${t.count} (${formatMinutes(t.minutes)})`),
      ...(workouts.length > 0 ? [`Serie allenanti: ${workSets}`, `Volume: ${formatNumber(tonnage, 0)} kg`] : []),
      ...supplementRows.map((r) => {
        const p = percent(r.result);
        return `${r.supplement.name}: ${p !== null ? `${p}%` : `${r.taken} dosi`}`;
      }),
      ...(nutrition ? [`Calorie in media: ${formatKcal(nutrition.average.kcal)} kcal`, `Proteine in media: ${formatNumber(nutrition.average.protein, 0)} g`] : []),
      ...(lastWeight ? [`Peso: ${formatNumber(lastWeight.kg, 1)} kg${weightChange !== null ? ` (${formatChange(weightChange, 'kg', (n) => formatNumber(n, 1))})` : ''}`] : []),
      ...(spent > 0 ? [`Speso in integratori: ${formatEuro(spent)}`] : []),
    ];
    void Share.share({ message: lines.join('\n') });
  };

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.arrow.up" accessibilityLabel="Condividi il report" onPress={share} />
      </Stack.Toolbar>

      <Segmented
        options={PERIODS}
        value={period}
        onChange={(next) => {
          setPeriod(next);
          setAnchor(isCurrent ? today : range.from);
        }}
      />

      <View style={styles.nav}>
        <Pressable onPress={() => go(-1)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Periodo precedente" style={styles.arrow}>
          <Icon name="chevron.left" size={18} tone="accent" weight="semibold" />
        </Pressable>
        <AppText variant="headline" style={styles.navTitle} numberOfLines={1}>
          {formatPeriod(period, anchor)}
        </AppText>
        <Pressable
          onPress={() => go(1)}
          disabled={!canGoForward}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Periodo successivo"
          style={[styles.arrow, !canGoForward && styles.disabled]}>
          <Icon name="chevron.right" size={18} tone="accent" weight="semibold" />
        </Pressable>
      </View>

      <View style={styles.tiles}>
        <Tile label="Giorni attivi" value={String(now.activeDays)} delta={formatDelta(now.activeDays, then.activeDays)} />
        <Tile label="Tempo" value={`${formatNumber(now.minutes / 60, now.minutes < 600 ? 1 : 0)} h`} delta={formatDelta(now.minutes / 60, then.minutes / 60, 1)} unit="h" />
        <Tile label="Palestra" value={String(countOf(now, gymTypeId))} delta={formatDelta(countOf(now, gymTypeId), countOf(then, gymTypeId))} />
        <Tile
          label="Integratori"
          value={formatEuro(spent)}
          delta={spent === spentBefore ? '=' : `${spent > spentBefore ? '+' : '−'}${formatEuro(Math.abs(spent - spentBefore))}`}
        />
      </View>
      <SectionFooter>{`Tra parentesi, rispetto a ${previous}.`}</SectionFooter>

      <Card style={styles.chart}>
        <View style={styles.bars}>
          {bars.map((b, i) => (
            <View key={i} style={styles.barColumn} accessible accessibilityLabel={`${b.label}: ${countLabel(b.total, 'attività', 'attività')}`}>
              <AppText variant="caption" tone="textSecondary" numeric style={styles.barTotal}>
                {b.total > 0 ? String(b.total) : ' '}
              </AppText>
              <View style={[styles.barTrack, { backgroundColor: theme.fill }]}>
                <View style={[styles.barStack, { height: `${(b.total / highest) * 100}%` }]}>
                  {[...b.counts.entries()].map(([typeId, n]) => {
                    const type = types.get(typeId);
                    return <View key={typeId} style={{ flex: n, backgroundColor: type ? colors[type.color] : theme.accent }} />;
                  })}
                </View>
              </View>
              <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
                {b.label}
              </AppText>
            </View>
          ))}
        </View>
      </Card>

      <SectionTitle>Attività</SectionTitle>
      <ListGroup>
        {now.byType.length === 0 ? <Row title="Nessuna attività fatta" chevron={false} /> : null}
        {now.byType.map((t) => {
          const type = types.get(t.typeId);
          return (
            <Row
              key={t.typeId}
              icon={<ActivityBadge symbol={type?.symbol ?? 'calendar'} color={type?.color ?? 'blue'} />}
              title={type?.name ?? 'Attività'}
              subtitle={`${countLabel(t.count, 'volta', 'volte')} · ${formatMinutes(t.minutes)}`}
              chevron={false}
              detail={formatDelta(t.count, countOf(then, t.typeId))}
            />
          );
        })}
      </ListGroup>

      {workouts.length > 0 ? (
        <>
          <SectionTitle>Palestra</SectionTitle>
          <ListGroup>
            <Row title="Allenamenti" chevron={false} detail={String(workouts.length)} />
            <Row title="Serie allenanti" chevron={false} detail={String(workSets)} />
            <Row title="Volume" chevron={false} detail={`${formatNumber(tonnage, 0)} kg`} />
            {topDays.length > 0 ? (
              <Row title="Giorni fatti" subtitle={topDays.map(([name, n]) => `${name} ${n}`).join(' · ')} chevron={false} />
            ) : null}
            <Row title="Tutti gli allenamenti" onPress={() => router.push('/training/history')} />
          </ListGroup>
        </>
      ) : null}

      <SectionTitle>Alimentazione</SectionTitle>
      <Card style={styles.food}>
        {period !== 'year' && body ? (
          <CaloriesChart days={body.food.map((d) => ({ date: d.date, kcal: d.kcal, target: d.targetKcal }))} />
        ) : null}
        {nutrition ? (
          <NutritionSummary summary={nutrition} />
        ) : (
          <AppText variant="subhead" tone="textSecondary">
            Nessun pasto registrato.
          </AppText>
        )}
      </Card>
      {nutrition ? (
        <SectionFooter>
          {`Medie sui ${nutrition.loggedDays} giorni con almeno un alimento registrato.${period !== 'year' ? ' Il tratteggio è l’obiettivo del giorno.' : ''}`}
        </SectionFooter>
      ) : null}

      <SectionTitle>Peso</SectionTitle>
      <ListGroup>
        <Row
          icon={<ActivityBadge symbol="scalemass.fill" color="blue" />}
          title={lastWeight ? `${formatNumber(lastWeight.kg, 1)} kg` : 'Nessuna pesata'}
          subtitle={
            lastWeight
              ? [weightChange !== null ? `${formatChange(weightChange, 'kg', (n) => formatNumber(n, 1))} nel periodo` : null, countLabel(weighIns.length, 'pesata', 'pesate')]
                  .filter(Boolean)
                  .join(' · ')
              : null
          }
          onPress={() => router.push('/calendar/weight')}
        />
      </ListGroup>

      {supplementRows.length > 0 || spent > 0 ? (
        <>
          <SectionTitle>Integratori</SectionTitle>
          <ListGroup>
            {supplementRows.map((r) => {
              const p = percent(r.result);
              return (
                <View key={r.supplement.id} style={styles.supplement}>
                  <View style={styles.supplementTop}>
                    <AppText style={styles.flex} numberOfLines={1}>
                      {r.supplement.name}
                    </AppText>
                    <AppText tone="textSecondary" numeric>
                      {p !== null ? `${p}%` : countLabel(r.taken, 'dose', 'dosi')}
                    </AppText>
                  </View>
                  {p !== null ? (
                    <>
                      <ProgressBar value={r.result.taken} target={r.result.due} color={p >= 80 ? theme.accent : theme.warning} height={5} />
                      <AppText variant="footnote" tone="textSecondary" numeric>
                        {`${r.result.taken} di ${r.result.due} dosi${r.spent > 0 ? ` · ${formatEuro(r.spent)}` : ''}`}
                      </AppText>
                    </>
                  ) : r.spent > 0 ? (
                    <AppText variant="footnote" tone="textSecondary" numeric>
                      {formatEuro(r.spent)}
                    </AppText>
                  ) : null}
                </View>
              );
            })}
            <Row title="Speso" chevron={false} detail={formatEuro(spent)} />
          </ListGroup>
          <SectionFooter>Le dosi contano dai giorni in cui erano previste; la spesa dalle confezioni comprate.</SectionFooter>
        </>
      ) : null}

      {log.length > 0 ? (
        <>
          <SectionTitle>Cosa hai fatto</SectionTitle>
          <ListGroup>
            {log.slice(0, LOG_LIMIT).map((item) => (
              <AgendaRow
                key={`${item.key}`}
                item={item}
                types={types}
                gymTypeId={gymTypeId}
                dayNames={data?.dayNames ?? new Map()}
                prefix={formatShortDate(item.kind === 'workout' ? item.workout.date : item.occurrence.date)}
                onPress={() => {
                  if (item.kind === 'workout') router.push({ pathname: '/training/session', params: { id: item.workout.id } });
                  else
                    router.push({
                      pathname: '/activity',
                      params:
                        item.occurrence.planId === null
                          ? { id: item.occurrence.recordId ?? undefined }
                          : { plan: item.occurrence.planId, date: item.occurrence.date },
                    });
                }}
              />
            ))}
          </ListGroup>
          {log.length > LOG_LIMIT ? <SectionFooter>{`E altre ${log.length - LOG_LIMIT}.`}</SectionFooter> : null}
        </>
      ) : null}
    </ScreenScroll>
  );
}

function Tile({ label, value, delta, unit }: { label: string; value: string; delta: string; unit?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.card }]}>
      <AppText variant="footnote" weight="600" tone="textSecondary">
        {label.toUpperCase()}
      </AppText>
      <AppText variant="title2" numeric numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="footnote" tone="textSecondary" numeric>
        {delta === '=' ? 'Come prima' : `(${delta}${unit ? ` ${unit}` : ''})`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, marginBottom: Spacing.sm },
  navTitle: { flex: 1, textAlign: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: Spacing.lg,
    gap: 2,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  chart: { marginTop: Spacing.lg },
  food: { gap: Spacing.lg },
  bars: { flexDirection: 'row', gap: 6, height: 150, alignItems: 'flex-end' },
  barColumn: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTotal: { height: 16 },
  barTrack: { flex: 1, width: '100%', maxWidth: 28, borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
  barStack: { width: '100%', flexDirection: 'column-reverse' },
  supplement: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 6 },
  supplementTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
