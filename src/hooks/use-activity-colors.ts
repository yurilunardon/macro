import { ActivityColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ActivityColor } from '@/lib/calendar';

/** The calendar's colours for the current appearance. */
export function useActivityColors(): Record<ActivityColor, string> {
  const scheme = useColorScheme();
  return ActivityColors[scheme === 'dark' ? 'dark' : 'light'];
}
