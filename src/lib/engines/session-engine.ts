/**
 * The session engine — the one write path that matters.
 *
 * Logging a stint is the central action of the application, and it has to be
 * ATOMIC: the raw session, the merged coverage, the cached aggregates, the XP
 * ledger, momentum, challenges, achievements, milestones, mastery,
 * collections, the season pass and the awards all move together or not at all.
 * Everything below therefore runs inside a single interactive transaction, and
 * every engine it calls takes that transaction client.
 *
 * The result is a `SessionOutcome`, which is exactly what the stint summary
 * screen renders — because every session matters, including a short one.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { STORY_CONFIG, XP_CONFIG, TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { addInterval, coverageSeconds, fromRows } from '@/lib/domain/intervals';
import { clampSpeed, realSecondsFor, timelineSecondsFor } from '@/lib/domain/playback';
import { storyCompleteBonus, xpForSession } from '@/lib/domain/progression';
import { stintHeading } from '@/lib/copy/tone';
import { isSeasonClosed } from '@/lib/domain/season-closure';
import type { SessionInput } from '@/lib/validation/schemas';
import type { SessionOutcome, SessionRemoval } from './contracts';
import {
  awardXp,
  purgeOrphanedSessionXp,
  rebuildCareerTotals,
  revokeSessionXp,
  revokeXpByDedupeKey,
} from './xp-ledger';
import { computeCareerMetrics } from './metrics';
import { recomputeRaceAggregates } from './race-engine';

import { applyMomentumForSession, updateStreak } from './momentum-engine';
import {
  addSeasonXp, getOrCreateCurrentPass, rebuildSeasonXpFromLedger, seasonClosureNotice,
} from './season-pass-engine';
import { evaluateChallenges } from './challenge-engine';
import { syncAchievements, syncMilestones } from './achievement-engine';
import { ensureMasteryTrees, syncMastery, recomputeRaceMasteries, getMasteryForChampionship } from './mastery-engine';
import { ensureSeasonCollections, syncCollections } from './collection-engine';
import { syncAwards } from './awards-engine';
import { recordedHoursInRange, getBudgetSnapshot } from './budget-engine';

/**
 * Prisma's default interactive-transaction timeout is far too short for this
 * much orchestration. These are generous on purpose: correctness of a single
 * logged session beats shaving milliseconds off it.
 */
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

/**
 * Resolve the stint's timeline window from either input mode.
 *
 * RANGE:    the user knows where they stopped — `02:47:31` — and the real time
 *           spent follows from the playback speed.
 * DURATION: the user knows how long they sat there, and the end position
 *           follows from the speed instead.
 */
export function resolveSessionWindow(
  input: Pick<SessionInput, 'mode' | 'startTimestamp' | 'endTimestamp' | 'realMinutes' | 'playbackSpeed'>,
  runtimeSec: number,
): { startSec: number; endSec: number; timelineSeconds: number; realSeconds: number; playbackSpeed: number } {
  const playbackSpeed = clampSpeed(input.playbackSpeed);
  const startSec = Math.max(0, Math.min(Math.round(input.startTimestamp), runtimeSec));

  let endSec: number;
  if (input.mode === 'DURATION') {
    const realSeconds = Math.round((input.realMinutes ?? 0) * 60);
    endSec = Math.min(runtimeSec, startSec + timelineSecondsFor(realSeconds, playbackSpeed));
  } else {
    endSec = Math.max(startSec, Math.min(Math.round(input.endTimestamp ?? startSec), runtimeSec));
  }

  const timelineSeconds = Math.max(0, endSec - startSec);
  return {
    startSec,
    endSec,
    timelineSeconds,
    // Real time always follows from the timeline actually covered, so a stint
    // clipped at the end of the race does not bill for time never spent.
    realSeconds: realSecondsFor(timelineSeconds, playbackSpeed),
    playbackSpeed,
  };
}

export async function logViewingSession(
  userId: string,
  input: SessionInput,
  now: Date = new Date(),
): Promise<SessionOutcome> {
  const watchedAt = input.watchedAt ?? now;

  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;

    // -- 1. The race, and where we already are in it -----------------------
    const race = await db.race.findFirstOrThrow({
      where: { id: input.raceId, userId },
      select: {
        id: true, name: true, runtimeSec: true, isMajorEvent: true, storyCompletedAt: true,
        championshipId: true, seasonId: true,
        championship: { select: { id: true, name: true } },
      },
    });

    const existingRows = await db.watchedInterval.findMany({
      where: { raceId: race.id },
      select: { startSec: true, endSec: true },
    });
    const existing = fromRows(existingRows);
    const coverageBefore = coverageSeconds(existing);

    const window = resolveSessionWindow(input, race.runtimeSec);

    // -- 2. Merge the new interval into the canonical coverage -------------
    //
    // `addedSeconds` is the timeline that had never been watched before. This
    // is the number that keeps re-watching honest: it increases real viewing
    // statistics without increasing unique completion twice.
    const { intervals: mergedIntervals, addedSeconds } = addInterval(existing, {
      start: window.startSec,
      end: window.endSec,
    }, { limit: race.runtimeSec, gapTolerance: STORY_CONFIG.gapToleranceSeconds });

    const session = await db.raceViewingSession.create({
      data: {
        raceId: race.id,
        userId,
        startTimestampSec: window.startSec,
        endTimestampSec: window.endSec,
        playbackSpeed: window.playbackSpeed,
        timelineSeconds: window.timelineSeconds,
        realSeconds: window.realSeconds,
        newCoverageSeconds: addedSeconds,
        coverageBeforeSec: coverageBefore,
        coverageAfterSec: coverageSeconds(mergedIntervals),
        watchedAt,
        note: input.note ?? null,
      },
      select: { id: true },
    });

    // The merged set is rewritten wholesale — it is a derived set, not a log.
    // The append-only log is `RaceViewingSession`, which is never rewritten.
    await db.watchedInterval.deleteMany({ where: { raceId: race.id } });
    if (mergedIntervals.length > 0) {
      await db.watchedInterval.createMany({
        data: mergedIntervals.map((interval) => ({
          raceId: race.id,
          startSec: interval.start,
          endSec: interval.end,
          sessionId: session.id,
        })),
      });
    }

    // -- 3. Rebuild the race's cached aggregates ---------------------------
    const aggregates = await recomputeRaceAggregates(db, race.id, now);

    // -- 4. XP for the stint ----------------------------------------------
    const profileBefore = await db.careerProfile.findUniqueOrThrow({ where: { userId } });
    const levelBefore = profileBefore.level;

    const sessionXp = xpForSession({
      timelineSeconds: window.timelineSeconds,
      newCoverageSeconds: addedSeconds,
      playbackSpeed: window.playbackSpeed,
    });

    const xpBreakdown: { label: string; amount: number }[] = [];
    let careerXpAwarded = 0;
    let seasonXpAwarded = 0;

    // While the season is closed (0.3.1) a stint earns career XP only. Every
    // ledger row it writes carries a season amount of zero, so there is no
    // season XP anywhere for a later rebuild to find.
    const seasonClosed = isSeasonClosed(now);
    const viewingSeasonXp = seasonClosed ? 0 : sessionXp.seasonXp;

    if (sessionXp.careerXp > 0) {
      const viewing = await awardXp(db, userId, {
        source: addedSeconds > 0 ? 'VIEWING' : 'REWATCH',
        amount: sessionXp.careerXp,
        seasonAmount: viewingSeasonXp,
        description: addedSeconds > 0 ? 'Viewing time' : 'Re-watched section',
        sourceRef: race.id,
        sessionId: session.id,
        // Deliberately no dedupeKey: viewing XP is bounded by the session it
        // belongs to, and each logged stint is its own row.
      });
      careerXpAwarded += viewing.granted;
      seasonXpAwarded += viewingSeasonXp;
      xpBreakdown.push({ label: addedSeconds > 0 ? 'Viewing time' : 'Re-watch', amount: viewing.granted });
    }

    // -- 5. Story Complete -------------------------------------------------
    let storyBonusAwarded = 0;
    if (aggregates.becameStoryComplete) {
      const bonus = storyCompleteBonus(race.runtimeSec, race.isMajorEvent);
      const bonusSeasonXp = seasonClosed ? 0 : bonus.seasonXp;
      const award = await awardXp(db, userId, {
        source: 'STORY_COMPLETE',
        amount: bonus.careerXp,
        seasonAmount: bonusSeasonXp,
        description: `Story Complete — ${race.name}`,
        sourceRef: race.id,
        sessionId: session.id,
        // One-shot: the unique dedupeKey is what makes this structurally
        // impossible to award twice, however often the engine re-runs.
        dedupeKey: `story-complete:${race.id}`,
      });
      storyBonusAwarded = award.granted;
      careerXpAwarded += award.granted;
      seasonXpAwarded += award.duplicate ? 0 : bonusSeasonXp;
      if (award.granted > 0) {
        xpBreakdown.push({ label: `Story Complete (${bonus.label})`, amount: award.granted });
      }
    }

    // -- 6. Momentum and streaks ------------------------------------------
    const momentum = await applyMomentumForSession(db, userId, window.realSeconds, now);
    const streak = await updateStreak(db, userId, watchedAt);

    // -- 7. Structures that may have grown since the last session ----------
    await ensureMasteryTrees(db, userId, now);
    await ensureSeasonCollections(db, userId, now);
    await recomputeRaceMasteries(db, userId, now);

    // -- 8. Collections, mastery, challenges -------------------------------
    const collections = await syncCollections(db, userId, now);
    for (const completed of collections.completedCollections) {
      if (completed.xpAwarded > 0) {
        xpBreakdown.push({ label: `Season Complete — ${completed.name}`, amount: completed.xpAwarded });
        careerXpAwarded += completed.xpAwarded;
      }
    }

    const mastery = await syncMastery(db, userId, now);
    for (const node of mastery) {
      if (node.xpAwarded > 0) {
        xpBreakdown.push({ label: `Mastery — ${node.nodeName}`, amount: node.xpAwarded });
        careerXpAwarded += node.xpAwarded;
      }
    }

    const challenges = await evaluateChallenges(db, userId, now);
    for (const challenge of challenges) {
      if (challenge.xpAwarded > 0) {
        xpBreakdown.push({ label: `Challenge — ${challenge.title}`, amount: challenge.xpAwarded });
        careerXpAwarded += challenge.xpAwarded;
      }
      seasonXpAwarded += challenge.seasonXpAwarded;
    }

    // -- 9. Achievements and milestones ------------------------------------
    //
    // Metrics are read through the TRANSACTION client so they include the
    // session that was just written.
    const metrics = await computeCareerMetrics(userId, db);
    const achievements = await syncAchievements(db, userId, metrics, now);
    for (const achievement of achievements) {
      if (achievement.xpAwarded > 0) {
        xpBreakdown.push({ label: `Achievement — ${achievement.name}`, amount: achievement.xpAwarded });
        careerXpAwarded += achievement.xpAwarded;
      }
    }

    const milestones = await syncMilestones(db, userId, metrics, now);
    for (const milestone of milestones) {
      if (milestone.xpAwarded > 0) {
        xpBreakdown.push({ label: `Milestone — ${milestone.label}`, amount: milestone.xpAwarded });
        careerXpAwarded += milestone.xpAwarded;
      }
    }

    // -- 10. Season pass ---------------------------------------------------
    //
    // Momentum's bonus applies to the quarterly currency only. It can never
    // make permanent career progression easier.
    //
    // While the season is closed there is no pass: none is created, nothing is
    // added, and the summary reports no season XP and no tiers.
    let boostedSeasonXp = 0;
    let seasonPassTiers: SessionOutcome['seasonPassTiers'] = [];
    if (!seasonClosed) {
      await getOrCreateCurrentPass(db, userId, now);
      boostedSeasonXp = Math.round(seasonXpAwarded * (1 + momentum.seasonXpBonus));
      seasonPassTiers = await addSeasonXp(db, userId, boostedSeasonXp, now, {
        description: `Stint — ${race.name}`,
        sourceRef: race.id,
      });
    }

    // -- 11. Trophies and the Hall of Fame ---------------------------------
    const profileAfter = await db.careerProfile.findUniqueOrThrow({ where: { userId } });
    // Metrics are reused rather than recomputed: `computeCareerMetrics` is
    // eight queries, and the only figures that moved since it ran are ones we
    // already know exactly. Re-querying inside an open transaction to learn
    // numbers we are holding would be a waste of a long lock.
    const metricsAfter = {
      ...metrics,
      achievementsUnlocked: metrics.achievementsUnlocked + achievements.length,
      masteryNodesUnlocked: metrics.masteryNodesUnlocked + mastery.length,
      level: profileAfter.level,
      prestige: profileAfter.prestige,
      careerXp: Number(profileAfter.careerXp),
      careerXpMillions: Math.round((Number(profileAfter.careerXp) / 1_000_000) * 100) / 100,
    };

    const awards = await syncAwards(
      db,
      userId,
      {
        metrics: metricsAfter,
        storyCompletedRace: aggregates.becameStoryComplete
          ? { id: race.id, name: race.name, runtimeSec: race.runtimeSec, isMajorEvent: race.isMajorEvent }
          : undefined,
        completedCollections: collections.completedCollections,
        masteryUnlocks: mastery,
        achievementUnlocks: achievements,
        levelAfter: profileAfter.level,
        levelsGained: profileAfter.level - levelBefore,
        prestigeGained: profileAfter.prestige - profileBefore.prestige,
        seasonPassCompleted: seasonPassTiers.some((t) => t.tier >= 100),
      },
      now,
    );

    // -- 12. Assemble the stint summary ------------------------------------
    const championshipMastery = race.championshipId
      ? await getMasteryForChampionship(userId, race.championshipId).catch(() => null)
      : null;

    const runtime = Math.max(1, race.runtimeSec);
    const realMinutes = window.realSeconds / 60;

    return {
      sessionId: session.id,
      raceId: race.id,
      raceName: race.name,

      realSeconds: window.realSeconds,
      timelineSeconds: window.timelineSeconds,
      newCoverageSeconds: addedSeconds,
      playbackSpeed: window.playbackSpeed,

      coverageBeforePercent: Math.round((coverageBefore / runtime) * 1000) / 10,
      coverageAfterPercent: Math.round((aggregates.coverageSec / runtime) * 1000) / 10,

      careerXpAwarded,
      seasonXpAwarded: boostedSeasonXp,
      xpBreakdown,
      seasonClosure: seasonClosureNotice(now),

      levelBefore,
      levelAfter: profileAfter.level,
      levelsGained: profileAfter.level - levelBefore,
      newTitle: profileAfter.level > levelBefore ? profileAfter.titleKey : null,
      prestigeGained: profileAfter.prestige - profileBefore.prestige,

      storyCompleted: aggregates.becameStoryComplete,
      storyCompleteBonus: storyBonusAwarded,

      achievements,
      milestones,
      mastery,
      challenges,
      seasonPassTiers,
      collections,
      trophies: awards.trophies,
      hallOfFame: awards.hallOfFame,

      momentum,
      streak,

      weekActualHours: 0,
      weekRecommendedHours: 0,

      championshipMastery: championshipMastery
        ? { name: championshipMastery.name, percent: championshipMastery.completionPercent }
        : null,

      heading: stintHeading(realMinutes),
      celebrate: chooseCelebration({
        storyCompleted: aggregates.becameStoryComplete,
        runtimeSec: race.runtimeSec,
        seasonCompleted: collections.completedCollections.length > 0,
        masteryTreeCompleted: mastery.some((m) => m.treeCompleted),
        prestigeGained: profileAfter.prestige - profileBefore.prestige,
        rareUnlock: achievements.some((a) => a.rarity === 'LEGENDARY' || a.rarity === 'MYTHIC'),
        levelsGained: profileAfter.level - levelBefore,
      }),
    } satisfies SessionOutcome;
  }, TRANSACTION_OPTIONS).then(async (outcome) => {
    // The weekly budget figures are read outside the transaction: they are
    // presentation, not progression, and keeping them out keeps the atomic
    // section as small as it can be.
    const budget = await getBudgetSnapshot(userId, now).catch(() => null);
    return budget
      ? { ...outcome, weekActualHours: budget.weekActualHours, weekRecommendedHours: budget.weekRecommendedHours }
      : outcome;
  });
}

/**
 * Decide how loudly to celebrate.
 *
 * Ordinary stints get a quiet, satisfying panel. The full-screen treatment is
 * reserved for the genuinely rare: a completed 24-hour race, a finished
 * season, a completed mastery tree, a prestige rank. Over-celebrating an
 * ordinary session is what turns a hobby into a slot machine.
 */
export function chooseCelebration(facts: {
  storyCompleted: boolean;
  runtimeSec: number;
  seasonCompleted: boolean;
  masteryTreeCompleted: boolean;
  prestigeGained: number;
  rareUnlock: boolean;
  levelsGained: number;
}): 'QUIET' | 'NOTABLE' | 'SPECTACULAR' {
  const isLongHaul = facts.runtimeSec >= TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec;
  if (
    facts.prestigeGained > 0 ||
    facts.seasonCompleted ||
    facts.masteryTreeCompleted ||
    (facts.storyCompleted && isLongHaul)
  ) {
    return 'SPECTACULAR';
  }
  if (facts.storyCompleted || facts.rareUnlock || facts.levelsGained > 0) return 'NOTABLE';
  return 'QUIET';
}

/**
 * Remove a logged session.
 *
 * Coverage is rebuilt from the REMAINING sessions rather than by subtracting
 * the deleted interval, because intervals merge and subtraction would not be
 * sound.
 *
 * XP FOLLOWS THE DATA. Deleting a stint deletes the XP that stint earned, and
 * every total is then rebuilt from the ledger. An earlier version of this
 * function deliberately left the XP in place, reasoning that there is no
 * negative XP in this application and that correcting a typo should never feel
 * like a punishment. The reasoning was sound; the conclusion was not. It left
 * the career contradicting itself — the race reading "not started" while the
 * career kept the XP for watching it — and it made test data permanent, since
 * nothing short of deleting the database could take it back.
 *
 * The distinction that resolves it: "never punish" forbids taking XP away as a
 * PENALTY — for a missed week, a broken streak, a budget overrun. None of that
 * exists here and none of it ever will. Removing an entry the user is deleting
 * on purpose is not a penalty, it is the truth catching up. And it is still
 * done without a single negative number: the ledger rows cease to exist and the
 * totals are recomputed from what remains.
 *
 * What is NOT taken back: achievements, trophies, mastery nodes, collections,
 * Hall of Fame entries, unlocked season-pass rewards, streaks and momentum.
 * Those are landmarks rather than balances, and nothing in this application
 * revokes something it has already given.
 */
export async function deleteViewingSession(
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<SessionRemoval> {
  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const session = await db.raceViewingSession.findFirstOrThrow({
      where: { id: sessionId, userId },
      select: { id: true, raceId: true },
    });

    // Before the row goes: the XPTransaction relation is `onDelete: SetNull`,
    // so deleting the session first would strand its awards with a null
    // sessionId and no way left to identify them.
    const revoked = await revokeSessionXp(db, userId, session.id);

    await db.raceViewingSession.delete({ where: { id: session.id } });

    const remaining = await db.raceViewingSession.findMany({
      where: { raceId: session.raceId },
      select: { startTimestampSec: true, endTimestampSec: true },
      orderBy: { watchedAt: 'asc' },
    });

    const race = await db.race.findUniqueOrThrow({
      where: { id: session.raceId },
      select: { runtimeSec: true },
    });

    let rebuilt: { start: number; end: number }[] = [];
    for (const row of remaining) {
      rebuilt = addInterval(rebuilt, { start: row.startTimestampSec, end: row.endTimestampSec }, {
        limit: race.runtimeSec,
        gapTolerance: STORY_CONFIG.gapToleranceSeconds,
      }).intervals;
    }

    await db.watchedInterval.deleteMany({ where: { raceId: session.raceId } });
    if (rebuilt.length > 0) {
      await db.watchedInterval.createMany({
        data: rebuilt.map((interval) => ({
          raceId: session.raceId,
          startSec: interval.start,
          endSec: interval.end,
        })),
      });
    }

    const aggregates = await recomputeRaceAggregates(db, session.raceId, now);

    // The Story Complete bonus is keyed to the RACE, not to whichever stint
    // happened to finish it, so it is governed by whether the race is still
    // complete rather than by which session was removed. Deleting the row is
    // what frees the unique dedupeKey — without that, a race that dropped below
    // the threshold could never award the bonus again, because re-completing it
    // would be silently swallowed as a duplicate.
    const storyBonus =
      aggregates.storyCompletedAt === null
        ? await revokeXpByDedupeKey(db, userId, `story-complete:${session.raceId}`)
        : { transactions: 0, careerXp: 0, seasonXp: 0 };

    // Rebuild rather than decrement. Career XP, level, prestige, title and the
    // per-transaction running totals the XP graph is drawn from all come back
    // out of the ledger, which is the only thing that was ever authoritative.
    const ledger = await rebuildCareerTotals(db, userId);
    await rebuildSeasonXpFromLedger(db, userId);

    return {
      raceId: session.raceId,
      careerXpRemoved: revoked.careerXp + storyBonus.careerXp,
      seasonXpRemoved: revoked.seasonXp + storyBonus.seasonXp,
      storyBonusRemoved: storyBonus.transactions > 0,
      levelBefore: ledger.levelBefore,
      levelAfter: ledger.levelAfter,
      careerXpBefore: ledger.careerXpBefore,
      careerXpAfter: ledger.careerXpAfter,
      remainingSessions: aggregates.sessionCount,
    };
  }, TRANSACTION_OPTIONS);
}

/** Real viewing hours logged in a window. Re-exported for the dashboard. */
export { recordedHoursInRange };

/** Exposed so the stint summary can show the XP rate the user is earning at. */
export const XP_PER_REAL_MINUTE = XP_CONFIG.xpPerRealMinute;

/** What a ledger repair put right. */
export interface LedgerRepair {
  /** Viewing awards whose stint had already been deleted. */
  orphanedTransactions: number;
  /** Story Complete bonuses held by races that are no longer complete. */
  staleStoryBonuses: number;
  careerXpBefore: number;
  careerXpAfter: number;
  levelBefore: number;
  levelAfter: number;
}

/**
 * Put a career's XP back in step with its data.
 *
 * Two things can leave a ledger overstated, and both predate the rule that XP
 * follows the data:
 *
 *   1. Viewing XP left behind by a stint that was deleted. Those rows still
 *      count towards the career total even though the stint they describe is
 *      gone — which is exactly how a career ends up permanently inflated by
 *      data that was entered to try the app out and then removed.
 *   2. A Story Complete bonus still held by a race that is no longer complete.
 *      Worse than the XP, its unique dedupeKey blocks the bonus from ever being
 *      earned again.
 *
 * Both are repaired by deletion, never by a negative adjustment, and the totals
 * are then rebuilt from what remains. Running it on a healthy career changes
 * nothing, so it is safe to run whenever.
 */
export async function repairXpLedger(userId: string): Promise<LedgerRepair> {
  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;

    const orphaned = await purgeOrphanedSessionXp(db, userId);

    const bonuses = await db.xPTransaction.findMany({
      where: { userId, source: 'STORY_COMPLETE', dedupeKey: { startsWith: 'story-complete:' } },
      select: { id: true, dedupeKey: true },
    });

    let staleStoryBonuses = 0;
    for (const bonus of bonuses) {
      const raceId = bonus.dedupeKey?.slice('story-complete:'.length);
      if (!raceId) continue;
      const race = await db.race.findFirst({
        where: { id: raceId, userId },
        select: { storyCompletedAt: true },
      });
      // A missing race means the bonus outlived what earned it just as surely
      // as an incomplete one does.
      if (race && race.storyCompletedAt !== null) continue;
      await db.xPTransaction.delete({ where: { id: bonus.id } });
      staleStoryBonuses += 1;
    }

    const ledger = await rebuildCareerTotals(db, userId);
    await rebuildSeasonXpFromLedger(db, userId);

    return {
      orphanedTransactions: orphaned.transactions,
      staleStoryBonuses,
      careerXpBefore: ledger.careerXpBefore,
      careerXpAfter: ledger.careerXpAfter,
      levelBefore: ledger.levelBefore,
      levelAfter: ledger.levelAfter,
    };
  }, TRANSACTION_OPTIONS);
}
