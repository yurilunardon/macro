import type { SQLiteDatabase } from 'expo-sqlite';

import { MATCH_REF } from '@/lib/calendar';
import type { DateKey } from '@/lib/dates';
import { parseIcs, planFeedSync, type FeedChange, type FeedRow, type IcsCalendar } from '@/lib/ics';

import { notifyChange } from './live';
import { getSetting, setSetting, type Feed } from './settings';

/** The user's team: the calendar made with their other project. It can be changed in Il piano. */
const STARTING_FEED = 'https://yurilunardon.github.io/calendario-volley-cartigliano/calendario.ics';

/** Follows the team's calendar from the first time, once: taken off by hand, it stays off. */
export async function seedFeed(db: SQLiteDatabase): Promise<void> {
  if (await getSetting(db, 'feed')) return;
  await setSetting(db, 'feed', { url: STARTING_FEED, name: null, syncedAt: null, error: null, tookOver: false });
}

export async function getFeed(db: SQLiteDatabase): Promise<Feed | null> {
  return getSetting(db, 'feed');
}

async function storedRows(db: SQLiteDatabase): Promise<FeedRow[]> {
  const rows = await db.getAllAsync<{
    id: number;
    source_uid: string;
    date: string;
    time: string | null;
    minutes: number | null;
    title: string | null;
    location: string | null;
    map_url: string | null;
  }>('SELECT id, source_uid, date, time, minutes, title, location, map_url FROM activities WHERE source_uid IS NOT NULL');
  return rows.map((r) => ({ id: r.id, uid: r.source_uid, date: r.date, time: r.time, minutes: r.minutes, title: r.title, location: r.location, mapUrl: r.map_url }));
}

/**
 * Brings the stored matches in line with a reading of the calendar, in one transaction, and returns
 * what changed among those to come. The first time it also takes the place of the weekly plan of
 * the matches, which said Saturday whatever the fixture list said: nothing to tell about then.
 */
export async function applyFeed(db: SQLiteDatabase, calendar: IcsCalendar, today: DateKey): Promise<FeedChange[]> {
  const type = await db.getFirstAsync<{ id: number }>('SELECT id FROM activity_types WHERE ref = ?', MATCH_REF);
  if (!type) return [];
  const feed = await getSetting(db, 'feed');
  const first = !feed?.tookOver;
  const plan = planFeedSync(await storedRows(db), calendar.events, today);
  const now = new Date().toISOString();
  const nothingToDo = !first && plan.insert.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
  if (nothingToDo) {
    if (feed) await setSetting(db, 'feed', { ...feed, name: calendar.name ?? feed.name, syncedAt: now, error: null });
    return [];
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (first) await tx.runAsync('DELETE FROM activity_plans WHERE type_id = ?', type.id);
    for (const e of plan.insert) {
      await tx.runAsync(
        `INSERT INTO activities (type_id, plan_id, date, time, minutes, day_id, note, status, created_at, source_uid, title, location, map_url)
         VALUES (?, NULL, ?, ?, ?, NULL, NULL, 'planned', ?, ?, ?, ?, ?)`,
        type.id,
        e.date,
        e.time,
        e.minutes,
        now,
        e.uid,
        e.summary,
        e.location,
        e.mapUrl,
      );
    }
    for (const { id, event: e } of plan.update) {
      await tx.runAsync('UPDATE activities SET date = ?, time = ?, minutes = ?, title = ?, location = ?, map_url = ? WHERE id = ?', e.date, e.time, e.minutes, e.summary, e.location, e.mapUrl, id);
    }
    for (const id of plan.remove) await tx.runAsync('DELETE FROM activities WHERE id = ?', id);
  });
  if (feed) await setSetting(db, 'feed', { ...feed, name: calendar.name ?? feed.name, syncedAt: now, error: null, tookOver: true });
  notifyChange('calendar', 'settings');
  return first ? [] : plan.changes;
}

/**
 * Reads the calendar followed, if any, and applies it. A file that cannot be read, or that holds no
 * events, changes nothing: a site down must not empty the calendar.
 */
export async function syncFeed(db: SQLiteDatabase, today: DateKey, fetcher: typeof fetch = fetch): Promise<FeedChange[]> {
  const feed = await getSetting(db, 'feed');
  if (!feed || feed.url.trim() === '') return [];
  const fail = async (error: string): Promise<FeedChange[]> => {
    await setSetting(db, 'feed', { ...feed, error });
    return [];
  };
  let text: string;
  try {
    const response = await fetcher(feed.url.trim());
    if (!response.ok) return await fail(`Il calendario risponde ${response.status}`);
    text = await response.text();
  } catch {
    return fail('Nessuna connessione');
  }
  const calendar = parseIcs(text);
  if (calendar.events.length === 0) return fail('Nessuna partita nel file');
  return applyFeed(db, calendar, today);
}
