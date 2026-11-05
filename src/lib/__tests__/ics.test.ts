import { describe, expect, it } from 'vitest';

import { describeFeedChanges, isHomeEvent, parseIcs, planFeedSync, type FeedRow } from '../ics';

// As the team's calendar is published: long lines folded, commas escaped, reminders inside the events.
const FILE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:New Volley Cartigliano',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:gara-131637632@fipav-calendario',
  'DTSTAMP:20261013T043207Z',
  'DTSTART;TZID=Europe/Rome:20261127T210000',
  'DTEND;TZID=Europe/Rome:20261127T230000',
  'SUMMARY:Volley Sandrigo - New Volley Cartigliano',
  'LOCATION:Pala Zanella SANDRIGO VI\\, Via S. Cr',
  ' istoforo\\, 1',
  'DESCRIPTION:Giornata 7 - Gara N° 1800\\n\\nGoogle Maps: https:',
  ' //www.google.com/maps?q=45.6\\,11.5\\nApple Maps: https://maps.apple.com/?daddr=45.6',
  ' \\,11.5\\nWaze: https://waze.com/ul',
  'URL:https://www.google.com/maps?q=45.6,11.5',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Non questa',
  'TRIGGER:-P1D',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gara-2@fipav-calendario',
  'DTSTART:20261114T183000Z',
  'DTEND:20261114T203000Z',
  'SUMMARY:New Volley Cartigliano - Avolley',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tutto-il-giorno',
  'DTSTART;VALUE=DATE:20261225',
  'SUMMARY:Natale',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Senza identificativo',
  'DTSTART:20261225T100000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('reading a calendar file', () => {
  const { name, events } = parseIcs(FILE);

  it('reads the calendar’s name and the events with an id and a date', () => {
    expect(name).toBe('New Volley Cartigliano');
    expect(events.map((e) => e.uid)).toEqual(['gara-131637632@fipav-calendario', 'gara-2@fipav-calendario', 'tutto-il-giorno']);
  });

  it('takes the local time as written, with folded lines and escapes undone', () => {
    expect(events[0]).toEqual({
      uid: 'gara-131637632@fipav-calendario',
      date: '2026-11-27',
      time: '21:00',
      minutes: 120,
      summary: 'Volley Sandrigo - New Volley Cartigliano',
      location: 'Pala Zanella SANDRIGO VI, Via S. Cristoforo, 1',
      mapUrl: 'https://maps.apple.com/?daddr=45.6,11.5',
    });
  });

  it('converts a time in UTC to the phone’s', () => {
    const expected = new Date(Date.UTC(2026, 10, 14, 18, 30));
    expect(events[1].time).toBe(`${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`);
    expect(events[1].minutes).toBe(120);
    expect(events[1].mapUrl).toBeNull();
  });

  it('takes an event of the whole day without a time', () => {
    expect(events[2]).toMatchObject({ date: '2026-12-25', time: null, minutes: null });
  });

  it('ignores anything that is not a calendar', () => {
    expect(parseIcs('<html>404</html>').events).toEqual([]);
    expect(parseIcs('').events).toEqual([]);
  });

  it('tells home from away by the team’s name', () => {
    expect(isHomeEvent('New Volley Cartigliano - Avolley', 'New Volley Cartigliano')).toBe(true);
    expect(isHomeEvent('Volley Sandrigo - New Volley Cartigliano', 'New Volley Cartigliano')).toBe(false);
    expect(isHomeEvent('New Volley Cartigliano - Avolley', null)).toBe(false);
  });
});

describe('a new reading', () => {
  const TODAY = '2026-11-05';
  const row = (fields: Partial<FeedRow>): FeedRow => ({ id: 1, uid: 'a', date: '2026-11-27', time: '21:00', minutes: 120, title: 'A - B', location: 'X', mapUrl: null, ...fields });
  const event = (fields: Partial<ReturnType<typeof parseIcs>['events'][number]> = {}) => ({ uid: 'a', date: '2026-11-27', time: '21:00', minutes: 120, summary: 'A - B', location: 'X', mapUrl: null, ...fields });

  it('leaves what did not change', () => {
    expect(planFeedSync([row({})], [event()], TODAY)).toEqual({ insert: [], update: [], remove: [], changes: [] });
  });

  it('adds what is new, without a word about what is over', () => {
    const plan = planFeedSync([], [event({ uid: 'n' }), event({ uid: 'old', date: '2026-10-23' })], TODAY);
    expect(plan.insert.map((e) => e.uid)).toEqual(['n', 'old']);
    expect(plan.changes.map((c) => [c.kind, c.date])).toEqual([['added', '2026-11-27']]);
  });

  it('follows a match that moves, by its id, and says so', () => {
    const plan = planFeedSync([row({ id: 7 })], [event({ date: '2026-11-28', time: '19:30' })], TODAY);
    expect(plan.update.map((u) => u.id)).toEqual([7]);
    expect(plan.insert).toEqual([]);
    expect(plan.changes).toEqual([{ kind: 'moved', title: 'A - B', date: '2026-11-28', time: '19:30' }]);
    expect(describeFeedChanges(plan.changes)).toBe('A - B è ora sabato 28 novembre alle 19:30.');
  });

  it('updates a new place quietly', () => {
    const plan = planFeedSync([row({ id: 7 })], [event({ location: 'Y' })], TODAY);
    expect(plan.update).toHaveLength(1);
    expect(plan.changes).toEqual([]);
  });

  it('takes off what is gone if still to come, and keeps what was played', () => {
    const plan = planFeedSync([row({ id: 1, uid: 'future' }), row({ id: 2, uid: 'past', date: '2026-10-23' })], [event({ uid: 'other' })], TODAY);
    expect(plan.remove).toEqual([1]);
    expect(plan.changes.map((c) => c.kind)).toEqual(['added', 'removed']);
  });

  it('counts several changes in one line', () => {
    expect(describeFeedChanges([])).toBeNull();
    expect(describeFeedChanges([{ kind: 'moved', title: 'A', date: '2026-11-28', time: null }, { kind: 'added', title: 'B', date: '2026-11-29', time: null }])).toBe('2 partite cambiate nel calendario della squadra.');
  });
});
