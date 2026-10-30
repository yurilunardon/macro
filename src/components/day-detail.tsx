import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { getWeightUpTo } from '@/db/body';
import type { CalendarData } from '@/db/calendar';
import { getDayPlan } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getDosesOn, getSupplements, setDoseTaken } from '@/db/supplements';
import { isPendingDelete, type ActivityType, type AgendaItem } from '@/lib/calendar';
import { formatDayTitle, formatLongDate, type DateKey } from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';
import { dosesDue } from '@/lib/supplements';
import { logWeight } from '@/services/log-weight';
import { openAgendaItem } from '@/services/open-agenda-item';
import { startAndOpenWorkout } from '@/services/start-workout';
import { usePendingDeletes } from '@/services/undo';

import { ActivityBadge } from './activity-badge';
import { AgendaRow } from './agenda-row';
import { AppText } from './app-text';
import { ActionRow, ListGroup, Row, SectionTitle } from './card';
import { SupplementRow } from './supplement-row';

type DayDetailProps = {
  date: DateKey;
  today: DateKey;
  /** What the day holds, from the agenda of the screen. */
  items: readonly AgendaItem[];
  calendar: CalendarData | undefined;
  types: ReadonlyMap<number, ActivityType>;
  /** Whether the day has an activity, for the supplements taken on those days. */
  busy: boolean;
  /** The title and date on top; off where the screen's title already says it. */
  header?: boolean;
};

/**
 * Everything about one day: the workouts and activities, the supplements to tick, what was eaten
 * against its target and the weight.
 */
export function DayDetail({ date, today, items, calendar, types, busy, header = true }: DayDetailProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const pending = usePendingDeletes();
  const gymTypeId = calendar?.gymTypeId ?? null;

  const { data } = useLiveQuery(
    `day-detail:${date}`,
    async (database) => {
      const [supplements, taken, totals, plan, weight] = await Promise.all([
        getSupplements(database),
        getDosesOn(database, date),
        getDailyTotals(database, date, date),
        getDayPlan(database, date),
        getWeightUpTo(database, date),
      ]);
      return { supplements, taken, eaten: totals[0] ?? null, target: plan.targets, weight };
    },
    ['calendar', 'food', 'body', 'settings'],
  );

  const shown = items.filter((i) => !isPendingDelete(i, pending));
  const active = new Set(busy ? [date] : []);
  const due = (data?.supplements ?? []).filter((s) => s.schedule === 'asNeeded' || dosesDue(s, date, active) > 0);
  const dosesTaken = due.reduce((sum, s) => sum + Math.min(s.timesPerDay, data?.taken.get(s.id)?.size ?? 0), 0);
  const dosesDueCount = due.filter((s) => s.schedule !== 'asNeeded').reduce((sum, s) => sum + s.timesPerDay, 0);
  const weighIn = data?.weight?.date === date ? data.weight : null;
  const title = formatDayTitle(date, today);

  return (
    <View>
      {header ? (
        <View style={styles.head}>
          <AppText variant="title2" numberOfLines={1}>
            {title}
          </AppText>
          {title !== formatLongDate(date) ? (
            <AppText variant="subhead" tone="textSecondary">
              {formatLongDate(date)}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <ListGroup>
        {shown.map((item) => (
          <AgendaRow
            key={item.key}
            item={item}
            types={types}
            gymTypeId={gymTypeId}
            dayNames={calendar?.dayNames ?? new Map()}
            onPress={() => openAgendaItem(router, item)}
            onStart={
              item.kind === 'activity' && item.status === 'planned' && item.occurrence.typeId === gymTypeId && date === today
                ? () => void startAndOpenWorkout(db, router, item.dayId)
                : undefined
            }
          />
        ))}
        <ActionRow
          label={shown.length === 0 ? 'Aggiungi un’attività' : 'Aggiungi attività'}
          symbol="plus.circle.fill"
          onPress={() => router.push({ pathname: '/activity', params: { date } })}
        />
      </ListGroup>

      <SectionTitle
        action={
          dosesDueCount > 0 ? (
            <AppText variant="footnote" tone={dosesTaken >= dosesDueCount ? 'accent' : 'textSecondary'} weight="600" numeric>
              {`${Math.min(dosesTaken, dosesDueCount)} di ${dosesDueCount}`}
            </AppText>
          ) : undefined
        }>
        Integratori
      </SectionTitle>
      <ListGroup>
        {due.map((s) => (
          <SupplementRow
            key={s.id}
            supplement={s}
            taken={data?.taken.get(s.id) ?? new Set()}
            disabled={date > today}
            onToggle={(index, on) => void setDoseTaken(db, s.id, date, index, on)}
            onPress={() => router.push({ pathname: '/supplement', params: { id: s.id } })}
          />
        ))}
        {data && data.supplements.length === 0 ? (
          <ActionRow label="Aggiungi i tuoi integratori" symbol="plus.circle.fill" onPress={() => router.push('/supplement')} />
        ) : (
          <Row title={due.length === 0 ? 'Nessuno da prendere' : 'Tutti gli integratori'} onPress={() => router.push('/calendar/supplements')} />
        )}
      </ListGroup>

      {date <= today ? (
        <>
          <SectionTitle>Alimentazione e peso</SectionTitle>
          <ListGroup>
            <Row
              icon={<ActivityBadge symbol="fork.knife" color="orange" size={28} />}
              title="Alimentazione"
              subtitle={
                data?.eaten
                  ? `${formatKcal(data.eaten.kcal)} / ${formatKcal(data.target.kcal)} kcal · P ${formatNumber(data.eaten.protein, 0)} g`
                  : 'Niente registrato'
              }
              onPress={() => {
                // The diary is the tab beside: show that day there.
                router.navigate({ pathname: '/', params: { date } });
              }}
            />
            <Row
              icon={<ActivityBadge symbol="scalemass.fill" color="blue" size={28} />}
              title="Peso"
              detail={weighIn ? `${formatNumber(weighIn.kg, 1)} kg` : <AppText tone="accent">Registra</AppText>}
              chevron={weighIn !== null}
              onPress={() => logWeight(db, date, data?.weight ?? null, today)}
            />
          </ListGroup>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: Spacing.xs, paddingTop: Spacing.xl, paddingBottom: Spacing.sm },
});
