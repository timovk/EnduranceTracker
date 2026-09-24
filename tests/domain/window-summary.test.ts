/**
 * One window of a career, summarised — and two years compared.
 *
 * Runs in London, so every local time below means one clock.
 */

import { describe, expect, it } from 'vitest';
import { CAREER_STATS_SHAPE, DURATION_CLASSES } from '@/lib/config';
import type { CareerTimeline, TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import type { CompareSide } from '@/lib/domain/window-summary';
import { COMPARE_ROW_ORDER, compareSummaries, durationClassOf, summariseWindow } from '@/lib/domain/window-summary';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;
const OPTIONS = {
  weekStartsOn: 1,
  meaningfulSessionSeconds: CAREER_STATS_SHAPE.meaningfulSessionMinutes * 60,
  rateMinimumRaces: CAREER_STATS_SHAPE.rateMinimumRaces,
};

inTimeZone(ZONES.london.zone, ZONES.london.offsets);

describe('race lengths', () => {
  it('a 10-hour race is classed as 10 hours', () => {
    expect(durationClassOf(10 * H)).toEqual({ key: 'h10', label: '10 hours' });
    expect(durationClassOf(9 * H + 50 * 60).key).toBe('h10');
    expect(durationClassOf(3 * H).key).toBe('short');
    expect(durationClassOf(24 * H).key).toBe('h24');
    expect(durationClassOf(20 * H).label).toBe('13 to 20 hours');
    expect(durationClassOf(48 * H).key).toBe(DURATION_CLASSES[DURATION_CLASSES.length - 1].key);
  });
});

describe('a window of a career', () => {
  function season(): { races: TimelineRaceRow[]; sessions: TimelineSessionRow[]; timeline: CareerTimeline } {
    const wec = { championshipId: 'wec', championshipName: 'WEC', championshipAccent: '#c0504d' };
    const races = [
      race('spa', { hours: 6, ...wec, circuit: 'Spa', circuitSlug: 'spa' }),
      race('lm', { hours: 24, ...wec, eventKey: 'le-mans', eventName: '24 Hours of Le Mans', circuitSlug: 'la-sarthe', circuit: 'La Sarthe' }),
      race('glimpse', { hours: 10 }),
    ];
    const sessions = [
      stint('spa', '2026-05-09T22:00', { from: '0:00', to: '3:00' }),
      stint('spa', '2026-05-10T21:00', { from: '3:00', to: '6:00' }),
      stint('lm', '2026-06-13T23:00', { from: '0:00', to: '4:00' }),
      stint('lm', '2026-06-14T23:00', { from: '4:00', to: '8:00', speed: 2 }),
      // Five minutes of something: started, never experienced.
      stint('glimpse', '2026-07-01T20:00', { from: '0:00', to: '0:05' }),
      // A re-watch of Spa's last hour.
      stint('spa', '2026-07-02T21:00', { from: '5:00', to: '6:00' }),
    ];
    return { races, sessions, timeline: career(races, sessions) };
  }

  it('summary totals equal the sum of the monthly rows', () => {
    const summary = summariseWindow(season().timeline, yearWindow(2026), OPTIONS);
    const months = [...summary.months.values()];
    expect(months.reduce((sum, m) => sum + m.creditedSeconds, 0)).toBeCloseTo(summary.creditedSeconds, 6);
    expect(months.reduce((sum, m) => sum + m.sessions, 0)).toBe(summary.sessions);
    expect([...summary.days.values()].reduce((sum, d) => sum + d.newCoverageSeconds, 0)).toBeCloseTo(summary.newCoverageSeconds, 6);
    expect(summary.weekdays.reduce((sum, d) => sum + d.creditedSeconds, 0)).toBeCloseTo(summary.creditedSeconds, 6);
    expect(summary.creditedSeconds).toBeCloseTo(3 * H + 3 * H + 4 * H + 2 * H + 5 * 60 + H, 6);
  });

  it('counts the facts of the window', () => {
    const summary = summariseWindow(season().timeline, yearWindow(2026), OPTIONS);
    expect(summary.sessions).toBe(6);
    expect(summary.racesStarted).toBe(3);
    // The glimpse is started, not experienced.
    expect(summary.racesExperienced).toBe(2);
    expect(summary.storyCompletes).toBe(1);
    expect(summary.storyCompleteList.map((entry) => entry.raceId)).toEqual(['spa']);
    expect(summary.rewatchSeconds).toBeCloseTo(H, 6);
    expect(summary.newCoverageSeconds).toBe(6 * H + 8 * H + 5 * 60);
    expect(summary.championshipsWatched).toBe(1);
    expect(summary.eventsWatched).toBe(1);
    expect(summary.raceIdsWatched).toEqual(['spa', 'lm', 'glimpse']);
    expect(summary.activeFrom).toEqual(localTime('2026-05-09T22:00'));
    expect(summary.longestRace).toEqual({ raceId: 'lm', name: 'lm', runtimeSec: 24 * H });
  });

  it('keeps the longest session and the shortest one that means anything', () => {
    const summary = summariseWindow(season().timeline, null, OPTIONS);
    expect(summary.longestSession).toMatchObject({ raceId: 'lm', creditedSeconds: 4 * H, raceName: 'lm' });
    // The five-minute glimpse is below the ten-minute line.
    expect(summary.shortestMeaningfulSession).toMatchObject({ raceId: 'spa', creditedSeconds: H });
    expect(summary.averageSessionSeconds).toBeCloseTo((13 * H + 5 * 60) / 6, 6);
  });

  it('completion percentage is runtime-weighted', () => {
    const summary = summariseWindow(season().timeline, yearWindow(2026), OPTIONS);
    // 6 of 6 hours, 8 of 24, 5 minutes of 10 hours.
    expect(summary.completionPercent).toBeCloseTo((100 * (6 * H + 8 * H + 5 * 60)) / (40 * H), 9);
    expect(summary.averageRaceCompletionPercent).toBeCloseTo((100 + 100 / 3 + (100 * 5) / 600) / 3, 9);
  });

  it('shares the hours between the groups', () => {
    const summary = summariseWindow(season().timeline, null, OPTIONS);
    expect(summary.byChampionship.map((row) => [row.id, row.name])).toEqual([['wec', 'WEC'], [null, 'Without a championship']]);
    expect(summary.byChampionship.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 12);
    expect(summary.byChampionship[0]).toMatchObject({ racesExperienced: 2, storyCompletes: 1, accent: '#c0504d' });
    expect(summary.byEvent.map((row) => row.id)).toEqual(['le-mans']);
    expect(summary.byCircuit.map((row) => row.id)).toEqual(['spa', 'la-sarthe']);
    expect(summary.byDurationClass.map((row) => row.id)).toEqual(['h6', 'h10', 'h24']);
  });

  it('respects a filter', () => {
    const summary = summariseWindow(season().timeline, null, { ...OPTIONS, include: (r) => r.championshipId === 'wec' });
    expect(summary.raceIdsWatched).toEqual(['spa', 'lm']);
    expect(summary.byChampionship.map((row) => row.id)).toEqual(['wec']);
  });

  it('counts the weekdays of the local calendar', () => {
    const summary = summariseWindow(season().timeline, yearWindow(2026), OPTIONS);
    // Saturday 9 May, Sunday 10 May, Saturday 13 June, Sunday 14 June, then a Wednesday and a Thursday.
    expect(summary.weekdays.map((d) => d.sessions)).toEqual([2, 0, 0, 1, 1, 0, 2]);
  });

  it('only counts time inside the window', () => {
    const summary = summariseWindow(season().timeline, { start: localTime('2026-05-10'), end: localTime('2026-06-01') }, OPTIONS);
    // The Spa stint of 9 May ran 19:00–22:00: none of it is inside.
    expect(summary.creditedSeconds).toBeCloseTo(3 * H, 6);
    expect(summary.sessions).toBe(1);
    expect(summary.activeDays).toBe(1);
  });

  it('a race is experienced and covered only as far as it was by the end of the window', () => {
    // Five minutes of a 6-hour race just before Christmas, the rest of it in
    // January: 2026 saw a glimpse, 2027 saw the race.
    const races = [race('late', { hours: 6 })];
    const sessions = [
      stint('late', '2026-12-20T21:00', { from: '0:00', to: '0:05' }),
      stint('late', '2027-01-09T23:00', { from: '0:05', to: '6:00' }),
    ];
    const timeline = career(races, sessions);

    const glimpse = summariseWindow(timeline, yearWindow(2026), OPTIONS);
    expect(glimpse.racesStarted).toBe(1);
    expect(glimpse.racesExperienced).toBe(0);
    expect(glimpse.longestRace).toBeNull();
    expect(glimpse.completionPercent).toBeCloseTo((100 * 300) / (6 * H), 9);
    expect(glimpse.averageRaceCompletionPercent).toBeCloseTo((100 * 300) / (6 * H), 9);

    const finished = summariseWindow(timeline, yearWindow(2027), OPTIONS);
    expect(finished.racesExperienced).toBe(1);
    expect(finished.longestRace).toEqual({ raceId: 'late', name: 'late', runtimeSec: 6 * H });
    expect(finished.completionPercent).toBe(100);
    expect(finished.averageRaceCompletionPercent).toBe(100);

    const lifetime = summariseWindow(timeline, null, OPTIONS);
    expect(lifetime.racesExperienced).toBe(1);
    expect(lifetime.completionPercent).toBe(100);
  });

  it('the Story Complete rate is of the races started in the window', () => {
    // Five races started in 2026 and finished in 2027: 2027 started none, so it
    // has no rate at all, and 2026's is 0% by the end of 2026.
    const races = ['a', 'b', 'c', 'd', 'e'].map((id) => race(id, { hours: 2 }));
    const sessions = races.flatMap((r, index) => [
      stint(r, `2026-12-0${index + 1}T20:00`, { from: '0:00', to: '1:00' }),
      stint(r, `2027-01-0${index + 1}T20:00`, { from: '1:00', to: '2:00' }),
    ]);
    const timeline = career(races, sessions);
    expect(summariseWindow(timeline, yearWindow(2026), OPTIONS).storyCompleteRate).toBe(0);
    expect(summariseWindow(timeline, yearWindow(2027), OPTIONS).storyCompleteRate).toBeNull();
    expect(summariseWindow(timeline, yearWindow(2027), OPTIONS).storyCompletes).toBe(5);
    expect(summariseWindow(timeline, null, OPTIONS).storyCompleteRate).toBe(100);
  });
});

/** A year of `hours` whole 6-hour races, all started and finished that year. */
function yearOf(year: number, races: number, prefix: string, championshipId = 'wec'): { races: TimelineRaceRow[]; sessions: TimelineSessionRow[] } {
  const rows = Array.from({ length: races }, (_, index) => race(`${prefix}${index}`, {
    hours: 6, championshipId, championshipName: championshipId.toUpperCase(),
  }));
  const sessions = rows.map((row, index) => stint(row, `${year}-03-${String(index + 1).padStart(2, '0')}T21:00`, { from: '0:00', to: '6:00' }));
  return { races: rows, sessions };
}

function side(timeline: CareerTimeline, year: number, extra: Partial<CompareSide> = {}): CompareSide {
  return {
    ...summariseWindow(timeline, yearWindow(year), OPTIONS),
    year,
    xpEarned: 0,
    levelsGained: 0,
    careerBeganInYear: null,
    ...extra,
  };
}

describe('comparing two years', () => {
  function twoYears(racesA: number, racesB: number) {
    const a = yearOf(2026, racesA, 'a');
    const b = yearOf(2027, racesB, 'b');
    return career([...a.races, ...b.races], [...a.sessions, ...b.sessions]);
  }

  it('the rows are exactly COMPARE_ROW_ORDER', () => {
    const timeline = twoYears(2, 3);
    const { rows } = compareSummaries(side(timeline, 2026), side(timeline, 2027));
    expect(rows.map((row) => row.key)).toEqual([...COMPARE_ROW_ORDER]);
    expect(new Set(COMPARE_ROW_ORDER).size).toBe(16);
  });

  it('absolute and relative differences', () => {
    const timeline = twoYears(2, 3);
    const { rows } = compareSummaries(
      side(timeline, 2026, { xpEarned: 20_000 }),
      side(timeline, 2027, { xpEarned: 30_000 }),
    );
    const hours = rows.find((row) => row.key === 'hours')!;
    expect(hours).toMatchObject({ unit: 'seconds', a: 12 * H, b: 18 * H, difference: 6 * H, note: null });
    expect(hours.percentChange).toBeCloseTo(50, 9);
    const xp = rows.find((row) => row.key === 'xp')!;
    expect(xp).toMatchObject({ difference: 10_000, percentChange: 50 });
  });

  it('a session row judges its base on the number of sessions, not on the length of one', () => {
    // Five 6-hour sessions in 2026: no single session reaches the ten-hour base
    // a total needs, yet five of them are enough for a percentage.
    const timeline = twoYears(5, 6);
    const { rows } = compareSummaries(side(timeline, 2026), side(timeline, 2027));
    for (const key of ['averageSession', 'longestSession'] as const) {
      expect(rows.find((row) => row.key === key), key).toMatchObject({
        unit: 'seconds', a: 6 * H, b: 6 * H, difference: 0, percentChange: 0, note: null,
      });
    }
  });

  it('no percentage change on a small base', () => {
    const timeline = twoYears(1, 3);
    const { rows } = compareSummaries(side(timeline, 2026), side(timeline, 2027));
    // Six hours and one session in 2026: the differences stand, the percentages do not.
    for (const key of ['hours', 'sessions', 'storyCompletes', 'averageSession', 'longestSession'] as const) {
      const row = rows.find((candidate) => candidate.key === key)!;
      expect(row.difference, key).not.toBeNull();
      expect(row.percentChange, key).toBeNull();
      expect(row.note, key).toBe('Too little in 2026 for a percentage to mean much');
    }
  });

  it('no percentage change against the year the career began in', () => {
    const timeline = twoYears(4, 4);
    const began = localTime('2026-03-01T15:00');
    const result = compareSummaries(side(timeline, 2026, { careerBeganInYear: began }), side(timeline, 2027));
    expect(result.partialNote).toBe('Your 2026 chapter began on 1 March');
    expect(result.rows.every((row) => row.percentChange === null)).toBe(true);
    expect(result.rows.find((row) => row.key === 'hours')!.difference).toBe(0);
  });

  it('rates need five races in both years', () => {
    const short = compareSummaries(side(twoYears(4, 6), 2026), side(twoYears(4, 6), 2027));
    expect(short.rows.find((row) => row.key === 'storyCompleteRate')).toMatchObject({
      a: null, b: null, difference: null, note: 'A rate needs at least 5 races started in each year',
    });
    const enough = compareSummaries(side(twoYears(5, 6), 2026), side(twoYears(5, 6), 2027));
    expect(enough.rows.find((row) => row.key === 'storyCompleteRate')).toMatchObject({
      unit: 'percent-points', a: 100, b: 100, difference: 0, percentChange: null,
    });
  });

  it('championship shares compare in percentage points', () => {
    const a = yearOf(2026, 2, 'a', 'wec');
    const a2 = yearOf(2026, 2, 'x', 'imsa');
    const b = yearOf(2027, 3, 'b', 'wec');
    const b2 = yearOf(2027, 1, 'y', 'imsa');
    // Second-championship stints a day later in the month, so no two are logged at once.
    const shift = (sessions: TimelineSessionRow[]) => sessions.map((s) => ({ ...s, watchedAt: new Date(s.watchedAt.getTime() + 15 * 86_400_000) }));
    const timeline = career([...a.races, ...a2.races, ...b.races, ...b2.races], [...a.sessions, ...shift(a2.sessions), ...b.sessions, ...shift(b2.sessions)]);
    const { championships } = compareSummaries(side(timeline, 2026), side(timeline, 2027));
    expect(championships.map((row) => [row.id, row.unit, row.a, row.b])).toEqual([
      ['wec', 'percent-points', 50, 75],
      ['imsa', 'percent-points', 50, 25],
    ]);
    expect(championships[0]!.difference).toBeCloseTo(25, 9);

    // Below ten hours in a year, only the hours themselves.
    const small = twoYears(1, 3);
    const hoursOnly = compareSummaries(side(small, 2026), side(small, 2027)).championships;
    expect(hoursOnly).toEqual([expect.objectContaining({ id: 'wec', unit: 'seconds', a: 6 * H, b: 18 * H })]);
  });

  it('lines up the months of the two years', () => {
    const timeline = twoYears(2, 3);
    const { months } = compareSummaries(side(timeline, 2026), side(timeline, 2027));
    expect(months).toHaveLength(12);
    expect(months[2]).toEqual({ month: 3, a: 12 * H, b: 18 * H });
    expect(months[0]).toEqual({ month: 1, a: 0, b: 0 });
  });
});
