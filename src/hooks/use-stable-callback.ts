import { useEffect, useRef, useState } from 'react';

/**
 * One function for good, which calls the latest: what receives it is not drawn again each time the
 * screen is, only because the function is new.
 */
export function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  const [stable] = useState(() => (...args: A) => latest.current(...args));
  return stable;
}
