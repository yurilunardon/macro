import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { deleteWeight, getLatestWeight, getWeightsSince, setWeight } from '@/db/body';
import { useLiveQuery } from '@/db/live';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle } from '@/lib/dates';
import { formatNumber, numberToInput } from '@/lib/format';
import { formatChange, groupByMonth, withChanges } from '@/lib/weights';
import { haptics } from '@/services/haptics';

/** Every weigh-in, newest first and grouped by month, with the change from the one before. */
export default function WeightsScreen() {
  const db = useSQLiteContext();
  const today = useToday();
  const { data } = useLiveQuery('weights:all', async (database) => {
    const [weights, latest] = await Promise.all([getWeightsSince(database, '0000-01-01'), getLatestWeight(database)]);
    return { weights, latest };
  });

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

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const months = groupByMonth(withChanges(data.weights));

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Registra il peso di oggi" onPress={logWeight} />
      </Stack.Toolbar>
      {months.length === 0 ? (
        <AppText tone="textSecondary" align="center" style={styles.empty}>
          Nessuna pesata. Tocca + per registrare il peso di oggi.
        </AppText>
      ) : null}
      {months.map((month) => (
        <View key={month.title}>
          <SectionTitle>{month.title}</SectionTitle>
          <ListGroup>
            {month.items.map((w) => (
              <SwipeToDelete key={w.date} onDelete={() => void deleteWeight(db, w.date)}>
                <Row
                  title={formatDayTitle(w.date, today)}
                  subtitle={w.change !== null ? formatChange(w.change, 'kg', (n) => formatNumber(n, 1)) : 'Prima pesata'}
                  detail={`${formatNumber(w.kg, 1)} kg`}
                  chevron={false}
                />
              </SwipeToDelete>
            ))}
          </ListGroup>
        </View>
      ))}
      {months.length > 0 ? <SectionFooter>Scorri a sinistra su una pesata per eliminarla.</SectionFooter> : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: Spacing.xxl },
});
