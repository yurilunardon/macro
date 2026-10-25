import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import {
  DEFAULT_REMINDERS,
  formatTime,
  parseTime,
  REMINDERS,
  type ReminderKey,
  type ReminderSettings,
} from '@/lib/reminders';
import { ensureNotificationPermission } from '@/services/reminders';

export default function RemindersScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const { data } = useLiveQuery('reminders', (database) => getSetting(database, 'reminders'));
  const { data: restAlert } = useLiveQuery('rest-alert', (database) => getSetting(database, 'restAlert'));

  useEffect(() => {
    let cancelled = false;
    void Notifications.getPermissionsAsync().then((p) => {
      if (!cancelled) setPermission(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const settings: ReminderSettings = { ...DEFAULT_REMINDERS, ...data };

  const save = (next: ReminderSettings) => void setSetting(db, 'reminders', next);
  // Without permission nothing is delivered, so switches show off until notifications are allowed.
  const effective = (on: boolean) => on && permission === 'granted';

  /** Turning something on asks for permission the first time. */
  const enable = async (apply: () => void) => {
    const granted = await ensureNotificationPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) apply();
    else
      Alert.alert('Notifiche disattivate', 'Attivale in Impostazioni → Macro → Notifiche.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Apri Impostazioni', onPress: () => void Linking.openSettings() },
      ]);
  };

  const toggle = (key: ReminderKey, enabled: boolean) => {
    const apply = () => save({ ...settings, [key]: { ...settings[key], enabled } });
    if (enabled) void enable(apply);
    else apply();
  };

  const toggleExpiry = (expiry: boolean) => {
    const apply = () => save({ ...settings, expiry });
    if (expiry) void enable(apply);
    else apply();
  };

  const editTime = (key: ReminderKey, label: string) => {
    if (Platform.OS !== 'ios') return;
    const current = settings[key];
    Alert.prompt(
      label,
      'A che ora? Ad esempio 13:30.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: (text?: string) => {
            const time = parseTime(text ?? '');
            if (!time) {
              Alert.alert('Ora non valida', 'Scrivila come 13:30.');
              return;
            }
            save({ ...settings, [key]: { ...current, ...time } });
          },
        },
      ],
      'plain-text',
      formatTime(current.hour, current.minute),
      'numbers-and-punctuation',
    );
  };

  const switchFor = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent }} accessibilityLabel={label} />
  );

  return (
    <ScreenScroll>
      {permission === 'denied' ? (
        <ListGroup>
          <Row
            title="Notifiche disattivate"
            subtitle="Attivale in Impostazioni → Macro → Notifiche"
            icon={<Icon name="bell.slash.fill" size={20} tone="danger" />}
            onPress={() => void Linking.openSettings()}
          />
        </ListGroup>
      ) : null}

      <SectionTitle>Ogni giorno</SectionTitle>
      <ListGroup>
        {REMINDERS.map((r) => {
          const setting = settings[r.key];
          return (
            <Row
              key={r.key}
              title={r.label}
              subtitle={`Alle ${formatTime(setting.hour, setting.minute)} · tocca per cambiare l’ora`}
              onPress={() => editTime(r.key, r.label)}
              chevron={false}
              detail={switchFor(effective(setting.enabled), (v) => toggle(r.key, v), `Promemoria ${r.label}`)}
            />
          );
        })}
      </ListGroup>

      <SectionTitle>AltStore</SectionTitle>
      <ListGroup>
        <Row
          title="Avviso prima della scadenza"
          subtitle="La sera prima che l’app scada, per ricordarti il Refresh"
          chevron={false}
          detail={switchFor(effective(settings.expiry), toggleExpiry, 'Avviso prima della scadenza')}
        />
      </ListGroup>
      <SectionFooter>
        Le notifiche sono tutte sul telefono: nessun server. Quando rinnovi l’app con AltStore la data di scadenza si
        aggiorna da sola.
      </SectionFooter>

      <SectionTitle>Allenamento · fine del recupero</SectionTitle>
      <Segmented
        options={[
          { key: 'silent', label: 'Silenziosa' },
          { key: 'sound', label: 'Con suono' },
        ]}
        value={restAlert ?? 'silent'}
        onChange={(value) => void setSetting(db, 'restAlert', value)}
      />
      <SectionFooter>
        Con l’app aperta il telefono vibra due volte e la barra del timer lo dice. Con lo schermo spento arriva una
        notifica: silenziosa, oppure con il suono di sistema, che in modalità silenziosa diventa solo una vibrazione.
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
