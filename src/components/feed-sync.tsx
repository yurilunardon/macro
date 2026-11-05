import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { syncFeed } from '@/db/feed';
import { todayKey } from '@/lib/dates';
import { describeFeedChanges } from '@/lib/ics';

import { toast } from './toast';

/** Not more often than this, when the app comes back to the foreground. The file changes rarely. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastCheck = 0;

/**
 * Reads the team's calendar when the app opens and comes back to the foreground, and says what
 * changed. It cannot do it with the app closed: that would take a new build. Renders nothing.
 */
export function FeedSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    const check = async () => {
      if (Date.now() - lastCheck < MIN_INTERVAL_MS) return;
      lastCheck = Date.now();
      const said = describeFeedChanges(await syncFeed(db, todayKey()));
      if (!said) return;
      toast.show(said, 'calendar');
      if (Platform.OS === 'web') return;
      // In the list of notifications too: it may have been missed.
      await Notifications.scheduleNotificationAsync({ content: { title: 'Partite', body: said, data: { url: '/calendar' } }, trigger: null }).catch(() => {});
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, [db]);
  return null;
}
