import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { expiryStatus, parseProvisioningExpiry, type ExpiryStatus } from '@/lib/provisioning';

let cached: Promise<Date | null> | null = null;

/** The profile only changes when AltStore reinstalls the app, so it is read once per launch. */
function readExpiry(): Promise<Date | null> {
  cached ??= (async () => {
    try {
      const file = new File(Paths.bundle, 'embedded.mobileprovision');
      if (!file.exists) return null;
      return parseProvisioningExpiry(await file.bytes());
    } catch {
      return null;
    }
  })();
  return cached;
}

/**
 * When the signature of the installed app expires, or null where there is none to read
 * (Expo Go, App Store builds, the simulator).
 */
export function useAppExpiry(): ExpiryStatus | null {
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void readExpiry().then((date) => {
      if (!cancelled) setExpiresAt(date);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  return expiresAt ? expiryStatus(expiresAt, new Date(now)) : null;
}
