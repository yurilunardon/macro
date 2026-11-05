import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionTitle } from '@/components/card';
import { StepButton } from '@/components/stepper';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { addActivity } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getSupplements, setDoseTaken } from '@/db/supplements';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { describeVolley, GYM_REF, MATCH_REF, volleyInTheWay, type ActivityType } from '@/lib/calendar';
import { formatLongDate, isDateKey } from '@/lib/dates';
import { clockOfMinutes, SNAP_MINUTES } from '@/lib/day-grid';
import { isoAt } from '@/lib/plan';
import { formatDose } from '@/lib/supplements';
import { calendarDrag, useDraft } from '@/services/calendar-drag';
import { haptics } from '@/services/haptics';
import { logWeight } from '@/services/log-weight';

/**
 * What the "Nuovo" just placed in the day is: an activity from that time on, or something done at
 * that time, e.g. the creatine taken then. The block stays in sight above the sheet, and follows.
 */
export default function CalendarNewSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = isDateKey(params.date) ? params.date : today;
  const draft = useDraft();
  const plan = useDayPlan(date, today);
  const { data: supplements } = useLiveQuery('supplements-all', (database) => getSupplements(database), ['calendar']);
  const minute = draft?.minute ?? 9 * 60;
  const time = clockOfMinutes(minute);

  useEffect(() => () => calendarDrag.set({ draft: null }), []);

  const shift = (by: number) => {
    if (!draft) return;
    haptics.selection();
    calendarDrag.set({ draft: { ...draft, minute: Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, draft.minute + by)) } });
  };

  const kinds = plan.calendar?.kinds;
  const blockedBy = (type: ActivityType) => {
    if (!kinds || type.ref !== GYM_REF) return null;
    const volley = volleyInTheWay(plan.items, kinds, minute, type.minutes ?? 60);
    return volley ? describeVolley(date, volley) : null;
  };

  const addType = async (type: ActivityType) => {
    await addActivity(db, { typeId: type.id, date, time, minutes: type.minutes, dayId: null, note: null });
    haptics.success();
    toast.show(`${type.name} alle ${time}`);
    router.back();
  };

  // What is due and not done yet, then what is taken when needed.
  const pending = plan.entries.filter((e) => !e.done && !e.skipped);
  const pendingIds = new Set(pending.flatMap((e) => (e.kind === 'supplement' ? [e.supplement.id] : [])));
  const whenNeeded = (supplements ?? []).filter((s) => s.schedule === 'asNeeded' && !pendingIds.has(s.id));
  const takenOf = (id: number) => plan.entries.filter((e) => e.kind === 'supplement' && e.supplement.id === id).length;

  const take = async (id: number, index: number, name: string) => {
    await setDoseTaken(db, id, date, index, true, isoAt(date, time));
    haptics.success();
    toast.show(`${name} alle ${time}`);
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="title2">Nuovo</AppText>
          <AppText variant="subhead" tone="textSecondary">
            {formatLongDate(date)}
          </AppText>
        </View>
        <StepButton symbol="minus" label="Un quarto d’ora prima" onPress={() => shift(-SNAP_MINUTES)} />
        <AppText variant="headline" numeric style={styles.time}>
          {time}
        </AppText>
        <StepButton symbol="plus" label="Un quarto d’ora dopo" onPress={() => shift(SNAP_MINUTES)} />
      </View>

      <SectionTitle>Attività</SectionTitle>
      <ListGroup>
        {(plan.calendar?.types ?? [])
          .filter((t) => !t.archived && t.ref !== MATCH_REF)
          .map((t) => {
            const why = blockedBy(t);
            return (
              <Row
                key={t.id}
                icon={<ActivityBadge symbol={t.symbol} color={t.color} size={28} />}
                title={t.name}
                subtitle={why ?? undefined}
                chevron={false}
                onPress={why ? undefined : () => void addType(t)}
              />
            );
          })}
        <Row title="Nuovo tipo di attività" onPress={() => router.push('/activity-type')} />
      </ListGroup>

      {pending.length > 0 || whenNeeded.length > 0 ? (
        <>
          <SectionTitle>Fatto a quest’ora</SectionTitle>
          <ListGroup>
            {pending.map((e) =>
              e.kind === 'supplement' ? (
                <Row key={e.key} title={e.supplement.name} subtitle={formatDose(e.supplement.dose, e.supplement.unit)} detail={`alle ${e.planned}`} chevron={false} onPress={() => void take(e.supplement.id, e.index, e.supplement.name)} />
              ) : (
                <Row
                  key={e.key}
                  title="Pesata"
                  chevron={false}
                  detail={`alle ${e.at}`}
                  onPress={() => {
                    router.back();
                    logWeight(db, date, null, today, isoAt(date, time));
                  }}
                />
              ),
            )}
            {whenNeeded.map((s) => (
              <Row key={s.id} title={s.name} subtitle={formatDose(s.dose, s.unit)} detail="Al bisogno" chevron={false} onPress={() => void take(s.id, takenOf(s.id), s.name)} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  time: { minWidth: 56, textAlign: 'center' },
});
