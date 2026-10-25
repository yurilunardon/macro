import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A tiny change feed: every write calls `notifyChange()`, and every `useLiveQuery` re-runs.
 * The database is small, so re-reading after each write is simpler than fine-grained invalidation.
 */
let version = 0;
const listeners = new Set<() => void>();

export function notifyChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

type LiveState<T> = { data: T | undefined; error: unknown; loading: boolean };

type Result<T> = { token: string; data: T | undefined; error: unknown };

/**
 * Runs `query` and re-runs it whenever `key` changes or the database is written to.
 * `key` must capture every input of `query` (for example the selected date).
 * While a re-run is in flight the previous data stays visible, so screens do not flash.
 */
export function useLiveQuery<T>(key: string, query: (db: SQLiteDatabase) => Promise<T>): LiveState<T> {
  const db = useSQLiteContext();
  const dataVersion = useSyncExternalStore(subscribe, getVersion);
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
