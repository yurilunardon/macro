import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';

import type { RestAlert } from '@/db/settings';

import { RestActivity } from '../../modules/rest-activity';
import { ensureNotificationPermission } from './reminders';

/** Outside the "macro-" prefix, so the reminders' rescheduling never cancels a running rest. */
export const REST_NOTIFICATION_ID = 'workout-rest';

export type RestState = {
  endsAt: number;
  /** Seconds, for the progress bar; changes with ±15 s. */
  total: number;
  /** What the rest is for, e.g. "Panca piana · serie 2". */
  label: string;
  /** The workout's name, for the Lock Screen. */
  title: string;
};

/** A sound of silence bundled with the app (see app.json): iOS plays it as its vibration. */
const VIBRATE_SOUND = 'rest-vibrate.wav';

let state: RestState | null = null;
/** When the last rest was ended by hand: "Vai" or "Salta". */
let endedByHand: number | null = null;
let alert: RestAlert = 'vibrate';
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
      // A vibration by default: felt in the pocket with the phone locked, nobody else hears it.
      sound: alert === 'sound' ? 'default' : alert === 'vibrate' ? VIBRATE_SOUND : false,
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

/**
 * The rest on the Lock Screen and in the Dynamic Island: its countdown and bar run there by
 * themselves; once over it says so until the next set, when it goes.
 */
function showActivity(): void {
  if (!RestActivity) return;
  try {
    if (state) RestActivity.show(state.title, state.label, state.endsAt - state.total * 1000, state.endsAt);
    else RestActivity.hide();
  } catch {
    // Live Activities turned off for the app: the notification is still there.
  }
}

// The rest lives in memory: one left on the Lock Screen by an app closed since has nothing behind it.
try {
  RestActivity?.hide();
} catch {
  // Nothing to end.
}

function set(next: RestState | null): void {
  state = next;
  emit();
  armFinish();
  showActivity();
  void schedule();
}

/**
 * The rest between sets: starts by itself when a set is ticked, survives leaving the app (its
 * end is a timestamp plus a scheduled notification) and can be stretched or skipped.
 */
export const restTimer = {
  start(seconds: number, label: string, options: { alert: RestAlert; title: string }): void {
    alert = options.alert;
    endedByHand = null;
    set({ endsAt: Date.now() + seconds * 1000, total: seconds, label, title: options.title });
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
    endedByHand ??= Date.now();
    set(null);
  },
  /** "Salta" is pressed: the rest is over from now, though its panel takes a moment to go. */
  markEnded(): void {
    endedByHand ??= Date.now();
  },
  /**
   * When the last rest ended, as an ISO date: about when the next set began. Null if it is still
   * running, or there was none: a set ticked then says nothing about how long it took.
   */
  endedAt(): string | null {
    if (endedByHand !== null) return new Date(endedByHand).toISOString();
    if (state && state.endsAt <= Date.now()) return new Date(state.endsAt).toISOString();
    return null;
  },
};

export function useRestTimer(): RestState | null {
  return useSyncExternalStore(subscribe, () => state);
}
