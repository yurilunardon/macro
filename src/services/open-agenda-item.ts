import type { useRouter } from 'expo-router';

import type { AgendaItem } from '@/lib/calendar';

/**
 * Opens what a row of the calendar is about: a finished workout in the calendar's own pages, the
 * one in progress in its sheet, an activity in its editor.
 */
export function openAgendaItem(router: ReturnType<typeof useRouter>, item: AgendaItem): void {
  if (item.kind === 'workout') {
    if (item.workout.endedAt) router.push({ pathname: '/calendar/session', params: { id: item.workout.id } });
    else router.push('/workout');
    return;
  }
  const o = item.occurrence;
  router.push({
    pathname: '/activity',
    params: o.planId === null ? { id: o.recordId ?? undefined } : { plan: o.planId, date: o.date },
  });
}
