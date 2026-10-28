import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { shareEqual } from '@/lib/share-equal';

/**
 * What a write touched. Screens re-read only when a topic they show has changed, so logging a
 * set does not make the diary, the stats and the settings query the database again.
 */
export type Topic = 'food' | 'body' | 'settings' | 'training' | 'calendar';

const ALL_TOPICS: readonly Topic[] = ['food', 'body', 'settings', 'training', 'calendar'];

/**
 * A tiny change feed: every write calls `notifyChange(topic)`, and the `useLiveQuery` hooks that
 * watch that topic re-run. The database is small, so re-reading a screen's data after a write
 * is simpler than fine-grained invalidation.
 */
const versions: Record<Topic, number> = { food: 0, body: 0, settings: 0, training: 0, calendar: 0 };
const listeners = new Set<() => void>();

/** With no topic, everything is considered changed (e.g. after restoring a backup). */
export function notifyChange(...topics: Topic[]): void {
  for (const topic of topics.length > 0 ? topics : ALL_TOPICS) versions[topic] += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type LiveState<T> = { data: T | undefined; error: unknown; loading: boolean };

type Result<T> = { token: string; data: T | undefined; error: unknown };


function versionOf(topics: readonly Topic[]): number {
  return topics.reduce((sum, topic) => sum + versions[topic], 0);
}

/**
 * The last result of each query. A screen opened again with nothing written since shows it at
 * once instead of a spinner; `prefetchLiveQuery` fills it just before a screen opens.
 */
const cache = new Map<string, Result<unknown>>();

/** Runs a screen's query ahead, e.g. on the tap that opens it, so it appears with its data. */
export async function prefetchLiveQuery<T>(
  db: SQLiteDatabase,
  key: string,
  query: (db: SQLiteDatabase) => Promise<T>,
  topics: readonly Topic[] = ALL_TOPICS,
): Promise<void> {
  const token = `${key}#${versionOf(topics)}`;
  if (cache.get(key)?.token === token) return;
  try {
    cache.set(key, { token, data: shareEqual(cache.get(key)?.data, await query(db)), error: undefined });
  } catch {
    // The screen runs it again and shows the error.
  }
}

/**
 * Runs `query` and re-runs it whenever `key` changes or one of `topics` is written to.
 * `key` must capture every input of `query` (for example the selected date).
 * While a re-run is in flight the previous data stays visible, so screens do not flash.
 */
export function useLiveQuery<T>(
  key: string,
  query: (db: SQLiteDatabase) => Promise<T>,
  topics: readonly Topic[] = ALL_TOPICS,
): LiveState<T> {
  const db = useSQLiteContext();
  // Versions only grow, so their sum changes exactly when one of the topics does.
  const dataVersion = useSyncExternalStore(subscribe, () => versionOf(topics));
  const token = `${key}#${dataVersion}`;
  const [result, setResult] = useState<Result<T> | null>(() => {
    const cached = cache.get(key);
    return cached?.token === token ? (cached as Result<T>) : null;
  });

  useEffect(() => {
    let cancelled = false;
    query(db).then(
      (data) => {
        if (cancelled) return;
        const next = { token, data: shareEqual(cache.get(key)?.data, data), error: undefined };
        cache.set(key, next);
        setResult(next);
      },
      (error: unknown) => {
        if (!cancelled) setResult((previous) => ({ token, data: previous?.data, error }));
      },
    );
    return () => {
      cancelled = true;
    };
    // `query` is recreated on every render; `token` stands in for its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, token]);

  return { data: result?.data, error: result?.error, loading: result?.token !== token };
}
