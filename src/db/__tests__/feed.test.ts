import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAgenda, expandActivities } from '@/lib/calendar';

import { addPlan, getActivityTypes, getCalendar } from '../calendar';
import { applyFeed, getFeed, seedFeed, syncFeed } from '../feed';
import { migrateDatabase } from '../schema';

import { createTestDatabase } from './test-database';

vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

let db: SQLiteDatabase;
const TODAY = '2026-11-05';

const event = (uid: string, date: string, time = '21:00') => ({ uid, date, time, minutes: 120, summary: `Partita ${uid}`, location: 'Palestra, Via 1', mapUrl: 'https://maps.apple.com/?daddr=1,2' });
const file = (...events: { uid: string; date: string; time: string }[]) =>
  [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Squadra',
    ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART:${e.date.replaceAll('-', '')}T${e.time.replace(':', '')}00`, `SUMMARY:${e.uid}`, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
const answer = (text: string, ok = true, status = 200) => (async () => ({ ok, status, text: async () => text })) as unknown as typeof fetch;

const matchesOn = async (from: string, to: string) => {
  const calendar = await getCalendar(db, from, to);
  return expandActivities(calendar.plans, calendar.records, from, to)
    .filter((o) => o.typeId === calendar.kinds.match)
    .map((o) => [o.date, o.time, o.title]);
};

beforeEach(async () => {
  db = createTestDatabase();
  await migrateDatabase(db);
  await seedFeed(db);
});

describe('the team’s calendar', () => {
  it('follows the team from the first time, and does not come back if taken off', async () => {
    expect((await getFeed(db))?.url).toContain('calendario-volley-cartigliano');
  });

  it('takes the place of the weekly plan of the matches, once, with nothing to tell', async () => {
    const match = (await getActivityTypes(db)).find((t) => t.ref === 'match')!.id;
    await addPlan(db, { typeId: match, weekdays: [6], time: '19:30', minutes: 120, dayId: null, note: null, startDate: '2026-10-30' });
    const changes = await applyFeed(db, { name: 'Squadra', events: [event('a', '2026-11-12')] }, TODAY);
    expect(changes).toEqual([]);
    expect(await matchesOn('2026-10-30', '2026-11-30')).toEqual([['2026-11-12', '21:00', 'Partita a']]);
    expect(await getFeed(db)).toMatchObject({ name: 'Squadra', error: null, tookOver: true });
  });

  it('follows a match that moves, without doubling it, and says so', async () => {
    await applyFeed(db, { name: 'Squadra', events: [event('a', '2026-11-12')] }, TODAY);
    const changes = await applyFeed(db, { name: 'Squadra', events: [event('a', '2026-11-13', '20:30')] }, TODAY);
    expect(changes.map((c) => [c.kind, c.date, c.time])).toEqual([['moved', '2026-11-13', '20:30']]);
    expect(await matchesOn('2026-11-01', '2026-11-30')).toEqual([['2026-11-13', '20:30', 'Partita a']]);
  });

  it('takes off a match that is gone, keeps those played', async () => {
    await applyFeed(db, { name: 'Squadra', events: [event('old', '2026-10-23'), event('a', '2026-11-12')] }, TODAY);
    await applyFeed(db, { name: 'Squadra', events: [event('b', '2026-11-20')] }, TODAY);
    expect((await matchesOn('2026-10-01', '2026-11-30')).map((m) => m[0])).toEqual(['2026-10-23', '2026-11-20']);
  });

  it('changes nothing when the file cannot be read, or holds nothing', async () => {
    await syncFeed(db, TODAY, answer(file({ uid: 'a', date: '2026-11-12', time: '21:00' })));
    expect(await matchesOn('2026-11-01', '2026-11-30')).toHaveLength(1);
    await syncFeed(db, TODAY, answer('Not Found', false, 404));
    expect((await getFeed(db))?.error).toBe('Il calendario risponde 404');
    await syncFeed(db, TODAY, answer('<html></html>'));
    expect((await getFeed(db))?.error).toBe('Nessuna partita nel file');
    await syncFeed(db, TODAY, (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect((await getFeed(db))?.error).toBe('Nessuna connessione');
    expect(await matchesOn('2026-11-01', '2026-11-30')).toHaveLength(1);
    await syncFeed(db, TODAY, answer(file({ uid: 'a', date: '2026-11-12', time: '21:00' })));
    expect((await getFeed(db))?.error).toBeNull();
  });

  it('removes the practice from the day of a match', async () => {
    const practice = (await getActivityTypes(db)).find((t) => t.ref === 'volleyball')!.id;
    await addPlan(db, { typeId: practice, weekdays: [4], time: '21:00', minutes: 120, dayId: null, note: null, startDate: '2026-11-01' });
    await applyFeed(db, { name: 'Squadra', events: [event('a', '2026-11-12')] }, TODAY);
    const c = await getCalendar(db, '2026-11-12', '2026-11-19');
    const agenda = buildAgenda({ occurrences: expandActivities(c.plans, c.records, '2026-11-12', '2026-11-19'), workouts: [], gymTypeId: c.gymTypeId, today: TODAY, rotation: null, kinds: c.kinds });
    expect(agenda.get('2026-11-12')?.map((i) => (i.kind === 'activity' ? i.occurrence.title : null))).toEqual(['Partita a']);
    expect(agenda.get('2026-11-19')).toHaveLength(1);
  });
});
