import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { StepButton } from '@/components/stepper';
import { TimePicker } from '@/components/time-picker';
import { WeekdayPicker } from '@/components/weekday-picker';
import { Spacing } from '@/constants/theme';
import { getCalendar } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getWorkHours, setWeekday } from '@/db/plan';
import { getPrograms } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { duringWork, formatMinutes, GYM_REF, parseTimeKey, planCovers, PRACTICE_REF, timeKey, weekdayShort, WEEKDAYS_FROM_MONDAY, type ActivityPlan } from '@/lib/calendar';
import { addDays, weekdayOf, type DateKey } from '@/lib/dates';
import { minutesOfClock } from '@/lib/week-layout';
import { haptics } from '@/services/haptics';

const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
/** The evening: what the user's work leaves free. */
const USUAL_TIME = '21:00';

type Day = { time: string; dayId: number | null };

/**
 * An activity's week: on which days and at what time. The gym then asks about the days of the
 * program, in a sheet of its own.
 */
export default function ActivityWeekScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ type?: string }>();
  const typeId = Number(params.type);
  const { data } = useLiveQuery(
    `activity-week:${typeId}:${today}`,
    async (database) => {
      const [calendar, programs, work] = await Promise.all([getCalendar(database, today, addDays(today, 6)), getPrograms(database), getWorkHours(database)]);
      return { calendar, program: programs.find((p) => p.active) ?? null, work };
    },
    ['calendar', 'training', 'settings'],
  );
  const type = data?.calendar.types.find((t) => t.id === typeId);
  const nextDate = (weekday: number): DateKey => addDays(today, (weekday - weekdayOf(today) + 7) % 7);

  const [days, setDays] = useState<Map<number, Day> | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (days !== null || !data) return;
    const next = new Map<number, Day>();
    let length: number | null = null;
    for (const weekday of WEEKDAYS_FROM_MONDAY) {
      const plan: ActivityPlan | undefined = data.calendar.plans.find((p) => p.typeId === typeId && planCovers(p, nextDate(weekday)));
      if (!plan) continue;
      next.set(weekday, { time: plan.time ?? USUAL_TIME, dayId: plan.dayId });
      length ??= plan.minutes;
    }
    // Filled once, as the data arrives; from then on the form keeps its own state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDays(next);
    setMinutes(length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, days, typeId]);

  if (!data || !type || days === null) return <ScreenScroll>{null}</ScreenScroll>;

  const shownMinutes = minutes ?? type.minutes ?? 60;
  const selected = WEEKDAYS_FROM_MONDAY.filter((d) => days.has(d));
  const isGym = type.ref === GYM_REF;

  const pick = (next: number[]) => {
    const updated = new Map<number, Day>();
    // The time of the last day picked is the likeliest for the next.
    const usual = selected.length > 0 ? (days.get(selected[selected.length - 1])?.time ?? USUAL_TIME) : USUAL_TIME;
    for (const weekday of next) updated.set(weekday, days.get(weekday) ?? { time: usual, dayId: null });
    setDays(updated);
  };
  const setTime = (weekday: number, time: string) => {
    const day = days.get(weekday);
    if (day) setDays(new Map(days).set(weekday, { ...day, time }));
  };

  const practice = data.calendar.types.find((t) => t.ref === PRACTICE_REF);
  const practiceDays = isGym && practice ? WEEKDAYS_FROM_MONDAY.filter((d) => data.calendar.plans.some((p) => p.typeId === practice.id && planCovers(p, nextDate(d)))) : [];
  const onPractice = selected.filter((d) => practiceDays.includes(d));
  const atWork = selected.filter((d) => duringWork(data.work, nextDate(d), minutesOfClock(days.get(d)?.time ?? USUAL_TIME), shownMinutes));

  const save = async () => {
    for (const weekday of WEEKDAYS_FROM_MONDAY) {
      const day = days.get(weekday);
      const plan = data.calendar.plans.find((p) => p.typeId === typeId && planCovers(p, nextDate(weekday)));
      if (!day) {
        if (plan) await setWeekday(db, weekday, null, today, typeId);
        continue;
      }
      if (plan && plan.time === day.time && plan.minutes === minutes) continue;
      await setWeekday(db, weekday, { typeId, time: day.time, minutes, dayId: day.dayId, note: plan?.note ?? null }, today, typeId);
    }
    haptics.success();
    router.back();
    // As soon as the gym's days are there, it asks about the program.
    if (isGym && selected.length > 0 && data.program && selected.some((d) => days.get(d)?.dayId === null)) router.push('/link-program');
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: type.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel="Salva" onPress={() => void save()} />
      </Stack.Toolbar>

      <SectionTitle>In quali giorni</SectionTitle>
      <ListGroup>
        <WeekdayPicker value={selected} onChange={pick} />
      </ListGroup>
      {onPractice.length > 0 ? (
        <SectionFooter>{`${onPractice.map((d) => weekdayShort(d)).join(', ')}: hai anche pallavolo.`}</SectionFooter>
      ) : practiceDays.length > 0 ? (
        <SectionFooter>{`${practiceDays.map((d) => weekdayShort(d)).join(', ')}: hai pallavolo.`}</SectionFooter>
      ) : null}

      {selected.length > 0 ? (
        <>
          <SectionTitle>A che ora</SectionTitle>
          <ListGroup>
            {selected.map((d) => (
              <Row
                key={d}
                title={DAY_NAMES[d]}
                chevron={false}
                detail={<TimePicker {...parseTimeKey(days.get(d)?.time ?? USUAL_TIME)} accessibilityLabel={`Ora di ${DAY_NAMES[d]}`} onChange={(t) => setTime(d, timeKey(t.hour, t.minute))} />}
              />
            ))}
          </ListGroup>
          {atWork.length > 0 ? <SectionFooter>{`${atWork.map((d) => weekdayShort(d)).join(', ')}: a quell’ora sei al lavoro.`}</SectionFooter> : null}
        </>
      ) : null}

      <ListGroup style={styles.group}>
        <View style={[styles.row, { backgroundColor: theme.card }]}>
          <AppText style={styles.flex}>Durata</AppText>
          <StepButton symbol="minus" label="15 minuti in meno" disabled={shownMinutes <= 15} onPress={() => setMinutes(Math.max(15, shownMinutes - 15))} />
          <AppText numeric style={styles.value}>
            {formatMinutes(shownMinutes)}
          </AppText>
          <StepButton symbol="plus" label="15 minuti in più" disabled={shownMinutes >= 600} onPress={() => setMinutes(Math.min(600, shownMinutes + 15))} />
        </View>
      </ListGroup>

      {isGym && data.program && selected.length > 0 ? (
        <>
          <SectionTitle>Scheda</SectionTitle>
          <ListGroup>
            <Row title="Giorni della scheda" detail={data.program.name} onPress={() => router.push('/link-program')} />
          </ListGroup>
        </>
      ) : null}

      <ListGroup style={styles.group}>
        <Row title="Nome, icona e colore" onPress={() => router.push({ pathname: '/activity-type', params: { id: type.id } })} />
      </ListGroup>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { marginTop: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingHorizontal: Spacing.lg },
  value: { minWidth: 92, textAlign: 'center' },
});
