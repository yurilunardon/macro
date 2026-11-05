/**
 * A calendar published as an .ics file, e.g. a team's matches, and what changes when it is read
 * again. Pure, so it is tested without the network or a database.
 */
import { formatLongDate, toDateKey, type DateKey } from './dates';

export type IcsEvent = {
  /** Stable across changes: how an event is told apart when its date moves. */
  uid: string;
  date: DateKey;
  /** "21:00", or null for an event of the whole day. */
  time: string | null;
  minutes: number | null;
  summary: string;
  location: string | null;
  /** Where to go, to open in Maps. */
  mapUrl: string | null;
};

export type IcsCalendar = { name: string | null; events: IcsEvent[] };

function unescapeText(value: string): string {
  return value.replace(/\\([\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

/** The local date and time of "20261127T210000", "20261127T200000Z" or "20261127". */
function parseMoment(value: string): { date: DateKey; time: string | null; at: Date } | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z?))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, , zulu] = match;
  if (h === undefined) {
    const at = new Date(Number(y), Number(mo) - 1, Number(d), 12);
    return { date: toDateKey(at), time: null, at };
  }
  const at = zulu
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return { date: toDateKey(at), time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`, at };
}

function httpsOnly(url: string | undefined): string | null {
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** Reads the events of a calendar file; one without a date or a uid is left out. */
export function parseIcs(text: string): IcsCalendar {
  // A long line goes on in the next, which starts with a space.
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let name: string | null = null;
  const events: IcsEvent[] = [];
  let current: Map<string, string> | null = null;
  let nested = 0;
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (key === 'BEGIN') {
      if (value.trim() === 'VEVENT') current = new Map();
      else if (current) nested += 1;
      continue;
    }
    if (key === 'END') {
      if (current && nested > 0) {
        nested -= 1;
      } else if (current && value.trim() === 'VEVENT') {
        const event = eventFrom(current);
        if (event) events.push(event);
        current = null;
      }
      continue;
    }
    if (!current) {
      if (key === 'X-WR-CALNAME') name = unescapeText(value);
    } else if (nested === 0) {
      current.set(key, value);
    }
  }
  return { name, events };
}

function eventFrom(props: ReadonlyMap<string, string>): IcsEvent | null {
  const uid = props.get('UID')?.trim();
  const start = parseMoment(props.get('DTSTART') ?? '');
  if (!uid || !start) return null;
  const end = parseMoment(props.get('DTEND') ?? '');
  const description = unescapeText(props.get('DESCRIPTION') ?? '');
  const apple = /Apple Maps:\s*(https:\/\/\S+)/i.exec(description)?.[1];
  return {
    uid,
    date: start.date,
    time: start.time,
    minutes: end && start.time ? Math.max(0, Math.round((end.at.getTime() - start.at.getTime()) / 60_000)) : null,
    summary: unescapeText(props.get('SUMMARY') ?? ''),
    location: unescapeText(props.get('LOCATION') ?? '') || null,
    mapUrl: httpsOnly(apple) ?? httpsOnly(props.get('URL')?.trim()),
  };
}

/** Whether a match is at home: its title starts with the team, as "Home - Away". */
export function isHomeEvent(summary: string, team: string | null): boolean {
  return team !== null && team !== '' && summary.toLowerCase().startsWith(team.toLowerCase());
}

/** An event as stored from an earlier reading. */
export type FeedRow = {
  id: number;
  uid: string;
  date: DateKey;
  time: string | null;
  minutes: number | null;
  title: string | null;
  location: string | null;
  mapUrl: string | null;
};

export type FeedChange = { kind: 'added' | 'moved' | 'removed'; title: string; date: DateKey; time: string | null };

export type FeedPlan = {
  insert: IcsEvent[];
  update: { id: number; event: IcsEvent }[];
  /** Gone from the file and still to come. Those already played stay, as what happened. */
  remove: number[];
  /** What is worth telling: only about what is still to come. */
  changes: FeedChange[];
};

/** What to do to the stored events to match a new reading. */
export function planFeedSync(rows: readonly FeedRow[], events: readonly IcsEvent[], today: DateKey): FeedPlan {
  const byUid = new Map(rows.map((r) => [r.uid, r]));
  const seen = new Set<string>();
  const plan: FeedPlan = { insert: [], update: [], remove: [], changes: [] };
  for (const event of events) {
    if (seen.has(event.uid)) continue;
    seen.add(event.uid);
    const row = byUid.get(event.uid);
    if (!row) {
      plan.insert.push(event);
      if (event.date >= today) plan.changes.push({ kind: 'added', title: event.summary, date: event.date, time: event.time });
      continue;
    }
    const moved = row.date !== event.date || row.time !== event.time;
    const same = !moved && row.minutes === event.minutes && row.title === event.summary && row.location === event.location && row.mapUrl === event.mapUrl;
    if (same) continue;
    plan.update.push({ id: row.id, event });
    if (moved && (event.date >= today || row.date >= today)) plan.changes.push({ kind: 'moved', title: event.summary, date: event.date, time: event.time });
  }
  for (const row of rows) {
    if (seen.has(row.uid) || row.date < today) continue;
    plan.remove.push(row.id);
    plan.changes.push({ kind: 'removed', title: row.title ?? 'Partita', date: row.date, time: row.time });
  }
  return plan;
}

/** "Sandrigo è ora venerdì 27 novembre alle 21:00." */
export function describeFeedChanges(changes: readonly FeedChange[]): string | null {
  if (changes.length === 0) return null;
  if (changes.length > 1) return `${changes.length} partite cambiate nel calendario della squadra.`;
  const [c] = changes;
  const when = `${formatLongDate(c.date).toLowerCase()}${c.time ? ` alle ${c.time}` : ''}`;
  if (c.kind === 'moved') return `${c.title} è ora ${when}.`;
  if (c.kind === 'added') return `Nuova: ${c.title}, ${when}.`;
  return `Tolta: ${c.title}, era ${when}.`;
}
