import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { StepButton } from '@/components/stepper';
import { TimePicker } from '@/components/time-picker';
import { Spacing } from '@/constants/theme';
import { getCalendar } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { setWeekday } from '@/db/plan';
import { useToday } from '@/hooks/use-today';
import { formatMinutes, GYM_REF, parseTimeKey, planCovers, timeKey, type ActivityType } from '@/lib/calendar';
import { addDays, weekdayOf } from '@/lib/dates';
import { haptics } from '@/services/haptics';

const WEEKDAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

/**
 * One day of the week in the plan: rest, or which activity, at what time and for how long. It
 * holds from today on; what was done before stays as it was.
 */
export default function PlanDayScreen() {
  const today = useToday();
  const weekday = Number(useLocalSearchParams<{ weekday: string }>().weekday);
  const date = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
  const { data } = useLiveQuery(`plan-day:${date}`, (database) => getCalendar(database, date, date), ['calendar']);
  if (!data) return <ScreenScroll>{null}</ScreenScroll>;
  // Starts from what the day holds now.
  const plan = data.plans.filter((p) => planCovers(p, date)).sort((a, b) => ((a.time ?? '') < (b.time ?? '') ? -1 : 1))[0];
  return (
    <PlanDayForm
      weekday={weekday}
      types={data.types.filter((t) => !t.archived)}
      initial={{
        typeId: plan?.typeId ?? null,
        name: plan?.note ?? '',
        time: plan?.time ?? '21:00',
        minutes: plan?.minutes ?? data.types.find((t) => t.id === plan?.typeId)?.minutes ?? 90,
      }}
    />
  );
}

function PlanDayForm({
  weekday,
  types,
  initial,
}: {
  weekday: number;
  types: ActivityType[];
  initial: { typeId: number | null; name: string; time: string; minutes: number };
}) {
  const db = useSQLiteContext();
  const router = useRouter();
  const today = useToday();
  const [typeId, setTypeId] = useState<number | null>(initial.typeId);
  const [name, setName] = useState(initial.name);
  const [time, setTime] = useState(initial.time);
  const [minutes, setMinutes] = useState(initial.minutes);

  const chosen = types.find((t) => t.id === typeId);
  const isGym = chosen?.ref === GYM_REF;

  const pick = (id: number | null) => {
    haptics.selection();
    setTypeId(id);
    const type = types.find((t) => t.id === id);
    if (type?.minutes) setMinutes(type.minutes);
  };

  const save = async () => {
    await setWeekday(
      db,
      weekday,
      typeId ? { typeId, time, minutes, dayId: null, note: name.trim() === '' ? null : name.trim() } : null,
      today,
    );
    haptics.success();
    router.back();
  };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: WEEKDAY_NAMES[weekday] ?? '' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel="Salva" onPress={() => void save()} />
      </Stack.Toolbar>

      <ListGroup>
        <Row
          title="Riposo"
          icon={<ActivityBadge symbol="moon.zzz.fill" color="indigo" size={28} />}
          chevron={false}
          detail={typeId === null ? <Icon name="checkmark" size={16} tone="accent" weight="semibold" /> : null}
          onPress={() => pick(null)}
        />
        {types.map((t) => (
          <Row
            key={t.id}
            title={t.name}
            icon={<ActivityBadge symbol={t.symbol} color={t.color} size={28} />}
            chevron={false}
            detail={typeId === t.id ? <Icon name="checkmark" size={16} tone="accent" weight="semibold" /> : null}
            onPress={() => pick(t.id)}
          />
        ))}
      </ListGroup>

      {typeId ? (
        <>
          <SectionTitle>Dettagli</SectionTitle>
          <ListGroup>
            <FieldRow
              label="Nome"
              value={name}
              onChangeText={setName}
              placeholder={isGym ? 'Es. Push' : (chosen?.name ?? '')}
              autoCapitalize="sentences"
            />
            <Row title="Ora" chevron={false} detail={<TimePicker {...parseTimeKey(time)} accessibilityLabel="Ora di inizio" onChange={(t) => setTime(timeKey(t.hour, t.minute))} />} />
            <View style={styles.row}>
              <AppText style={styles.flex}>Durata</AppText>
              <StepButton symbol="minus" label="15 minuti in meno" disabled={minutes <= 15} onPress={() => setMinutes(Math.max(15, minutes - 15))} />
              <AppText variant="headline" numeric style={styles.count}>
                {formatMinutes(minutes)}
              </AppText>
              <StepButton symbol="plus" label="15 minuti in più" disabled={minutes >= 300} onPress={() => setMinutes(Math.min(300, minutes + 15))} />
            </View>
          </ListGroup>
          <SectionFooter>
            {isGym ? 'Il nome è quello che vedi nel calendario e che prende l’allenamento quando lo inizi.' : 'Vale da oggi in poi, ogni settimana.'}
          </SectionFooter>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingHorizontal: Spacing.lg },
  count: { minWidth: 96, textAlign: 'center' },
});
