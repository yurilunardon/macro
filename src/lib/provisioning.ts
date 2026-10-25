/**
 * Apps installed with AltStore and a free Apple ID stop opening when their provisioning
 * profile expires (7 days). The profile is inside the app as `embedded.mobileprovision`: a
 * signed blob whose payload is a plain XML plist, so the expiry can be read without parsing CMS.
 */

/** Bytes to a string, one character per byte; the XML part of the profile is ASCII. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  // In chunks, to stay well within the engine's limit on function arguments.
  for (let i = 0; i < bytes.length; i += 4096) {
    text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return text;
}

export function parseProvisioningExpiry(bytes: Uint8Array): Date | null {
  const match = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(latin1(bytes));
  if (!match) return null;
  const date = new Date(match[1].trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export type ExpiryLevel = 'ok' | 'soon' | 'urgent' | 'expired';

export type ExpiryStatus = { expiresAt: Date; hoursLeft: number; level: ExpiryLevel };

/** "soon" within 3 days, "urgent" within 24 hours. */
export function expiryStatus(expiresAt: Date, now: Date = new Date()): ExpiryStatus {
  const hoursLeft = (expiresAt.getTime() - now.getTime()) / 3_600_000;
  const level: ExpiryLevel = hoursLeft <= 0 ? 'expired' : hoursLeft < 24 ? 'urgent' : hoursLeft < 72 ? 'soon' : 'ok';
  return { expiresAt, hoursLeft, level };
}

const timeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

/** "oggi alle 13:05", "domani alle 9:00", "sabato 1 novembre". */
export function formatExpiry(expiresAt: Date, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(expiresAt) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `oggi alle ${timeFormat.format(expiresAt)}`;
  if (days === 1) return `domani alle ${timeFormat.format(expiresAt)}`;
  return dayFormat.format(expiresAt);
}
