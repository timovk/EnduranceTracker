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
import { STORY_CONFIG, TIMELINE_SHAPE, XP_CONFIG, TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { editionFingerprint, editionYear, serialiseFingerprint } from '@/lib/domain/edition';
import { addInterval, clampIntervals, coverageSeconds, fromRows } from '@/lib/domain/intervals';
import { clampSpeed, realSecondsFor, timelineSecondsFor } from '@/lib/domain/playback';
import { storyCompleteBonus, xpForSession } from '@/lib/domain/progression';
import { stintHeading } from '@/lib/copy/tone';
import { isSeasonClosed } from '@/lib/domain/season-closure';
import type { SessionInput } from '@/lib/validation/schemas';
import type { RaceRemoval, SessionOutcome, SessionRemoval } from './contracts';
import {
  awardXp,
  combineRevocations,
  purgeOrphanedSessionXp,
  rebuildCareerTotals,
  revokeRaceViewingXp,
  revokeSessionsXp,
  revokeSessionXp,
  revokeXpByDedupeKey,
  revokeXpByDedupeKeys,
  settleLedger,
  type LedgerRebuild,
  type XpRevocation,
} from './xp-ledger';
import { computeCareerMetricsWithHistory } from './metrics';
import { rebuildRaceIntervals, recomputeRaceAggregates } from './race-engine';
import { storyBonusKey } from './progression-resync';
import {
  fillLandmarkDates, isCareerMilestoneRung, listStintCareerMilestones, syncCareerMilestones,
} from './career-milestone-engine';
import {
  highestMilestoneCelebration, levelForMilestone, louderLevel, type MilestoneCelebration,
} from '@/lib/domain/celebration';
import {
  expeditionOutcomeOf, heldExpeditionKeys, reconcileExpedition, writeExpeditionSummary, type ExpeditionSummaryWrite,
} from './expedition-engine';

import { applyMomentumForSession, updateStreak } from './momentum-engine';
import {
  addSeasonXp, getOrCreateCurrentPass, seasonClosureNotice,
} from './season-pass-engine';
import { evaluateChallenges } from './challenge-engine';
import { syncAchievements, syncMilestones } from './achievement-engine';
import {
  ensureMasteryTrees, syncMastery, recomputeRaceMasteries, getMasteryForChampionship, writeMissingEventStepCredits,
} from './mastery-engine';
import { ensureSeasonCollections, syncCollections } from './collection-engine';
import { syncAwards } from './awards-engine';
import { recordedHoursInRange, getBudgetSnapshot } from './budget-engine';

/**
 * Prisma's default interactive-transaction timeout is far too short for this
 * much orchestration. These are generous on purpose: correctness of a single
 * logged session beats shaving milliseconds off it.
 */
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

/** Why a stint was refused. */
export type InvalidStintReason = 'future-watched-at';

/**
 * A stint the engine will not log.
 *
 * Thrown before anything is written, so a refused stint leaves no trace. The
 * server action turns it into a plain sentence; nothing about it is an error
 * the user did wrong in any way that matters.
 */
export class InvalidStintError extends Error {
  readonly reason: InvalidStintReason;

  constructor(reason: InvalidStintReason) {
    super(reason === 'future-watched-at' ? 'The stint is dated in the future.' : 'The stint cannot be logged.');
    this.name = 'InvalidStintError';
    this.reason = reason;
  }
}

/**
 * The latest instant a stint may be dated: now, plus a few minutes for a clock
 * that runs a little fast. A stint's `watchedAt` is when it was logged, and a
 * stint dated tomorrow would date a milestone or a record in the future.
 */
export function latestAcceptedWatchedAt(now: Date): Date {
  return new Date(now.getTime() + TIMELINE_SHAPE.futureWatchedAtSlackMinutes * 60_000);
}

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
  // Backdated stints stay accepted (the engine takes any past `watchedAt`);
  // only a stint dated after now is refused, before anything is written.
  if (watchedAt > latestAcceptedWatchedAt(now)) throw new InvalidStintError('future-watched-at');

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
    // Coverage is measured on the set cut at the runtime, as the aggregates
    // measure it: a race whose runtime was shortened under 0.3.x can still
    // hold intervals past its new end, and they are not coverage.
    const coverageBefore = coverageSeconds(clampIntervals(existing, race.runtimeSec));

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
        coverageAfterSec: coverageSeconds(clampIntervals(mergedIntervals, race.runtimeSec)),
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
    //
    // Clamped to the runtime. A race whose runtime was shortened before 0.4.0
    // can hold coverage past its new end, and a bonus it was paid on the
    // strength of that coverage is no longer supported once the clamp applies.
    const aggregates = await recomputeRaceAggregates(db, race.id, now);

    // A Story Complete bonus the race no longer supports goes before anything
    // is paid, and the ledger is settled at once: every award below is then
    // stamped on the career as it really is, and achievements and milestones
    // are measured against it rather than against XP that is about to go.
    const storyBonusRevocation = aggregates.storyCompletedAt === null
      ? await revokeXpByDedupeKey(db, userId, storyBonusKey(race.id))
      : null;
    if (storyBonusRevocation !== null) await settleLedger(db, userId, [storyBonusRevocation]);

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
        dedupeKey: storyBonusKey(race.id),
      });
      storyBonusAwarded = award.granted;
      careerXpAwarded += award.granted;
      seasonXpAwarded += award.duplicate ? 0 : bonusSeasonXp;
      if (award.granted > 0) {
        xpBreakdown.push({ label: `Story Complete (${bonus.label})`, amount: award.granted });
      }
    }

    // -- 5a. The Expedition's checkpoints (0.4.0) --------------------------
    //
    // From the race's replay, which now includes this stint. On this path the
    // coverage only grows and the runtime cannot change, so it only pays, and
    // every checkpoint it pays names this stint (§4.3.2).
    const expedition = await reconcileExpedition(db, userId, race.id, { crossingSessionId: session.id });
    for (const checkpoint of expedition.awarded) {
      xpBreakdown.push({ label: `Expedition — ${checkpoint.percent}% of the story`, amount: checkpoint.xp });
      careerXpAwarded += checkpoint.xp;
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
    // session that was just written. The career history they were computed
    // from comes with them, for the Career Milestones below.
    const { metrics, history } = await computeCareerMetricsWithHistory(userId, db);
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

    // -- 9a. Career Milestones (0.4.0) -------------------------------------
    //
    // The new rungs are reached and paid, then every landmark still without
    // a date is dated from the replay — which is built only when there is
    // one, so an ordinary stint never pays for it.
    const careerSync = await syncCareerMilestones(db, userId, { metrics, history, now });
    for (const reached of careerSync.reached) {
      if (reached.xpAwarded > 0) {
        xpBreakdown.push({ label: `Career milestone — ${reached.title}`, amount: reached.xpAwarded });
        careerXpAwarded += reached.xpAwarded;
      }
    }
    await fillLandmarkDates(db, userId, { history, now, recognisedBySessionId: session.id });

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

    const championshipMastery = race.championshipId
      ? await getMasteryForChampionship(userId, race.championshipId).catch(() => null)
      : null;
    const careerMilestones = await listStintCareerMilestones(db, userId, session.id);
    const ladderMilestones = milestones.filter((milestone) => !isCareerMilestoneRung(milestone));

    // -- 11a. The Expedition Summary (0.4.0) ---------------------------------
    //
    // Whenever an Expedition's story is complete and it has no summary yet —
    // not only on the completing stint, so a summary never hangs on a one-off
    // moment. Written live, with this stint's unlocks and its championship's
    // mastery as they are now, only when this stint completed the story;
    // otherwise it is retrospective and its unlocks are rebuilt.
    let summary: ExpeditionSummaryWrite | null = null;
    if (expedition.isExpedition && expedition.storyCompleted && expedition.history !== null) {
      const live = aggregates.becameStoryComplete && expedition.history.completingSessionId === session.id;
      summary = await writeExpeditionSummary(db, userId, race.id, now, {
        retrospective: !live,
        history: expedition.history,
        inputs: history,
        unlocks: live ? { achievements, milestones: ladderMilestones, careerMilestones, mastery } : undefined,
        championshipMastery: championshipMastery
          ? { name: championshipMastery.name, percent: championshipMastery.completionPercent }
          : null,
      });
    }

    // Anything taken back above is settled after the last award (R13). The
    // Story Complete revocation was settled at once; the checkpoints cannot be
    // revoked on this path, but the rule has no exceptions.
    await settleLedger(db, userId, [expedition.revocation]);

    const expeditionOutcome = expedition.history === null
      ? null
      : expeditionOutcomeOf({
        history: expedition.history,
        sessionId: session.id,
        paid: new Map(expedition.awarded
          .filter((checkpoint) => checkpoint.sessionId === session.id)
          .map((checkpoint) => [checkpoint.percent, checkpoint.xp])),
        summary: summary === null ? null : { id: summary.id, completingSessionId: summary.snapshot.completingSessionId },
      });

    // -- 12. Assemble the stint summary ------------------------------------
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
      coverageBeforeSec: coverageBefore,
      coverageAfterSec: aggregates.coverageSec,
      runtimeSec: race.runtimeSec,

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
      // A rung that is also a Career Milestone is shown with those instead.
      milestones: ladderMilestones,
      careerMilestones,
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

      expedition: expeditionOutcome,

      heading: stintHeading(realMinutes),
      celebrate: chooseCelebration({
        storyCompleted: aggregates.becameStoryComplete,
        runtimeSec: race.runtimeSec,
        seasonCompleted: collections.completedCollections.length > 0,
        masteryTreeCompleted: mastery.some((m) => m.treeCompleted),
        prestigeGained: profileAfter.prestige - profileBefore.prestige,
        rareUnlock: achievements.some((a) => a.rarity === 'LEGENDARY' || a.rarity === 'MYTHIC'),
        levelsGained: profileAfter.level - levelBefore,
        careerMilestoneCelebration: highestMilestoneCelebration(careerMilestones),
        expeditionCompleted: expeditionOutcome?.completed ?? false,
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
 * season, a completed mastery tree, a prestige rank, a major career
 * milestone. Over-celebrating an ordinary session is what turns a hobby into
 * a slot machine.
 *
 * `careerMilestoneCelebration` is the loudest celebration among the stint's
 * Career Milestones (0.4.0): a `notable` one makes the stint at least
 * NOTABLE, a `spectacular` one SPECTACULAR. Most milestones celebrate
 * `none` and are simply listed. What the summary then draws is
 * `celebrationView` (`domain/celebration`).
 *
 * `expeditionCompleted` — the stint completed an Expedition's story and its
 * summary was written (0.4.0) — is SPECTACULAR whatever the race's length:
 * following a race as an Expedition is exactly asking for that moment.
 */
export function chooseCelebration(facts: {
  storyCompleted: boolean;
  runtimeSec: number;
  seasonCompleted: boolean;
  masteryTreeCompleted: boolean;
  prestigeGained: number;
  rareUnlock: boolean;
  levelsGained: number;
  careerMilestoneCelebration: MilestoneCelebration;
  expeditionCompleted: boolean;
}): 'QUIET' | 'NOTABLE' | 'SPECTACULAR' {
  const isLongHaul = facts.runtimeSec >= TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec;
  const fromMilestones = levelForMilestone(facts.careerMilestoneCelebration);
  if (
    facts.prestigeGained > 0 ||
    facts.seasonCompleted ||
    facts.masteryTreeCompleted ||
    facts.expeditionCompleted ||
    (facts.storyCompleted && isLongHaul)
  ) {
    return 'SPECTACULAR';
  }
  if (facts.storyCompleted || facts.rareUnlock || facts.levelsGained > 0) return louderLevel('NOTABLE', fromMilestones);
  return fromMilestones;
}

/**
 * What the stint summary draws for the level chosen above. It lives with the
 * pure domain code, so the summary (a client component) can use it without
 * pulling the database into the browser; it is re-exported here beside the
 * choice it completes.
 */
export { celebrationView } from '@/lib/domain/celebration';

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

    // The merged coverage is rebuilt from the stints that remain, in canonical
    // order and clamped to the runtime — the one rebuild every path shares.
    await rebuildRaceIntervals(db, session.raceId);
    const aggregates = await recomputeRaceAggregates(db, session.raceId, now);

    // The Story Complete bonus is keyed to the RACE, not to whichever stint
    // happened to finish it, so it is governed by whether the race is still
    // complete rather than by which session was removed. Deleting the row is
    // what frees the unique dedupeKey — without that, a race that dropped below
    // the threshold could never award the bonus again, because re-completing it
    // would be silently swallowed as a duplicate.
    const storyBonus =
      aggregates.storyCompletedAt === null
        ? await revokeXpByDedupeKey(db, userId, storyBonusKey(session.raceId))
        : null;

    // The Expedition's checkpoints follow the coverage the same way: those the
    // remaining stints no longer reach come off, and free their keys. Nothing
    // new can be reached by removing a stint, so nothing is paid here — not
    // even a checkpoint an unfinished upgrade has yet to pay, which the
    // removal's figures would not account for.
    const expedition = await reconcileExpedition(db, userId, session.raceId, { award: false });

    // Rebuild rather than decrement. Career XP, level, prestige, title and the
    // per-transaction running totals the XP graph is drawn from all come back
    // out of the ledger, which is the only thing that was ever authoritative.
    const revocations = storyBonus === null ? [revoked, expedition.revocation] : [revoked, storyBonus, expedition.revocation];
    const ledger = await settleLedger(db, userId, revocations) ?? await unchangedLedger(db, userId);
    const expeditionXpRemoved = expedition.revoked.reduce((sum, checkpoint) => sum + checkpoint.xp, 0);

    return {
      raceId: session.raceId,
      careerXpRemoved: revoked.careerXp + (storyBonus?.careerXp ?? 0) + expeditionXpRemoved,
      seasonXpRemoved: revoked.seasonXp + (storyBonus?.seasonXp ?? 0),
      storyBonusRemoved: (storyBonus?.transactions ?? 0) > 0,
      expeditionXpRemoved,
      checkpointsRemoved: expedition.revoked.map((checkpoint) => checkpoint.percent),
      levelBefore: ledger.levelBefore,
      levelAfter: ledger.levelAfter,
      careerXpBefore: ledger.careerXpBefore,
      careerXpAfter: ledger.careerXpAfter,
      remainingSessions: aggregates.sessionCount,
    };
  }, TRANSACTION_OPTIONS);
}

/** The career as it stands, for a removal that took no XP back. */
async function unchangedLedger(db: Tx, userId: string): Promise<LedgerRebuild> {
  const profile = await db.careerProfile.findUniqueOrThrow({ where: { userId } });
  const careerXp = Number(profile.careerXp);
  return {
    careerXpBefore: careerXp,
    careerXpAfter: careerXp,
    levelBefore: profile.level,
    levelAfter: profile.level,
    rowsRestamped: 0,
  };
}

/**
 * Remove a race from the library, and the XP it earned with it (owner
 * decision D4).
 *
 * Exactly as if its stints had been deleted one by one: the viewing and
 * re-watch XP of every stint, the Story Complete bonus and its Expedition
 * checkpoints come off the ledger, and the totals are rebuilt from what
 * remains. Viewing XP left behind
 * by a stint deleted under an older version is found by the race it names
 * (`sourceRef`) and goes too.
 *
 * Landmarks stay: achievements, milestones, mastery nodes and trophies are
 * untouched, and a Hall of Fame plaque keeps its place with its link to the
 * race cleared. Nothing it helped reach is taken back — and the event steps
 * it helped reach are remembered by its edition (a tombstone credit), so the
 * same edition added again cannot pay them twice.
 *
 * Returns null when the race is not in this account's library.
 */
export async function deleteRace(
  userId: string,
  raceId: string,
  now: Date = new Date(),
): Promise<RaceRemoval | null> {
  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const race = await db.race.findFirst({
      where: { id: raceId, userId },
      select: {
        id: true, name: true, runtimeSec: true, raceDate: true, circuitSlug: true, season: { select: { year: true } },
      },
    });
    if (race === null) return null;

    const sessions = await db.raceViewingSession.findMany({
      where: { raceId: race.id, userId },
      select: { id: true },
    });

    // Before the cascade, which would null every `sessionId` on the way out.
    const viewing = await revokeSessionsXp(db, userId, sessions.map((session) => session.id));
    const orphaned = await revokeRaceViewingXp(db, userId, race.id);
    const storyBonus = await revokeXpByDedupeKeys(db, userId, [storyBonusKey(race.id)]);
    // Every checkpoint the race holds, by its exact key.
    const expedition = await revokeXpByDedupeKeys(db, userId, await heldExpeditionKeys(db, userId, race.id));

    // The event steps the race helped reach are credited to it first, and its
    // credits keep its edition's fingerprint once it is gone (a tombstone), so
    // the same edition added again cannot pay those steps a second time, in
    // this event or any other.
    await writeMissingEventStepCredits(db, userId);
    await db.eventStepCredit.updateMany({
      where: { userId, raceId: race.id },
      data: {
        fingerprint: serialiseFingerprint(editionFingerprint({
          editionYear: editionYear({ raceDate: race.raceDate, seasonYear: race.season?.year ?? null }),
          circuitSlug: race.circuitSlug,
          name: race.name,
          runtimeSec: race.runtimeSec,
        })),
      },
    });

    // Scoped by account as well as id, so the delete is safe on its own. It
    // cascades to the stints, their intervals and the collection cards; the
    // Hall of Fame keeps its plaque, and an Expedition Summary its snapshot,
    // with the race link cleared.
    await db.race.deleteMany({ where: { id: race.id, userId } });

    // The event caches drop the edition.
    await recomputeRaceMasteries(db, userId, now);

    const revocations = [viewing, orphaned, storyBonus, expedition];
    const ledger = await settleLedger(db, userId, revocations) ?? await unchangedLedger(db, userId);
    const removed = combineRevocations(revocations);

    return {
      raceName: race.name,
      sessionsRemoved: sessions.length,
      careerXpRemoved: removed.careerXp,
      seasonXpRemoved: removed.seasonXp,
      storyBonusRemoved: storyBonus.transactions > 0,
      expeditionXpRemoved: expedition.careerXp,
      levelBefore: ledger.levelBefore,
      levelAfter: ledger.levelAfter,
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
  /** Expedition checkpoints held for races that no longer exist. */
  staleExpeditionCheckpoints: number;
  careerXpBefore: number;
  careerXpAfter: number;
  levelBefore: number;
  levelAfter: number;
}

/**
 * Put a career's XP back in step with its data.
 *
 * Three things can leave a ledger overstated, and the first two predate the
 * rule that XP follows the data:
 *
 *   1. Viewing XP left behind by a stint that was deleted. Those rows still
 *      count towards the career total even though the stint they describe is
 *      gone — which is exactly how a career ends up permanently inflated by
 *      data that was entered to try the app out and then removed.
 *   2. A Story Complete bonus still held by a race that is no longer complete.
 *      Worse than the XP, its unique dedupeKey blocks the bonus from ever being
 *      earned again.
 *   3. An Expedition checkpoint held for a race that no longer exists
 *      (0.4.0). Deleting a race takes its checkpoints with it, so this is a
 *      repair for a ledger something else left behind. Checkpoints a race
 *      still in the library no longer supports are the Expedition
 *      reconcile's to take back, not this repair's.
 *
 * Both are repaired by deletion, never by a negative adjustment, and the totals
 * are then rebuilt from what remains. Running it on a healthy career changes
 * nothing, so it is safe to run whenever.
 */
export async function repairXpLedger(userId: string): Promise<LedgerRepair> {
  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;

    const orphaned = await purgeOrphanedSessionXp(db, userId);

    // Every race is read once, rather than once per bonus.
    const [bonuses, checkpoints, races] = await Promise.all([
      db.xPTransaction.findMany({
        where: { userId, source: 'STORY_COMPLETE', dedupeKey: { startsWith: 'story-complete:' } },
        select: { dedupeKey: true },
      }),
      db.xPTransaction.findMany({ where: { userId, source: 'EXPEDITION' }, select: { dedupeKey: true, sourceRef: true } }),
      db.race.findMany({ where: { userId }, select: { id: true, storyCompletedAt: true } }),
    ]);
    const complete = new Set(races.filter((race) => race.storyCompletedAt !== null).map((race) => race.id));
    const present = new Set(races.map((race) => race.id));

    // A missing race means the bonus outlived what earned it just as surely
    // as an incomplete one does.
    const staleKeys = bonuses
      .map((bonus) => bonus.dedupeKey)
      .filter((key): key is string => key !== null && !complete.has(key.slice('story-complete:'.length)));
    const stale = await revokeXpByDedupeKeys(db, userId, staleKeys);

    const orphanedCheckpoints = await revokeXpByDedupeKeys(db, userId, checkpoints
      .filter((row) => row.sourceRef === null || !present.has(row.sourceRef))
      .flatMap((row) => (row.dedupeKey === null ? [] : [row.dedupeKey])));

    // Settled from the earliest row either repair removed. This is also the
    // maintenance path, where a running total that drifted is put right, so
    // the whole ledger is replayed after it: a drift before the first removed
    // row is corrected too, and where the settle already did the work the
    // replay finds nothing to write.
    const revocations: XpRevocation[] = [orphaned, stale, orphanedCheckpoints];
    const settled = await settleLedger(db, userId, revocations);
    const ledger = await rebuildCareerTotals(db, userId);

    return {
      orphanedTransactions: orphaned.transactions,
      staleStoryBonuses: stale.transactions,
      staleExpeditionCheckpoints: orphanedCheckpoints.transactions,
      careerXpBefore: settled?.careerXpBefore ?? ledger.careerXpBefore,
      careerXpAfter: ledger.careerXpAfter,
      levelBefore: settled?.levelBefore ?? ledger.levelBefore,
      levelAfter: ledger.levelAfter,
    };
  }, TRANSACTION_OPTIONS);
}
