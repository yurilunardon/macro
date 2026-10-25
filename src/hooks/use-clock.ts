import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** The current time in ms, refreshed every `intervalMs` and when the app comes back. */
export function useClock(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}
