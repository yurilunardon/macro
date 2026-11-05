import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { activityName } from '@/components/plan-day';
import { TimePicker } from '@/components/time-picker';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { moveOccurrence } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getWorkHours } from '@/db/plan';
import { useAgenda } from '@/hooks/use-agenda';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { DEFAULT_WORK_HOURS, formatDayName, moveChoices, parseTimeKey, timeKey } from '@/lib/calendar';
import { addDays, isDateKey } from '@/lib/dates';
import { haptics } from '@/services/haptics';

/**
 * To which day an activity goes, this time only: free days first, the first of them already picked.
 * Days with a match cannot be picked for the gym, and neither can a practice at the same time.
 */
export default function MoveWorkoutSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ date?: string; key?: string }>();
  const from = isDateKey(params.date) ? params.date : today;
  const { data: calendar, agenda, types } = useAgenda(addDays(from, -8), addDays(from, 8), today);
  const { data: workHours } = useLiveQuery('work-hours', getWorkHours, ['settings']);
  const item = (agenda.get(from) ?? []).find((i) => i.key === params.key);
  const [time, setTime] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  if (!calendar || !item || item.kind !== 'activity') return <View style={[styles.fill, { backgroundColor: theme.background }]} />;

  const o = item.occurrence;
  const name = activityName(item, types, calendar.gymTypeId, calendar.dayNames);
  const minutes = o.minutes ?? types.get(o.typeId)?.minutes ?? 60;
  const at = time ?? o.time ?? '21:00';
  const isGym = o.typeId === calendar.kinds.gym;
  const choices = moveChoices({
    agenda,
    // Only the gym has to give way to volleyball.
    kinds: isGym ? calendar.kinds : { gym: calendar.kinds.gym, match: null, practice: null },
    types,
    dayNames: calendar.dayNames,
    workHours: workHours ?? DEFAULT_WORK_HOURS,
    from,
    today,
    time: at,
    minutes,
    ignore: item.key,
  });
  const chosen = choices.find((c) => c.date === picked && !c.blocked) ?? choices.find((c) => !c.blocked);

  const move = async () => {
    if (!chosen) return;
    const undo = await moveOccurrence(db, o, { date: chosen.date, time: at, minutes: o.minutes }, item.dayId);
    haptics.success();
    router.back();
    toast.show(`${name} spostato a ${formatDayName(chosen.date).toLowerCase()}`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void undo() });
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <AppText variant="title2" numberOfLines={1} style={styles.flex}>{`Sposta ${name}`}</AppText>
        <Button title="Sposta" compact disabled={!chosen} onPress={() => void move()} />
      </View>

      <SectionTitle>A che ora</SectionTitle>
      <ListGroup>
        <Row title="Ora" chevron={false} detail={<TimePicker {...parseTimeKey(at)} accessibilityLabel="Ora" onChange={(t) => setTime(timeKey(t.hour, t.minute))} />} />
      </ListGroup>
      {chosen?.atWork ? <SectionFooter>A quell’ora sei al lavoro.</SectionFooter> : null}

      <SectionTitle>In quale giorno</SectionTitle>
      <ListGroup>
        {choices.map((c) => (
          <Row
            key={c.date}
            title={formatDayName(c.date)}
            subtitle={c.label}
            chevron={false}
            onPress={
              c.blocked
                ? undefined
                : () => {
                    haptics.selection();
                    setPicked(c.date);
                  }
            }
            detail={c.date === chosen?.date ? <Icon name="checkmark" size={16} tone="accent" weight="semibold" /> : c.blocked ? <AppText tone="textTertiary">Non si può</AppText> : undefined}
          />
        ))}
      </ListGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
