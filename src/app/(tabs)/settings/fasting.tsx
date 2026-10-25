import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Chip } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { deleteFast, getFastHistory } from '@/db/fasts';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { FASTING_GOALS, fastStatus, formatHours } from '@/lib/fasting';

const startFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function FastingSettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data } = useLiveQuery('fasting-settings', async (database) => {
    const [settings, history] = await Promise.all([getSetting(database, 'fasting'), getFastHistory(database, 60)]);
    return { settings: settings ?? { enabled: false, goalHours: 16 }, history };
  });

  if (!data) return null;
  const { settings, history } = data;

  return (
    <ScreenScroll>
      <ListGroup>
        <Row
          title="Digiuno intermittente"
          subtitle="Mostra il timer in fondo al Diario"
          chevron={false}
          detail={
            <Switch
              value={settings.enabled}
              onValueChange={(enabled) => void setSetting(db, 'fasting', { ...settings, enabled })}
              trackColor={{ true: theme.accent }}
              accessibilityLabel="Digiuno intermittente"
            />
          }
        />
      </ListGroup>

      <SectionTitle>Durata obiettivo</SectionTitle>
      <View style={styles.chips}>
        {FASTING_GOALS.map((hours) => (
          <Chip
            key={hours}
            label={`${hours} h`}
            selected={settings.goalHours === hours}
            onPress={() => void setSetting(db, 'fasting', { ...settings, goalHours: hours })}
          />
        ))}
      </View>
      <SectionFooter>16 h è il classico 16:8: digiuno dalla cena al pranzo del giorno dopo.</SectionFooter>

      {history.length > 0 ? (
        <>
          <SectionTitle>Storico</SectionTitle>
          <ListGroup>
            {history.map((fast) => {
              const status = fastStatus(fast);
              return (
                <SwipeToDelete key={fast.id} onDelete={() => void deleteFast(db, fast.id)}>
                  <Row
                    title={formatHours(status.elapsedHours)}
                    subtitle={`Dal ${startFormat.format(new Date(fast.start))} · obiettivo ${fast.goalHours} h`}
                    icon={
                      <Icon
                        name={status.goalReached ? 'checkmark.circle.fill' : 'circle.dashed'}
                        size={20}
                        tone={status.goalReached ? 'accent' : 'textTertiary'}
                      />
                    }
                    chevron={false}
                    onLongPress={() =>
                      Alert.alert('Eliminare questo digiuno?', formatHours(status.elapsedHours), [
                        { text: 'Annulla', style: 'cancel' },
                        { text: 'Elimina', style: 'destructive', onPress: () => void deleteFast(db, fast.id) },
                      ])
                    }
                  />
                </SwipeToDelete>
              );
            })}
          </ListGroup>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
