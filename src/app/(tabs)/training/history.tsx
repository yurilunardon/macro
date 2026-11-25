import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteWorkout, getWorkoutHistory, type WorkoutSummary } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate, formatWeekdayName, fromDateKey } from '@/lib/dates';
import { countLabel } from '@/lib/format';
import { formatRestGap, historyLine, PAUSE_DAYS, type HistoryItem, type RestGap } from '@/lib/history';
import { formatWorkoutLength } from '@/lib/training';
import { groupByMonth } from '@/lib/weights';

/** Every finished workout, newest first, by month, with the days of rest between them named. */
export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const confirm = () =>
    confirmDestructive({
      title: 'Eliminare l’allenamento?',
      message: 'Sparisce dallo storico e dai record.',
      action: 'Elimina allenamento',
    });
  const { data } = useLiveQuery('workout-history', (database) => getWorkoutHistory(database), ['training']);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const months = byMonth(historyLine(data));

  return (
    <ScreenScroll>
      {months.length === 0 ? (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          Nessun allenamento.
        </AppText>
      ) : null}
      {months.map((month) => (
        <View key={month.title}>
          <SectionTitle>{`${month.title} · ${countLabel(month.items.filter((i) => i.kind === 'workout').length, 'allenamento', 'allenamenti')}`}</SectionTitle>
          <View style={styles.line}>
            {month.items.map((item) =>
              item.kind === 'rest' ? (
                <RestRow key={`rest-${item.gap.from}`} gap={item.gap} />
              ) : (
                <SwipeToDelete key={item.workout.id} confirm={confirm} onDelete={() => void deleteWorkout(db, item.workout.id)}>
                  <WorkoutRow
                    workout={item.workout}
                    // Relative, so from the calendar's stack it stays there.
                    onPress={() => router.push({ pathname: './session', params: { id: item.workout.id } })}
                  />
                </SwipeToDelete>
              ),
            )}
          </View>
        </View>
      ))}
    </ScreenScroll>
  );
}

/**
 * Months of the history, each with its workouts and the days without training between them. A
 * gap that runs into the month before stays in the month of the workout after it.
 */
function byMonth(items: HistoryItem<WorkoutSummary>[]): { title: string; items: HistoryItem<WorkoutSummary>[] }[] {
  const months: { key: string; title: string; items: HistoryItem<WorkoutSummary>[] }[] = [];
  for (const item of items) {
    const last = months[months.length - 1];
    if (item.kind === 'rest') {
      last?.items.push(item);
      continue;
    }
    const key = item.workout.date.slice(0, 7);
    if (last && last.key === key) last.items.push(item);
    else months.push({ key, title: groupByMonth([item.workout])[0].title, items: [item] });
  }
  return months;
}

/** A workout: the day of the month on the left, then what it was, the day of the week and how long. */
function WorkoutRow({ workout, onPress }: { workout: WorkoutSummary; onPress: () => void }) {
  const theme = useTheme();
  const seconds = (Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 1000;
  const name = formatWeekdayName(workout.date);
  const weekday = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${workout.name}, ${formatLongDate(workout.date)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.background }, pressed && { opacity: 0.7 }]}>
      <View style={styles.date} accessible={false}>
        <AppText variant="title2" weight="700" numeric>
          {String(fromDateKey(workout.date).getDate())}
        </AppText>
      </View>
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <View style={styles.flex}>
          <AppText numberOfLines={1}>{workout.name}</AppText>
          <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
            {Number.isFinite(seconds) && seconds > 0 ? `${weekday} · ${formatWorkoutLength(seconds)}` : weekday}
          </AppText>
        </View>
        <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
      </View>
    </Pressable>
  );
}

/** The days between two workouts, named: a thin line under the dates and what they were. */
function RestRow({ gap }: { gap: RestGap }) {
  const theme = useTheme();
  const pause = gap.days >= PAUSE_DAYS;
  return (
    <View style={styles.rest}>
      <View style={styles.date}>
        <View style={[styles.restLine, { backgroundColor: theme.separator }, pause && styles.restLinePause]} />
      </View>
      <AppText variant="footnote" tone="textSecondary" style={styles.flex}>
        {formatRestGap(gap)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  line: { paddingHorizontal: Spacing.lg, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  date: { width: 36, alignItems: 'center' },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rest: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 28 },
  restLine: { width: 2, height: 22, borderRadius: 1 },
  restLinePause: { height: 34 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: Spacing.xxl, paddingHorizontal: Spacing.lg },
});
