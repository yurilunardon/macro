import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter } from '@/components/card';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenScroll } from '@/components/screen';
import { Radius, Spacing } from '@/constants/theme';
import { getCalendar } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getMoments, getWeighInPlan } from '@/db/plan';
import { getSetting } from '@/db/settings';
import { getSupplements } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatWeekdays, GYM_REF, planCovers, WEEKDAYS_FROM_MONDAY, weekdayShort } from '@/lib/calendar';
import { addDays, formatShortDate, weekdayOf } from '@/lib/dates';
import { formatDose, formatSchedule } from '@/lib/supplements';

/**
 * The plan behind the calendar, at a glance and all of it editable: the week, the supplements,
 * the weigh-in and the times of the day.
 */
export default function PlanScreen() {
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const today = useToday();
  const last = addDays(today, 6);
  const { data } = useLiveQuery(
    `plan:${today}`,
    async (database) => {
      const [calendar, supplements, moments, weighIn, review] = await Promise.all([
        getCalendar(database, today, last),
        getSupplements(database),
        getMoments(database),
        getWeighInPlan(database),
        getSetting(database, 'planReviewOn'),
      ]);
      return { calendar, supplements, moments, weighIn, review };
    },
    ['calendar', 'settings'],
  );

  const types = new Map((data?.calendar.types ?? []).map((t) => [t.id, t]));
  const momentName = (id: string | null) => data?.moments.find((m) => m.id === id)?.name ?? null;

  // What each day of the week holds from today: the plans that cover its next date.
  const week = WEEKDAYS_FROM_MONDAY.map((weekday) => {
    const date = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
    const plans = (data?.calendar.plans ?? []).filter((p) => planCovers(p, date)).sort((a, b) => ((a.time ?? '') < (b.time ?? '') ? -1 : 1));
    const plan = plans[0];
    const type = plan ? types.get(plan.typeId) : undefined;
    const name = plan ? (type?.ref === GYM_REF ? (plan.note ?? type.name) : (type?.name ?? 'Attività')) : 'Riposo';
    return { weekday, name, time: plan?.time ?? null, color: type ? colors[type.color] : null, more: plans.length - 1 };
  });

  const weighIn = data?.weighIn;
  const weighInLabel = !weighIn
    ? ''
    : !weighIn.enabled
      ? 'Spenta'
      : [weighIn.schedule === 'daily' ? 'Ogni giorno' : formatWeekdays(weighIn.weekdays), momentName(weighIn.moment)?.toLowerCase()].filter(Boolean).join(', ');

  return (
    <ScreenScroll>
      <View style={styles.head}>
        <AppText variant="title2">Settimana</AppText>
        <AppText tone="textSecondary">Tocca un giorno</AppText>
      </View>
      <View style={styles.week}>
        {week.map((day) => (
          <PressableScale
            key={day.weekday}
            onPress={() => router.push({ pathname: '/calendar/plan-day', params: { weekday: day.weekday } })}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayShort(day.weekday)}: ${day.name}${day.time ? ` alle ${day.time}` : ''}`}
            style={[styles.tile, { backgroundColor: theme.card }]}>
            <AppText variant="footnote" weight="600" tone="textSecondary">
              {weekdayShort(day.weekday)}
            </AppText>
            <View style={[styles.kind, { backgroundColor: day.color ? `${day.color}29` : theme.fill }]}>
              <AppText variant="caption" weight="700" numberOfLines={1} adjustsFontSizeToFit style={{ color: day.color ?? theme.textSecondary }}>
                {day.name}
              </AppText>
            </View>
            <AppText variant="caption" tone="textSecondary" numeric>
              {day.time ?? ' '}
            </AppText>
          </PressableScale>
        ))}
      </View>

      <View style={styles.head}>
        <AppText variant="title2">Integratori</AppText>
        <PressableScale onPress={() => router.push('/supplement')} accessibilityRole="button" style={[styles.add, { backgroundColor: theme.card }]}>
          <AppText tone="accent" weight="600">
            Aggiungi
          </AppText>
        </PressableScale>
      </View>
      <ListGroup>
        {(data?.supplements ?? []).map((s) => (
          <Row
            key={s.id}
            title={s.name}
            subtitle={[formatDose(s.dose, s.unit), s.schedule === 'daily' ? null : formatSchedule(s).toLowerCase()].filter(Boolean).join(' · ')}
            detail={(s.moment ? momentName(s.moment) : s.reminder) ?? undefined}
            onPress={() => router.push({ pathname: '/supplement', params: { id: s.id } })}
          />
        ))}
        {data && data.supplements.length === 0 ? <Row title="Nessun integratore" chevron={false} /> : null}
      </ListGroup>

      <View style={styles.head}>
        <AppText variant="title2">Altro</AppText>
      </View>
      <ListGroup>
        <Row title="Pesata" detail={weighInLabel} onPress={() => router.push('/calendar/weigh-in')} />
        <Row title="Orari della giornata" detail={data ? `${data.moments.length} momenti` : ''} onPress={() => router.push('/calendar/moments')} />
        <Row title="Tipi di attività" onPress={() => router.push('/calendar/activity-types')} />
        <Row title="Promemoria" onPress={() => router.push('/settings')} />
      </ListGroup>
      {data?.review ? (
        <SectionFooter>{data.review <= today ? 'È ora di rivedere il piano.' : `Il ${formatShortDate(data.review)} ti chiedo di rivederlo.`}</SectionFooter>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xl, marginBottom: Spacing.sm, paddingHorizontal: 2 },
  week: { flexDirection: 'row', gap: 6 },
  tile: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    height: 104,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  kind: { alignSelf: 'stretch', marginHorizontal: 3, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  add: { height: 32, paddingHorizontal: Spacing.md, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
