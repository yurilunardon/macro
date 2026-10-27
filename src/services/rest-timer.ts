import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';

import { ensureNotificationPermission } from './reminders';

/** Outside the "macro-" prefix, so the reminders' rescheduling never cancels a running rest. */
export const REST_NOTIFICATION_ID = 'workout-rest';

export type RestState = {
  endsAt: number;
  /** Seconds, for the progress bar; changes with ±15 s. */
  total: number;
  /** What the rest is for, e.g. "Panca piana · serie 2". */
  label: string;
};

let state: RestState | null = null;
let sound = false;
let finishTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function schedule(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID).catch(() => {});
  if (!state || state.endsAt <= Date.now()) return;
  if (!(await ensureNotificationPermission())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: REST_NOTIFICATION_ID,
    content: {
      title: 'Recupero finito',
      body: state.label,
      // Silent by default: a banner on the lock screen and nothing else, so the gym is not disturbed.
      sound: sound ? 'default' : false,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(state.endsAt) },
  }).catch(() => {});
}

/** How often the phone buzzes once the rest is over, and for how long at most. */
const BUZZ_EVERY = 1500;
const BUZZ_FOR = 3 * 60_000;
let buzz: ReturnType<typeof setInterval> | undefined;

/**
 * With the app open the phone really vibrates when the rest is over (the haptic taps used
 * elsewhere are too light to notice between sets), and keeps vibrating until "Vai" is pressed or
 * the next set is ticked; with it locked the notification takes over.
 */
function armFinish(): void {
  clearTimeout(finishTimer);
  clearInterval(buzz);
  Vibration.cancel();
  if (!state) return;
  const ending = state;
  finishTimer = setTimeout(() => {
    if (state !== ending) return;
    Vibration.vibrate();
    const until = Date.now() + BUZZ_FOR;
    buzz = setInterval(() => {
      if (state !== ending || Date.now() > until) {
        clearInterval(buzz);
        return;
      }
      Vibration.vibrate();
    }, BUZZ_EVERY);
  }, Math.max(0, ending.endsAt - Date.now()));
}

function set(next: RestState | null): void {
  state = next;
  emit();
  armFinish();
  void schedule();
}

/**
 * The rest between sets: starts by itself when a set is ticked, survives leaving the app (its
 * end is a timestamp plus a scheduled notification) and can be stretched or skipped.
 */
export const restTimer = {
  start(seconds: number, label: string, options: { sound: boolean }): void {
    sound = options.sound;
    set({ endsAt: Date.now() + seconds * 1000, total: seconds, label });
  },
  /**
   * Adds or takes away time. The bar keeps the length of the whole rest, so taking 15 s away
   * shortens it; adding past the full length makes the full length longer. The rest never goes
   * below zero: with less left than the change, "−15" is not offered (skipping ends it).
   */
  adjust(deltaSeconds: number): void {
    if (!state) return;
    const now = Date.now();
    const left = state.endsAt - now + deltaSeconds * 1000;
    if (left <= 0) return;
    set({ ...state, endsAt: now + left, total: Math.max(state.total, left / 1000) });
  },
  /** Ends the rest: skipped while it runs, or "Vai" once it is over. */
  stop(): void {
    if (!state) return;
    set(null);
  },
};

export function useRestTimer(): RestState | null {
  return useSyncExternalStore(subscribe, () => state);
}
