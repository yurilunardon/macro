import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { getCalendar } from '@/db/calendar';
import { getFeed, syncFeed } from '@/db/feed';
import { useLiveQuery } from '@/db/live';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatLongDate } from '@/lib/dates';
import { describeFeedChanges, isHomeEvent } from '@/lib/ics';
import { clockOf } from '@/lib/plan';
import { haptics } from '@/services/haptics';

/** The team's published calendar: where it is, how the last reading went, and the matches to come. */
export default function FeedScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const today = useToday();
  const [busy, setBusy] = useState(false);
  const { data } = useLiveQuery(
    `feed-page:${today}`,
    async (database) => {
      const [feed, calendar] = await Promise.all([getFeed(database), getCalendar(database, today, addDays(today, 400))]);
      return { feed, matches: calendar.records.filter((r) => r.sourceUid && r.typeId === calendar.kinds.match) };
    },
    ['calendar', 'settings'],
  );
  if (!data) return <ScreenScroll>{null}</ScreenScroll>;
  const { feed, matches } = data;

  const saveUrl = (url: string) => {
    if (!feed || url.trim() === feed.url) return;
    void setSetting(db, 'feed', { ...feed, url: url.trim() });
  };
  const refresh = async () => {
    setBusy(true);
    const changes = await syncFeed(db, today);
    setBusy(false);
    haptics.success();
    toast.show(describeFeedChanges(changes) ?? 'Già aggiornato');
  };
  const synced = feed?.syncedAt ? `${new Date(feed.syncedAt).toDateString() === new Date().toDateString() ? 'Oggi' : formatLongDate(feed.syncedAt.slice(0, 10))} alle ${clockOf(feed.syncedAt)}` : 'Mai';

  return (
    <ScreenScroll>
      <ListGroup>
        <Row title="Calendario" detail={feed?.name ?? ''} chevron={false} />
        <Row title="Aggiornato" detail={synced} chevron={false} />
        {feed?.error ? <Row title={feed.error} chevron={false} destructive /> : null}
      </ListGroup>
      <View style={styles.action}>
        <Button title={busy ? 'Aggiorno…' : 'Aggiorna ora'} variant="tinted" disabled={busy} onPress={() => void refresh()} />
      </View>
      <SectionFooter>Si aggiorna da solo quando apri l’app.</SectionFooter>

      <SectionTitle>Indirizzo</SectionTitle>
      <ListGroup>
        <View style={styles.field}>
          <TextInput
            defaultValue={feed?.url ?? ''}
            onEndEditing={(event) => saveUrl(event.nativeEvent.text)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Indirizzo del calendario"
            style={[styles.input, { color: theme.text }]}
          />
        </View>
      </ListGroup>

      <SectionTitle>Prossime partite</SectionTitle>
      <ListGroup>
        {matches.map((m) => {
          const map = m.mapUrl;
          return (
            <Row
              key={m.id}
              title={m.title ?? 'Partita'}
              subtitle={`${formatLongDate(m.date)}${m.time ? `, ${m.time}` : ''} · ${isHomeEvent(m.title ?? '', feed?.name ?? null) ? 'In casa' : 'Trasferta'}`}
              chevron={false}
              onPress={map ? () => void Linking.openURL(map) : undefined}
            />
          );
        })}
        {matches.length === 0 ? (
          <View style={styles.none}>
            <AppText tone="textSecondary">Nessuna partita in programma.</AppText>
          </View>
        ) : null}
      </ListGroup>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: Spacing.md },
  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  input: { fontSize: 15, minHeight: 24 },
  none: { padding: Spacing.lg },
});
