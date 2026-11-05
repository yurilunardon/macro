import { useRouter } from 'expo-router';

import { ActivityBadge } from '@/components/activity-badge';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { getCalendar } from '@/db/calendar';
import { getFeed } from '@/db/feed';
import { useLiveQuery } from '@/db/live';
import { getWeighInPlan, getWorkHours } from '@/db/plan';
import { getSetting } from '@/db/settings';
import { getSupplements } from '@/db/supplements';
import { useToday } from '@/hooks/use-today';
import { formatWeekdays, MATCH_REF, planCovers, WEEKDAYS_FROM_MONDAY, weekdayShort } from '@/lib/calendar';
import { addDays, formatShortDate, weekdayOf } from '@/lib/dates';

/** The plan behind the calendar, in its own words: the activities, the supplements, the weigh-in, work. */
export default function PlanScreen() {
  const router = useRouter();
  const today = useToday();
  const last = addDays(today, 6);
  const { data } = useLiveQuery(
    `plan:${today}`,
    async (database) => {
      const [calendar, supplements, weighIn, work, review, feed] = await Promise.all([
        getCalendar(database, today, last),
        getSupplements(database),
        getWeighInPlan(database),
        getWorkHours(database),
        getSetting(database, 'planReviewOn'),
        getFeed(database),
      ]);
      return { calendar, supplements, weighIn, work, review, feed };
    },
    ['calendar', 'settings', 'training'],
  );

  const days = (typeId: number) =>
    WEEKDAYS_FROM_MONDAY.filter((weekday) => {
      const date = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
      return (data?.calendar.plans ?? []).some((p) => p.typeId === typeId && planCovers(p, date));
    });

  const weighIn = data?.weighIn;
  const work = data?.work;
  return (
    <ScreenScroll>
      <SectionTitle>Attività</SectionTitle>
      <ListGroup>
        {(data?.calendar.types ?? [])
          .filter((t) => !t.archived)
          .map((t) => {
            const icon = <ActivityBadge symbol={t.symbol} color={t.color} size={28} />;
            if (t.ref === MATCH_REF && data?.feed) return <Row key={t.id} icon={icon} title={t.name} detail="Dalla squadra" onPress={() => router.push('/calendar/feed')} />;
            const on = days(t.id);
            return (
              <Row
                key={t.id}
                icon={icon}
                title={t.name}
                detail={on.length > 0 ? on.map((d) => weekdayShort(d)).join(', ') : 'Quando capita'}
                onPress={() => router.push({ pathname: '/calendar/activity-week', params: { type: t.id } })}
              />
            );
          })}
        <Row title="Aggiungi attività" onPress={() => router.push('/activity-type')} />
      </ListGroup>

      <SectionTitle>E poi</SectionTitle>
      <ListGroup>
        <Row title="Integratori" detail={data ? String(data.supplements.length) : ''} onPress={() => router.push('/calendar/supplements')} />
        <Row title="Pesata" detail={weighIn ? (weighIn.enabled ? `${weighIn.schedule === 'daily' ? 'Ogni giorno' : formatWeekdays(weighIn.weekdays)}, ${weighIn.time}` : 'Spenta') : ''} onPress={() => router.push('/calendar/weigh-in')} />
        <Row title="Lavoro" detail={work ? (work.enabled ? `${work.from} – ${work.to}` : 'Spento') : ''} onPress={() => router.push('/calendar/work')} />
        <Row title="Promemoria" onPress={() => router.push('/settings')} />
      </ListGroup>
      {data?.review ? (
        <SectionFooter>{data.review <= today ? 'È ora di rivedere il piano.' : `Il ${formatShortDate(data.review)} ti chiedo di rivederlo.`}</SectionFooter>
      ) : null}
    </ScreenScroll>
  );
}
