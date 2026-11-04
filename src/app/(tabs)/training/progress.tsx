import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
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
import { compareCounts, compareTimes, dayNumber, howOften, monthWeeks, periodRange, restBuckets, timesOf, totalsOf, volumeBuckets, workoutsBetween, workoutsPerMonth, type Period, type PeriodBucket, type ProgressWorkout } from '@/lib/progress';
import { formatDuration, formatLifted, formatWorkoutLengthShort } from '@/lib/training';
import { haptics } from '@/services/haptics';

const PERIODS = [
  { key: 'week', label: 'Settimana' },
  { key: 'month', label: 'Mese' },
  { key: 'year', label: 'Anno' },
] as const;

const FADE = FadeIn.duration(220);

/**
 * How the training is going, for the week, the month or the year: how many workouts as the big
 * number, then chapters on the page itself, each saying in a line what its numbers mean: how
 * regular it was, how much was lifted, how the time went, and the records beaten.
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
  const before = workoutsBetween(workouts, range.previousFrom, range.previousTo);
  const times = timesOf(inside);
  const timesBefore = timesOf(before);
  const load = [`${formatLifted(totals.kg)} sollevati`, totals.count > 0 ? `${formatWorkoutLengthShort(totals.seconds)} in palestra` : null, `${totals.sets} serie`].filter(Boolean).join(' · ');

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

        <Chapter title="Costanza" line={howOften(period, totals.count, range.from, range.to, today)}>
          {period === 'year' ? <MonthTiles workouts={inside} from={range.from} /> : <DayGrid period={period} workouts={inside} today={today} />}
        </Chapter>

        <Chapter title="Carico" line={load}>
          <BarChart buckets={volumeBuckets(period, inside, range).map(({ kg, ...bucket }) => ({ ...bucket, value: kg }))} format={formatLifted} />
        </Chapter>

        {times.workout !== null ? (
          <Chapter title="Tempi" line="In media, in questo periodo">
            <View>
              <TimeRow label="Un allenamento" value={formatWorkoutLengthShort(times.workout)} change={compareTimes(times.workout, timesBefore.workout, range)} />
              {times.between !== null ? <TimeRow divided label="Tra una serie e l’altra" value={formatDuration(times.between)} change={compareTimes(times.between, timesBefore.between, range)} /> : null}
              {times.work !== null ? <TimeRow divided label="Una serie" value={formatDuration(times.work)} change={compareTimes(times.work, timesBefore.work, range)} /> : null}
            </View>
            {times.between !== null ? (
              <View style={styles.timeChart}>
                <AppText variant="footnote" tone="textSecondary">
                  Tra una serie e l’altra
                </AppText>
                <BarChart buckets={restBuckets(period, inside, range)} format={formatDuration} />
              </View>
            ) : null}
          </Chapter>
        ) : null}

        {records && records.length > 0 ? (
          <Chapter title="Record" line={records.length === 1 ? '1 esercizio più forte di sempre' : `${records.length} esercizi più forti di sempre`}>
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
          </Chapter>
        ) : null}
      </Animated.View>
    </ScreenScroll>
  );
}

/** A part of the page: its title, a line saying what its numbers mean, and the numbers. */
function Chapter({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <View style={styles.chapter}>
      <View>
        <AppText variant="title3">{title}</AppText>
        <AppText variant="subhead" tone="textSecondary" numeric>
          {line}
        </AppText>
      </View>
      {children}
    </View>
  );
}

/** A time of the period, with how it compares with the one before. */
function TimeRow({ label, value, change, divided = false }: { label: string; value: string; change: string | null; divided?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.timeRow, divided && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
      <View style={styles.flex}>
        <AppText variant="subhead" tone="textSecondary">
          {label}
        </AppText>
        {change ? (
          <AppText variant="footnote" tone="textSecondary" numeric>
            {change}
          </AppText>
        ) : null}
      </View>
      <AppText variant="title3" numeric numberOfLines={1}>
        {value}
      </AppText>
    </View>
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
                style={[styles.dayCell, styles.day, { backgroundColor: done.has(day) ? theme.accent : theme.card }, day === today && !done.has(day) && { borderColor: theme.accent, borderWidth: 1.5 }]}>
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
          <View key={m.key} accessible accessibilityLabel={`${m.title}: ${m.count}`} style={[styles.month, { backgroundColor: theme.card }]}>
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
function BarChart({ buckets, format }: { buckets: readonly PeriodBucket[]; format: (value: number) => string }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const most = Math.max(1, ...buckets.map((b) => b.value));
  const shown = buckets.find((b) => b.key === picked) ?? null;
  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <AppText variant="footnote" weight="600" tone="textSecondary">
          {shown ? shown.title : 'Tocca una barra'}
        </AppText>
        {shown ? (
          <AppText variant="footnote" weight="600" numeric>
            {format(shown.value)}
          </AppText>
        ) : null}
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
            accessibilityLabel={`${b.title}: ${format(b.value)}`}
            style={styles.barSlot}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  b.value > 0
                    ? { height: `${Math.max(4, (b.value / most) * 100)}%`, backgroundColor: theme.accent, opacity: picked === null || b.key === picked ? 1 : 0.4 }
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { gap: Spacing.xxl, marginTop: Spacing.lg },
  chapter: { gap: Spacing.md },
  chart: { gap: Spacing.sm },
  hero: { paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm, gap: 2 },
  bigNumber: { fontSize: 60, lineHeight: 66, fontWeight: '800', letterSpacing: -1 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
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
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 50, paddingVertical: Spacing.sm },
  timeChart: { gap: Spacing.xs, marginTop: Spacing.sm },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 28 },
});
