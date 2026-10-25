import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** The current time, refreshed every `intervalMs` and when the app comes back to the foreground. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [intervalMs]);
  return new Date(now);
}
