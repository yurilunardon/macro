import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { getActivityDates } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { getDosesTaken, getSupplements } from '@/db/supplements';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { useToday } from '@/hooks/use-today';
import { addDays, daysFrom } from '@/lib/dates';
import { supplementReminders } from '@/lib/supplements';
import { syncNotifications } from '@/services/reminders';

/** Supplement reminders are scheduled this many days ahead, and again each time the app opens. */
const SUPPLEMENT_DAYS = 14;

/**
 * Keeps the scheduled notifications in line with the reminder settings, the supplements still
 * to take and the app's expiry, which changes every time AltStore refreshes the app; and opens
 * the screen a notification is about when it is tapped. Renders nothing.
 */
export function NotificationSync() {
  const router = useRouter();
  const expiry = useAppExpiry();
  const today = useToday();
  const last = addDays(today, SUPPLEMENT_DAYS - 1);
  const { data } = useLiveQuery(`notification-sync:${today}`, async (database) => {
    const [settings, supplements, taken, busy] = await Promise.all([
      getSetting(database, 'reminders'),
      getSupplements(database),
      getDosesTaken(database, today, last),
      getActivityDates(database, today, last, today),
    ]);
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return { settings, supplements: supplementReminders(supplements, taken, busy, daysFrom(today, last), { date: today, time }) };
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
  // one that launched the app, and those tapped while it runs, each once.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      const url = response.notification.request.content.data?.url;
      if (handled.current === id || typeof url !== 'string') return;
      handled.current = id;
      router.push(url as Href);
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);

  return null;
}
