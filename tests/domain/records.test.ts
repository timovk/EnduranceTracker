/**
 * Personal Records: every kind, how each improves, and the rules that keep
 * them honest. Runs in London.
 */

import { describe, expect, it } from 'vitest';
import type { CareerTimeline } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import type { RecordEvent, RecordKind, RecordOptions } from '@/lib/domain/records';
import { beatenAfter, computeRecordProgression, currentRecords, RECORD_ORDER, recordLabel, recordsSetIn } from '@/lib/domain/records';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;
const OPTIONS: RecordOptions = { weekStartsOn: 1, longRaceThresholdSec: 10 * H, rollingDays: 7 };

inTimeZone(ZONES.london.zone, ZONES.london.offsets);

function progression(timeline: CareerTimeline, options: Partial<RecordOptions> = {}): RecordEvent[] {
  return computeRecordProgression(timeline, { ...OPTIONS, ...options });
}

function ofKind(events: readonly RecordEvent[], kind: RecordKind): RecordEvent[] {
  return events.filter((event) => event.kind === kind);
}

describe('each record', () => {
  it('longest session', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2026-05-01T22:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-03T22:00', { from: '2:00', to: '5:00' }),
      stint(r, '2026-05-05T22:00', { from: '5:00', to: '6:00' }),
    ])), 'longest-session');
    expect(events.map((e) => [e.value, e.at])).toEqual([[2 * H, localTime('2026-05-01T22:00')], [3 * H, localTime('2026-05-03T22:00')]]);
    expect(events[1]).toMatchObject({ label: 'Longest session', unit: 'seconds', raceId: 'r', detail: 'r', basis: 'logged-time', previousValue: 2 * H });
  });

  it('most in a day, never more than the day holds', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2026-03-09T21:00', { from: '0:00', to: '2:00' }),
      // Twenty hours, then twenty more logged a minute later: forty hours of
      // credit in one day is batch logging, and the day holds twenty-four.
      stint(r, '2026-03-10T23:00', { from: '0:00', to: '20:00' }),
      stint(r, '2026-03-10T23:01', { from: '0:00', to: '20:00' }),
    ])), 'most-in-a-day');
    expect(events.map((e) => [e.periodKey, e.value])).toEqual([['2026-03-09', 2 * H], ['2026-03-10', 24 * H]]);
    expect(events[1]).toMatchObject({ at: localTime('2026-03-10'), detail: '10 March 2026', basis: 'logged-time' });
  });

  it('most in seven days', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2026-04-01T21:00', { from: '0:00', to: '3:00' }),
      stint(r, '2026-04-06T21:00', { from: '3:00', to: '6:00' }),
      // Eight days after the first: the first has left the window.
      stint(r, '2026-04-09T21:00', { from: '6:00', to: '8:00' }),
    ])), 'most-in-seven-days');
    expect(events.map((e) => [e.periodKey, e.value])).toEqual([['2026-04-01', 3 * H], ['2026-04-06', 6 * H]]);
    expect(events[1]).toMatchObject({ label: 'Most in seven days', detail: '31 March 2026 to 6 April 2026' });
  });

  it('the seven-day record spans 29 February correctly', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2028-02-23T21:00', { from: '0:00', to: '1:00' }),
      stint(r, '2028-02-24T21:00', { from: '1:00', to: '3:00' }),
      stint(r, '2028-02-29T21:00', { from: '3:00', to: '5:00' }),
      stint(r, '2028-03-01T21:00', { from: '5:00', to: '7:00' }),
    ])), 'most-in-seven-days');
    // Ending on 1 March, the seven days are 24 February to 1 March: 29
    // February is one of them, so 23 February is not.
    expect(events.map((e) => [e.periodKey, e.value])).toEqual([
      ['2028-02-23', H], ['2028-02-24', 3 * H], ['2028-02-29', 5 * H], ['2028-03-01', 6 * H],
    ]);
    expect(events[3]!.detail).toBe('24 February 2028 to 1 March 2028');
  });

  it('most in a month', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2026-01-10T21:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-02-10T21:00', { from: '2:00', to: '3:00' }),
      stint(r, '2026-03-10T21:00', { from: '3:00', to: '6:00' }),
    ])), 'most-in-a-month');
    expect(events.map((e) => [e.periodKey, e.value, e.detail])).toEqual([
      ['2026-01', 2 * H, 'January 2026'], ['2026-03', 3 * H, 'March 2026'],
    ]);
    expect(events[1]!.at).toEqual(localTime('2026-03-01'));
  });

  it('most Story Completes in a month and in a year', () => {
    const races = ['a', 'b', 'c', 'd'].map((id) => race(id, { hours: 1 }));
    const whole = { from: '0:00', to: '1:00' };
    const events = progression(career(races, [
      stint('a', '2026-11-05T21:00', whole),
      stint('b', '2027-01-05T21:00', whole),
      stint('c', '2027-01-06T21:00', whole),
      stint('d', '2027-02-06T21:00', whole),
    ]));
    expect(ofKind(events, 'most-completions-in-a-month').map((e) => [e.periodKey, e.value])).toEqual([['2026-11', 1], ['2027-01', 2]]);
    expect(ofKind(events, 'most-story-completes-in-a-year').map((e) => [e.periodKey, e.value, e.basis])).toEqual([
      ['2026', 1, 'history'], ['2027', 3, 'history'],
    ]);
    expect(ofKind(events, 'most-story-completes-in-a-year')[1]!.at).toEqual(localTime('2027-01-01'));
  });

  it('longest race completed', () => {
    const races = [race('six', { hours: 6 }), race('twelve', { hours: 12 }), race('three', { hours: 3 })];
    const events = ofKind(progression(career(races, [
      stint('six', '2026-05-01T21:00', { from: '0:00', to: '6:00' }),
      stint('twelve', '2026-05-03T21:00', { from: '0:00', to: '12:00' }),
      stint('three', '2026-05-05T21:00', { from: '0:00', to: '3:00' }),
    ])), 'longest-race-story-completed');
    expect(events.map((e) => [e.raceId, e.value])).toEqual([['six', 6 * H], ['twelve', 12 * H]]);
  });

  it('fastest long race and longest start to finish', () => {
    const races = [race('slow', { hours: 12 }), race('quick', { hours: 12 }), race('short', { hours: 6 })];
    const events = progression(career(races, [
      stint('slow', '2026-05-01T21:00', { from: '0:00', to: '6:00' }),
      stint('slow', '2026-05-05T21:00', { from: '6:00', to: '12:00' }),
      stint('quick', '2026-06-01T21:00', { from: '0:00', to: '6:00' }),
      stint('quick', '2026-06-02T21:00', { from: '6:00', to: '12:00' }),
      // Short races are not long races, however quickly they are finished.
      stint('short', '2026-07-01T21:00', { from: '0:00', to: '6:00' }),
    ]));
    // The slow one ran from 15:00 on 1 May to 21:00 on 5 May.
    const slow = (4 * 24 + 6) * H;
    const quick = (24 + 6) * H;
    expect(ofKind(events, 'fastest-long-race-completion').map((e) => [e.raceId, e.value])).toEqual([['slow', slow], ['quick', quick]]);
    expect(ofKind(events, 'longest-start-to-finish').map((e) => [e.raceId, e.value])).toEqual([['slow', slow]]);
  });

  it('most new race coverage in a day', () => {
    const r = race('r', { hours: 24 });
    const events = ofKind(progression(career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-02T21:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-03T21:00', { from: '2:00', to: '8:00', speed: 3 }),
    ])), 'most-new-coverage-in-a-day');
    // The re-watch adds nothing; six hours of race in two hours at 3× adds six.
    expect(events.map((e) => [e.periodKey, e.value])).toEqual([['2026-05-01', 2 * H], ['2026-05-03', 6 * H]]);
  });

  it('longest run of complete editions', () => {
    const edition = (id: string, year: number) => race(id, {
      hours: 1, eventKey: 'x', eventName: 'The X Hours', raceDate: new Date(`${year}-06-01`),
    });
    const races = [edition('x24', 2024), edition('x25', 2025), edition('x27', 2027), edition('x26', 2026)];
    const whole = { from: '0:00', to: '1:00' };
    const events = ofKind(progression(career(races, [
      stint('x24', '2026-05-01T21:00', whole),
      stint('x25', '2026-05-02T21:00', whole),
      stint('x27', '2026-05-03T21:00', whole),
      stint('x26', '2026-05-04T21:00', whole),
    ])), 'longest-edition-streak');
    // One edition is not a run; 2024–25 is; filling in 2026 joins 2024–27.
    expect(events.map((e) => [e.value, e.detail, e.unit])).toEqual([
      [2, 'The X Hours, 2024–2025', 'editions'], [4, 'The X Hours, 2024–2027', 'editions'],
    ]);
    expect(events[1]).toMatchObject({ eventKey: 'x', raceId: 'x26', at: localTime('2026-05-04T21:00') });
  });
});

describe('the rules', () => {
  it('ties keep the earlier holder', () => {
    const r = race('r', { hours: 24 });
    const events = progression(career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '3:00' }),
      stint(r, '2026-05-03T21:00', { from: '3:00', to: '6:00' }),
    ]));
    expect(ofKind(events, 'longest-session')).toHaveLength(1);
    expect(ofKind(events, 'most-in-a-day')).toHaveLength(1);
    expect(currentRecords(events).find((e) => e.kind === 'longest-session')!.at).toEqual(localTime('2026-05-01T21:00'));
  });

  it('progression lists every improvement', () => {
    const r = race('r', { hours: 24 });
    const events = progression(career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '1:00' }),
      stint(r, '2026-05-02T21:00', { from: '1:00', to: '3:00' }),
      stint(r, '2026-05-03T21:00', { from: '3:00', to: '4:00' }),
      stint(r, '2026-05-04T21:00', { from: '4:00', to: '7:00' }),
    ]));
    const sessions = ofKind(events, 'longest-session');
    expect(sessions.map((e) => [e.previousValue, e.value])).toEqual([[null, H], [H, 2 * H], [2 * H, 3 * H]]);
    // In time order throughout.
    const times = events.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('fastest completion is never shorter than the credited time', () => {
    // Twelve hours of race logged in three stints a minute apart: the logged
    // times say four minutes, the viewing says twelve hours.
    const r = race('r', { hours: 12 });
    const events = progression(career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '4:00' }),
      stint(r, '2026-05-01T21:01', { from: '4:00', to: '8:00' }),
      stint(r, '2026-05-01T21:02', { from: '8:00', to: '12:00' }),
    ]));
    expect(ofKind(events, 'fastest-long-race-completion')[0]!.value).toBe(12 * H);
  });

  it('records respect filters', () => {
    const races = [race('wec', { hours: 6, championshipId: 'wec' }), race('gt', { hours: 3, championshipId: 'gt' })];
    const timeline = career(races, [
      stint('wec', '2026-05-01T21:00', { from: '0:00', to: '2:00' }),
      stint('gt', '2026-05-02T21:00', { from: '0:00', to: '3:00' }),
    ]);
    const onlyWec = currentRecords(progression(timeline, { include: (r) => r.championshipId === 'wec' }));
    expect(onlyWec.find((e) => e.kind === 'longest-session')).toMatchObject({ raceId: 'wec', value: 2 * H });
    expect(onlyWec.some((e) => e.kind === 'longest-race-story-completed')).toBe(false);
  });

  it('records within a year', () => {
    const r = race('r', { hours: 24 });
    const timeline = career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '5:00' }),
      stint(r, '2027-05-01T21:00', { from: '5:00', to: '7:00' }),
      // 22:00 on 31 December to 01:00: only the hour in 2027 is 2027's.
      stint(r, '2027-01-01T01:00', { from: '7:00', to: '10:00' }),
    ]);
    const within = currentRecords(progression(timeline, { within: yearWindow(2027) }));
    expect(within.find((e) => e.kind === 'longest-session')).toMatchObject({ value: 3 * H, at: localTime('2027-01-01T01:00') });
    expect(within.find((e) => e.kind === 'most-in-a-day')).toMatchObject({ value: 2 * H, periodKey: '2027-05-01' });
    const career2026 = currentRecords(progression(timeline));
    expect(career2026.find((e) => e.kind === 'longest-session')!.value).toBe(5 * H);
  });

  it('beatenAfter finds the record that replaced it', () => {
    const r = race('r', { hours: 24 });
    const events = progression(career([r], [
      stint(r, '2026-05-01T21:00', { from: '0:00', to: '1:00' }),
      stint(r, '2026-05-02T21:00', { from: '1:00', to: '3:00' }),
    ]));
    const [first, second] = ofKind(events, 'longest-session');
    expect(beatenAfter(events, first!)).toBe(second);
    expect(beatenAfter(events, second!)).toBeNull();
  });

  it('lists current records in RECORD_ORDER and finds those set in a window', () => {
    const r = race('r', { hours: 6 });
    const events = progression(career([r], [
      stint(r, '2026-12-30T21:00', { from: '0:00', to: '3:00' }),
      stint(r, '2027-01-02T21:00', { from: '3:00', to: '6:00' }),
    ]));
    const kinds = currentRecords(events).map((e) => e.kind);
    expect(kinds).toEqual(RECORD_ORDER.filter((kind) => kinds.includes(kind)));
    expect(recordsSetIn(events, yearWindow(2027)).every((e) => e.at >= localTime('2027-01-01'))).toBe(true);
    expect(recordsSetIn(events, yearWindow(2027)).map((e) => e.kind)).toContain('longest-race-story-completed');
  });

  it('names every record the same way on its card and in the list of those still to be set', () => {
    const r = race('r', { hours: 24 });
    const events = progression(career([r], [stint(r, '2026-12-30T21:00', { from: '0:00', to: '24:00' })]));
    for (const event of events) expect(event.label).toBe(recordLabel(event.kind, OPTIONS.rollingDays));
    expect(recordLabel('most-in-seven-days', 7)).toBe('Most in seven days');
    expect(recordLabel('most-in-seven-days', 14)).toBe('Most in 14 days');
    expect(new Set(RECORD_ORDER.map((kind) => recordLabel(kind))).size).toBe(RECORD_ORDER.length);
  });
});
