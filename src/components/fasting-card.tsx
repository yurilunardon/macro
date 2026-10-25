import * as Haptics from 'expo-haptics';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { endFast, getActiveFast, getFastHistory, setFastStart, startFast } from '@/db/fasts';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { fastStatus, formatHours } from '@/lib/fasting';
import { parseTime } from '@/lib/reminders';
import { ensureNotificationPermission } from '@/services/reminders';

import { AppText } from './app-text';
import { Button } from './button';
import { Card, SectionTitle } from './card';
import { ProgressBar } from './progress';

const timeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayTimeFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Intermittent fasting timer, shown in the diary when fasting is turned on in Profilo. */
export function FastingCard() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const now = useNow(30_000);
  const { data } = useLiveQuery('fasting-card', async (database) => {
    const [settings, active, history] = await Promise.all([
      getSetting(database, 'fasting'),
      getActiveFast(database),
      getFastHistory(database, 1),
    ]);
    return { settings, active, last: history[0] ?? null };
  });

  if (!data?.settings?.enabled) return null;
  const goalHours = data.settings.goalHours;

  const start = async () => {
    // The notification at the end of the fast needs permission; without it the timer still works.
    await ensureNotificationPermission();
    await startFast(db, goalHours);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const active = data.active;
  if (!active) {
    const last = data.last ? fastStatus(data.last) : null;
    return (
      <>
        <SectionTitle>Digiuno</SectionTitle>
        <Card style={styles.card}>
          <AppText variant="subhead" tone="textSecondary">
            {last
              ? `Ultimo digiuno: ${formatHours(last.elapsedHours)}${last.goalReached ? ', obiettivo raggiunto' : ''}.`
              : 'Avvia il timer quando finisci l’ultimo pasto della giornata.'}
          </AppText>
          <Button title={`Inizia digiuno da ${goalHours} h`} onPress={() => void start()} compact />
        </Card>
      </>
    );
  }

  const status = fastStatus(active, now);

  const end = () => {
    const finish = async () => {
      await endFast(db, active.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    if (status.goalReached) {
      void finish();
      return;
    }
    Alert.alert('Terminare il digiuno?', `Mancano ${formatHours(active.goalHours - status.elapsedHours)} all’obiettivo.`, [
      { text: 'Continua', style: 'cancel' },
      { text: 'Termina', style: 'destructive', onPress: () => void finish() },
    ]);
  };

  const changeStart = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt(
      'Ora di inizio',
      'Quando hai finito di mangiare, ad esempio 20:30.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: (text?: string) => {
            const time = parseTime(text ?? '');
            if (!time) {
              Alert.alert('Ora non valida', 'Scrivila come 20:30.');
              return;
            }
            const date = new Date();
            date.setHours(time.hour, time.minute, 0, 0);
            // A time later than now means yesterday evening.
            if (date.getTime() > Date.now()) date.setDate(date.getDate() - 1);
            void setFastStart(db, active.id, date);
          },
        },
      ],
      'plain-text',
      timeFormat.format(new Date(active.start)),
      'numbers-and-punctuation',
    );
  };

  return (
    <>
      <SectionTitle>Digiuno</SectionTitle>
      <Card style={styles.card}>
        <View>
          <AppText variant="title" numeric>
            {formatHours(status.elapsedHours)}
          </AppText>
          <AppText variant="subhead" tone={status.goalReached ? 'accent' : 'textSecondary'}>
            {status.goalReached
              ? `Obiettivo di ${active.goalHours} h raggiunto`
              : `Obiettivo ${active.goalHours} h · fino a ${dayTimeFormat.format(status.goalAt)}`}
          </AppText>
        </View>
        <ProgressBar value={Math.min(status.elapsedHours, active.goalHours)} target={active.goalHours} color={theme.accent} height={8} />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button title="Termina" onPress={end} compact />
          </View>
          <View style={styles.flex}>
            <Button title={`Iniziato alle ${timeFormat.format(new Date(active.start))}`} variant="plain" onPress={changeStart} compact />
          </View>
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.sm },
});
