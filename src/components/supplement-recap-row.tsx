import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_REMINDERS, type ReminderSetting } from '@/lib/reminders';
import { ensureNotificationPermission } from '@/services/reminders';

import { Row } from './card';
import { TimePicker } from './time-picker';

const DEFAULT: ReminderSetting = DEFAULT_REMINDERS.supplements ?? { enabled: true, hour: 21, minute: 30 };

/**
 * The evening reminder of the supplements not taken yet: its time and a switch, as the alarms in
 * Clock. In the supplements' list and among the reminders, both on the same setting.
 */
export function SupplementRecapRow() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [allowed, setAllowed] = useState(true);
  const { data } = useLiveQuery('reminders', (database) => getSetting(database, 'reminders'), ['settings']);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void Notifications.getPermissionsAsync().then((p) => {
      if (!cancelled) setAllowed(p.granted || p.canAskAgain);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === undefined) return null;
  const settings = { ...DEFAULT_REMINDERS, ...data };
  const setting = settings.supplements ?? DEFAULT;
  const save = (next: ReminderSetting) => void setSetting(db, 'reminders', { ...settings, supplements: next });

  const toggle = async (enabled: boolean) => {
    if (!enabled) {
      save({ ...setting, enabled });
      return;
    }
    const granted = await ensureNotificationPermission();
    setAllowed(granted);
    if (granted) save({ ...setting, enabled });
    else
      Alert.alert('Notifiche disattivate', 'Attivale in Impostazioni → Fuel → Notifiche.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Apri Impostazioni', onPress: () => void Linking.openSettings() },
      ]);
  };

  return (
    <Row
      title="Integratori non presi"
      subtitle="Un avviso la sera con quelli che mancano"
      chevron={false}
      detail={
        <View style={styles.detail}>
          <TimePicker
            hour={setting.hour}
            minute={setting.minute}
            accessibilityLabel="Ora dell’avviso degli integratori"
            onChange={(time) => save({ ...setting, ...time })}
          />
          <Switch
            value={setting.enabled && allowed}
            onValueChange={(v) => void toggle(v)}
            trackColor={{ true: theme.accent }}
            accessibilityLabel="Avviso degli integratori non presi"
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
