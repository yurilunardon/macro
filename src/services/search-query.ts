import { useEffect, useSyncExternalStore } from 'react';

type TextEvent = { nativeEvent: { text: string } };

/**
 * What is typed in a screen's native search bar. The bar's options live in the layout and never
 * change: set again from the screen, on every render, iOS rebuilt the bar, which showed up
 * without its glass for a moment. The screen reads the text from here instead.
 */
function createSearchQuery() {
  let text = '';
  const listeners = new Set<() => void>();
  const set = (next: string) => {
    text = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    onChangeText: (event: TextEvent) => set(event.nativeEvent.text),
    /** The text typed; empty again once the screen closes, as its bar is. */
    useQuery(): string {
      useEffect(() => () => set(''), []);
      return useSyncExternalStore(subscribe, () => text);
    },
  };
}

/** The exercise library in the Allenamento tab. */
export const exerciseSearch = createSearchQuery();
/** The exercise picker, which can be open over the library. */
export const pickerSearch = createSearchQuery();
