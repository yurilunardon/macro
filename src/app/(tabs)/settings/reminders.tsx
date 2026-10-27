import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { TimePicker } from '@/components/time-picker';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_REMINDERS, REMINDERS, type ReminderKey, type ReminderSettings } from '@/lib/reminders';
import { ensureNotificationPermission } from '@/services/reminders';

export default function RemindersScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const { data } = useLiveQuery('reminders', (database) => getSetting(database, 'reminders'), ['settings']);
  const { data: restAlert } = useLiveQuery('rest-alert', (database) => getSetting(database, 'restAlert'), ['settings']);

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
      Alert.alert('Notifiche disattivate', 'Attivale in Impostazioni → Fuel → Notifiche.', [
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

  const switchFor = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent }} accessibilityLabel={label} />
  );

  return (
    <ScreenScroll>
      {permission === 'denied' ? (
        <ListGroup>
          <Row
            title="Notifiche disattivate"
            subtitle="Attivale in Impostazioni → Fuel → Notifiche"
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
            // The time is set with the iOS time pill beside the switch, as for alarms in Clock.
            <Row
              key={r.key}
              title={r.label}
              chevron={false}
              detail={
                <View style={styles.detail}>
                  <TimePicker
                    hour={setting.hour}
                    minute={setting.minute}
                    accessibilityLabel={`Ora del promemoria ${r.label}`}
                    onChange={(time) => save({ ...settings, [r.key]: { ...setting, ...time } })}
                  />
                  {switchFor(effective(setting.enabled), (v) => toggle(r.key, v), `Promemoria ${r.label}`)}
                </View>
              }
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
        Notifiche solo locali, senza server.
      </SectionFooter>

      <SectionTitle>Allenamento · fine del recupero</SectionTitle>
      <Segmented
        options={[
          { key: 'silent', label: 'Solo avviso' },
          { key: 'sound', label: 'Suono o vibrazione' },
        ]}
        value={restAlert ?? 'silent'}
        onChange={(value) => void setSetting(db, 'restAlert', value)}
      />
      <SectionFooter>
        A telefono bloccato «Solo avviso» non vibra; in silenzioso il suono diventa vibrazione. Ad app aperta vibra sempre.
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
