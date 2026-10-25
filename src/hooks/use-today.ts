import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { todayKey, type DateKey } from '@/lib/dates';

function subscribe(onChange: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') onChange();
  });
  // Also notice midnight while the app stays open.
  const timer = setInterval(onChange, 60_000);
  return () => {
    subscription.remove();
    clearInterval(timer);
  };
}

/** Today's date, updated when the app comes back to the foreground or the day changes. */
export function useToday(): DateKey {
  return useSyncExternalStore(subscribe, () => todayKey());
}
