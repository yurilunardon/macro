import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionTitle } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getWorkoutHistory } from '@/db/workouts';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle } from '@/lib/dates';
import { countLabel, formatNumber } from '@/lib/format';
import { formatWorkoutLength } from '@/lib/training';
import { groupByMonth } from '@/lib/weights';

/** Every finished workout, newest first, by month. */
export default function HistoryScreen() {
  const router = useRouter();
  const today = useToday();
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
              <Row
                key={w.id}
                title={w.name}
                subtitle={`${formatDayTitle(w.date, today)} · ${formatWorkoutLength(
                  (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000,
                )} · ${countLabel(w.workSets, 'serie', 'serie')}${w.tonnage > 0 ? ` · ${formatNumber(w.tonnage, 0)} kg` : ''}`}
                onPress={() => router.push({ pathname: '/training/session', params: { id: w.id } })}
              />
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
