/**
 * Dating landmarks from the replay: when a rung was really reached, and the
 * agreement between the moment the app recognises a rung and the moment the
 * replay dates it.
 */

import { describe, expect, it } from 'vitest';
import { MASTERY_SHAPE, MILESTONES } from '@/lib/config';
import type { TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import {
  acceptInstant, creditedSecondsByLocalYear, creditedSecondsByLocalYearOfSessions, editionsExperiencedByEvent,
  eventStepInstant, isReplayableMilestoneMetric, milestoneInstant, recognitionThresholdSeconds,
} from '@/lib/domain/landmarks';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;

inTimeZone(ZONES.london.zone, ZONES.london.offsets);

/** The rounding `engines/metrics.ts` recognises hour rungs with. */
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Four whole 24-hour stints, then one more of `lastSeconds`. */
function nearlyHundredHours(lastSeconds: number): { races: TimelineRaceRow[]; sessions: TimelineSessionRow[] } {
  const races = ['a', 'b', 'c', 'd', 'e'].map((id) => race(id, { hours: 24 }));
  const sessions = races.slice(0, 4).map((r, index) => stint(r, `2026-05-0${2 * index + 2}T12:00`, { from: '0:00', to: '24:00' }));
  sessions.push(stint(races[4]!, '2026-05-11T12:00', { from: '0:00:00', to: `0:00:${lastSeconds}` }));
  return { races, sessions };
}

describe('which metrics history can date', () => {
  it('replays counts and hours, and leaves the rest to the moment they were recorded', () => {
    for (const metric of ['realHours', 'timelineHours', 'realHoursYear:2027', 'sessions', 'storyCompletes',
      'racesStarted', 'racesExperienced', 'stories6h', 'stories24h', 'majorEventStories', 'eventEditions']) {
      expect(isReplayableMilestoneMetric(metric), metric).toBe(true);
    }
    for (const metric of ['racesCompleted', 'championshipsCompleted', 'seasonsCompleted', 'circuits', 'countries',
      'careerXpMillions', 'level', 'realHoursYear:soon']) {
      expect(isReplayableMilestoneMetric(metric), metric).toBe(false);
    }
  });
});

describe('recognition and replay agree', () => {
  it('recognition and replay agree at every HOUR_STEPS rung', () => {
    const hours = MILESTONES.find((def) => def.metric === 'realHours')!.thresholds;
    for (const threshold of hours) {
      const seconds = recognitionThresholdSeconds('realHours', threshold);
      // The app recognises the rung exactly from this many seconds…
      expect(round1(seconds / 3600), `${threshold} h`).toBeGreaterThanOrEqual(threshold);
      // …and not a second before.
      expect(round1((seconds - 1) / 3600), `${threshold} h`).toBeLessThan(threshold);
    }
    expect(recognitionThresholdSeconds('timelineHours', 10)).toBe(10 * H - 180);
  });

  it('crosses a calendar year in whole seconds, and leaves counts as counts', () => {
    expect(recognitionThresholdSeconds('realHoursYear:2027', 100)).toBe(100 * H);
    expect(recognitionThresholdSeconds('storyCompletes', 10)).toBe(10);
  });

  it('the 100-hour crossing is inside the stint that crossed it', () => {
    const { races, sessions } = nearlyHundredHours(5 * H);
    const timeline = career(races, sessions);
    const crossing = timeline.stints[4]!;
    const instant = milestoneInstant(timeline, 'realHours', 100)!;
    expect(instant).toMatchObject({ precision: 'INTERPOLATED', sessionId: crossing.sessionId, raceId: 'e', subjectName: 'e' });
    expect(instant.at.getTime()).toBeGreaterThan(crossing.startsAt.getTime());
    expect(instant.at.getTime()).toBeLessThanOrEqual(crossing.watchedAt.getTime());
    // Three minutes early, as round1 recognises it: 3h57m into the stint.
    expect(instant.at).toEqual(new Date(crossing.startsAt.getTime() + (4 * H - 180) * 1000));
  });

  it('a rung recognised at 99.96 h gets an INTERPOLATED date inside the stint that recognised it', () => {
    // 96 hours, then 3.96 more: 99.96 h in all, which round1 already shows as 100.
    const { races, sessions } = nearlyHundredHours(Math.round(3.96 * H));
    const timeline = career(races, sessions);
    expect(round1(timeline.totalCreditedSeconds / 3600)).toBe(100);
    const last = timeline.stints[4]!;
    const instant = milestoneInstant(timeline, 'realHours', 100)!;
    expect(instant.precision).toBe('INTERPOLATED');
    expect(instant.sessionId).toBe(last.sessionId);
    // 36 seconds before the stint was logged.
    expect(instant.at).toEqual(new Date(last.watchedAt.getTime() - 36_000));
  });

  it('dates nothing the history no longer reaches', () => {
    const { races, sessions } = nearlyHundredHours(H);
    expect(milestoneInstant(career(races, sessions), 'realHours', 100)).toBeNull();
    expect(milestoneInstant(career(races, sessions), 'circuits', 1)).toBeNull();
  });
});

describe('count milestones', () => {
  it('count milestones take the completing stint', () => {
    const a = race('a', { hours: 3 });
    const b = race('b', { hours: 3 });
    const sessions = [
      stint(a, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(b, '2026-05-02T20:00', { from: '0:00', to: '3:00' }),
      stint(a, '2026-05-03T20:00', { from: '2:00', to: '3:00' }),
    ];
    const timeline = career([a, b], sessions);
    expect(milestoneInstant(timeline, 'storyCompletes', 1)).toMatchObject({
      at: localTime('2026-05-02T20:00'), precision: 'STINT', sessionId: sessions[1]!.id, subjectName: 'b',
    });
    expect(milestoneInstant(timeline, 'storyCompletes', 2)?.at).toEqual(localTime('2026-05-03T20:00'));
    expect(milestoneInstant(timeline, 'sessions', 3)?.sessionId).toBe(sessions[2]!.id);
    expect(milestoneInstant(timeline, 'racesStarted', 2)?.raceId).toBe('b');
    expect(milestoneInstant(timeline, 'racesExperienced', 1)?.raceId).toBe('a');
    expect(milestoneInstant(timeline, 'storyCompletes', 3)).toBeNull();
  });

  it('counts a race towards a length only from that length', () => {
    const shortish = race('five', { hours: 5 });
    const redFlagged = race('six', { hours: MASTERY_SHAPE.stories6hMinHours });
    const timeline = career([shortish, redFlagged], [
      stint(shortish, '2026-05-01T20:00', { from: '0:00', to: '5:00' }),
      stint(redFlagged, '2026-05-03T20:00', { from: '0:00', to: '5:30' }),
    ]);
    expect(milestoneInstant(timeline, 'stories6h', 1)?.raceId).toBe('six');
    expect(milestoneInstant(timeline, 'stories12h', 1)).toBeNull();
  });

  it('counts major events only', () => {
    const plain = race('plain', { hours: 1 });
    const major = race('major', { hours: 1, isMajorEvent: true });
    const timeline = career([plain, major], [
      stint(plain, '2026-05-01T20:00', { from: '0:00', to: '1:00' }),
      stint(major, '2026-05-02T20:00', { from: '0:00', to: '1:00' }),
    ]);
    expect(milestoneInstant(timeline, 'majorEventStories', 1)?.raceId).toBe('major');
  });

  it('dates a year of viewing inside that year', () => {
    const lm = race('lm', { hours: 24 });
    const timeline = career([lm], [stint(lm, '2027-01-01T04:00', { from: '0:00', to: '6:00' })]);
    expect(milestoneInstant(timeline, 'realHoursYear:2027', 3)?.at).toEqual(localTime('2027-01-01T03:00'));
    expect(milestoneInstant(timeline, 'realHoursYear:2026', 3)).toBeNull();
  });
});

/** Editions of two events: X over 2024–2026, Y over 2025–2026. */
function twoEvents() {
  const edition = (id: string, key: string, year: number) => race(id, {
    hours: 6, eventKey: key, eventId: `id-${key}`, eventName: key === 'x' ? 'Six Hours of X' : 'Six Hours of Y',
    raceDate: new Date(`${year}-06-01`),
  });
  const races = [edition('x24', 'x', 2024), edition('x25', 'x', 2025), edition('x26', 'x', 2026),
    edition('y25', 'y', 2025), edition('y26', 'y', 2026), edition('y26b', 'y', 2026)];
  const whole = { from: '0:00', to: '6:00' };
  const sessions = [
    stint('x24', '2026-01-10T20:00', whole),
    stint('y25', '2026-01-12T20:00', whole),
    // A second race of 2026 for Y: the same edition, counted once.
    stint('y26b', '2026-01-14T20:00', whole),
    stint('y26', '2026-01-16T20:00', whole),
    stint('x25', '2026-01-18T20:00', whole),
    stint('x26', '2026-01-20T20:00', { from: '0:00', to: '1:00' }),
  ];
  return { races, sessions, timeline: career(races, sessions) };
}

describe('recurring events', () => {
  it('dates the first event with n editions experienced, and names the event', () => {
    const { sessions, timeline } = twoEvents();
    expect(milestoneInstant(timeline, 'eventEditions', 2)).toEqual({
      at: localTime('2026-01-14T20:00'), precision: 'STINT', sessionId: sessions[2]!.id, raceId: 'y26b',
      eventId: 'id-y', subjectName: 'Six Hours of Y',
    });
    expect(milestoneInstant(timeline, 'eventEditions', 3)?.eventId).toBe('id-x');
    expect(milestoneInstant(timeline, 'eventEditions', 4)).toBeNull();
    expect(editionsExperiencedByEvent(timeline)).toEqual(new Map([['x', 3], ['y', 2]]));
  });

  it('dates each Event Legacy step inside its own event', () => {
    const { sessions, timeline } = twoEvents();
    expect(eventStepInstant(timeline, 'x', 'editionsStoryComplete', 2)?.sessionId).toBe(sessions[4]!.id);
    expect(eventStepInstant(timeline, 'x', 'editionsStoryComplete', 3)).toBeNull();
    expect(eventStepInstant(timeline, 'x', 'editionsExperienced', 3)?.sessionId).toBe(sessions[5]!.id);
    expect(eventStepInstant(timeline, 'y', 'editionsStoryComplete', 2)?.sessionId).toBe(sessions[2]!.id);
    // 2024 and 2025 complete in a row, with the 2025 edition.
    expect(eventStepInstant(timeline, 'x', 'consecutiveEditions', 2)?.sessionId).toBe(sessions[4]!.id);
    expect(eventStepInstant(timeline, 'x', 'consecutiveEditions', 3)).toBeNull();
    // Twelve hours of Y by its second stint, recognised three minutes early.
    expect(eventStepInstant(timeline, 'y', 'realHours', 12)).toMatchObject({
      precision: 'INTERPOLATED', sessionId: sessions[2]!.id,
      at: new Date(localTime('2026-01-14T20:00').getTime() - 180_000),
    });
    expect(eventStepInstant(timeline, 'y', 'somethingElse', 1)).toBeNull();
  });
});

describe('a calendar year of credited time', () => {
  it('splits a stint over New Year in whole seconds, both ways alike', () => {
    const lm = race('lm', { hours: 24 });
    const sessions = [
      stint(lm, '2026-12-30T20:00', { from: '0:00', to: '1:00' }),
      stint(lm, '2027-01-01T04:00', { from: '1:00', to: '7:00:07' }),
    ];
    const byYear = creditedSecondsByLocalYear(career([lm], sessions));
    expect(byYear.get(2026)! + byYear.get(2027)!).toBe(H + 6 * H + 7);
    expect(Number.isInteger(byYear.get(2026))).toBe(true);
    expect(byYear.get(2026)).toBe(H + Math.round((6 * H + 7) * ((2 * H + 7) / (6 * H + 7))));
    expect(creditedSecondsByLocalYearOfSessions(sessions)).toEqual(byYear);
  });
});

describe('accepting a replayed date', () => {
  it('never dates a landmark after the moment it was recorded', () => {
    const recognisedAt = localTime('2026-05-01T20:00');
    expect(acceptInstant({ at: localTime('2026-05-01T19:00') }, recognisedAt, 5)).toBe(true);
    expect(acceptInstant({ at: localTime('2026-05-01T20:05') }, recognisedAt, 5)).toBe(true);
    expect(acceptInstant({ at: localTime('2026-05-01T20:06') }, recognisedAt, 5)).toBe(false);
  });
});
