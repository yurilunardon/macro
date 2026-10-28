import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row, SectionFooter } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteSupplement, getSupplements, getSupplementStock } from '@/db/supplements';
import { useToday } from '@/hooks/use-today';
import { formatDose, formatEuro, formatSchedule, supplementSymbol } from '@/lib/supplements';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

/** The supplements in use: how much and when, and how long they last. */
export default function SupplementsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
  const pending = usePendingDeletes();
  const { data } = useLiveQuery(
    `supplements:${today}`,
    async (database) => {
      const list = await getSupplements(database);
      return { list, stock: await getSupplementStock(database, list, today) };
    },
    ['calendar'],
  );
  const list = (data?.list ?? []).filter((s) => !pending.has(`supplement:${s.id}`));
  const monthly = list.reduce((sum, s) => sum + (data?.stock.get(s.id)?.monthly ?? 0), 0);

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Nuovo integratore" onPress={() => router.push('/supplement')} />
      </Stack.Toolbar>

      {data && list.length === 0 ? (
        <Card style={styles.empty}>
          <ActivityBadge symbol="pills.fill" color="indigo" size={44} />
          <AppText variant="title2">I tuoi integratori</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Creatina, omega 3, vitamine, proteine: ogni giorno li spunti nel calendario e sai quanto spendi e quando finiscono.
          </AppText>
          <View style={styles.button}>
            <Button title="Aggiungi integratore" onPress={() => router.push('/supplement')} />
          </View>
        </Card>
      ) : null}

      {list.length > 0 ? (
        <>
          <ListGroup>
            {list.map((s) => {
              const stock = data?.stock.get(s.id);
              const days = stock?.daysLeft ?? null;
              return (
                <SwipeToDelete
                  key={s.id}
                  onDelete={() =>
                    deleteWithUndo({ key: `supplement:${s.id}`, title: `${s.name} eliminato`, run: () => deleteSupplement(db, s.id) })
                  }>
                  <Row
                    icon={<ActivityBadge symbol={supplementSymbol(s.unit)} color="indigo" />}
                    title={s.name}
                    subtitle={[formatDose(s.dose, s.unit), formatSchedule(s), s.reminder].filter(Boolean).join(' · ')}
                    detail={
                      days !== null ? (
                        <AppText variant="subhead" tone={days <= 7 ? 'warning' : 'textSecondary'} numeric>
                          {days <= 7 ? `Finisce tra ${days} gg` : `${days} gg`}
                        </AppText>
                      ) : undefined
                    }
                    onPress={() => router.push({ pathname: '/supplement', params: { id: s.id } })}
                  />
                </SwipeToDelete>
              );
            })}
          </ListGroup>
          <SectionFooter>
            {monthly > 0
              ? `Circa ${formatEuro(monthly)} al mese, ai prezzi delle confezioni. I giorni sono quelli che restano con le scorte.`
              : 'Con quantità e prezzo della confezione vedi quanto spendi al mese e quando finiscono.'}
          </SectionFooter>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  empty: { gap: Spacing.sm },
  button: { marginTop: Spacing.md },
});
