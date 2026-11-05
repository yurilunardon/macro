import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { activityName } from '@/components/plan-day';
import { confirmStart } from '@/components/prompt';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { setOccurrenceDay, setPlanDay, skipOccurrence, deleteActivity } from '@/db/calendar';
import { getFeed } from '@/db/feed';
import { useLiveQuery } from '@/db/live';
import { getPrograms } from '@/db/programs';
import { setDoseSkipped, setDoseTaken } from '@/db/supplements';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatDayName, type AgendaItem, type Occurrence } from '@/lib/calendar';
import { formatLongDate, isDateKey, type DateKey } from '@/lib/dates';
import { formatNumber } from '@/lib/format';
import { isHomeEvent } from '@/lib/ics';
import { addMinutes, clockOf, isoAt, type DayEntry } from '@/lib/plan';
import { formatDose, formatSchedule } from '@/lib/supplements';
import { haptics } from '@/services/haptics';
import { logWeight } from '@/services/log-weight';
import { openAgendaItem } from '@/services/open-agenda-item';
import { startAndOpenWorkout } from '@/services/start-workout';

/** How long the sheet takes to go, before what opens next. */
const SHEET_GONE_MS = 320;

/** What a block of the day is, opened by a tap, with what can be done with it. */
export default function CalendarItemSheet() {
  const params = useLocalSearchParams<{ date?: string; key?: string }>();
  const today = useToday();
  const date = isDateKey(params.date) ? params.date : today;
  const plan = useDayPlan(date, today);
  const item = plan.items.find((i) => i.key === params.key);
  const entry = plan.entries.find((e) => e.key === params.key);
  const theme = useTheme();
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      {item ? <ActivityBody item={item} date={date} today={today} plan={plan} /> : null}
      {entry ? <EntryBody entry={entry} date={date} today={today} /> : null}
    </ScrollView>
  );
}

function Head({ title, line }: { title: string; line: string }) {
  return (
    <View style={styles.head}>
      <AppText variant="title2">{title}</AppText>
      <AppText tone="textSecondary" numeric>
        {line}
      </AppText>
    </View>
  );
}

function ActivityBody({ item, date, today, plan }: { item: AgendaItem; date: DateKey; today: DateKey; plan: ReturnType<typeof useDayPlan> }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const gymTypeId = plan.calendar?.gymTypeId ?? null;
  const dayNames = plan.calendar?.dayNames ?? new Map<number, string>();
  const name = activityName(item, plan.types, gymTypeId, dayNames);
  const { data: programs } = useLiveQuery('programs', (database) => getPrograms(database), ['training']);
  const { data: feed } = useLiveQuery('feed', getFeed, ['settings']);
  if (item.kind === 'workout') return null;
  const o: Occurrence = item.occurrence;
  const type = plan.types.get(o.typeId);
  const minutes = o.minutes ?? type?.minutes ?? 60;
  const line = `${formatLongDate(date)}${o.time ? ` · ${o.time} – ${addMinutes(o.time, minutes)}` : ''}`;

  if (o.sourceUid) {
    const home = isHomeEvent(o.title ?? '', feed?.name ?? null);
    const map = o.mapUrl;
    return (
      <>
        <Head title={name} line={line} />
        <ListGroup>
          <Row title={home ? 'In casa' : 'Trasferta'} detail={o.location?.split(',')[0]} chevron={false} />
          {map ? <Row title="Indicazioni" detail="Mappe" onPress={() => void Linking.openURL(map)} /> : null}
          <Row title="Dal calendario della squadra" chevron={false} onPress={() => router.push('/calendar/feed')} />
        </ListGroup>
      </>
    );
  }

  const isGym = o.typeId === gymTypeId && item.status === 'planned';
  const start = async () => {
    const dayId = item.dayId;
    if (date !== today) {
      const go = await confirmStart({
        title: `È previsto ${formatDayName(date).toLowerCase()}${o.time ? ` alle ${o.time}` : ''}`,
        message: 'Vuoi iniziarlo adesso?',
        action: 'Inizia',
      });
      if (!go) return;
      // It is done now, so that day it no longer is to do.
      if (o.planId !== null) await setPlanDay(db, o.planId, o.date, { status: 'cancelled' });
      else if (o.recordId !== null) await deleteActivity(db, o.recordId);
      router.back();
      setTimeout(() => void startAndOpenWorkout(db, router, dayId, name, { anyTime: true }), SHEET_GONE_MS);
      return;
    }
    router.back();
    setTimeout(() => void startAndOpenWorkout(db, router, dayId, name), SHEET_GONE_MS);
  };
  const skip = async () => {
    haptics.selection();
    const undo = await skipOccurrence(db, o);
    router.back();
    toast.show(`${name} saltato`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void undo() });
  };
  const active = programs?.find((p) => p.active) ?? null;
  const dayName = item.dayId === null ? null : (dayNames.get(item.dayId) ?? null);

  return (
    <>
      <Head title={name} line={line} />
      {isGym ? <Button title="Inizia" onPress={() => void start()} /> : null}
      <ListGroup style={styles.group}>
        {isGym && active ? (
          <Row
            title="Giorno della scheda"
            chevron={false}
            detail={
              <MenuButton
                icon="list.bullet"
                accessibilityLabel="Giorno della scheda"
                groups={[
                  { title: active.name, actions: active.days.map((d) => ({ label: d.name, checked: d.id === item.dayId, onPress: () => void setOccurrenceDay(db, o, d.id) })) },
                  { actions: [{ label: 'Il prossimo della scheda', checked: o.dayId === null, onPress: () => void setOccurrenceDay(db, o, null) }] },
                ]}>
                <View style={styles.pick}>
                  <AppText tone="accent" numberOfLines={1}>
                    {dayName ?? 'Il prossimo'}
                  </AppText>
                  <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
                </View>
              </MenuButton>
            }
          />
        ) : null}
        {item.status === 'planned' ? <Row title="Sposta" onPress={() => router.replace({ pathname: '/move-workout', params: { date, key: item.key } })} /> : null}
        <Row title="Modifica" onPress={() => { router.back(); setTimeout(() => openAgendaItem(router, item), SHEET_GONE_MS); }} />
        {item.status === 'skipped' ? (
          <Row title="Rimetti in programma" chevron={false} onPress={() => { if (o.planId !== null) void setPlanDay(db, o.planId, o.date, { status: 'planned' }); router.back(); }} />
        ) : (
          <Row title="Salta" chevron={false} onPress={() => void skip()} />
        )}
      </ListGroup>
    </>
  );
}

function EntryBody({ entry, date, today }: { entry: DayEntry; date: DateKey; today: DateKey }) {
  const db = useSQLiteContext();
  const router = useRouter();
  if (entry.kind === 'weighIn') {
    return (
      <>
        <Head title="Pesata" line={`${formatLongDate(date)} · ${entry.at}`} />
        <Button
          title={entry.kg !== null ? `${formatNumber(entry.kg, 1)} kg: modifica` : 'Registra il peso'}
          onPress={() => {
            router.back();
            setTimeout(() => logWeight(db, date, entry.kg !== null ? { kg: entry.kg } : null, today), SHEET_GONE_MS);
          }}
        />
        <ListGroup style={styles.group}>
          <Row title="Peso e misure" onPress={() => { router.back(); setTimeout(() => router.push('/calendar/weight' as Href), SHEET_GONE_MS); }} />
        </ListGroup>
      </>
    );
  }
  const s = entry.supplement;
  const toggle = async () => {
    const taking = !entry.done;
    await setDoseTaken(db, s.id, date, entry.index, taking, taking ? (date === today ? new Date().toISOString() : isoAt(date, entry.planned)) : undefined);
    haptics.success();
    router.back();
  };
  const skip = async () => {
    await setDoseSkipped(db, s.id, date, entry.index, !entry.skipped);
    haptics.selection();
    router.back();
  };
  const line = entry.takenAt ? `Preso alle ${clockOf(entry.takenAt)}` : `${formatLongDate(date)} · alle ${entry.planned}`;
  return (
    <>
      <Head title={s.name} line={line} />
      <Button title={entry.done ? 'Togli la spunta' : 'Fatto'} variant={entry.done ? 'tinted' : 'filled'} onPress={() => void toggle()} />
      <ListGroup style={styles.group}>
        <Row title="Dose" detail={formatDose(s.dose, s.unit)} chevron={false} />
        <Row title="Ogni quanto" detail={formatSchedule(s)} chevron={false} />
        {s.note ? <Row title={s.note} chevron={false} /> : null}
        {!entry.done ? <Row title={entry.skipped ? 'Rimetti in programma' : 'Salta'} chevron={false} onPress={() => void skip()} /> : null}
        <Row title="Modifica" onPress={() => { router.back(); setTimeout(() => router.push({ pathname: '/supplement', params: { id: s.id } }), SHEET_GONE_MS); }} />
      </ListGroup>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  head: { gap: 2, marginBottom: Spacing.md },
  group: { marginTop: Spacing.md },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, maxWidth: 200 },
});
