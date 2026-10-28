import * as Notifications from 'expo-notifications';

import { formatMonthName, fromDateKey, monthOf, toDateKey } from '@/lib/dates';
import { formatExpiry } from '@/lib/provisioning';
import { DEFAULT_REMINDERS, expiryReminderAt, monthlyReportAt, REMINDERS, type ReminderSettings } from '@/lib/reminders';
import type { SupplementReminder } from '@/lib/supplements';

/** Every notification this app schedules starts with this, so it can replace only its own. */
const PREFIX = 'macro-';

/** The supplements' notifications carry a "Segna come presi" button, handled in NotificationSync. */
export const SUPPLEMENTS_CATEGORY = 'supplements';
export const TAKEN_ACTION = 'taken';

/**
 * iOS keeps at most 64 notifications waiting: the supplements' days ahead take what the daily
 * reminders, the report and the expiry leave.
 */
const SUPPLEMENT_LIMIT = 50;

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
 * Replaces the scheduled notifications with what the settings ask for: daily reminders, the
 * supplements still to take, the monthly report and the evening before the app expires. Never
 * asks for permission.
 */
export async function syncNotifications(input: {
  settings: ReminderSettings | null;
  expiresAt: Date | null;
  supplements: readonly SupplementReminder[];
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

  if (input.supplements.length > 0) {
    await Notifications.setNotificationCategoryAsync(SUPPLEMENTS_CATEGORY, [
      { identifier: TAKEN_ACTION, buttonTitle: 'Segna come presi', options: { opensAppToForeground: true } },
    ]).catch(() => {
      // Without the button the notification still opens the calendar.
    });
  }
  for (const r of input.supplements.slice(0, SUPPLEMENT_LIMIT)) {
    const at = fromDateKey(r.date);
    const [hour, minute] = r.time.split(':').map(Number);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}supplements-${r.date}-${r.time}`,
      content: {
        title: r.title,
        body: r.body,
        categoryIdentifier: SUPPLEMENTS_CATEGORY,
        data: { url: '/calendar', date: r.date, supplements: r.ids },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  }

  if (settings.monthlyReport ?? true) {
    const at = monthlyReportAt();
    const month = monthOf(toDateKey(new Date(at.getFullYear(), at.getMonth() - 1, 1, 12)));
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}monthly-report`,
      content: {
        title: `Il report di ${formatMonthName(month).toLowerCase()}`,
        body: 'Allenamenti, attività e integratori del mese, con quanto hai speso.',
        data: { url: `/calendar/report?period=month&anchor=${month}-01` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
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
