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
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { buildCareerTimeline } from '@/lib/domain/career-timeline';
import { yearWindow } from '@/lib/domain/calendar';
import { computeRecordProgression } from '@/lib/domain/records';
import { summariseWindow } from '@/lib/domain/window-summary';
import { clearCareerTimelineCache, getCareerTimeline, loadTimelineInputs } from '@/lib/engines/career-timeline-engine';
import {
  getEventLegacy, getEventsIndex, linkRaces, mergeEvents, renameEvent, unlinkRace,
} from '@/lib/engines/event-legacy-engine';
import { deleteRace, deleteViewingSession } from '@/lib/engines/session-engine';
import { getExpeditionView, setExpeditionMode } from '@/lib/engines/expedition-engine';
import {
  backfillEventProgression, backfillExpeditions, backfillMilestones, backfillRaces, buildPhaseContext, EXPEDITION_CHUNK,
  expeditionRaceIds, runCareerBackfillFor,
} from '@/lib/server/upgrades/career-backfill';
import { eventStepProblems, expeditionProblems, ledgerProblems, logStint } from '../helpers/career-db';
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

/** The backfill's chunk transaction, as `career-backfill.ts` opens it. */
const CHUNK_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/**
 * Put a career's landmarks back to undated and its races back to no credited
 * time, as 0.3.2 left them, so the paths that fill them in have everything to
 * do.
 */
async function undate(userId: string, options: { credited: boolean }): Promise<void> {
  await prisma.milestoneProgress.updateMany({
    where: { userId },
    data: { achievedAt: null, achievedPrecision: null, sessionId: null, raceId: null, eventId: null, subjectName: null },
  });
  await prisma.masteryProgress.updateMany({ where: { userId }, data: { achievedAt: null, achievedPrecision: null, achievedSessionId: null } });
  if (options.credited) await prisma.race.updateMany({ where: { userId }, data: { creditedViewingSec: null } });
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

  it('logs a stint that dates every undated landmark in under 1 s for a real career and 6 s for a large one', async () => {
    // The first stint after the update, while the backfill has not yet dated
    // anything: the stint builds the replay and dates every landmark itself.
    for (const career of [real, large]) await undate(career.userId, { credited: false });
    const realLog = await timedAsync(() => logStint(real.userId, real.openRaceId, { from: 1_800, to: 2_400, now: real.now }));
    const largeLog = await timedAsync(() => logStint(large.userId, large.openRaceId, { from: 1_800, to: 2_400, now: large.now }));
    for (const career of [real, large]) {
      expect(await prisma.milestoneProgress.count({ where: { userId: career.userId, achievedPrecision: null } })).toBe(0);
    }
    expect(realLog.result.sessionId).toBeTruthy();
    expect(realLog.ms).toBeLessThan(1_000);
    expect(largeLog.ms).toBeLessThan(6_000);
  }, SLOW);

  it('backfills a real career in one start, in under 5 s', async () => {
    await undate(real.userId, { credited: true });
    const { result, ms } = await timedAsync(() =>
      runCareerBackfillFor(real.userId, { now: real.now, clock: { shouldStartChunk: () => true }, force: true }));
    expect(result.completed).toBe(true);
    expect(result.racesCredited).toBeGreaterThan(0);
    expect(result.datesFilled).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5_000);
    expect(await ledgerProblems(real.userId)).toEqual([]);
  }, SLOW);

  it('backfills a large career with its context in under 3 s and every chunk in under 5 s', async () => {
    await undate(large.userId, { credited: true });
    const context = await timedAsync(() => buildPhaseContext(large.userId, large.now));
    expect(context.ms).toBeLessThan(3_000);

    // P1, 500 races a chunk, as the backfill runs it.
    const ids = [...context.result.timeline.racesById.keys()].sort();
    let slowestRaceChunk = 0;
    let credited = 0;
    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500);
      const { result, ms } = await timedAsync(() =>
        prisma.$transaction((tx) => backfillRaces(tx as Tx, context.result, chunk), CHUNK_TRANSACTION));
      credited += result.racesCredited;
      slowestRaceChunk = Math.max(slowestRaceChunk, ms);
    }
    expect(credited).toBe(ids.length);
    expect(slowestRaceChunk).toBeLessThan(5_000);

    // P3, one chunk.
    const milestones = await timedAsync(() => prisma.$transaction(
      (tx) => backfillMilestones(tx as Tx, large.userId, large.now, context.result.timeline),
      CHUNK_TRANSACTION,
    ));
    expect(milestones.result.filled).toBeGreaterThan(0);
    expect(milestones.ms).toBeLessThan(5_000);
    expect(await prisma.milestoneProgress.count({ where: { userId: large.userId, achievedPrecision: null } })).toBe(0);
  }, SLOW);

  it('backfills a large career’s Expeditions (P4) in chunks of under 5 s each, holding only what their coverage reaches', async () => {
    const context = await timedAsync(() => buildPhaseContext(large.userId, large.now));
    expect(context.ms).toBeLessThan(3_000);
    const ids = expeditionRaceIds(context.result.timeline);
    expect(ids.length).toBeGreaterThan(1_000);

    let slowest = 0;
    let checkpoints = 0;
    let summaries = 0;
    for (let index = 0; index < ids.length; index += EXPEDITION_CHUNK) {
      const chunk = ids.slice(index, index + EXPEDITION_CHUNK);
      const { result, ms } = await timedAsync(() => prisma.$transaction(
        (tx) => backfillExpeditions(tx as Tx, context.result, chunk, { resize: false }),
        CHUNK_TRANSACTION,
      ));
      slowest = Math.max(slowest, ms);
      checkpoints += result.checkpoints;
      summaries += result.summaries;
    }
    expect(checkpoints).toBeGreaterThan(5_000);
    expect(summaries).toBeGreaterThan(500);
    expect(slowest).toBeLessThan(5_000);
    expect(await expeditionProblems(large.userId)).toEqual([]);
  }, 900_000);

  it('backfills a career’s recurring events (P2) in one chunk, under 5 s, crediting every step they had reached', async () => {
    // As 0.3.2 left them: steps reached, and no record of which races reached them.
    for (const career of [real, large]) await prisma.eventStepCredit.deleteMany({ where: { userId: career.userId } });
    const realP2 = await timedAsync(() =>
      prisma.$transaction((tx) => backfillEventProgression(tx as Tx, real.userId, real.now), CHUNK_TRANSACTION));
    const largeP2 = await timedAsync(() =>
      prisma.$transaction((tx) => backfillEventProgression(tx as Tx, large.userId, large.now), CHUNK_TRANSACTION));
    expect(realP2.result.credits).toBeGreaterThan(0);
    expect(largeP2.result.credits).toBeGreaterThan(10_000);
    expect(realP2.ms).toBeLessThan(5_000);
    expect(largeP2.ms).toBeLessThan(5_000);
    expect(await eventStepProblems(large.userId)).toEqual([]);
  }, SLOW);

  it('logs a stint that reads every event-step credit in under 1 s for a real career and 6 s for a large one', async () => {
    expect(await prisma.eventStepCredit.count({ where: { userId: large.userId } })).toBeGreaterThan(10_000);
    const realLog = await timedAsync(() => logStint(real.userId, real.openRaceId, { from: 2_400, to: 3_000, now: real.now }));
    const largeLog = await timedAsync(() => logStint(large.userId, large.openRaceId, { from: 2_400, to: 3_000, now: large.now }));
    expect(realLog.ms).toBeLessThan(1_000);
    expect(largeLog.ms).toBeLessThan(6_000);
  }, SLOW);

  it('renames, links, unlinks and merges events in under 1 s for a real career and 6 s for a large one', async () => {
    const EVENT_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;
    for (const [career, limit] of [[real, 1_000], [large, 6_000]] as const) {
      const outside = `${career.userId.replace('-user', '')}-race-1`;
      const timings = {
        rename: await timedAsync(() => prisma.$transaction(
          (tx) => renameEvent(tx as Tx, career.userId, 'event-0', 'The Opening Classic'), EVENT_TRANSACTION)),
        link: await timedAsync(() => prisma.$transaction(
          (tx) => linkRaces(tx as Tx, career.userId, 'event-0', [outside], career.now), EVENT_TRANSACTION)),
        unlink: await timedAsync(() => prisma.$transaction(
          (tx) => unlinkRace(tx as Tx, career.userId, outside, career.now), EVENT_TRANSACTION)),
        merge: await timedAsync(() => prisma.$transaction(
          (tx) => mergeEvents(tx as Tx, career.userId, 'event-3', 'event-0', career.now), EVENT_TRANSACTION)),
      };
      expect(timings.link.result).toBe(1);
      expect(timings.merge.result.racesMoved).toBeGreaterThan(0);
      for (const [name, timing] of Object.entries(timings)) {
        expect(timing.ms, `${career.userId} ${name}`).toBeLessThan(limit);
      }
    }
    expect(await eventStepProblems(large.userId)).toEqual([]);
  }, SLOW);

  it('builds an event’s page in under 3 s cold and 800 ms warm, and the Events page, for a large career', async () => {
    clearCareerTimelineCache(large.userId);
    const cold = await timedAsync(() => getEventLegacy(large.userId, 'event-0'));
    const warm = await timedAsync(() => getEventLegacy(large.userId, 'event-0'));
    const index = await timedAsync(() => getEventsIndex(large.userId));
    const realPage = await timedAsync(() => getEventLegacy(real.userId, 'event-0'));
    expect(cold.result).not.toBeNull();
    expect(index.result.events.length).toBeGreaterThan(30);
    expect(cold.ms).toBeLessThan(3_000);
    expect(warm.ms).toBeLessThan(800);
    expect(index.ms).toBeLessThan(3_000);
    expect(realPage.ms).toBeLessThan(500);
  }, SLOW);

  it('builds the Expedition page in under 500 ms for a real career and 1 s for a large one', async () => {
    // The first-year 24-hour race of 200 stints: the longest page either career has.
    for (const [career, limit] of [[real, 500], [large, 1_000]] as const) {
      const view = await timedAsync(() => getExpeditionView(career.userId, career.bigRaceId, career.now));
      expect(view.result?.isExpedition).toBe(true);
      expect(view.result?.stints.length).toBeGreaterThanOrEqual(199);
      expect(view.ms, career.userId).toBeLessThan(limit);
    }
  }, SLOW);

  it('switches Expedition Mode, writing a missing summary, in under 500 ms for a real career and 2 s for a large one', async () => {
    const EXPEDITION_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;
    for (const [career, limit] of [[real, 500], [large, 2_000]] as const) {
      const race = await prisma.race.findFirstOrThrow({
        where: { userId: career.userId, runtimeSec: { gte: 10 * H }, storyCompletedAt: { not: null } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      await prisma.$transaction((tx) => setExpeditionMode(tx as Tx, career.userId, race.id, 'off', career.now), EXPEDITION_TRANSACTION);
      // As if its summary had never been written: switching it on writes it.
      await prisma.expeditionSummary.deleteMany({ where: { userId: career.userId, raceId: race.id } });
      const on = await timedAsync(() => prisma.$transaction(
        (tx) => setExpeditionMode(tx as Tx, career.userId, race.id, 'on', career.now), EXPEDITION_TRANSACTION));
      expect(on.result?.summaryWritten).toBe(true);
      expect(on.ms, career.userId).toBeLessThan(limit);
    }
  }, SLOW);

  it('logs the stint that completes an Expedition, summary and all, in under 1 s for a real career and 6 s for a large one', async () => {
    for (const [career, limit] of [[real, 1_000], [large, 6_000]] as const) {
      await prisma.$transaction((tx) => setExpeditionMode(tx as Tx, career.userId, career.openRaceId, 'on', career.now));
      const race = await prisma.race.findUniqueOrThrow({ where: { id: career.openRaceId }, select: { runtimeSec: true } });
      const log = await timedAsync(() => logStint(career.userId, career.openRaceId, { from: 0, to: race.runtimeSec, now: career.now }));
      expect(log.result.expedition?.completed).toBe(true);
      expect(log.ms, career.userId).toBeLessThan(limit);
    }
    expect(await expeditionProblems(real.userId)).toEqual([]);
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
