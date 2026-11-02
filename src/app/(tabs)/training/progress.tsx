import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getPeriodRecords, getWorkoutHistory } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { monthOf, weekOf, type DateKey } from '@/lib/dates';
import { formatNumber } from '@/lib/format';
import { compareCounts, dayNumber, monthWeeks, periodRange, totalsOf, volumeBuckets, workoutsBetween, workoutsPerMonth, type Period, type ProgressWorkout, type VolumeBucket } from '@/lib/progress';
import { formatLifted, formatWorkoutLengthShort } from '@/lib/training';
import { haptics } from '@/services/haptics';

const PERIODS = [
  { key: 'week', label: 'Settimana' },
  { key: 'month', label: 'Mese' },
  { key: 'year', label: 'Anno' },
] as const;

const FADE = FadeIn.duration(220);

/**
 * How the training is going, for the week, the month or the year: how many workouts as the big
 * number, on which days, how much was lifted over time and the records beaten.
 */
export default function ProgressScreen() {
  const theme = useTheme();
  const today = useToday();
  const { names } = useExerciseNames();
  const [period, setPeriod] = useState<Period>('month');
  const range = periodRange(period, today);
  const { data: history } = useLiveQuery('progress-history', (database) => getWorkoutHistory(database), ['training']);
  const { data: records } = useLiveQuery(`progress-records:${range.from}:${range.to}`, (database) => getPeriodRecords(database, range.from, range.to), ['training']);

  const workouts = history ?? [];
  const inside = workoutsBetween(workouts, range.from, range.to);
  const totals = totalsOf(inside);
  const compare = compareCounts(totals.count, workoutsBetween(workouts, range.previousFrom, range.previousTo).length, range);
  const stats = [
    { label: 'in palestra', value: totals.count > 0 ? formatWorkoutLengthShort(totals.seconds) : '0 min' },
    { label: 'serie', value: String(totals.sets) },
    { label: 'sollevati', value: formatLifted(totals.kg) },
  ];

  return (
    <ScreenScroll>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      {/* The whole page follows the period: it comes in fresh rather than changing piece by piece. */}
      <Animated.View key={period} entering={FADE} style={styles.page}>
        <View style={styles.hero}>
          <AppText variant="subhead" tone="textSecondary">
            {range.label}
          </AppText>
          <AppText numeric style={styles.bigNumber}>
            {String(totals.count)}
            <AppText variant="title2">{totals.count === 1 ? ' allenamento' : ' allenamenti'}</AppText>
          </AppText>
          {compare ? (
            <View style={styles.compare}>
              {compare.trend !== 'same' ? <Icon name={compare.trend === 'up' ? 'arrow.up.right' : 'arrow.down.right'} size={14} weight="semibold" tone={compare.trend === 'up' ? 'accent' : 'textSecondary'} /> : null}
              <AppText variant="subhead" weight="600" tone={compare.trend === 'up' ? 'accent' : 'textSecondary'}>
                {compare.text}
              </AppText>
            </View>
          ) : null}
        </View>

        <Card style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <AppText variant="headline" numeric numberOfLines={1}>
                {s.value}
              </AppText>
              <AppText variant="caption" tone="textSecondary">
                {s.label}
              </AppText>
            </View>
          ))}
        </Card>

        <Card style={styles.card}>
          <AppText variant="footnote" weight="600" tone="textSecondary">
            {period === 'year' ? 'I mesi in palestra' : 'I giorni in palestra'}
          </AppText>
          {period === 'year' ? <MonthTiles workouts={inside} from={range.from} /> : <DayGrid period={period} workouts={inside} today={today} />}
        </Card>

        <VolumeChart buckets={volumeBuckets(period, inside, range)} total={totals.kg} />

        {records && records.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="footnote" weight="600" tone="textSecondary">
              Record
            </AppText>
            {records.map((r) => (
              <View key={r.exercise.id} style={styles.record}>
                <AppText numberOfLines={1} style={styles.flex}>
                  {names(r.exercise).title}
                </AppText>
                <AppText weight="600" numeric style={{ color: theme.ringCloser }}>
                  {`+${formatNumber(r.gain, 1)} kg`}
                </AppText>
              </View>
            ))}
          </Card>
        ) : null}
      </Animated.View>
    </ScreenScroll>
  );
}

/** The days of the week or the month, those with a workout filled in green. */
function DayGrid({ period, workouts, today }: { period: 'week' | 'month'; workouts: readonly ProgressWorkout[]; today: DateKey }) {
  const theme = useTheme();
  const done = new Set(workouts.map((w) => w.date));
  const weeks = period === 'week' ? [weekOf(today)] : monthWeeks(monthOf(today));
  return (
    <View style={styles.weeks}>
      {weeks.map((week, row) => (
        <View key={row} style={styles.week}>
          {week.map((day, column) =>
            day === null ? (
              <View key={column} style={styles.dayCell} />
            ) : (
              <View
                key={day}
                accessible
                accessibilityLabel={`${dayNumber(day)}: ${done.has(day) ? 'allenamento' : 'nessun allenamento'}`}
                style={[styles.dayCell, styles.day, { backgroundColor: done.has(day) ? theme.accent : theme.fill }, day === today && !done.has(day) && { borderColor: theme.accent, borderWidth: 1.5 }]}>
                <AppText variant="caption" weight="600" numeric style={{ color: done.has(day) ? theme.onAccent : day > today ? theme.textTertiary : theme.textSecondary }}>
                  {dayNumber(day)}
                </AppText>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** The twelve months, in one green that deepens with the workouts done in each. */
function MonthTiles({ workouts, from }: { workouts: readonly ProgressWorkout[]; from: DateKey }) {
  const theme = useTheme();
  const months = workoutsPerMonth(workouts, from);
  const most = Math.max(1, ...months.map((m) => m.count));
  return (
    <View style={styles.months}>
      {months.map((m) => {
        const strength = m.count / most;
        const strong = strength > 0.6;
        return (
          <View key={m.key} accessible accessibilityLabel={`${m.title}: ${m.count}`} style={[styles.month, { backgroundColor: theme.fill }]}>
            {m.count > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.accent, opacity: 0.25 + strength * 0.75 }]} /> : null}
            <AppText variant="caption" weight="600" style={{ color: strong ? theme.onAccent : theme.textSecondary }}>
              {m.title.slice(0, 3)}
            </AppText>
            <AppText variant="headline" numeric style={{ color: strong ? theme.onAccent : theme.text }}>
              {String(m.count)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** One bar per stretch of the period; a tap on a bar shows what it holds in the heading. */
function VolumeChart({ buckets, total }: { buckets: readonly VolumeBucket[]; total: number }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const most = Math.max(1, ...buckets.map((b) => b.kg));
  const shown = buckets.find((b) => b.key === picked) ?? null;
  return (
    <Card style={styles.card}>
      <View style={styles.chartHead}>
        <AppText variant="footnote" weight="600" tone="textSecondary">
          {shown ? shown.title : 'Volume'}
        </AppText>
        <AppText variant="footnote" weight="600" numeric>
          {formatLifted(shown ? shown.kg : total)}
        </AppText>
      </View>
      <View style={styles.bars}>
        {buckets.map((b) => (
          <Pressable
            key={b.key}
            onPress={() => {
              haptics.selection();
              setPicked(b.key === picked ? null : b.key);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${b.title}: ${formatLifted(b.kg)}`}
            style={styles.barSlot}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  b.kg > 0
                    ? { height: `${Math.max(4, (b.kg / most) * 100)}%`, backgroundColor: theme.accent, opacity: picked === null || b.key === picked ? 1 : 0.4 }
                    : { height: 2, backgroundColor: theme.track },
                ]}
              />
            </View>
            <AppText variant="caption" tone={b.key === picked ? 'text' : 'textSecondary'} maxFontSizeMultiplier={1.2}>
              {b.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { gap: Spacing.md, marginTop: Spacing.md },
  hero: { paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm, gap: 2 },
  bigNumber: { fontSize: 60, lineHeight: 66, fontWeight: '800', letterSpacing: -1 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, gap: 1 },
  card: { gap: Spacing.sm },
  weeks: { gap: Spacing.xs + 1 },
  week: { flexDirection: 'row', gap: Spacing.xs + 1 },
  dayCell: { flex: 1, aspectRatio: 1 },
  day: { borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs + 1 },
  month: { flexBasis: '23%', flexGrow: 1, minHeight: 60, padding: Spacing.sm, borderRadius: Radius.sm, borderCurve: 'continuous', overflow: 'hidden', gap: 1 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between' },
  bars: { flexDirection: 'row', gap: Spacing.xs },
  barSlot: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  barTrack: { height: 88, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 28 },
});
