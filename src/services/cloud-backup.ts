/**
 * The copy of all the data in the user's own Supabase project, so that losing the phone does not
 * lose the diary. It is the same JSON as the backup file, saved under the user's folder in a
 * private bucket that only they can read, once a day by name and the last month kept.
 *
 * Only the tokens of the session are kept on the phone, never the password; they live in a file of
 * their own, outside the database, so restoring a backup does not sign the user out.
 */
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { CLOUD } from '@/constants/cloud';
import { readBackup } from '@/db/backup';
import { parseBackup, type BackupData } from '@/lib/backup';
import { cloudErrorText, cloudFileDay, cloudFileName, cloudFilesToPrune, cloudSaveDue } from '@/lib/cloud';
import { todayKey, type DateKey } from '@/lib/dates';

type Session = { accessToken: string; refreshToken: string; expiresAt: number; userId: string; email: string };

export type CloudState = {
  session: Session | null;
  /** When the last copy went up. */
  savedAt: string | null;
  /** Why the last try failed; null if it went well. */
  error: string | null;
  /**
   * Saving on its own. Off on a phone that has just signed in where copies are already online:
   * its data could be empty, and would take the place of today's good copy. On after a restore or
   * a "Salva ora".
   */
  auto: boolean;
  busy: boolean;
};

export type CloudCopy = { name: string; day: DateKey; updatedAt: string; size: number };

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const STORE = 'cloud-backup.json';

let state: CloudState = load();
const listeners = new Set<() => void>();

function load(): CloudState {
  const empty: CloudState = { session: null, savedAt: null, error: null, auto: true, busy: false };
  try {
    const file = new File(Paths.document, STORE);
    if (!file.exists) return empty;
    const saved = JSON.parse(file.textSync()) as Partial<CloudState>;
    return { ...empty, ...saved, busy: false };
  } catch {
    return empty;
  }
}

function set(change: Partial<CloudState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
  try {
    const file = new File(Paths.document, STORE);
    if (!file.exists) file.create();
    const { busy: _busy, ...kept } = state;
    file.writeSync(JSON.stringify(kept));
  } catch {
    // On the web there is no file: it lasts until the page is closed.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCloudBackup(): CloudState {
  return useSyncExternalStore(subscribe, () => state);
}

async function answer(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

type TokenAnswer = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email?: string } };

async function token(grant: 'password' | 'refresh_token', body: object): Promise<Session> {
  const response = await fetch(`${CLOUD.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: CLOUD.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await answer(response);
  if (!response.ok) throw new CloudError(cloudErrorText(response.status, data), response.status);
  const t = data as TokenAnswer;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    userId: t.user.id,
    email: t.user.email ?? '',
  };
}

let refreshing: Promise<Session> | null = null;

/** A session good for at least another minute: refreshed once, however many ask at the same time. */
async function session(): Promise<Session> {
  const current = state.session;
  if (!current) throw new CloudError('Non hai fatto l’accesso');
  if (current.expiresAt - 60_000 > Date.now()) return current;
  refreshing ??= token('refresh_token', { refresh_token: current.refreshToken })
    .then((fresh) => {
      set({ session: fresh });
      return fresh;
    })
    .catch((error: unknown) => {
      // A refresh token used up or revoked will not work again: only signing in again helps.
      if (error instanceof CloudError && (error.status === 400 || error.status === 401)) {
        set({ session: null, error: 'Accesso scaduto: accedi di nuovo' });
      }
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function storage(path: string, init: RequestInit = {}): Promise<unknown> {
  const { accessToken } = await session();
  const response = await fetch(`${CLOUD.url}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: CLOUD.key, Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  const data = await answer(response);
  if (!response.ok) throw new CloudError(cloudErrorText(Number((data as { statusCode?: string })?.statusCode) || response.status, data));
  return data;
}

function failure(error: unknown): string {
  if (error instanceof CloudError) return error.message;
  return 'Nessuna connessione';
}

/** Signs in with the one user of the project. Returns whether copies are already online. */
export async function signIn(email: string, password: string): Promise<{ copies: number }> {
  const fresh = await token('password', { email: email.trim(), password });
  set({ session: fresh, error: null, savedAt: null, auto: false });
  const copies = await listCopies();
  set({ auto: copies.length === 0 });
  return { copies: copies.length };
}

export function signOut(): void {
  set({ session: null, savedAt: null, error: null, auto: true });
}

/** The copies online, newest first. */
export async function listCopies(): Promise<CloudCopy[]> {
  const { userId } = await session();
  const items = (await storage(`object/list/${CLOUD.bucket}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: userId, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'desc' } }),
  })) as { name: string; updated_at?: string; created_at?: string; metadata?: { size?: number } | null }[];
  return items
    .flatMap((item) => {
      const day = cloudFileDay(item.name);
      if (!day) return [];
      return [{ name: item.name, day, updatedAt: item.updated_at ?? item.created_at ?? '', size: item.metadata?.size ?? 0 }];
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Puts today's copy online, in place of an earlier one of the same day, and drops the oldest. */
export async function saveNow(db: SQLiteDatabase): Promise<void> {
  if (state.busy) return;
  set({ busy: true });
  try {
    const { userId } = await session();
    const now = new Date();
    const data = await readBackup(db);
    await storage(`object/${CLOUD.bucket}/${userId}/${cloudFileName(todayKey(now))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': '0' },
      body: JSON.stringify(data),
    });
    set({ savedAt: now.toISOString(), error: null, auto: true });
    const old = cloudFilesToPrune((await listCopies()).map((c) => c.name));
    if (old.length > 0) {
      await storage(`object/${CLOUD.bucket}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: old.map((name) => `${userId}/${name}`) }),
      });
    }
  } catch (error) {
    set({ error: failure(error) });
    throw error;
  } finally {
    set({ busy: false });
  }
}

/** Saves if signed in, on, and the last copy is old enough. Never says anything: the screen does. */
export async function saveIfDue(db: SQLiteDatabase): Promise<void> {
  if (!state.session || !state.auto || state.busy || !cloudSaveDue(state.savedAt)) return;
  await saveNow(db).catch(() => {});
}

/** Downloads one copy and checks it, ready for restoreBackup. */
export async function downloadCopy(copy: CloudCopy): Promise<BackupData> {
  const { userId } = await session();
  const json = await storage(`object/authenticated/${CLOUD.bucket}/${userId}/${copy.name}`);
  return parseBackup(typeof json === 'string' ? JSON.parse(json) : json);
}

/** After a restore the data is the copy's: saving on its own can start again. */
export function restoredFromCloud(): void {
  set({ auto: true, error: null });
}

export { failure as cloudFailure };
