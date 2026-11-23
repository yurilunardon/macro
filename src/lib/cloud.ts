/**
 * The copy of the data kept online: one file a day, named by the day, the last ones kept. What can
 * be worked out without the network lives here, so it can be tested.
 */
import { formatShortDate, todayKey, type DateKey } from './dates';

/** How many days of copies stay online: a bad day can be undone up to a month later. */
export const CLOUD_KEEP = 30;
/** The app saves on its own when it opens or closes, not more often than this. */
export const CLOUD_EVERY_MS = 6 * 60 * 60 * 1000;

const NAME = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** "2026-11-23.json": a later save the same day takes its place. */
export function cloudFileName(day: DateKey): string {
  return `${day}.json`;
}

/** The day a file is for, or null if it is not one of ours. */
export function cloudFileDay(name: string): DateKey | null {
  const match = NAME.exec(name);
  return match ? (match[1] as DateKey) : null;
}

/** The files past the newest `keep`, to delete. Files that are not copies are left alone. */
export function cloudFilesToPrune(names: readonly string[], keep: number = CLOUD_KEEP): string[] {
  return names
    .filter((name) => cloudFileDay(name) !== null)
    .sort()
    .reverse()
    .slice(keep);
}

/** Whether it is time to save again. */
export function cloudSaveDue(lastSavedAt: string | null, now: Date = new Date(), every: number = CLOUD_EVERY_MS): boolean {
  if (!lastSavedAt) return true;
  const last = new Date(lastSavedAt).getTime();
  return Number.isNaN(last) || now.getTime() - last >= every;
}

/** "oggi alle 14:32", "ieri alle 9:05", "21 nov alle 18:10". */
export function formatCloudTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = todayKey(date);
  const today = todayKey(now);
  const yesterday = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const when = day === today ? 'oggi' : day === yesterday ? 'ieri' : formatShortDate(day);
  return `${when} alle ${time}`;
}

/** "840 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** What went wrong, in words, from Supabase's answer. */
export function cloudErrorText(status: number, body: unknown): string {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = String(data.error_code ?? data.error ?? '');
  if (code === 'invalid_credentials' || code === 'invalid_grant') return 'Email o password sbagliate';
  if (code === 'email_not_confirmed') return 'Email non confermata: confermala da Supabase';
  if (code.startsWith('refresh_token_') || code === 'session_not_found') return 'Accesso scaduto: accedi di nuovo';
  if (status === 401 || status === 403) return 'Accesso negato: controlla le regole del bucket';
  if (status === 404) return 'Il bucket «backups» non c’è';
  if (status === 413) return 'Il backup è troppo grande';
  if (status >= 500) return 'Supabase non risponde, riprova più tardi';
  const message = data.msg ?? data.message ?? data.error_description;
  return typeof message === 'string' && message ? message : `Errore ${status}`;
}
