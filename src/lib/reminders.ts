/** Daily reminders the user can turn on, and when to warn about the app expiring. */

export type ReminderKey = 'weighIn' | 'breakfast' | 'lunch' | 'dinner';

export type ReminderSetting = { enabled: boolean; hour: number; minute: number };

export type ReminderSettings = Record<ReminderKey, ReminderSetting> & {
  /** A notification the day before the AltStore signature expires. */
  expiry: boolean;
};

export const REMINDERS: readonly { key: ReminderKey; label: string; title: string; body: string }[] = [
  { key: 'weighIn', label: 'Pesata', title: 'Pesati', body: 'Al mattino, prima di colazione: registralo in Progressi.' },
  { key: 'breakfast', label: 'Colazione', title: 'Colazione', body: 'Registra la colazione in Macro.' },
  { key: 'lunch', label: 'Pranzo', title: 'Pranzo', body: 'Registra il pranzo in Macro.' },
  { key: 'dinner', label: 'Cena', title: 'Cena', body: 'Registra la cena in Macro.' },
];

export const DEFAULT_REMINDERS: ReminderSettings = {
  weighIn: { enabled: false, hour: 7, minute: 30 },
  breakfast: { enabled: false, hour: 9, minute: 0 },
  lunch: { enabled: false, hour: 14, minute: 0 },
  dinner: { enabled: false, hour: 21, minute: 0 },
  expiry: true,
};

/** Accepts "7:30", "07.30", "730" or "7". Returns null if it is not a time of day. */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const match = /^\s*(\d{1,2})(?:[:.,\s]?(\d{2}))?\s*$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * When to remind about the expiry: the evening before (20:00), or two hours before if that
 * has already passed. Null when even that is in the past.
 */
export function expiryReminderAt(expiresAt: Date, now: Date = new Date()): Date | null {
  const evening = new Date(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate() - 1, 20, 0);
  if (evening > now && evening < expiresAt) return evening;
  const soon = new Date(expiresAt.getTime() - 2 * 3_600_000);
  return soon > now ? soon : null;
}
