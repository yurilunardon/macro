import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { toast } from './toast';

/** Not more often than this, when the app comes back to the foreground. */
const MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastCheck = 0;

async function check(): Promise<void> {
  if (!Updates.isEnabled || __DEV__ || Date.now() - lastCheck < MIN_INTERVAL_MS) return;
  lastCheck = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    const { isNew } = await Updates.fetchUpdateAsync();
    if (!isNew) return;
    // Downloaded: it starts by itself at the next launch, or now with the button.
    toast.show('Aggiornamento pronto', 'arrow.down.circle.fill', { label: 'Riavvia', onPress: () => void Updates.reloadAsync() });
  } catch {
    // Offline or the server is unreachable: try again next time.
  }
}

/**
 * Looks for a new version of the app's screens (published with `eas update`) when the app opens
 * and when it comes back to the foreground, and downloads it in the background. Changes that
 * need native code still need a new IPA.
 */
export function UpdateCheck() {
  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, []);
  return null;
}
