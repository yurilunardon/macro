import { useNavigation } from 'expo-router';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';

/**
 * False while the screen's sheet is rising. A sheet leaves only once its first render is done, so
 * what is costly to build (long lists, what is out of sight) waits for this: the sheet rises at
 * once and the rest arrives as it lands.
 */
export function useSettled(fallbackMs = 500): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const done = () => setSettled(true);
    const fallback = setTimeout(done, fallbackMs);
    const unsubscribe = navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) done();
    });
    return () => {
      clearTimeout(fallback);
      unsubscribe();
    };
  }, [navigation, fallbackMs]);
  return settled;
}
