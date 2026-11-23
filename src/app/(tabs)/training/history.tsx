import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionTitle } from '@/components/card';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteWorkout, getWorkoutHistory } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate, formatWeekdayAbbr, fromDateKey, type DateKey } from '@/lib/dates';
import { countLabel } from '@/lib/format';
import { groupByMonth } from '@/lib/weights';

/** Every finished workout, newest first, by month: for each, the day it was and what day it was. */
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
  const months = groupByMonth(data);

  return (
    <ScreenScroll>
      {months.length === 0 ? (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          Nessun allenamento.
        </AppText>
      ) : null}
      {months.map((month) => (
        <View key={month.title}>
          <SectionTitle>{`${month.title} · ${countLabel(month.items.length, 'allenamento', 'allenamenti')}`}</SectionTitle>
          <ListGroup>
            {month.items.map((w) => (
              <SwipeToDelete key={w.id} confirm={confirm} onDelete={() => void deleteWorkout(db, w.id)}>
              <Row
                icon={<DateLeaf date={w.date} />}
                title={w.name}
                accessibilityHint={formatLongDate(w.date)}
                // Relative, so from the calendar's stack it stays there.
                onPress={() => router.push({ pathname: './session', params: { id: w.id } })}
              />
              </SwipeToDelete>
            ))}
          </ListGroup>
        </View>
      ))}
    </ScreenScroll>
  );
}

/** The date as a calendar's leaf: the day of the week above, the day of the month big under it. */
function DateLeaf({ date }: { date: DateKey }) {
  const theme = useTheme();
  return (
    <View style={[styles.leaf, { backgroundColor: theme.fill }]} accessible={false}>
      <AppText variant="caption" weight="700" tone="accent" style={styles.leafDay}>
        {formatWeekdayAbbr(date)}
      </AppText>
      <AppText variant="title3" weight="600" numeric style={styles.leafNumber}>
        {String(fromDateKey(date).getDate())}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  leaf: { width: 44, height: 44, borderRadius: Radius.sm, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  leafDay: { fontSize: 10, lineHeight: 12, letterSpacing: 0.4 },
  leafNumber: { lineHeight: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: Spacing.xxl, paddingHorizontal: Spacing.lg },
});
