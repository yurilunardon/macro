import { Stack, useRouter } from 'expo-router';

import { ActivityBadge } from '@/components/activity-badge';
import { ListGroup, Row, SectionFooter } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { getActivityTypes } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { formatMinutes, GYM_REF } from '@/lib/calendar';
import { usePendingDeletes } from '@/services/undo';

/** The kinds of activity of the calendar: the gym, volleyball, matches and the user's own. */
export default function ActivityTypesScreen() {
  const router = useRouter();
  const pending = usePendingDeletes();
  const { data } = useLiveQuery('activity-types', getActivityTypes, ['calendar']);
  const types = (data ?? []).filter((t) => !t.archived && !pending.has(`activity-type:${t.id}`));

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Nuovo tipo" onPress={() => router.push('/activity-type')} />
      </Stack.Toolbar>
      <ListGroup>
        {types.map((t) => (
          <Row
            key={t.id}
            icon={<ActivityBadge symbol={t.symbol} color={t.color} />}
            title={t.name}
            subtitle={[t.ref === GYM_REF ? 'Gli allenamenti registrati nell’app' : null, t.minutes ? `Di solito ${formatMinutes(t.minutes)}` : null]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => router.push({ pathname: '/activity-type', params: { id: t.id } })}
          />
        ))}
      </ListGroup>
      <SectionFooter>Ogni tipo ha il suo colore nel calendario e il suo conteggio nel report.</SectionFooter>
    </ScreenScroll>
  );
}
