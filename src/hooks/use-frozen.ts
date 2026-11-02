import { useState } from 'react';

/** The value as it was when `frozen` became true, until it is false again. */
export function useFrozen<T>(value: T, frozen: boolean): T {
  const [held, setHeld] = useState<{ value: T } | null>(null);
  if (frozen && held === null) setHeld({ value });
  if (!frozen && held !== null) setHeld(null);
  return frozen && held !== null ? held.value : value;
}
