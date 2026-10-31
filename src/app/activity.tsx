import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { DatePicker } from '@/components/date-picker';
import { FieldRow, Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { choose } from '@/components/prompt';
import { StepButton } from '@/components/stepper';
import { TimePicker } from '@/components/time-picker';
import { WeekdayPicker } from '@/components/weekday-picker';
import { Radius, Spacing } from '@/constants/theme';
import {
  addActivity,
  addPlan,
  deleteActivity,
  endPlan,
  getActivity,
  getActivityTypes,
  getPlan,
  getPlanDay,
  setActivityStatus,
  setPlanDay,
  updateActivity,
  updatePlan,
} from '@/db/calendar';
import { getTrainingSettings } from '@/db/days';
import { useLiveQuery } from '@/db/live';
import { getPrograms } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatMinutes, formatWeekdays, GYM_REF, parseTimeKey, timeKey, type ActivityType, type StoredStatus } from '@/lib/calendar';
import { formatLongDate, isDateKey, weekdayOf, type DateKey } from '@/lib/dates';
import { haptics } from '@/services/haptics';
import { deleteWithUndo } from '@/services/undo';

/** What the form starts from: a new activity, a single one, or one day of a repeated one. */
type Draft = {
  mode: 'new' | 'single' | 'plan';
  recordId: number | null;
  planId: number | null;
  /** The day opened: for a plan, the one being changed. */
  date: DateKey;
  typeId: number | null;
  time: string | null;
  minutes: number | null;
  dayId: number | null;
  note: string | null;
  status: StoredStatus;
  weekdays: number[];
};

async function loadDraft(
  db: ReturnType<typeof useSQLiteContext>,
  params: { id?: string; plan?: string; date?: string; type?: string; repeat?: string },
  today: DateKey,
): Promise<Draft | null> {
  const date = isDateKey(params.date) ? params.date : today;
  if (params.id) {
    const record = await getActivity(db, Number(params.id));
    if (!record) return null;
    return {
      mode: 'single',
      recordId: record.id,
      planId: null,
      date: record.date,
      typeId: record.typeId,
      time: record.time,
      minutes: record.minutes,
      dayId: record.dayId,
      note: record.note,
      status: record.status,
      weekdays: [weekdayOf(record.date)],
    };
  }
  if (params.plan) {
    const plan = await getPlan(db, Number(params.plan));
    if (!plan) return null;
    const day = await getPlanDay(db, plan.id, date);
    return {
      mode: 'plan',
      recordId: day?.id ?? null,
      planId: plan.id,
      date,
      typeId: plan.typeId,
      time: day ? day.time : plan.time,
      minutes: day ? day.minutes : plan.minutes,
      dayId: day ? day.dayId : plan.dayId,
      note: day ? day.note : plan.note,
      status: day?.status ?? 'planned',
      weekdays: plan.weekdays,
    };
  }
  return {
    mode: 'new',
    recordId: null,
    planId: null,
    date,
    typeId: params.type ? Number(params.type) : null,
    time: null,
    minutes: null,
    dayId: null,
    note: null,
    status: 'planned',
    // Weekly from the start: the training days already chosen for the calorie targets.
    weekdays: params.repeat === '1' ? (await getTrainingSettings(db)).trainingWeekdays : [weekdayOf(date)],
  };
}

/** A new activity, or one to change: kind, day, repetition, time, length, day of the program, note. */
export default function ActivityScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ id?: string; plan?: string; date?: string; type?: string; repeat?: string }>();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const { data: types } = useLiveQuery('activity-types', getActivityTypes, ['calendar']);

  useEffect(() => {
    let cancelled = false;
    void loadDraft(db, params, today).then((d) => {
      if (!cancelled) setDraft(d);
    });
    return () => {
      cancelled = true;
    };
    // Loaded once: the form then keeps its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  if (draft === undefined || !types) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (draft === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <AppText tone="textSecondary">Attività non trovata.</AppText>
      </View>
    );
  }
  // "repeat=1": a new activity that starts as a weekly one, e.g. the gym days.
  return <ActivityForm draft={draft} types={types} today={today} weekly={draft.mode === 'plan' || (draft.mode === 'new' && params.repeat === '1')} />;
}

function ActivityForm({ draft, types, today, weekly }: { draft: Draft; types: ActivityType[]; today: DateKey; weekly: boolean }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { data: programs } = useLiveQuery('programs', (database) => getPrograms(database), ['training']);
  const choices = types.filter((t) => !t.archived || t.id === draft.typeId);

  const [typeId, setTypeId] = useState(draft.typeId ?? choices[0]?.id ?? 0);
  const type = types.find((t) => t.id === typeId);
  const isGym = type?.ref === GYM_REF;
  const [date, setDate] = useState(draft.date);
  const [repeat, setRepeat] = useState(weekly);
  const [weekdays, setWeekdays] = useState(draft.weekdays);
  const [time, setTime] = useState(draft.time);
  const [minutes, setMinutes] = useState(draft.minutes);
  const [dayId, setDayId] = useState(draft.dayId);
  const [note, setNote] = useState(draft.note ?? '');
  const [status, setStatus] = useState(draft.status);
  const shownMinutes = minutes ?? type?.minutes ?? 60;
  const valid = type !== undefined && (!repeat || weekdays.length > 0);

  const active = programs?.find((p) => p.active) ?? null;
  const dayName = dayId === null ? null : (programs?.flatMap((p) => p.days).find((d) => d.id === dayId)?.name ?? null);

  const input = () => ({
    typeId,
    date,
    time,
    minutes,
    dayId: isGym ? dayId : null,
    note: note.trim() === '' ? null : note,
  });

  const save = async () => {
    if (!valid) return;
    const fields = input();
    if (draft.mode === 'new' || (draft.mode === 'single' && repeat)) {
      if (draft.recordId !== null) await deleteActivity(db, draft.recordId);
      if (repeat) await addPlan(db, { ...fields, weekdays, startDate: date });
      else await addActivity(db, fields);
    } else if (draft.mode === 'single' && draft.recordId !== null) {
      await updateActivity(db, draft.recordId, fields);
      if (status !== draft.status) await setActivityStatus(db, draft.recordId, status);
    } else if (draft.mode === 'plan' && draft.planId !== null) {
      const changed =
        typeId !== draft.typeId ||
        date !== draft.date ||
        time !== draft.time ||
        minutes !== draft.minutes ||
        fields.dayId !== draft.dayId ||
        fields.note !== draft.note ||
        weekdays.slice().sort().join() !== draft.weekdays.slice().sort().join();
      if (!changed) {
        if (status !== draft.status) await setPlanDay(db, draft.planId, draft.date, { status });
      } else {
        // As in Calendar: a repeated event asks how far the change goes.
        const scope = await choose({
          title: 'Attività ripetuta',
          message: formatWeekdays(draft.weekdays),
          actions: [{ label: 'Solo questa' }, { label: 'Questa e le successive' }],
        });
        if (scope === null) return;
        if (scope === 0) {
          if (typeId !== draft.typeId || date !== draft.date) {
            // Another kind or another day: this one leaves the plan and stands on its own.
            await setPlanDay(db, draft.planId, draft.date, { status: 'cancelled' });
            const id = await addActivity(db, fields);
            if (status !== 'planned') await setActivityStatus(db, id, status);
          } else {
            await setPlanDay(db, draft.planId, draft.date, { time, minutes, dayId: fields.dayId, note: fields.note, status });
          }
        } else {
          await updatePlan(db, draft.planId, { ...fields, weekdays, startDate: date }, draft.date);
        }
      }
    }
    haptics.success();
    router.back();
  };

  const remove = async () => {
    if (draft.mode === 'single' && draft.recordId !== null) {
      const id = draft.recordId;
      router.back();
      deleteWithUndo({ key: `activity:${id}`, title: 'Attività eliminata', run: () => deleteActivity(db, id) });
      return;
    }
    if (draft.mode !== 'plan' || draft.planId === null) return;
    const planId = draft.planId;
    const scope = await choose({
      title: 'Eliminare l’attività ripetuta?',
      message: formatWeekdays(draft.weekdays),
      actions: [{ label: 'Elimina solo questa', destructive: true }, { label: 'Elimina questa e le successive' }],
    });
    if (scope === null) return;
    router.back();
    if (scope === 0) {
      deleteWithUndo({
        key: `plan-day:${planId}:${draft.date}`,
        title: 'Attività eliminata',
        run: () => setPlanDay(db, planId, draft.date, { status: 'cancelled' }),
      });
    } else {
      deleteWithUndo({
        key: `plan-from:${planId}:${draft.date}`,
        title: 'Attività ripetuta interrotta',
        run: () => endPlan(db, planId, draft.date),
      });
    }
  };

  const pickType = (next: ActivityType) => {
    haptics.selection();
    setTypeId(next.id);
    // A new activity takes the usual length of its kind until it is changed by hand.
    if (draft.mode === 'new') setMinutes(null);
  };

  const past = draft.mode !== 'new' && draft.date <= today;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <Stack.Screen options={{ title: draft.mode === 'new' ? 'Nuova attività' : (type?.name ?? 'Attività') }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Annulla" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel="Salva" disabled={!valid} onPress={() => void save()} />
      </Stack.Toolbar>

      {/* The kinds side by side, as the colours of a calendar in Calendar's new event. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.types} style={styles.typesScroll}>
        {choices.map((t) => {
          const on = t.id === typeId;
          return (
            <Pressable
              key={t.id}
              onPress={() => pickType(t)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.type,
                { backgroundColor: theme.card, borderColor: on ? theme.accent : 'transparent' },
                pressed && styles.pressed,
              ]}>
              <ActivityBadge symbol={t.symbol} color={t.color} size={26} />
              <AppText weight={on ? '600' : '400'}>{t.name}</AppText>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => router.push('/activity-type')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.type, { backgroundColor: theme.card, borderColor: 'transparent' }, pressed && styles.pressed]}>
          <Icon name="plus" size={18} tone="accent" weight="semibold" />
          <AppText tone="accent">Altro</AppText>
        </Pressable>
      </ScrollView>

      <ListGroup>
        <Row title="Giorno" chevron={false} detail={<DatePicker value={date} onChange={setDate} accessibilityLabel="Giorno" />} />
        {draft.mode !== 'plan' ? (
          <Row
            title="Ogni settimana"
            chevron={false}
            detail={
              <Switch
                value={repeat}
                onValueChange={(on) => {
                  setRepeat(on);
                  if (on && weekdays.length === 0) setWeekdays([weekdayOf(date)]);
                }}
                trackColor={{ true: theme.accent }}
                accessibilityLabel="Ripeti ogni settimana"
              />
            }
          />
        ) : null}
        {repeat ? <WeekdayPicker value={weekdays} onChange={setWeekdays} /> : null}
      </ListGroup>
      {repeat ? (
        <SectionFooter>
          {weekdays.length === 0
            ? 'Scegli almeno un giorno.'
            : draft.mode === 'plan'
              ? `${formatWeekdays(weekdays)}.`
              : `${formatWeekdays(weekdays)}, dal ${formatLongDate(date).toLowerCase()}.`}
        </SectionFooter>
      ) : null}

      <ListGroup style={styles.group}>
        <Row
          title="Orario"
          chevron={false}
          detail={
            <View style={styles.detail}>
              {time !== null ? (
                <TimePicker {...parseTimeKey(time)} accessibilityLabel="Orario" onChange={(t) => setTime(timeKey(t.hour, t.minute))} />
              ) : null}
              <Switch
                value={time !== null}
                onValueChange={(on) => setTime(on ? (draft.time ?? '18:00') : null)}
                trackColor={{ true: theme.accent }}
                accessibilityLabel="Con un orario"
              />
            </View>
          }
        />
        <View style={styles.row}>
          <AppText style={styles.flex}>Durata</AppText>
          <StepButton symbol="minus" label="15 minuti in meno" disabled={shownMinutes <= 15} onPress={() => setMinutes(Math.max(15, shownMinutes - 15))} />
          <AppText numeric style={styles.value}>
            {formatMinutes(shownMinutes)}
          </AppText>
          <StepButton symbol="plus" label="15 minuti in più" disabled={shownMinutes >= 600} onPress={() => setMinutes(Math.min(600, shownMinutes + 15))} />
        </View>
      </ListGroup>

      {isGym ? (
        <>
          <SectionTitle>Scheda</SectionTitle>
          <ListGroup>
            <Row
              title="Giorno della scheda"
              chevron={false}
              detail={
                <MenuButton
                  icon="list.bullet"
                  accessibilityLabel="Giorno della scheda"
                  groups={[
                    {
                      actions: [
                        { label: 'Il prossimo della scheda', icon: 'arrow.triangle.2.circlepath', checked: dayId === null, onPress: () => setDayId(null) },
                      ],
                    },
                    ...(active ? [active] : []).map((p) => ({
                      title: p.name,
                      actions: p.days.map((d) => ({ label: d.name, icon: d.icon, checked: d.id === dayId, onPress: () => setDayId(d.id) })),
                    })),
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
          </ListGroup>
          <SectionFooter>
            {dayId === null
              ? 'Segue la rotazione della scheda: Push, poi Pull, poi Legs… Fatto l’allenamento, la palestra di quel giorno risulta fatta.'
              : 'Sempre questo giorno della scheda.'}
          </SectionFooter>
        </>
      ) : null}

      <SectionTitle>Nota</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Nota"
          value={note}
          onChangeText={setNote}
          placeholder={type?.ref === 'match' ? 'Es. contro Treviso, in casa' : 'Es. palestra comunale'}
          autoCapitalize="sentences"
        />
      </ListGroup>

      {past ? (
        <>
          <SectionTitle>Com’è andata</SectionTitle>
          <Segmented<'planned' | 'done' | 'skipped'>
            options={[
              ...(draft.date === today ? [{ key: 'planned' as const, label: 'Da fare' }] : []),
              { key: 'done', label: 'Fatta' },
              { key: 'skipped', label: 'Saltata' },
            ]}
            value={
              status === 'skipped' || status === 'cancelled'
                ? 'skipped'
                : status === 'done' || (draft.date < today && !isGym)
                  ? 'done'
                  : draft.date === today
                    ? 'planned'
                    : 'skipped'
            }
            onChange={setStatus}
          />
          <SectionFooter>
            {isGym
              ? 'La palestra risulta fatta quando registri l’allenamento nell’app.'
              : 'Le attività passate contano come fatte, finché non le segni come saltate.'}
          </SectionFooter>
        </>
      ) : null}

      {draft.mode !== 'new' ? (
        <View style={styles.actions}>
          <Button title="Elimina attività" variant="destructive" onPress={() => void remove()} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  typesScroll: { marginHorizontal: -Spacing.lg, marginBottom: Spacing.lg },
  types: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
  group: { marginTop: Spacing.xl },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingHorizontal: Spacing.lg },
  value: { minWidth: 92, textAlign: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, maxWidth: 200 },
  actions: { paddingTop: Spacing.xl },
});
