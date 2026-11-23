import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { saveIfDue } from '@/services/cloud-backup';

/**
 * Puts the copy of the data online when the app opens, comes back, or is left, if the last one is
 * a few hours old. Renders nothing; how it went is in Impostazioni.
 */
export function CloudSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    void saveIfDue(db);
    const subscription = AppState.addEventListener('change', (next) => {
      // Leaving it, what was just entered goes up too: iOS gives a few seconds to finish.
      if (next === 'active' || next === 'background') void saveIfDue(db);
    });
    return () => subscription.remove();
  }, [db]);
  return null;
}
