/**
 * Race dates (0.3.2).
 *
 * The date field stores the typed day at midnight UTC, and "today" is the
 * local calendar day. The two only agree by accident in UTC, which is where
 * the tests normally run — so every rule here is also checked west and east
 * of Greenwich, where reading the stored date in local time would put the race
 * on the wrong day.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isRaceDayAhead, isStillToCome, raceDayStart } from '@/lib/domain/race-day';
import { summariseStillToCome, type RaceCandidate } from '@/lib/engines/strategist-engine';
import { raceInputSchema } from '@/lib/validation/schemas';
import { formatDate } from '@/lib/utils';

/** Exactly what the add-race form stores for a typed date. */
function storedRaceDate(isoDay: string): Date {
  const parsed = raceInputSchema.parse({ name: 'Any race', raceDate: isoDay, scheduledDuration: '06:00:00' });
  if (parsed.raceDate === null) throw new Error('the schema dropped the race date');
  return parsed.raceDate;
}

/** An unwatched race the strategist would otherwise suggest, dated `isoDay`. */
function datedCandidate(id: string, isoDay: string): RaceCandidate {
  return {
    id, name: id, championshipId: null, championshipName: null, championshipColor: null,
    seasonId: null, seasonLabel: null, circuit: null, runtimeSec: 6 * 3600, coverageSec: 0,
    status: 'UNWATCHED', priority: 'NORMAL', excitement: 3, isMajorEvent: false, storyComplete: false,
    raceDate: storedRaceDate(isoDay), sessionCount: 0, lastWatchedAt: null,
    gaps: [{ start: 0, end: 6 * 3600 }], avgPlaybackSpeed: null, seasonRaceCount: 0, seasonRacesRemaining: 0,
  };
}

const ZONES = ['UTC', 'Europe/Amsterdam', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

describe.each(ZONES)('in %s', (zone) => {
  const original = process.env.TZ;
  beforeAll(() => { process.env.TZ = zone; });
  afterAll(() => {
    // Assigning undefined would set the string "undefined", not the host zone.
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('runs in the zone it says it does', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone === 'UTC' ? 'UTC' : zone);
  });

  it('treats a race as ahead until local midnight on its race day', () => {
    const race = storedRaceDate('2026-11-07');
    expect(isRaceDayAhead(race, new Date(2026, 10, 6, 0, 0, 0))).toBe(true);
    expect(isRaceDayAhead(race, new Date(2026, 10, 6, 23, 59, 59, 999))).toBe(true);
    expect(isRaceDayAhead(race, new Date(2026, 10, 7, 0, 0, 0))).toBe(false);
    expect(isRaceDayAhead(race, new Date(2026, 10, 7, 23, 59))).toBe(false);
    expect(isRaceDayAhead(race, new Date(2026, 10, 8, 9))).toBe(false);
  });

  it('crosses month and year ends the right way round', () => {
    expect(isRaceDayAhead(storedRaceDate('2027-01-01'), new Date(2026, 11, 31, 23, 59))).toBe(true);
    expect(isRaceDayAhead(storedRaceDate('2027-01-01'), new Date(2027, 0, 1, 0, 0))).toBe(false);
    expect(isRaceDayAhead(storedRaceDate('2026-10-01'), new Date(2026, 8, 30, 22))).toBe(true);
    expect(isRaceDayAhead(storedRaceDate('2026-09-30'), new Date(2026, 9, 1, 1))).toBe(false);
  });

  it('shows the race day as the day that was typed', () => {
    const day = raceDayStart(storedRaceDate('2026-11-07'));
    expect(day).toEqual(new Date(2026, 10, 7));
    expect(formatDate(day, 'long')).toBe('7 November 2026');
  });

  it('gives the strategist the typed day as the first race day', () => {
    const summary = summariseStillToCome(
      [datedCandidate('later', '2027-06-12'), datedCandidate('first', '2026-11-07')],
      new Date(2026, 8, 24, 20),
    );
    expect(summary.count).toBe(2);
    expect(formatDate(summary.nextRaceDay, 'long')).toBe('7 November 2026');
  });
});

describe('isRaceDayAhead', () => {
  it('is false when there is no date, or one that cannot be read', () => {
    expect(isRaceDayAhead(null, new Date(2026, 8, 24))).toBe(false);
    expect(isRaceDayAhead(new Date(Number.NaN), new Date(2026, 8, 24))).toBe(false);
  });
});

describe('isStillToCome', () => {
  // Built per test, in the zone the test runs in.
  let now: Date;
  beforeEach(() => { now = new Date(2026, 8, 24, 20); });

  it('is true for a race dated after today with no stint logged', () => {
    expect(isStillToCome({ raceDate: storedRaceDate('2026-11-07'), sessionCount: 0 }, now)).toBe(true);
  });

  it('is false once a stint has been logged, whatever the date says', () => {
    expect(isStillToCome({ raceDate: storedRaceDate('2026-11-07'), sessionCount: 1 }, now)).toBe(false);
  });

  it('is false for a race dated today, in the past, or not dated at all', () => {
    expect(isStillToCome({ raceDate: storedRaceDate('2026-09-24'), sessionCount: 0 }, now)).toBe(false);
    expect(isStillToCome({ raceDate: storedRaceDate('2026-06-13'), sessionCount: 0 }, now)).toBe(false);
    expect(isStillToCome({ raceDate: null, sessionCount: 0 }, now)).toBe(false);
  });
});

describe('raceDayStart', () => {
  it('is null when there is no date', () => {
    expect(raceDayStart(null)).toBeNull();
    expect(raceDayStart(new Date(Number.NaN))).toBeNull();
  });
});
