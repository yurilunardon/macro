import * as Notifications from 'expo-notifications';

import { formatExpiry } from '@/lib/provisioning';
import { DEFAULT_REMINDERS, expiryReminderAt, REMINDERS, type ReminderSettings } from '@/lib/reminders';

/** Every notification this app schedules starts with this, so it can replace only its own. */
const PREFIX = 'macro-';

// Show reminders as banners even while the app is open. The end of a rest is shown inside the
// app instead (the timer bar and a double buzz), so its banner would only be in the way.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const inApp = notification.request.identifier === 'workout-rest';
    return {
      shouldShowBanner: !inApp,
      shouldShowList: !inApp,
      shouldPlaySound: !inApp,
      shouldSetBadge: false,
    };
  },
});

/** Asks for permission if it was never asked. Returns whether notifications are allowed. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Replaces the scheduled notifications with what the settings ask for: daily reminders and the
 * evening before the app expires. Never asks for permission.
 */
export async function syncNotifications(input: {
  settings: ReminderSettings | null;
  expiresAt: Date | null;
}): Promise<void> {
  const settings = input.settings ?? DEFAULT_REMINDERS;
  if (!(await Notifications.getPermissionsAsync()).granted) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  for (const reminder of REMINDERS) {
    const setting = settings[reminder.key];
    if (!setting.enabled) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${reminder.key}`,
      content: { title: reminder.title, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: setting.hour, minute: setting.minute },
    });
  }

  const expiryAt = settings.expiry && input.expiresAt ? expiryReminderAt(input.expiresAt) : null;
  if (expiryAt && input.expiresAt) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}expiry`,
      content: {
        title: 'Rinnova Fuel',
        body: `L’app scade ${formatExpiry(input.expiresAt)}. Apri AltStore e tocca Refresh All, con il Mac acceso sulla stessa Wi-Fi.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: expiryAt },
    });
  }
}
