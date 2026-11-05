import { useSQLiteContext } from 'expo-sqlite';
import { Switch } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { TimePicker } from '@/components/time-picker';
import { WeekdayPicker } from '@/components/weekday-picker';
import { useLiveQuery } from '@/db/live';
import { getWorkHours } from '@/db/plan';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { parseTimeKey, timeKey, type WorkHours } from '@/lib/calendar';

/**
 * When the user is at work: drawn behind the hours of the day, and left out when a time is proposed.
 * What is put there by hand stays there: it is an exception, a day of leave.
 */
export default function WorkScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: work } = useLiveQuery('work-hours', getWorkHours, ['settings']);
  if (!work) return <ScreenScroll>{null}</ScreenScroll>;
  const save = (fields: Partial<WorkHours>) => void setSetting(db, 'workHours', { ...work, ...fields });
  return (
    <ScreenScroll>
      <ListGroup>
        <Row
          title="Nel calendario"
          chevron={false}
          detail={<Switch value={work.enabled} onValueChange={(enabled) => save({ enabled })} trackColor={{ true: theme.accent }} accessibilityLabel="Lavoro nel calendario" />}
        />
      </ListGroup>
      {work.enabled ? (
        <>
          <SectionTitle>In quali giorni</SectionTitle>
          <ListGroup>
            <WeekdayPicker value={work.weekdays} onChange={(weekdays) => save({ weekdays })} />
          </ListGroup>
          <SectionTitle>Orario</SectionTitle>
          <ListGroup>
            <Row title="Dalle" chevron={false} detail={<TimePicker {...parseTimeKey(work.from)} accessibilityLabel="Inizio del lavoro" onChange={(t) => save({ from: timeKey(t.hour, t.minute) })} />} />
            <Row title="Alle" chevron={false} detail={<TimePicker {...parseTimeKey(work.to)} accessibilityLabel="Fine del lavoro" onChange={(t) => save({ to: timeKey(t.hour, t.minute) })} />} />
          </ListGroup>
          <SectionFooter>Quello che metti in queste ore resta dov’è: è un’eccezione.</SectionFooter>
        </>
      ) : null}
    </ScreenScroll>
  );
}
