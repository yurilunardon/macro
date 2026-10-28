function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * The new result, with every part equal to the previous one swapped back for the previous
 * object. A write re-reads a whole screen, but what did not change keeps its identity, so the
 * compiler's memoised components under it skip: ticking a set redraws that set, not every row
 * of the workout and the native views in them.
 */
export function shareEqual<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return previous as T;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const merged = next.map((item, i) => {
      const shared = shareEqual(previous[i], item);
      if (shared !== previous[i]) same = false;
      return shared;
    });
    return (same ? previous : merged) as T;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      merged[key] = shareEqual(previous[key], next[key]);
      if (merged[key] !== previous[key] || !(key in previous)) same = false;
    }
    return (same ? previous : merged) as T;
  }
  return next;
}
