import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ActionRow, ListGroup, SectionFooter } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { TimePicker } from '@/components/time-picker';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getMoments } from '@/db/plan';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { parseTimeKey, timeKey } from '@/lib/calendar';
import type { Moment } from '@/lib/plan';
import { haptics } from '@/services/haptics';

/**
 * The moments of the day the supplements and the weigh-in are tied to, with their times. The two
 * tied to the training follow it on the days with one, and keep their own time on the others.
 */
export default function MomentsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: moments } = useLiveQuery('moments', getMoments, ['settings']);

  const save = (next: Moment[]) => void setSetting(db, 'moments', next);
  const change = (id: string, fields: Partial<Moment>) => save((moments ?? []).map((m) => (m.id === id ? { ...m, ...fields } : m)));
  const add = () => {
    haptics.selection();
    save([...(moments ?? []), { id: `m${Date.now()}`, name: 'Nuovo momento', time: '18:00', anchor: null }]);
  };

  return (
    <ScreenScroll>
      <ListGroup>
        {(moments ?? []).map((m) => {
          const row = (
            <View style={styles.row}>
              <View style={styles.flex}>
                <TextInput
                  defaultValue={m.name}
                  onEndEditing={(event) => {
                    const name = event.nativeEvent.text.trim();
                    if (name !== '' && name !== m.name) change(m.id, { name });
                  }}
                  accessibilityLabel="Nome del momento"
                  style={[styles.name, { color: theme.text }]}
                />
                {m.anchor ? (
                  <AppText variant="footnote" tone="textSecondary">
                    {m.anchor === 'start' ? 'All’inizio dell’allenamento; senza, alle' : 'Alla fine dell’allenamento; senza, alle'}
                  </AppText>
                ) : null}
              </View>
              <TimePicker {...parseTimeKey(m.time)} accessibilityLabel={`Ora di ${m.name}`} onChange={(t) => change(m.id, { time: timeKey(t.hour, t.minute) })} />
            </View>
          );
          // The two tied to the training stay: the plan needs them.
          return m.anchor ? (
            <View key={m.id}>{row}</View>
          ) : (
            <SwipeToDelete key={m.id} onDelete={() => save((moments ?? []).filter((x) => x.id !== m.id))}>
              {row}
            </SwipeToDelete>
          );
        })}
        <ActionRow label="Aggiungi momento" onPress={add} />
      </ListGroup>
      <SectionFooter>Le notifiche arrivano a questi orari. Quello che è in un momento eliminato passa al primo della giornata.</SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  name: { fontSize: 17, paddingVertical: 4 },
});
