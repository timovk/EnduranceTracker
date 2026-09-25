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
 * them for nothing. The pure paths run on the career in memory; the database
 * paths on the same careers written to a database of their own
 * (`tests/helpers/large-career-db.ts`), and each work package adds the paths
 * it builds.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAREER_STATS_SHAPE, EXPEDITION_SHAPE } from '@/lib/config';
import { disconnectDb, prisma } from '@/lib/db/client';
import { buildCareerTimeline } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import { computeRecordProgression } from '@/lib/domain/records';
import { summariseWindow } from '@/lib/domain/window-summary';
import { getCareerTimeline, loadTimelineInputs } from '@/lib/engines/career-timeline-engine';
import { deleteRace, deleteViewingSession } from '@/lib/engines/session-engine';
import { ledgerProblems, logStint } from '../helpers/career-db';
import type { LargeCareerDatabase, SeededCareer } from '../helpers/large-career-db';
import { createLargeCareerDatabase } from '../helpers/large-career-db';
import type { SyntheticCareer } from '../helpers/synthetic-career';
import { syntheticCareer } from '../helpers/synthetic-career';

const H = 3600;

function timed<T>(work: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = work();
  return { result, ms: performance.now() - started };
}

async function timedAsync<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await work();
  return { result, ms: performance.now() - started };
}

/** Generous per-test limits: a timing assertion should fail, not the test runner's clock. */
const SLOW = 180_000;

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

describe.skipIf(process.env.PERF !== '1')('a career at scale (database)', () => {
  let db: LargeCareerDatabase;
  let large: SeededCareer;
  let real: SeededCareer;

  beforeAll(async () => {
    db = await createLargeCareerDatabase();
    large = db.large;
    real = db.real;
    // One stint each first, untimed: it creates the mastery trees, challenges
    // and event rows a career of this size would long since have.
    for (const career of [large, real]) {
      await logStint(career.userId, career.openRaceId, { from: 0, to: 600, now: career.now });
    }
  }, 900_000);

  afterAll(async () => {
    await disconnectDb();
    db?.cleanup();
  });

  it('is the size §1.3 describes', async () => {
    expect(large.stints).toBe(60_200);
    expect(large.races).toBe(5_001);
    expect(large.ledgerRows).toBeGreaterThanOrEqual(180_000);
    expect(await prisma.xPTransaction.count({ where: { userId: large.userId } })).toBeGreaterThanOrEqual(180_000);
    expect(real.stints).toBe(3_200);
  });

  it('loads and replays a large career inside the start-up context budget (3 s)', async () => {
    const { result, ms } = await timedAsync(async () => {
      const inputs = await loadTimelineInputs(prisma, large.userId);
      return buildCareerTimeline(inputs.sessions, inputs.races);
    });
    expect(result.stints.length).toBeGreaterThanOrEqual(60_200);
    expect(ms).toBeLessThan(3_000);
  }, SLOW);

  it('serves a cached replay for the price of its fingerprint, inside the smallest warm page budget (800 ms)', async () => {
    const cold = await timedAsync(() => getCareerTimeline(large.userId));
    const warm = await timedAsync(() => getCareerTimeline(large.userId));
    expect(warm.result).toBe(cold.result);
    expect(cold.ms).toBeLessThan(5_000);
    expect(warm.ms).toBeLessThan(800);
  }, SLOW);

  it('logs a stint in under 1 s for a real career and 6 s for a large one', async () => {
    const realLog = await timedAsync(() => logStint(real.userId, real.openRaceId, { from: 600, to: 1_800, now: real.now }));
    const largeLog = await timedAsync(() => logStint(large.userId, large.openRaceId, { from: 600, to: 1_800, now: large.now }));
    expect(realLog.result.sessionId).toBeTruthy();
    expect(realLog.ms).toBeLessThan(1_000);
    expect(largeLog.ms).toBeLessThan(6_000);
  }, SLOW);

  it('deletes a stint from the last month in under 1 s for a real career and 2 s for a large one', async () => {
    const realDelete = await timedAsync(() => deleteViewingSession(real.userId, real.lastStintId, real.now));
    const largeDelete = await timedAsync(() => deleteViewingSession(large.userId, large.lastStintId, large.now));
    expect(realDelete.ms).toBeLessThan(1_000);
    expect(largeDelete.ms).toBeLessThan(2_000);
  }, SLOW);

  it('deletes a race from the last month in under 1 s for a real career and 2 s for a large one', async () => {
    const realDelete = await timedAsync(() => deleteRace(real.userId, real.lastRaceId, real.now));
    const largeDelete = await timedAsync(() => deleteRace(large.userId, large.lastRaceId, large.now));
    expect(realDelete.result).not.toBeNull();
    expect(largeDelete.result).not.toBeNull();
    expect(realDelete.ms).toBeLessThan(1_000);
    expect(largeDelete.ms).toBeLessThan(2_000);
  }, SLOW);

  it('deletes a stint from the first year in under 1 s for a real career and 10 s for a large one', async () => {
    // Its XP sits at the start of the ledger, so every running total after it
    // is re-stamped: the whole ledger, in batches.
    const realDelete = await timedAsync(() => deleteViewingSession(real.userId, real.firstStintId, real.now));
    const largeDelete = await timedAsync(() => deleteViewingSession(large.userId, large.firstStintId, large.now));
    expect(largeDelete.result.careerXpRemoved).toBeGreaterThan(0);
    expect(realDelete.ms).toBeLessThan(1_000);
    expect(largeDelete.ms).toBeLessThan(10_000);
    expect(await ledgerProblems(large.userId)).toEqual([]);
  }, SLOW);

  it('deletes a first-year race of 200 stints in under 1 s for a real career and 10 s for a large one', async () => {
    const realDelete = await timedAsync(() => deleteRace(real.userId, real.bigRaceId, real.now));
    const largeDelete = await timedAsync(() => deleteRace(large.userId, large.bigRaceId, large.now));
    // The career's first stint was this race's, and went in the test above.
    expect(largeDelete.result?.sessionsRemoved).toBe(199);
    expect(realDelete.ms).toBeLessThan(1_000);
    expect(largeDelete.ms).toBeLessThan(10_000);
    expect(await ledgerProblems(large.userId)).toEqual([]);
    expect(await ledgerProblems(real.userId)).toEqual([]);
  }, SLOW);
});
