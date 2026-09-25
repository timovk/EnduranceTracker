/**
 * Watched-interval arithmetic.
 *
 * These are the tests that matter most in the application: if interval merging
 * is wrong, every completion figure, every XP award and every collection is
 * wrong with it.
 */

import { describe, expect, it } from 'vitest';
import {
  addInterval, clampIntervals, coverageRatio, coverageSeconds, fromRows, furthestPoint, gapsIn,
  isStoryComplete, largestGap, mergeIntervals, newCoverageOf, normalizeInterval,
  resumePoint, subtract,
} from '@/lib/domain/intervals';

const H = 3600;

describe('normalizeInterval', () => {
  it('orders reversed bounds', () => {
    expect(normalizeInterval({ start: 500, end: 100 })).toEqual({ start: 100, end: 500 });
  });

  it('rejects zero-length intervals', () => {
    expect(normalizeInterval({ start: 100, end: 100 })).toBeNull();
  });

  it('clamps to the race runtime', () => {
    expect(normalizeInterval({ start: 100, end: 9999 }, 5000)).toEqual({ start: 100, end: 5000 });
  });

  it('never produces a negative start', () => {
    expect(normalizeInterval({ start: -50, end: 100 })).toEqual({ start: 0, end: 100 });
  });

  it('collapses an interval entirely beyond the runtime', () => {
    expect(normalizeInterval({ start: 6000, end: 7000 }, 5000)).toBeNull();
  });
});

describe('clampIntervals', () => {
  it('cuts a set at the runtime, dropping what lies wholly past it', () => {
    // A race shortened to six hours after 0:00-1:00, 2:00-7:00 and 7:30-8:00
    // were watched: five hours of it are covered, not six and a half.
    const stored = [{ start: 0, end: H }, { start: 2 * H, end: 7 * H }, { start: 7.5 * H, end: 8 * H }];
    const clamped = clampIntervals(stored, 6 * H);
    expect(clamped).toEqual([{ start: 0, end: H }, { start: 2 * H, end: 6 * H }]);
    expect(coverageSeconds(clamped)).toBe(5 * H);
  });

  it('leaves a set inside the runtime as it was', () => {
    const inside = [{ start: 0, end: H }, { start: 2 * H, end: 3 * H }];
    expect(clampIntervals(inside, 6 * H)).toEqual(inside);
  });
});

describe('mergeIntervals', () => {
  it('merges overlapping intervals', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 50, end: 200 }]))
      .toEqual([{ start: 0, end: 200 }]);
  });

  it('merges exactly adjacent intervals', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 100, end: 200 }]))
      .toEqual([{ start: 0, end: 200 }]);
  });

  it('keeps genuinely separate intervals apart', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 500, end: 600 }]))
      .toEqual([{ start: 0, end: 100 }, { start: 500, end: 600 }]);
  });

  it('absorbs a fully contained interval', () => {
    expect(mergeIntervals([{ start: 0, end: 1000 }, { start: 200, end: 300 }]))
      .toEqual([{ start: 0, end: 1000 }]);
  });

  it('is order independent', () => {
    const a = mergeIntervals([{ start: 500, end: 600 }, { start: 0, end: 100 }, { start: 90, end: 520 }]);
    const b = mergeIntervals([{ start: 0, end: 100 }, { start: 90, end: 520 }, { start: 500, end: 600 }]);
    expect(a).toEqual(b);
    expect(a).toEqual([{ start: 0, end: 600 }]);
  });

  it('closes gaps within the tolerance but not beyond it', () => {
    const near = [{ start: 0, end: 100 }, { start: 110, end: 200 }];
    expect(mergeIntervals(near, 20)).toEqual([{ start: 0, end: 200 }]);
    expect(mergeIntervals(near, 5)).toEqual(near);
  });

  it('handles a large unsorted set without losing coverage', () => {
    const pieces = Array.from({ length: 200 }, (_, i) => ({ start: i * 50, end: i * 50 + 30 }));
    const shuffled = [...pieces].reverse();
    expect(coverageSeconds(shuffled)).toBe(200 * 30);
    expect(mergeIntervals(shuffled)).toHaveLength(200);
  });

  it('does not mutate its input', () => {
    const input = [{ start: 0, end: 100 }, { start: 50, end: 200 }];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeIntervals(input);
    expect(input).toEqual(snapshot);
  });
});

describe('addInterval — the re-watch rule', () => {
  it('counts wholly new timeline as new coverage', () => {
    const result = addInterval([], { start: 0, end: 3600 });
    expect(result.addedSeconds).toBe(3600);
    expect(coverageSeconds(result.intervals)).toBe(3600);
  });

  it('adds no coverage when re-watching a section already seen', () => {
    // The worked example from the specification: watch 00:00-01:00, then
    // re-watch 00:30-01:00. Real viewing time is 1h30m; unique coverage is 1h.
    const first = addInterval([], { start: 0, end: H });
    const second = addInterval(first.intervals, { start: 1800, end: H });

    expect(second.addedSeconds).toBe(0);
    expect(coverageSeconds(second.intervals)).toBe(H);
  });

  it('credits only the genuinely new part of a partial overlap', () => {
    const first = addInterval([], { start: 0, end: H });
    const second = addInterval(first.intervals, { start: 1800, end: H + 1800 });

    expect(second.addedSeconds).toBe(1800);
    expect(coverageSeconds(second.intervals)).toBe(H + 1800);
  });

  it('is idempotent: logging the same interval twice adds nothing the second time', () => {
    const once = addInterval([], { start: 100, end: 900 });
    const twice = addInterval(once.intervals, { start: 100, end: 900 });
    expect(twice.addedSeconds).toBe(0);
    expect(coverageSeconds(twice.intervals)).toBe(coverageSeconds(once.intervals));
  });

  it('clamps additions to the race runtime', () => {
    // A replay that runs past the chequered flag must not be able to push
    // coverage beyond 100% of the race.
    const result = addInterval([], { start: 0, end: 7 * H }, { limit: 6 * H });
    expect(result.addedSeconds).toBe(6 * H);
    expect(coverageSeconds(result.intervals)).toBe(6 * H);
  });

  it('fills a gap exactly, joining two islands', () => {
    const base = [{ start: 0, end: 1000 }, { start: 2000, end: 3000 }];
    const result = addInterval(base, { start: 1000, end: 2000 });
    expect(result.addedSeconds).toBe(1000);
    expect(result.intervals).toEqual([{ start: 0, end: 3000 }]);
  });

  it('accumulates correctly over many overlapping sessions', () => {
    let intervals: { start: number; end: number }[] = [];
    let totalNew = 0;
    const sessions = [
      { start: 0, end: 1200 }, { start: 900, end: 2400 }, { start: 3000, end: 3600 },
      { start: 0, end: 600 }, { start: 2400, end: 3000 }, { start: 3600, end: 5400 },
    ];
    for (const session of sessions) {
      const result = addInterval(intervals, session);
      intervals = result.intervals;
      totalNew += result.addedSeconds;
    }
    // Total new coverage must equal final coverage — no double counting.
    expect(totalNew).toBe(coverageSeconds(intervals));
    expect(coverageSeconds(intervals)).toBe(5400);
  });
});

describe('newCoverageOf', () => {
  it('agrees with addInterval', () => {
    const existing = [{ start: 0, end: 1000 }, { start: 2000, end: 3000 }];
    const incoming = { start: 500, end: 2500 };
    expect(newCoverageOf(existing, incoming)).toBe(addInterval(existing, incoming).addedSeconds);
  });

  it('is zero for a fully covered incoming interval', () => {
    expect(newCoverageOf([{ start: 0, end: 5000 }], { start: 1000, end: 2000 })).toBe(0);
  });
});

describe('subtract and gaps', () => {
  it('finds the hole left by a skipped section', () => {
    const watched = [{ start: 0, end: 6197 }, { start: 10964, end: 6 * H }];
    const gaps = gapsIn(watched, 6 * H);
    expect(gaps).toEqual([{ start: 6197, end: 10964 }]);
    expect(largestGap(watched, 6 * H)).toBe(10964 - 6197);
  });

  it('returns nothing for fully watched races', () => {
    expect(gapsIn([{ start: 0, end: 6 * H }], 6 * H)).toEqual([]);
  });

  it('returns the whole race when nothing has been watched', () => {
    expect(gapsIn([], 6 * H)).toEqual([{ start: 0, end: 6 * H }]);
  });

  it('subtracts a set spanning several pieces', () => {
    expect(subtract([{ start: 0, end: 1000 }], [{ start: 200, end: 300 }, { start: 600, end: 700 }]))
      .toEqual([{ start: 0, end: 200 }, { start: 300, end: 600 }, { start: 700, end: 1000 }]);
  });

  it('handles a subtrahend that covers everything', () => {
    expect(subtract([{ start: 100, end: 200 }], [{ start: 0, end: 1000 }])).toEqual([]);
  });
});

describe('furthestPoint vs coverage — why a high-water mark is not enough', () => {
  it('distinguishes a skipped race from a fully watched one', () => {
    const skipped = [{ start: 0, end: H }, { start: 5 * H, end: 6 * H }];
    const complete = [{ start: 0, end: 6 * H }];

    // The furthest point reached is identical...
    expect(furthestPoint(skipped)).toBe(furthestPoint(complete));
    // ...but the coverage is not, which is the entire point.
    expect(coverageSeconds(skipped)).toBe(2 * H);
    expect(coverageSeconds(complete)).toBe(6 * H);
  });
});

describe('resumePoint', () => {
  it('points at the first unwatched gap, not the furthest point', () => {
    const watched = [{ start: 0, end: H }, { start: 3 * H, end: 4 * H }];
    expect(resumePoint(watched, 6 * H)).toBe(H);
  });

  it('points at the end once everything before it is watched', () => {
    expect(resumePoint([{ start: 0, end: 2 * H }], 6 * H)).toBe(2 * H);
  });

  it('starts at zero for an unwatched race', () => {
    expect(resumePoint([], 6 * H)).toBe(0);
  });

  it('never exceeds the runtime for a complete race', () => {
    expect(resumePoint([{ start: 0, end: 6 * H }], 6 * H)).toBe(6 * H);
  });
});

describe('isStoryComplete', () => {
  const thresholds = { coverageRatio: 0.995, maxUncoveredSeconds: 120 };

  it('unlocks on a fully watched race', () => {
    expect(isStoryComplete([{ start: 0, end: 6 * H }], 6 * H, thresholds)).toBe(true);
  });

  it('tolerates a few missing seconds of podium footage', () => {
    expect(isStoryComplete([{ start: 0, end: 6 * H - 30 }], 6 * H, thresholds)).toBe(true);
  });

  it('does not unlock when a section in the middle was skipped', () => {
    const skipped = [{ start: 0, end: 2 * H }, { start: 3 * H, end: 6 * H }];
    expect(isStoryComplete(skipped, 6 * H, thresholds)).toBe(false);
  });

  it('unlocks once the user goes back and watches the skipped section', () => {
    const repaired = [{ start: 0, end: 2 * H }, { start: 2 * H, end: 3 * H }, { start: 3 * H, end: 6 * H }];
    expect(isStoryComplete(repaired, 6 * H, thresholds)).toBe(true);
  });

  it('refuses a 24-hour race missing more than the absolute allowance', () => {
    // 99.6% of 24 hours still leaves nearly six minutes unseen. The ratio alone
    // would pass it; the absolute cap is what stops it.
    const covered = 24 * H * 0.996;
    expect(covered / (24 * H)).toBeGreaterThan(thresholds.coverageRatio);
    expect(isStoryComplete([{ start: 0, end: covered }], 24 * H, thresholds)).toBe(false);
  });

  it('never unlocks on an empty timeline', () => {
    expect(isStoryComplete([], 6 * H, thresholds)).toBe(false);
  });

  it('never unlocks for a zero-length race', () => {
    expect(isStoryComplete([{ start: 0, end: 100 }], 0, thresholds)).toBe(false);
  });

  it('watching highlights does not count', () => {
    // Six scattered five-minute highlights of a six-hour race.
    const highlights = Array.from({ length: 6 }, (_, i) => ({ start: i * H, end: i * H + 300 }));
    expect(coverageRatio(highlights, 6 * H)).toBeCloseTo(0.083, 2);
    expect(isStoryComplete(highlights, 6 * H, thresholds)).toBe(false);
  });
});

describe('fromRows', () => {
  it('merges database rows into a canonical set', () => {
    expect(fromRows([{ startSec: 50, endSec: 200 }, { startSec: 0, endSec: 100 }]))
      .toEqual([{ start: 0, end: 200 }]);
  });

  it('returns an empty set for no rows', () => {
    expect(fromRows([])).toEqual([]);
  });
});
