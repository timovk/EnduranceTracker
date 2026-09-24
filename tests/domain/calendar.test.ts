/**
 * The local-time calendar: days, weeks, months and years by the computer's
 * own clock.
 *
 * Every block runs in a named time zone (the offsets are checked first), and
 * every date is built inside the test, after the zone has been switched.
 */

import { describe, expect, it } from 'vitest';
import {
  clipToWindow, dayKeyToLocalDate, daysInYear, isLeapYear, localDayKey, localMonthKey, localTimeZoneName,
  monthWindow, samePeriodEnd, splitAcrossLocalDays, weekKeyForDay, weekLabel, yearWindow,
} from '@/lib/domain/calendar';
import { viewingWeek } from '@/lib/domain/periods';
import { summariseWindow } from '@/lib/domain/window-summary';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;
const OPTIONS = { weekStartsOn: 1, meaningfulSessionSeconds: 600, rateMinimumRaces: 5 };

describe('the calendar in London', () => {
  inTimeZone(ZONES.london.zone, ZONES.london.offsets);

  it('names the zone the chapters follow', () => {
    expect(localTimeZoneName()).toBe('Europe/London');
  });

  it('keys days and months from local parts', () => {
    const at = localTime('2026-07-01T00:30');
    expect(localDayKey(at)).toBe('2026-07-01');
    expect(localMonthKey(at)).toBe('2026-07');
    // In UTC it is still 30 June: the local day is the one the user lived.
    expect(at.toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(dayKeyToLocalDate('2026-07-01').getTime()).toBe(localTime('2026-07-01').getTime());
  });

  it('builds year and month windows at local midnight', () => {
    expect(yearWindow(2026)).toEqual({ start: localTime('2026-01-01'), end: localTime('2027-01-01') });
    expect(monthWindow(2026, 12)).toEqual({ start: localTime('2026-12-01'), end: localTime('2027-01-01') });
    expect(monthWindow(2028, 2).end.getTime() - monthWindow(2028, 2).start.getTime()).toBe(29 * 24 * H * 1000);
  });

  it('splits a stint across local midnight on 31 December into both years', () => {
    const slices = splitAcrossLocalDays(localTime('2026-12-31T23:00'), localTime('2027-01-01T01:00'));
    expect(slices).toEqual([
      { dayKey: '2026-12-31', fraction: 0.5 },
      { dayKey: '2027-01-01', fraction: 0.5 },
    ]);
  });

  it('puts a zero-length window on the day of its instant', () => {
    const at = localTime('2026-12-31T23:59');
    expect(splitAcrossLocalDays(at, at)).toEqual([{ dayKey: '2026-12-31', fraction: 1 }]);
  });

  it('gives every slice of a long window a share that sums to exactly one', () => {
    const slices = splitAcrossLocalDays(localTime('2026-03-01T07:13'), localTime('2026-03-03T19:41'));
    expect(slices.map((slice) => slice.dayKey)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(slices.reduce((sum, slice) => sum + slice.fraction, 0)).toBe(1);
  });

  it('a DST day splits into 23 and 25 hours correctly', () => {
    // 29 March 2026 has 23 hours in London; 25 October 2026 has 25.
    const spring = splitAcrossLocalDays(localTime('2026-03-28T12:00'), localTime('2026-03-30T12:00'));
    const springTotal = 12 + 23 + 12;
    expect(spring.map((slice) => slice.dayKey)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(spring[1]!.fraction).toBeCloseTo(23 / springTotal, 12);

    const autumn = splitAcrossLocalDays(localTime('2026-10-24T12:00'), localTime('2026-10-26T12:00'));
    const autumnTotal = 12 + 25 + 12;
    expect(autumn[1]!.fraction).toBeCloseTo(25 / autumnTotal, 12);
    expect(autumn[0]!.fraction).toBeCloseTo(12 / autumnTotal, 12);
  });

  it('29 February is a day of its own in 2028', () => {
    const slices = splitAcrossLocalDays(localTime('2028-02-28T22:00'), localTime('2028-03-01T02:00'));
    expect(slices.map((slice) => slice.dayKey)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(slices[1]!.fraction).toBeCloseTo(24 / 28, 12);
  });

  it('a leap year has 366 day buckets', () => {
    const year = yearWindow(2028);
    const days = new Set(splitAcrossLocalDays(year.start, year.end).map((slice) => slice.dayKey));
    expect(days.size).toBe(366);
    expect(daysInYear(2028)).toBe(366);
    expect(daysInYear(2027)).toBe(365);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });

  it('samePeriodEnd maps 29 February to 28 February', () => {
    expect(samePeriodEnd(2027, localTime('2028-02-29T10:15'))).toEqual(new Date(2027, 1, 28, 23, 59, 59, 999));
    expect(samePeriodEnd(2032, localTime('2028-02-29T10:15'))).toEqual(localTime('2032-02-29T10:15'));
    expect(samePeriodEnd(2025, localTime('2026-09-24T21:30:15'))).toEqual(localTime('2025-09-24T21:30:15'));
  });

  it('clips a window to the part inside it', () => {
    const window = yearWindow(2027);
    const clipped = clipToWindow(localTime('2026-12-31T23:00'), localTime('2027-01-01T03:00'), window);
    expect(clipped).toEqual({ startsAt: localTime('2027-01-01'), endsAt: localTime('2027-01-01T03:00'), fraction: 0.75 });
    expect(clipToWindow(localTime('2026-12-30T10:00'), localTime('2026-12-30T12:00'), window)).toBeNull();
    // A zero-length window is inside when its instant is; the end is excluded.
    const instant = localTime('2027-01-01');
    expect(clipToWindow(instant, instant, window)?.fraction).toBe(1);
    expect(clipToWindow(window.end, window.end, window)).toBeNull();
  });

  it('keys weeks exactly as the budget does', () => {
    for (const weekStartsOn of [0, 1, 6]) {
      for (const key of ['2026-12-27', '2026-12-31', '2027-01-03', '2027-01-04', '2028-02-29']) {
        expect(weekKeyForDay(key, weekStartsOn)).toBe(viewingWeek(dayKeyToLocalDate(key), weekStartsOn).key);
      }
    }
    const memo = new Map<string, string>();
    expect(weekKeyForDay('2026-12-31', 1, memo)).toBe(weekKeyForDay('2026-12-31', 1, memo));
    expect(memo.size).toBe(1);
  });

  it('labels a week, and clips one that straddles New Year to the days in the year', () => {
    const key = weekKeyForDay('2026-12-29', 1);
    expect(weekLabel(key, 1)).toMatchObject({ label: 'Mon 28 Dec – Sun 3 Jan', clipped: false });

    const clipped = weekLabel(key, 1, yearWindow(2026));
    expect(clipped).toEqual({
      label: 'Mon 28 – Thu 31 Dec', start: localTime('2026-12-28'), end: localTime('2027-01-01'), clipped: true,
    });

    // A Sunday week start moves the whole week.
    const sunday = weekKeyForDay('2026-12-29', 0);
    expect(weekLabel(sunday, 0).label).toBe('Sun 27 Dec – Sat 2 Jan');
    expect(weekLabel(sunday, 0, yearWindow(2027))).toMatchObject({ label: 'Fri 1 – Sat 2 Jan', clipped: true });
  });
});

describe('a stint on New Year’s Eve', () => {
  inTimeZone(ZONES.london.zone, ZONES.london.offsets);

  it('attributes a stint’s facts to the year of its watchedAt', () => {
    // Two hours of racing, 23:30 on 31 December to 01:30 on 1 January.
    const lm = race('lm', { hours: 24 });
    const timeline = career([lm], [stint(lm, '2027-01-01T01:30', { from: '0:00', to: '2:00' })]);
    const old = summariseWindow(timeline, yearWindow(2026), OPTIONS);
    const next = summariseWindow(timeline, yearWindow(2027), OPTIONS);

    // Its hours are shared by the two years…
    expect(old.creditedSeconds).toBeCloseTo(0.5 * H, 6);
    expect(next.creditedSeconds).toBeCloseTo(1.5 * H, 6);
    // …but the stint itself, and the race it started, belong to the year it
    // was logged in.
    expect(old.sessions).toBe(0);
    expect(next.sessions).toBe(1);
    expect(old.racesStarted).toBe(0);
    expect(next.racesStarted).toBe(1);
  });
});

describe('the same instant around the world', () => {
  describe('in Auckland', () => {
    inTimeZone(ZONES.auckland.zone, ZONES.auckland.offsets);

    it('the same instant falls in different local years in Auckland and Los Angeles', () => {
      const instant = new Date('2026-12-31T12:00:00Z');
      // 01:00 on 1 January 2027 in Auckland.
      expect(localDayKey(instant)).toBe('2027-01-01');
      const lm = race('lm', { hours: 24 });
      const timeline = career([lm], [stint(lm, instant, { from: '0:00', to: '0:30' })]);
      expect(summariseWindow(timeline, yearWindow(2027), OPTIONS).sessions).toBe(1);
      expect(summariseWindow(timeline, yearWindow(2026), OPTIONS).sessions).toBe(0);
    });
  });

  describe('in Los Angeles', () => {
    inTimeZone(ZONES.losAngeles.zone, ZONES.losAngeles.offsets);

    it('the same instant falls in different local years in Auckland and Los Angeles', () => {
      const instant = new Date('2026-12-31T12:00:00Z');
      // 04:00 on 31 December 2026 in Los Angeles.
      expect(localDayKey(instant)).toBe('2026-12-31');
      const lm = race('lm', { hours: 24 });
      const timeline = career([lm], [stint(lm, instant, { from: '0:00', to: '0:30' })]);
      expect(summariseWindow(timeline, yearWindow(2026), OPTIONS).sessions).toBe(1);
      expect(summariseWindow(timeline, yearWindow(2027), OPTIONS).sessions).toBe(0);
    });
  });
});
