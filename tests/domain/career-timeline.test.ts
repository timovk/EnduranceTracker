/**
 * The career replay: coverage, credited time, stint windows and the instants
 * interpolated along them.
 *
 * Runs in London, so the local times written below mean one clock.
 */

import { describe, expect, it } from 'vitest';
import { STORY_CONFIG, XP_CONFIG } from '@/lib/config';
import {
  buildCareerTimeline, compareCanonical, coverageAt, coverageCrossing, creditedSeconds, cumulativeCrossing,
  isRaceExperienced, nthEvent, raceExperiencedEvents, raceStartEvents, replayRace, storyCompleteEvents,
} from '@/lib/domain/career-timeline';
import type { TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import { addInterval, coverageSeconds, mergeIntervals } from '@/lib/domain/intervals';
import { milestoneInstant } from '@/lib/domain/landmarks';
import { xpForSession } from '@/lib/domain/progression';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;
const MINUTE = 60_000;

inTimeZone(ZONES.london.zone, ZONES.london.offsets);

describe('credited seconds', () => {
  it('credited seconds equal XP-credited real time', () => {
    for (const speed of [0.1, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 8]) {
      for (const timeline of [60, 1_799, 2 * H, 24 * H]) {
        const realSeconds = Math.round(timeline / speed);
        const xp = xpForSession({ timelineSeconds: timeline, newCoverageSeconds: timeline, playbackSpeed: speed });
        expect(creditedSeconds({ realSeconds, timelineSeconds: timeline }), `${speed}× over ${timeline}s`)
          .toBe(xp.newRealSeconds + xp.rewatchRealSeconds);
      }
    }
  });

  it('0.5× is credited at 0.75×', () => {
    // Two hours of race at half speed is four hours in the chair, credited as
    // two hours forty: what XP credits.
    expect(creditedSeconds({ realSeconds: 4 * H, timelineSeconds: 2 * H })).toBe(Math.round((2 * H) / XP_CONFIG.xpMinSpeed));
    expect(creditedSeconds({ realSeconds: 4 * H, timelineSeconds: 2 * H })).toBe(9_600);
  });

  it('is the real time at 0.75× and above, and never negative', () => {
    expect(creditedSeconds({ realSeconds: 3_600, timelineSeconds: 5_400 })).toBe(3_600);
    expect(creditedSeconds({ realSeconds: 0, timelineSeconds: 0 })).toBe(0);
    expect(creditedSeconds({ realSeconds: -5, timelineSeconds: 100 })).toBe(0);
  });
});

describe('experienced races', () => {
  it('needs ten credited minutes and a tenth of the race', () => {
    const six = 6 * H;
    expect(isRaceExperienced({ coverageSec: 0.1 * six, runtimeSec: six, creditedSec: 600 })).toBe(true);
    expect(isRaceExperienced({ coverageSec: 0.1 * six - 1, runtimeSec: six, creditedSec: 3_600 })).toBe(false);
    expect(isRaceExperienced({ coverageSec: six, runtimeSec: six, creditedSec: 599 })).toBe(false);
  });

  it('counts an hour of a long race whatever its length', () => {
    expect(isRaceExperienced({ coverageSec: H, runtimeSec: 24 * H, creditedSec: H })).toBe(true);
    expect(isRaceExperienced({ coverageSec: H - 1, runtimeSec: 24 * H, creditedSec: H })).toBe(false);
  });

  it('marks the stint that made a race experienced', () => {
    const lm = race('lm', { hours: 24 });
    const timeline = career([lm], [
      stint(lm, '2026-06-01T20:00', { from: '0:00', to: '0:05' }),
      stint(lm, '2026-06-02T20:00', { from: '0:05', to: '1:00' }),
      stint(lm, '2026-06-03T20:00', { from: '1:00', to: '2:00' }),
    ]);
    const history = timeline.races.get('lm')!;
    expect(history.stints.map((s) => s.experiencesRace)).toEqual([false, true, false]);
    expect(history.experiencedAt).toEqual(localTime('2026-06-02T20:00'));
    expect(raceExperiencedEvents(timeline).map((event) => event.sessionId)).toEqual([history.stints[1]!.sessionId]);
  });
});

describe('coverage', () => {
  it('re-watching adds re-watch time and no coverage', () => {
    const r = race('r', { hours: 6 });
    const timeline = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-02T20:00', { from: '1:00', to: '2:00' }),
    ]);
    const [first, again] = timeline.races.get('r')!.stints;
    expect(first!.addedCoverageSeconds).toBe(2 * H);
    expect(first!.rewatchCreditedSeconds).toBe(0);
    expect(again!.addedCoverageSeconds).toBe(0);
    expect(again!.rewatchCreditedSeconds).toBe(H);
    expect(timeline.races.get('r')!.coverageSeconds).toBe(2 * H);
  });

  it('coverage from fragmented stints equals the merged coverage', () => {
    const r = race('r', { hours: 6 });
    const pieces = [['3:00', '4:00'], ['0:00', '0:40'], ['5:00', '6:00'], ['0:30', '1:30'], ['3:30', '4:10']] as const;
    const sessions = pieces.map(([from, to], index) => stint(r, `2026-05-0${index + 1}T20:00`, { from, to }));
    const history = career([r], sessions).races.get('r')!;
    const merged = mergeIntervals(sessions.map((s) => ({ start: s.startTimestampSec, end: s.endTimestampSec })));
    expect(history.coverageSeconds).toBe(coverageSeconds(merged));
    expect(history.stints.reduce((sum, s) => sum + s.addedCoverageSeconds, 0)).toBe(history.coverageSeconds);
    expect(history.intervals).toEqual(merged);
  });

  it('replay coverage equals the race page coverage for bridged gaps', () => {
    // Two stints 10 seconds apart: the 20-second tolerance Story Complete uses
    // bridges the gap, on the race page and in the replay alike.
    const r = race('r', { hours: 1 });
    const history = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00:00', to: '0:30:00' }),
      stint(r, '2026-05-01T20:40', { from: '0:30:10', to: '1:00:00' }),
    ]).races.get('r')!;
    let page = addInterval([], { start: 0, end: 1_800 }, { limit: H, gapTolerance: STORY_CONFIG.gapToleranceSeconds });
    page = addInterval(page.intervals, { start: 1_810, end: H }, { limit: H, gapTolerance: STORY_CONFIG.gapToleranceSeconds });
    expect(history.coverageSeconds).toBe(coverageSeconds(page.intervals));
    expect(history.coverageSeconds).toBe(H);
  });

  it('reaching the end with gaps is not Story Complete', () => {
    const r = race('r', { hours: 6 });
    const history = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-02T20:00', { from: '3:00', to: '6:00' }),
    ]).races.get('r')!;
    expect(history.coverageSeconds).toBe(5 * H);
    expect(history.storyCompletedAt).toBeNull();
    expect(history.stints.some((s) => s.completesStory)).toBe(false);
  });

  it('dates Story Complete at the stint that completed it, once', () => {
    const r = race('r', { hours: 6 });
    const timeline = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '3:00' }),
      stint(r, '2026-05-02T20:00', { from: '3:00', to: '6:00' }),
      stint(r, '2026-05-03T20:00', { from: '0:00', to: '1:00' }),
    ]);
    const history = timeline.races.get('r')!;
    expect(history.storyCompletedAt).toEqual(localTime('2026-05-02T20:00'));
    expect(history.stints.map((s) => s.completesStory)).toEqual([false, true, false]);
    expect(storyCompleteEvents(timeline)).toHaveLength(1);
  });

  it('clamps coverage to the race’s current runtime', () => {
    // A legacy stint that ran past a runtime later shortened to 6 hours.
    const r = race('r', { hours: 6 });
    const history = career([r], [stint(r, '2026-05-01T20:00', { from: '5:00', to: '7:00' })]).races.get('r')!;
    const only = history.stints[0]!;
    expect(only.addedCoverageSeconds).toBe(H);
    expect(only.timelineInRuntimeSeconds).toBe(H);
    // Timeline past the end is neither coverage nor re-watch.
    expect(only.rewatchCreditedSeconds).toBe(0);
    expect(history.coverageSeconds).toBe(H);
  });

  it('answers coverage at any moment, and when a percentage was crossed', () => {
    const r = race('r', { hours: 10 });
    const history = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-02T20:00', { from: '2:00', to: '5:00' }),
    ]).races.get('r')!;
    expect(coverageAt(history, localTime('2026-05-01T19:59'))).toBe(0);
    expect(coverageAt(history, localTime('2026-05-01T20:00'))).toBe(2 * H);
    expect(coverageAt(history, localTime('2026-06-01'))).toBe(5 * H);
    expect(coverageCrossing(history, 10)?.at).toEqual(localTime('2026-05-01T20:00'));
    expect(coverageCrossing(history, 50)?.sessionId).toBe(history.stints[1]!.sessionId);
    expect(coverageCrossing(history, 51)).toBeNull();
  });
});

describe('the career walk', () => {
  it('orders stints canonically, whatever order they arrive in', () => {
    const a = race('a');
    const same = localTime('2026-05-01T20:00');
    const sessions = [
      stint(a, '2026-05-02T20:00', { from: '1:00', to: '2:00', id: 'late' }),
      stint(a, same, { from: '0:30', to: '1:00', id: 'b', createdAt: '2026-05-01T20:05' }),
      stint(a, same, { from: '0:00', to: '0:30', id: 'a', createdAt: '2026-05-01T20:05' }),
      stint(a, same, { from: '0:00', to: '0:10', id: 'z', createdAt: '2026-05-01T20:01' }),
    ];
    expect([...sessions].sort(compareCanonical).map((s) => s.id)).toEqual(['z', 'a', 'b', 'late']);
    expect(career([a], sessions).stints.map((s) => s.sessionId)).toEqual(['z', 'a', 'b', 'late']);
  });

  it('cuts each window at the previous stint, whatever race it was', () => {
    const a = race('a');
    const b = race('b');
    const timeline = career([a, b], [
      stint(a, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(b, '2026-05-01T21:00', { from: '0:00', to: '2:00' }),
    ]);
    const second = timeline.stints[1]!;
    expect(second.nominalStartsAt).toEqual(localTime('2026-05-01T19:00'));
    expect(second.startsAt).toEqual(localTime('2026-05-01T20:00'));
    // One hour left of two is exactly the reliable share.
    expect(second.windowReliable).toBe(true);
    expect(second.cumulativeCreditedBefore).toBe(2 * H);
    expect(timeline.totalCreditedSeconds).toBe(4 * H);
    expect(timeline.races.get('b')!.startedAt).toEqual(localTime('2026-05-01T20:00'));
  });

  it('places backdated stints by when they were watched', () => {
    const a = race('a');
    const timeline = career([a], [
      stint(a, '2026-09-22T20:00', { from: '1:00', to: '2:00', id: 'now' }),
      stint(a, '2025-07-01T20:00', { from: '0:00', to: '1:00', id: 'backdated' }),
    ]);
    expect(timeline.stints.map((s) => s.sessionId)).toEqual(['backdated', 'now']);
    expect(timeline.stints[0]!.startsRace).toBe(true);
    expect(raceStartEvents(timeline)[0]!.at).toEqual(localTime('2025-07-01T20:00'));
  });

  it('skips a stint whose race is missing, and never throws on nothing', () => {
    const a = race('a');
    const timeline = career([a], [
      stint(a, '2026-05-01T20:00', { from: '0:00', to: '1:00' }),
      stint('gone', '2026-05-02T20:00', { from: '0:00', to: '1:00' }),
    ]);
    expect(timeline.stints).toHaveLength(1);
    const empty = buildCareerTimeline([], []);
    expect(empty.stints).toEqual([]);
    expect(empty.totalCreditedSeconds).toBe(0);
    expect(cumulativeCrossing(empty.stints, H, (s) => s.creditedSeconds)).toBeNull();
  });

  it('keeps every race, watched or not', () => {
    const timeline = career([race('a'), race('b')], []);
    expect(timeline.races.size).toBe(2);
    expect(timeline.races.get('b')!.startedAt).toBeNull();
  });

  it('replays one race on its own the same way', () => {
    const a = race('a', { hours: 10 });
    const b = race('b');
    const sessions = [
      stint(a, '2026-05-01T20:00', { from: '0:00', to: '3:00' }),
      stint(b, '2026-05-02T20:00', { from: '0:00', to: '1:00' }),
      stint(a, '2026-05-03T20:00', { from: '2:00', to: '6:00' }),
    ];
    const alone = replayRace(a, sessions);
    const inCareer = career([a, b], sessions).races.get('a')!;
    expect(alone.coverageSeconds).toBe(inCareer.coverageSeconds);
    expect(alone.sessionCount).toBe(2);
    expect(alone.stints.map((s) => s.addedCoverageSeconds)).toEqual(inCareer.stints.map((s) => s.addedCoverageSeconds));
  });

  it('counts the n-th event from one', () => {
    const a = race('a');
    const b = race('b');
    const timeline = career([a, b], [
      stint(a, '2026-05-01T20:00', { from: '0:00', to: '1:00' }),
      stint(b, '2026-05-02T20:00', { from: '0:00', to: '1:00' }),
    ]);
    const starts = raceStartEvents(timeline);
    expect(nthEvent(starts, 2)).toMatchObject({ raceId: 'b', precision: 'STINT' });
    expect(nthEvent(starts, 3)).toBeNull();
    expect(nthEvent(starts, 0)).toBeNull();
  });
});

/** Four whole days of racing, then a fifth 24-hour stint. */
function hundredHours(): { races: TimelineRaceRow[]; sessions: TimelineSessionRow[] } {
  const races = ['a', 'b', 'c', 'd', 'e'].map((id) => race(id, { hours: 24 }));
  const sessions = races.map((r, index) => stint(r, `2026-05-${String(2 * index + 2).padStart(2, '0')}T12:00`, { from: '0:00', to: '24:00' }));
  return { races, sessions };
}

describe('interpolated instants', () => {
  it('interpolates the instant 100 hours was crossed', () => {
    const { races, sessions } = hundredHours();
    const timeline = career(races, sessions);
    // 96 hours before the fifth stint; four more hours into its window.
    const instant = cumulativeCrossing(timeline.stints, 100 * H, (s) => s.creditedSeconds);
    expect(instant).toEqual({
      at: localTime('2026-05-09T16:00'), precision: 'INTERPOLATED', sessionId: sessions[4]!.id, raceId: 'e',
    });
  });

  it('uses credited seconds for the interpolation', () => {
    // Two hours of race at half speed: four hours in the chair, credited as
    // 2h40m. The window is the credited time, not the four hours.
    const r = race('r');
    const timeline = career([r], [stint(r, '2026-05-01T22:40', { from: '0:00', to: '2:00', speed: 0.5 })]);
    const only = timeline.stints[0]!;
    expect(only.creditedSeconds).toBe(9_600);
    expect(only.startsAt).toEqual(localTime('2026-05-01T20:00'));
    expect(cumulativeCrossing(timeline.stints, 4_800, (s) => s.creditedSeconds)?.at).toEqual(localTime('2026-05-01T21:20'));
  });

  it('the year rung is interpolated inside the part of the stint in that year', () => {
    // Six hours of racing from 22:00 on 31 December to 04:00 on 1 January.
    const lm = race('lm', { hours: 24 });
    const timeline = career([lm], [stint(lm, '2027-01-01T04:00', { from: '0:00', to: '6:00' })]);
    const inNewYear = cumulativeCrossing(timeline.stints, 2 * H, (s) => s.creditedSeconds, yearWindow(2027));
    expect(inNewYear).toMatchObject({ at: localTime('2027-01-01T02:00'), precision: 'INTERPOLATED' });
    const inOldYear = cumulativeCrossing(timeline.stints, H, (s) => s.creditedSeconds, yearWindow(2026));
    expect(inOldYear?.at).toEqual(localTime('2026-12-31T23:00'));
    // Only two hours of it fell in 2026.
    expect(cumulativeCrossing(timeline.stints, 2 * H + 1, (s) => s.creditedSeconds, yearWindow(2026))).toBeNull();
  });

  it('two stints logged a minute apart never date a later threshold before an earlier one', () => {
    const r = race('r', { hours: 24 });
    const timeline = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-01T20:01', { from: '2:00', to: '4:00' }),
    ]);
    const first = cumulativeCrossing(timeline.stints, H, (s) => s.creditedSeconds)!;
    const second = cumulativeCrossing(timeline.stints, 3 * H, (s) => s.creditedSeconds)!;
    expect(first.at).toEqual(localTime('2026-05-01T19:00'));
    expect(second.at.getTime()).toBeGreaterThanOrEqual(first.at.getTime());
    expect(second.at).toEqual(localTime('2026-05-01T20:01'));
  });

  it('a batch-logged stint’s crossing is STINT, not INTERPOLATED', () => {
    const r = race('r', { hours: 24 });
    const timeline = career([r], [
      stint(r, '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint(r, '2026-05-01T20:01', { from: '2:00', to: '4:00' }),
    ]);
    const batch = timeline.stints[1]!;
    expect(batch.windowReliable).toBe(false);
    expect(batch.startsAt).toEqual(localTime('2026-05-01T20:00'));
    expect(cumulativeCrossing(timeline.stints, 3 * H, (s) => s.creditedSeconds)).toMatchObject({
      precision: 'STINT', sessionId: batch.sessionId,
    });
  });

  it('milestone instants are monotone in threshold for random logs', () => {
    // A seeded generator, so a failure can be replayed exactly.
    let seed = 20260924;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    for (let round = 0; round < 25; round += 1) {
      const races = Array.from({ length: 4 }, (_, index) => race(`r${index}`, { hours: [3, 6, 12, 24][index]! }));
      const sessions: TimelineSessionRow[] = [];
      let clock = localTime('2026-01-01T18:00').getTime();
      for (let index = 0; index < 40; index += 1) {
        const r = races[Math.floor(next() * races.length)]!;
        const startSec = Math.floor(next() * (r.runtimeSec - 600));
        const endSec = Math.min(r.runtimeSec, startSec + 300 + Math.floor(next() * 3 * H));
        // Mostly an evening apart, sometimes batch-logged a minute later.
        clock += next() < 0.3 ? MINUTE : Math.floor(next() * 3 * 24 * 60) * MINUTE;
        const speed = [0.5, 1, 1, 1.5, 2][Math.floor(next() * 5)]!;
        sessions.push(stint(r, new Date(clock), { from: `0:00:${startSec}`, to: `0:00:${endSec}`, speed }));
      }
      const timeline = career(races, sessions);
      let previous = -Infinity;
      for (let hours = 1; hours * H <= timeline.totalCreditedSeconds; hours += 1) {
        const instant = milestoneInstant(timeline, 'realHours', hours);
        expect(instant, `round ${round}, ${hours} h`).not.toBeNull();
        expect(instant!.at.getTime(), `round ${round}, ${hours} h`).toBeGreaterThanOrEqual(previous);
        previous = instant!.at.getTime();
      }
    }
  });
});
