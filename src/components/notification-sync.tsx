import { useEffect } from 'react';

import { getActiveFast } from '@/db/fasts';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { syncNotifications } from '@/services/reminders';

/**
 * Keeps the scheduled notifications in line with the reminder settings, the running fast and
 * the app's expiry, which changes every time AltStore refreshes the app. Renders nothing.
 */
export function NotificationSync() {
  const expiry = useAppExpiry();
  const { data } = useLiveQuery('notification-sync', async (database) => {
    const [settings, fast] = await Promise.all([getSetting(database, 'reminders'), getActiveFast(database)]);
    return { settings, fast };
  });
  const expiresAt = expiry?.expiresAt ?? null;
  // Only what the notifications depend on, so the minute-by-minute clock does not reschedule them.
  const key = data ? JSON.stringify([data.settings, data.fast, expiresAt?.toISOString() ?? null]) : null;

  useEffect(() => {
    if (!data) return;
    syncNotifications({ settings: data.settings, expiresAt, fast: data.fast }).catch(() => {
      // Scheduling is best effort: the app works the same without notifications.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
