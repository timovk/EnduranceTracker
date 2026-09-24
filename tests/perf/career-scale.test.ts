/**
 * Performance at the scale of a long career (SPEC §1.3).
 *
 * "Large" is a synthetic ten-year career of 5,000 races and 60,000 stints;
 * "Real" is the first 3,000 of those stints, the most a real career holds for
 * years. Everything is generated in memory from a seeded generator, so a slow
 * run can be repeated exactly.
 *
 * Only run on request — `PERF=1 npx vitest run tests/perf` — because timings
 * belong to the machine rather than to the code, and a busy CI box would fail
 * them for nothing. This file holds the pure paths; the database paths join it
 * as the work packages that build them land.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { CAREER_STATS_SHAPE, EXPEDITION_SHAPE } from '@/lib/config';
import { buildCareerTimeline } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import { computeRecordProgression } from '@/lib/domain/records';
import { summariseWindow } from '@/lib/domain/window-summary';
import type { SyntheticCareer } from '../helpers/synthetic-career';
import { syntheticCareer } from '../helpers/synthetic-career';

const H = 3600;

function timed<T>(work: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = work();
  return { result, ms: performance.now() - started };
}

describe.skipIf(process.env.PERF !== '1')('a career at scale (pure)', () => {
  let large: SyntheticCareer;
  let real: SyntheticCareer;

  beforeAll(() => {
    large = syntheticCareer();
    const sessions = large.sessions.slice(0, 3_000);
    const raceIds = new Set(sessions.map((session) => session.raceId));
    real = { races: large.races.filter((r) => raceIds.has(r.id)), sessions };
  });

  const summaryOptions = {
    weekStartsOn: 1,
    meaningfulSessionSeconds: CAREER_STATS_SHAPE.meaningfulSessionMinutes * 60,
    rateMinimumRaces: CAREER_STATS_SHAPE.rateMinimumRaces,
  };
  const recordOptions = {
    weekStartsOn: 1,
    longRaceThresholdSec: EXPEDITION_SHAPE.autoThresholdHours * H,
    rollingDays: CAREER_STATS_SHAPE.recordRollingDays,
  };

  it('is the size §1.3 describes', () => {
    expect(large.races).toHaveLength(5_000);
    expect(large.sessions).toHaveLength(60_000);
    const years = new Set(large.sessions.map((session) => session.watchedAt.getFullYear()));
    expect(years.size).toBeGreaterThanOrEqual(10);
  });

  it('replays a real career in under 50 ms', () => {
    // Warm the JIT on something else first, as a running server would be.
    buildCareerTimeline(real.sessions.slice(0, 500), real.races);
    const { result, ms } = timed(() => buildCareerTimeline(real.sessions, real.races));
    expect(result.stints).toHaveLength(3_000);
    expect(ms).toBeLessThan(50);
  });

  it('replays a large career in under 1.5 s', () => {
    const { result, ms } = timed(() => buildCareerTimeline(large.sessions, large.races));
    expect(result.stints).toHaveLength(60_000);
    expect(ms).toBeLessThan(1_500);
  });

  it('summarises and finds the records of a large career inside the warm Statistics budget', () => {
    // A warm /stats is this fold over the cached replay, plus a few queries:
    // 1.5 s for the core tabs and 2 s with Records (§1.3).
    const timeline = buildCareerTimeline(large.sessions, large.races);
    const lifetime = timed(() => summariseWindow(timeline, null, summaryOptions));
    const year = timed(() => summariseWindow(timeline, yearWindow(2022), summaryOptions));
    const records = timed(() => computeRecordProgression(timeline, recordOptions));
    expect(lifetime.result.sessions).toBe(60_000);
    expect(year.result.sessions).toBeGreaterThan(0);
    expect(records.result.length).toBeGreaterThan(0);
    expect(lifetime.ms).toBeLessThan(1_500);
    expect(year.ms).toBeLessThan(1_500);
    expect(records.ms).toBeLessThan(2_000);
  });
});
