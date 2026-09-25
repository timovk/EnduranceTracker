/**
 * Rebuild every derived figure of a career from the sources of truth.
 *
 * The cached counters on `Race`, the merged coverage in `WatchedInterval`, the
 * career XP total, mastery progress, achievement progress and collection
 * state are all DERIVED. `recomputeCareer` rebuilds all of them from the
 * stints, the races and the XP ledger — the safety net if a cache ever drifts,
 * and the way a configuration re-balance is applied to an existing career.
 * `npm run db:recompute` (`scripts/recompute.ts`) is its command line.
 *
 * Every step is idempotent: running it twice changes nothing the second time,
 * and nothing it re-derives can be paid twice, because the XP ledger's dedupe
 * keys are unique per account.
 *
 *   1. Races, in chunks of their own transaction: coverage rebuilt from the
 *      stints and clamped to the runtime, the cached aggregates rebuilt, and
 *      the Story Complete bonus made to exist exactly when the replay says the
 *      race is complete — which pays a bonus a runtime edit skipped. The
 *      ledger is settled per chunk.
 *   2. The ledger repair (`repairXpLedger`): viewing XP whose stint is gone and
 *      Story Complete bonuses whose race is not complete are removed.
 *   3. One transaction for the rest: mastery trees and event caches,
 *      collections, mastery, metrics, achievements, milestone ladders and
 *      Career Milestones, and a date for every landmark that has none. Only
 *      when asked (`rebuildMilestoneDates`) is every landmark dated again
 *      from the replay, where the replay's instant passes the same test a
 *      first dating does: the one deliberate exception to "a landmark's date
 *      is written once", for developer repair.
 *   4. The account's 0.4.0 backfill is recorded as done: recompute has just
 *      done all of it.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { buildCareerTimeline, type CareerTimeline } from '@/lib/domain/career-timeline';
import { syncAchievements, syncMilestones } from '@/lib/engines/achievement-engine';
import { fillLandmarkDates, rebuildLandmarkDates, syncCareerMilestones } from '@/lib/engines/career-milestone-engine';
import { loadTimelineInputs } from '@/lib/engines/career-timeline-engine';
import { ensureSeasonCollections, syncCollections } from '@/lib/engines/collection-engine';
import { ensureMasteryTrees, recomputeRaceMasteries, syncMastery } from '@/lib/engines/mastery-engine';
import { computeCareerMetricsWithHistory } from '@/lib/engines/metrics';
import { reconcileStoryBonus } from '@/lib/engines/progression-resync';
import { rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { repairXpLedger, type LedgerRepair } from '@/lib/engines/session-engine';
import { settleLedger, type XpRevocation } from '@/lib/engines/xp-ledger';
import { markCareerBackfillApplied } from '@/lib/server/upgrades/career-backfill';

export interface RecomputeOptions {
  /** The instant recorded as "now" by anything the rebuild completes. Defaults to the clock. */
  now?: Date;
  /**
   * Date every milestone and event step again from the replay (`db:recompute
   * --rebuild-milestone-dates`). Only rows whose replayed instant passes the
   * dating test are rewritten; every other row is left as it is.
   */
  rebuildMilestoneDates?: boolean;
}

export interface RecomputeReport {
  racesRebuilt: number;
  /** Story Complete bonuses paid to complete races that were missing theirs. */
  storyBonusesAwarded: number;
  /** Story Complete bonuses taken back from races the replay says are not complete. */
  storyBonusesRevoked: number;
  ledger: LedgerRepair;
  collectionCardsFilled: number;
  masteryNodesUnlocked: number;
  achievementsUnlocked: number;
  milestonesReached: number;
  /** Career Milestone rungs newly written, and the XP they paid. */
  careerMilestonesReached: number;
  careerMilestoneXp: number;
  /** Landmarks given a date from history, and those history cannot place. */
  datesFilled: number;
  datesRecognised: number;
  /** Landmarks dated again on request; 0 unless `rebuildMilestoneDates` was set. */
  milestoneDatesRebuilt: number;
  totals: { races: number; coverageSec: number; creditedViewingSec: number };
}

/** Races per chunk transaction: small enough that one chunk of a very long career stays quick. */
const RACE_CHUNK = 500;

/** One chunk of races. As generous as logging a stint. */
const CHUNK_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/** The syncs of step 3, over the whole career at once. */
const SYNC_TRANSACTION = { maxWait: 15_000, timeout: 120_000 } as const;

/** Rebuild one account's derived state. Safe to run at any time, any number of times. */
export async function recomputeCareer(userId: string, options: RecomputeOptions = {}): Promise<RecomputeReport> {
  const now = options.now ?? new Date();

  // -- 1. Races ------------------------------------------------------------
  //
  // The replay is built once for the whole account. The chunks below rebuild
  // coverage and aggregates but never touch a stint, so it stays true for all
  // of them.
  const inputs = await loadTimelineInputs(prisma, userId);
  const timeline = buildCareerTimeline(inputs.sessions, inputs.races);
  const raceIds = inputs.races.map((race) => race.id).sort();

  let storyBonusesAwarded = 0;
  let storyBonusesRevoked = 0;
  for (let index = 0; index < raceIds.length; index += RACE_CHUNK) {
    const chunk = raceIds.slice(index, index + RACE_CHUNK);
    const result = await prisma.$transaction(
      (tx) => rebuildRaceChunk(tx as Tx, userId, chunk, timeline, now),
      CHUNK_TRANSACTION,
    );
    storyBonusesAwarded += result.awarded;
    storyBonusesRevoked += result.revoked;
  }

  // -- 2. The ledger -------------------------------------------------------
  //
  // Repairs before it rebuilds: XP left behind by a deleted stint, and Story
  // Complete bonuses held by races that are no longer complete, both inflate
  // the total and neither can be corrected by summing what is there.
  const ledger = await repairXpLedger(userId);

  // -- 3. Everything else --------------------------------------------------
  //
  // The remaining engines are idempotent, so simply running them re-derives
  // everything they own without awarding anything twice — the unique dedupe
  // keys on the XP ledger are what guarantee that.
  const synced = await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    await ensureMasteryTrees(db, userId, now);
    await ensureSeasonCollections(db, userId, now);
    await recomputeRaceMasteries(db, userId, now);
    const collections = await syncCollections(db, userId, now);
    const mastery = await syncMastery(db, userId, now);
    const { metrics, history } = await computeCareerMetricsWithHistory(userId, db);
    const achievements = await syncAchievements(db, userId, metrics, now);
    const milestones = await syncMilestones(db, userId, metrics, now);
    const careerMilestones = await syncCareerMilestones(db, userId, { metrics, history, now });
    // Dated from what this transaction sees rather than from the replay step 1
    // built: the event links were just recomputed, and an event step is
    // replayed inside its event's races. The replay is built here only when a
    // rebuild of every date needs it anyway; otherwise only if some landmark
    // is still undated.
    const replay = options.rebuildMilestoneDates ? buildCareerTimeline(history.sessions, history.races) : undefined;
    const dates = await fillLandmarkDates(db, userId, { history, now, timeline: replay });
    const milestoneDatesRebuilt = replay === undefined ? 0 : await rebuildLandmarkDates(db, userId, replay);
    return {
      collectionCardsFilled: collections.filledItems.length,
      masteryNodesUnlocked: mastery.length,
      achievementsUnlocked: achievements.length,
      milestonesReached: milestones.length,
      careerMilestonesReached: careerMilestones.created,
      careerMilestoneXp: careerMilestones.xpAwarded,
      datesFilled: dates.milestones + dates.eventSteps,
      datesRecognised: dates.recognised,
      milestoneDatesRebuilt,
    };
  }, SYNC_TRANSACTION);

  // -- 4. The upgrade --------------------------------------------------------
  //
  // Everything the 0.4.0 backfill would do has just been done, so the next
  // start has nothing left to do for this account.
  await markCareerBackfillApplied(userId);

  const totals = await prisma.race.aggregate({
    where: { userId },
    _sum: { coverageSec: true, creditedViewingSec: true },
    _count: true,
  });

  return {
    racesRebuilt: raceIds.length,
    storyBonusesAwarded,
    storyBonusesRevoked,
    ledger,
    ...synced,
    totals: {
      races: totals._count,
      coverageSec: totals._sum.coverageSec ?? 0,
      creditedViewingSec: totals._sum.creditedViewingSec ?? 0,
    },
  };
}

/**
 * Step 1 for one chunk of races, inside its transaction: coverage, aggregates
 * and the Story Complete bonus, then the ledger settled for what came off.
 * The races are this account's own: their ids came from its replay.
 */
async function rebuildRaceChunk(
  db: Tx,
  userId: string,
  raceIds: readonly string[],
  timeline: CareerTimeline,
  now: Date,
): Promise<{ awarded: number; revoked: number }> {
  let awarded = 0;
  let revoked = 0;
  const revocations: XpRevocation[] = [];

  for (const raceId of raceIds) {
    await rebuildRaceIntervals(db, raceId);
    await recomputeRaceAggregates(db, raceId, now);
    const story = await reconcileStoryBonus(db, userId, raceId, { history: timeline.races.get(raceId) });
    if (story.awarded > 0) awarded += 1;
    if (story.revocation.transactions > 0) revoked += 1;
    revocations.push(story.revocation);
  }

  await settleLedger(db, userId, revocations);
  return { awarded, revoked };
}
