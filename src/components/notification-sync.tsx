import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { getActivityDates } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { getDoseChanges, getDoseKeys, getSupplements, takeDoses } from '@/db/supplements';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useToday } from '@/hooks/use-today';
import { addDays, daysFrom, isDateKey } from '@/lib/dates';
import { supplementsEvening } from '@/lib/reminders';
import { supplementReminders } from '@/lib/supplements';
import { haptics } from '@/services/haptics';
import { SNOOZE_ACTION, snoozeNotification, syncNotifications, TAKEN_ACTION } from '@/services/reminders';

import { toast } from './toast';

/** Supplement reminders are scheduled this many days ahead, and again each time the app opens. */
const SUPPLEMENT_DAYS = 14;

/**
 * Keeps the scheduled notifications in line with the reminder settings, the supplements still
 * to take and the app's expiry, which changes every time AltStore refreshes the app; and opens
 * the screen a notification is about when it is tapped. Renders nothing.
 */
export function NotificationSync() {
  const db = useSQLiteContext();
  const router = useRouter();
  const expiry = useAppExpiry();
  const today = useToday();
  const last = addDays(today, SUPPLEMENT_DAYS - 1);
  const { data } = useLiveQuery(`notification-sync:${today}`, async (database) => {
    const [settings, supplements, taken, changes, busy] = await Promise.all([
      getSetting(database, 'reminders'),
      getSupplements(database),
      getDoseKeys(database, today, last),
      getDoseChanges(database, today, last),
      getActivityDates(database, today, last, today),
    ]);
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return {
      settings,
      supplements: supplementReminders(supplements, taken, changes, busy, daysFrom(today, last), { date: today, time }, supplementsEvening(settings)),
    };
  }, ['settings', 'calendar']);
  const expiresAt = expiry?.expiresAt ?? null;
  // Only what the notifications depend on, so the minute-by-minute clock does not reschedule them.
  const key = data ? JSON.stringify([data.settings, data.supplements, expiresAt?.toISOString() ?? null]) : null;

  useEffect(() => {
    if (!data) return;
    syncNotifications({ settings: data.settings, supplements: data.supplements, expiresAt }).catch(() => {
      // Scheduling is best effort: the app works the same without notifications.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A tapped notification opens what it is about, e.g. the calendar to tick the supplements: the
  // one that launched the app, and those tapped while it runs, each once. "Fatto" on a supplements
  // reminder ticks them too; "Tra 30 minuti" sends it again.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const action = response.actionIdentifier;
      if (action !== Notifications.DEFAULT_ACTION_IDENTIFIER && action !== TAKEN_ACTION && action !== SNOOZE_ACTION) return;
      const id = `${response.notification.request.identifier}:${action}`;
      const data = response.notification.request.content.data ?? {};
      if (handled.current === id || typeof data.url !== 'string') return;
      handled.current = id;
      router.push(data.url as Href);
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      const doses = Array.isArray(data.doses) ? data.doses.filter((d): d is { id: number; index: number } => typeof d?.id === 'number' && typeof d?.index === 'number') : [];
      if (action === TAKEN_ACTION && isDateKey(data.date) && doses.length > 0) {
        void takeDoses(db, doses, data.date).then((count) => {
          haptics.success();
          toast.show(count === 1 ? 'Segnato come preso' : 'Segnati come presi');
        });
      }
      if (action === SNOOZE_ACTION) {
        void snoozeNotification(response.notification.request.content).then(() => toast.show('Te lo ricordo tra 30 minuti', 'clock'));
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [db, router]);

  return null;
}
