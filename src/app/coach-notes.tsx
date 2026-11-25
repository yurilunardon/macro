import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter } from '@/components/card';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { getCoachChat, setCoachNotes } from '@/db/coach';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';

/** What the coach keeps about the user: one fact a row, oldest first; a swipe takes one away. */
export default function CoachNotesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { data } = useLiveQuery('coach-chat', getCoachChat, ['settings']);
  const notes = data?.notes ?? [];

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title3" style={styles.flex}>
          Cosa sa di te
        </AppText>
        <Button title="Fine" variant="plain" compact onPress={() => router.back()} />
      </View>
      {notes.length === 0 ? (
        <AppText tone="textSecondary">Ancora niente. Toccando «Conoscimi» nel coach, ti fa le domande e scrive qui quello che impara.</AppText>
      ) : (
        <>
          <ListGroup>
            {notes.map((note, i) => (
              <SwipeToDelete key={`${note.at}-${i}`} onDelete={() => void setCoachNotes(db, notes.filter((_, j) => j !== i))}>
                <Row title={note.text} />
              </SwipeToDelete>
            ))}
          </ListGroup>
          <SectionFooter>Le legge prima di ogni risposta. Scorri a sinistra per togliere quelle sbagliate; per correggerne una, diglielo in chat.</SectionFooter>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center' },
});
