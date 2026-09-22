/**
 * Career metric helpers.
 *
 * The pure parts of the metrics layer: consecutive-year runs, which mastery
 * and achievements both depend on, and the long-break detection behind one
 * deliberately warm secret achievement.
 */

import { describe, expect, it } from 'vitest';
import { countLongBreakReturns, emptyMetrics, longestRun } from '@/lib/engines/metrics';

const DAY = 86_400_000;
const base = new Date(2026, 0, 1).getTime();
const at = (days: number) => new Date(base + days * DAY);

describe('emptyMetrics', () => {
  it('starts a career at level one with nothing else', () => {
    const metrics = emptyMetrics();
    expect(metrics.level).toBe(1);
    expect(metrics.realHours).toBe(0);
    expect(metrics.storyCompletes).toBe(0);
    expect(metrics.prestige).toBe(0);
  });

  it('never starts negative', () => {
    for (const [key, value] of Object.entries(emptyMetrics())) {
      expect(value, key).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns a fresh object each time', () => {
    const first = emptyMetrics();
    first.realHours = 99;
    expect(emptyMetrics().realHours).toBe(0);
  });
});

describe('longestRun', () => {
  it('finds a run of consecutive years', () => {
    expect(longestRun([2022, 2023, 2024, 2026])).toBe(3);
  });

  it('does not care about input order', () => {
    expect(longestRun([2026, 2023, 2024, 2022])).toBe(3);
  });

  it('treats duplicates as one year', () => {
    expect(longestRun([2024, 2024, 2024])).toBe(1);
    expect(longestRun([2024, 2024, 2025])).toBe(2);
  });

  it('handles the empty and single cases', () => {
    expect(longestRun([])).toBe(0);
    expect(longestRun([2026])).toBe(1);
  });

  it('finds the longest of several runs', () => {
    expect(longestRun([2010, 2011, 2015, 2016, 2017, 2018, 2020])).toBe(4);
  });

  it('handles a long unbroken history', () => {
    const years = Array.from({ length: 30 }, (_, i) => 1996 + i);
    expect(longestRun(years)).toBe(30);
  });
});

describe('countLongBreakReturns', () => {
  it('counts picking a race back up after a month away', () => {
    const sessions = [
      { raceId: 'a', watchedAt: at(0) },
      { raceId: 'a', watchedAt: at(45) },
    ];
    expect(countLongBreakReturns(sessions)).toBe(1);
  });

  it('does not count an ordinary gap', () => {
    const sessions = [
      { raceId: 'a', watchedAt: at(0) },
      { raceId: 'a', watchedAt: at(10) },
      { raceId: 'a', watchedAt: at(20) },
    ];
    expect(countLongBreakReturns(sessions)).toBe(0);
  });

  it('counts each race separately', () => {
    const sessions = [
      { raceId: 'a', watchedAt: at(0) },
      { raceId: 'b', watchedAt: at(1) },
      { raceId: 'a', watchedAt: at(40) },
      { raceId: 'b', watchedAt: at(41) },
    ];
    expect(countLongBreakReturns(sessions)).toBe(2);
  });

  it('does not count a break across different races', () => {
    // Watching something else for a month is not a break from anything.
    const sessions = [
      { raceId: 'a', watchedAt: at(0) },
      { raceId: 'b', watchedAt: at(60) },
    ];
    expect(countLongBreakReturns(sessions)).toBe(0);
  });

  it('counts several returns to the same race', () => {
    const sessions = [
      { raceId: 'a', watchedAt: at(0) },
      { raceId: 'a', watchedAt: at(40) },
      { raceId: 'a', watchedAt: at(100) },
    ];
    expect(countLongBreakReturns(sessions)).toBe(2);
  });

  it('handles an empty history', () => {
    expect(countLongBreakReturns([])).toBe(0);
  });

  it('never counts a first session as a return', () => {
    expect(countLongBreakReturns([{ raceId: 'a', watchedAt: at(0) }])).toBe(0);
  });
});
