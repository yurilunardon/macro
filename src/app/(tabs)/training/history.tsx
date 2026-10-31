import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteWorkout, getWorkoutHistory } from '@/db/workouts';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle } from '@/lib/dates';
import { countLabel, formatNumber } from '@/lib/format';
import { formatWorkoutLength } from '@/lib/training';
import { groupByMonth } from '@/lib/weights';

/** Every finished workout, newest first, by month. */
export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
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
                icon={<DayBadge icon={w.icon} />}
                title={w.name}
                subtitle={`${formatDayTitle(w.date, today)} · ${formatWorkoutLength(
                  (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000,
                )} · ${countLabel(w.workSets, 'serie', 'serie')}${w.tonnage > 0 ? ` · ${formatNumber(w.tonnage, 0)} kg` : ''}`}
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: Spacing.xxl, paddingHorizontal: Spacing.lg },
});
