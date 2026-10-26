import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * What a write touched. Screens re-read only when a topic they show has changed, so logging a
 * set does not make the diary, the stats and the settings query the database again.
 */
export type Topic = 'food' | 'body' | 'settings' | 'training';

const ALL_TOPICS: readonly Topic[] = ['food', 'body', 'settings', 'training'];

/**
 * A tiny change feed: every write calls `notifyChange(topic)`, and the `useLiveQuery` hooks that
 * watch that topic re-run. The database is small, so re-reading a screen's data after a write
 * is simpler than fine-grained invalidation.
 */
const versions: Record<Topic, number> = { food: 0, body: 0, settings: 0, training: 0 };
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
  const dataVersion = useSyncExternalStore(subscribe, () => topics.reduce((sum, topic) => sum + versions[topic], 0));
  const token = `${key}#${dataVersion}`;
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    query(db).then(
      (data) => {
        if (!cancelled) setResult({ token, data, error: undefined });
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
