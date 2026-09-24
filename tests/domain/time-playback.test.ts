/**
 * Timestamp parsing and the real-time / timeline-time distinction.
 */

import { describe, expect, it } from 'vitest';
import {
  formatCoveragePercent, formatDuration, formatHoursMinutes, formatTimestamp, hoursToSeconds,
  parseTimestamp, TimeParseError, toHours, tryParseTimestamp,
} from '@/lib/domain/time';
import { isStoryComplete } from '@/lib/domain/intervals';
import { STORY_CONFIG } from '@/lib/config';
import {
  averagePlaybackSpeed, clampSpeed, estimateRemaining, realSecondsFor,
  suggestStints, timelineSecondsFor,
} from '@/lib/domain/playback';

const H = 3600;

describe('parseTimestamp', () => {
  it('parses HH:MM:SS', () => {
    expect(parseTimestamp('02:47:31')).toBe(2 * H + 47 * 60 + 31);
  });

  it('parses a single-digit hour', () => {
    expect(parseTimestamp('2:47:31')).toBe(2 * H + 47 * 60 + 31);
  });

  it('parses MM:SS', () => {
    expect(parseTimestamp('47:31')).toBe(47 * 60 + 31);
  });

  it('parses bare seconds', () => {
    expect(parseTimestamp('90')).toBe(90);
  });

  it('allows hours beyond 24 — a 24-hour race reaches 24:00:00', () => {
    expect(parseTimestamp('24:00:00')).toBe(24 * H);
    expect(parseTimestamp('26:30:00')).toBe(26 * H + 30 * 60);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTimestamp('  01:00:00 ')).toBe(H);
  });

  it('rejects out-of-range minutes and seconds', () => {
    expect(() => parseTimestamp('01:75:00')).toThrow(TimeParseError);
    expect(() => parseTimestamp('01:00:75')).toThrow(TimeParseError);
  });

  it('rejects nonsense', () => {
    for (const bad of ['', 'abc', '1:2:3:4', '01:xx:00', '-5:00']) {
      expect(() => parseTimestamp(bad)).toThrow(TimeParseError);
    }
  });

  it('tryParseTimestamp returns null instead of throwing', () => {
    expect(tryParseTimestamp('nope')).toBeNull();
    expect(tryParseTimestamp('01:00:00')).toBe(H);
  });

  it('round-trips through formatTimestamp', () => {
    for (const seconds of [0, 59, 60, 3599, 3600, 10051, 86_399, 86_400, 95_000]) {
      expect(parseTimestamp(formatTimestamp(seconds))).toBe(seconds);
    }
  });
});

describe('formatting', () => {
  it('formats timestamps with padded fields', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(10_051)).toBe('02:47:31');
    expect(formatTimestamp(86_400)).toBe('24:00:00');
  });

  it('formats durations as prose', () => {
    expect(formatDuration(6 * H)).toBe('6h 00m');
    expect(formatDuration(4871)).toBe('1h 21m');
    expect(formatDuration(2820)).toBe('47m');
    expect(formatDuration(45)).toBe('45s');
  });

  it('includes seconds when asked', () => {
    expect(formatDuration(3465, { seconds: true })).toBe('57m 45s');
  });

  it('formats compact hours and minutes', () => {
    expect(formatHoursMinutes(4871)).toBe('1:21');
    expect(formatHoursMinutes(0)).toBe('0:00');
  });

  it('converts to and from hours', () => {
    expect(toHours(5400)).toBe(1.5);
    expect(hoursToSeconds(1.5)).toBe(5400);
  });
});

describe('formatCoveragePercent', () => {
  it('floors to one decimal', () => {
    expect(formatCoveragePercent(6 * H, 24 * H)).toBe('25%');
    expect(formatCoveragePercent(Math.round(0.624 * 24 * H), 24 * H)).toBe('62.4%');
    expect(formatCoveragePercent(1, 3)).toBe('33.3%');
    expect(formatCoveragePercent(2, 3)).toBe('66.6%');
  });

  it('a Story Complete race with a 40 s gap never shows 100%', () => {
    const runtime = 24 * H;
    const intervals = [{ start: 0, end: 12 * H }, { start: 12 * H + 40, end: runtime }];
    expect(isStoryComplete(intervals, runtime, STORY_CONFIG)).toBe(true);
    expect(formatCoveragePercent(runtime - 40, runtime)).toBe('99.9%');
    expect(formatCoveragePercent(runtime - 1, runtime)).toBe('99.9%');
  });

  it('says 100% only when every second is covered, and 0% for no race at all', () => {
    expect(formatCoveragePercent(24 * H, 24 * H)).toBe('100%');
    expect(formatCoveragePercent(0, 24 * H)).toBe('0%');
    expect(formatCoveragePercent(0, 0)).toBe('0%');
    expect(formatCoveragePercent(-5, 60)).toBe('0%');
  });
});

describe('real time versus timeline time', () => {
  it('a six-hour race at 1.5x costs four real hours', () => {
    expect(realSecondsFor(6 * H, 1.5)).toBe(4 * H);
  });

  it('a six-hour race at 1x costs six real hours', () => {
    expect(realSecondsFor(6 * H, 1)).toBe(6 * H);
  });

  it('inverts cleanly', () => {
    expect(timelineSecondsFor(4 * H, 1.5)).toBe(6 * H);
    for (const speed of [0.75, 1, 1.25, 2, 3]) {
      expect(timelineSecondsFor(realSecondsFor(6 * H, speed), speed)).toBeCloseTo(6 * H, -1);
    }
  });

  it('clamps absurd speeds rather than dividing by zero', () => {
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed(-4)).toBe(1);
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(1000)).toBe(8);
    expect(Number.isFinite(realSecondsFor(H, 0))).toBe(true);
  });
});

describe('averagePlaybackSpeed', () => {
  it('weights by timeline, not by session count', () => {
    const sessions = [
      { timelineSeconds: 6 * H, realSeconds: 6 * H },  // a long 1x stint
      { timelineSeconds: 120, realSeconds: 40 },       // a two-minute 3x blast
    ];
    const average = averagePlaybackSpeed(sessions);
    expect(average).toBeGreaterThan(1);
    expect(average).toBeLessThan(1.02); // the short stint barely moves it
  });

  it('returns 1 for no sessions', () => {
    expect(averagePlaybackSpeed([])).toBe(1);
  });

  it('recovers a uniform speed exactly', () => {
    expect(averagePlaybackSpeed([{ timelineSeconds: 4 * H, realSeconds: 2 * H }])).toBe(2);
  });
});

describe('estimateRemaining', () => {
  it('answers the worked example from the specification', () => {
    // 02:47:31 of 06:00:00 watched.
    const estimate = estimateRemaining(10_051, 6 * H, 1);
    expect(estimate.completionPercent).toBeCloseTo(46.5, 1);
    expect(formatDuration(estimate.timelineRemainingSec)).toBe('3h 12m');
  });

  it('scales the real-time estimate by playback speed', () => {
    const atOne = estimateRemaining(10_051, 6 * H, 1);
    const atOneQuarter = estimateRemaining(10_051, 6 * H, 1.25);
    expect(atOneQuarter.realRemainingSec).toBeLessThan(atOne.realRemainingSec);
    expect(atOneQuarter.timelineRemainingSec).toBe(atOne.timelineRemainingSec);
  });

  it('never reports negative remaining time', () => {
    const estimate = estimateRemaining(99_999, 6 * H, 1);
    expect(estimate.timelineRemainingSec).toBe(0);
    expect(estimate.completionPercent).toBe(100);
  });

  it('handles a zero-length race without dividing by zero', () => {
    expect(estimateRemaining(0, 0, 1).completionPercent).toBe(0);
  });
});

describe('suggestStints — long races are expeditions, not sittings', () => {
  it('divides a 24-hour race into manageable pieces', () => {
    const stints = suggestStints([{ start: 0, end: 24 * H }], 150, 1);
    expect(stints.length).toBeGreaterThan(8);
    for (const stint of stints) {
      expect(stint.realSeconds).toBeLessThanOrEqual(150 * 60 + 1);
    }
    // The pieces exactly tile the race, with no overlap and no gap.
    expect(stints[0]!.start).toBe(0);
    expect(stints[stints.length - 1]!.end).toBe(24 * H);
    for (let i = 1; i < stints.length; i += 1) {
      expect(stints[i]!.start).toBe(stints[i - 1]!.end);
    }
  });

  it('only suggests stints over the unwatched parts', () => {
    const stints = suggestStints([{ start: 4 * H, end: 6 * H }], 60, 1);
    expect(stints.every((s) => s.start >= 4 * H && s.end <= 6 * H)).toBe(true);
  });

  it('returns nothing for a fully watched race', () => {
    expect(suggestStints([], 150, 1)).toEqual([]);
  });

  it('accounts for playback speed when sizing a stint', () => {
    const atOne = suggestStints([{ start: 0, end: 24 * H }], 150, 1);
    const atTwo = suggestStints([{ start: 0, end: 24 * H }], 150, 2);
    // At 2x, the same real time covers twice the timeline, so fewer stints.
    expect(atTwo.length).toBeLessThan(atOne.length);
  });
});
