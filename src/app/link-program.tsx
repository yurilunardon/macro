import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { Spacing } from '@/constants/theme';
import { getCalendar } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { setWeekday } from '@/db/plan';
import { getPrograms } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { planCovers, WEEKDAYS_FROM_MONDAY, type ActivityPlan } from '@/lib/calendar';
import { addDays, weekdayOf } from '@/lib/dates';
import { haptics } from '@/services/haptics';

const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

/**
 * Asked as soon as the gym's days are saved, and whenever the program changes: which day of the
 * program goes on each of them. "No" leaves them to take the next one in turn.
 */
export default function LinkProgramSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const { data } = useLiveQuery(
    `link-program:${today}`,
    async (database) => {
      const [calendar, programs] = await Promise.all([getCalendar(database, today, addDays(today, 6)), getPrograms(database)]);
      return { calendar, program: programs.find((p) => p.active) ?? null };
    },
    ['calendar', 'training'],
  );
  const [picks, setPicks] = useState<Map<number, number | null>>(new Map());
  const [seeded, setSeeded] = useState(false);

  // The gym's days from today, and what each is tied to; those not tied get the program's in order.
  const gymDays: { weekday: number; plan: ActivityPlan }[] = [];
  for (const weekday of WEEKDAYS_FROM_MONDAY) {
    const date = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
    const plan = data?.calendar.plans.find((p) => p.typeId === data.calendar.gymTypeId && planCovers(p, date));
    if (plan) gymDays.push({ weekday, plan });
  }
  const program = data?.program ?? null;
  useEffect(() => {
    if (seeded || !data || !program) return;
    const next = new Map<number, number | null>();
    const ids = new Set(program.days.map((d) => d.id));
    gymDays.forEach(({ weekday, plan }, i) => {
      next.set(weekday, plan.dayId !== null && ids.has(plan.dayId) ? plan.dayId : (program.days[i % program.days.length]?.id ?? null));
    });
    // Filled once, as the data arrives; from then on the choices are the user's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicks(next);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, program, seeded]);

  const save = async (link: boolean) => {
    for (const { weekday, plan } of gymDays) {
      const dayId = link ? (picks.get(weekday) ?? null) : null;
      if (dayId === plan.dayId) continue;
      await setWeekday(db, weekday, { typeId: plan.typeId, time: plan.time, minutes: plan.minutes, dayId, note: plan.note }, today, plan.typeId);
    }
    haptics.success();
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <AppText variant="title2">Colleghi la scheda?</AppText>
      <AppText tone="textSecondary" style={styles.line}>
        {program ? `Scegli cosa fai in ogni giorno di ${program.name}.` : 'Non hai una scheda in uso.'}
      </AppText>
      <ListGroup>
        {gymDays.map(({ weekday }) => {
          const dayId = picks.get(weekday) ?? null;
          const name = program?.days.find((d) => d.id === dayId)?.name ?? 'Il prossimo';
          return (
            <Row
              key={weekday}
              title={DAY_NAMES[weekday]}
              chevron={false}
              detail={
                <MenuButton
                  icon="list.bullet"
                  accessibilityLabel={`Giorno della scheda di ${DAY_NAMES[weekday]}`}
                  groups={[
                    { actions: (program?.days ?? []).map((d) => ({ label: d.name, checked: d.id === dayId, onPress: () => setPicks(new Map(picks).set(weekday, d.id)) })) },
                    { actions: [{ label: 'Il prossimo della scheda', checked: dayId === null, onPress: () => setPicks(new Map(picks).set(weekday, null)) }] },
                  ]}>
                  <View style={styles.pick}>
                    <AppText tone="accent" numberOfLines={1}>
                      {name}
                    </AppText>
                    <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
                  </View>
                </MenuButton>
              }
            />
          );
        })}
      </ListGroup>
      <View style={styles.actions}>
        <Button title="Collega" disabled={!program} onPress={() => void save(true)} />
        <Button title="No, ogni volta il prossimo" variant="tinted" onPress={() => void save(false)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  line: { marginTop: 2, marginBottom: Spacing.md },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, maxWidth: 200 },
  actions: { gap: Spacing.sm, marginTop: Spacing.lg },
});
