/**
 * Reconstruct a stint summary from committed data.
 *
 * The figures a summary shows — XP, coverage before and after, what unlocked —
 * are all recorded at the time, so the summary can be rebuilt afterwards
 * rather than held in client state. That means a refresh shows the same
 * numbers, and a summary can be revisited from the session history.
 */

import { prisma } from '@/lib/db/client';
import type { SessionOutcome } from '@/lib/engines/contracts';
import { stintHeading } from '@/lib/copy/tone';
import { chooseCelebration } from '@/lib/engines/session-engine';
import { getMomentum, getStreak } from '@/lib/engines/momentum-engine';
import { getBudgetSnapshot } from '@/lib/engines/budget-engine';
import { getMasteryForChampionship } from '@/lib/engines/mastery-engine';
import { MILESTONES, TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { isSeasonClosed } from '@/lib/domain/season-closure';
import { seasonClosureNotice } from '@/lib/engines/season-pass-engine';

export async function buildOutcomeForSession(
  userId: string,
  sessionId: string,
): Promise<SessionOutcome | null> {
  const session = await prisma.raceViewingSession.findFirst({
    where: { id: sessionId, userId },
    select: {
      id: true, raceId: true, realSeconds: true, timelineSeconds: true,
      newCoverageSeconds: true, playbackSpeed: true, coverageBeforeSec: true,
      coverageAfterSec: true, watchedAt: true, createdAt: true,
      race: {
        select: {
          id: true, name: true, runtimeSec: true, storyCompletedAt: true,
          championshipId: true, championship: { select: { name: true } },
        },
      },
      xpTransactions: {
        select: { source: true, amount: true, seasonAmount: true, description: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!session) return null;

  const runtime = Math.max(1, session.race.runtimeSec);
  // Everything awarded in the same transaction as this session belongs to it.
  const windowStart = new Date(session.watchedAt.getTime() - 5 * 60_000);

  const [profile, momentum, streak, budget, achievements, mastery, challenges, milestones, tiers, trophies, hallOfFame] =
    await Promise.all([
      prisma.careerProfile.findUniqueOrThrow({ where: { userId } }),
      getMomentum(userId).catch(() => null),
      getStreak(userId).catch(() => null),
      getBudgetSnapshot(userId).catch(() => null),
      prisma.achievementProgress.findMany({
        where: { userId, unlockedAt: { gte: windowStart } },
        select: { achievement: true, unlockedAt: true },
      }),
      prisma.masteryProgress.findMany({
        where: { userId, unlockedAt: { gte: windowStart } },
        select: { node: { select: { key: true, name: true, description: true, rarity: true, xpReward: true, tree: { select: { key: true, name: true } } } } },
      }),
      prisma.challengeProgress.findMany({
        where: { challenge: { userId }, completedAt: { gte: windowStart } },
        select: {
          completedAt: true,
          challenge: { select: { id: true, scope: true, title: true, xpReward: true, seasonXpReward: true } },
        },
      }),
      prisma.milestoneProgress.findMany({
        where: { userId, reachedAt: { gte: windowStart } },
        select: { metric: true, threshold: true, valueAtReach: true, xpAwarded: true },
      }),
      prisma.seasonPassProgress.findMany({
        where: { seasonPass: { userId }, unlockedAt: { gte: windowStart } },
        orderBy: { tier: 'asc' },
      }),
      prisma.trophy.findMany({ where: { userId, awardedAt: { gte: windowStart } } }),
      prisma.hallOfFameEntry.findMany({ where: { userId, occurredAt: { gte: windowStart } } }),
    ]);

  const careerXpAwarded = session.xpTransactions.reduce((sum, t) => sum + t.amount, 0);
  const seasonXpAwarded = session.xpTransactions.reduce((sum, t) => sum + t.seasonAmount, 0);
  const storyBonus = session.xpTransactions.find((t) => t.source === 'STORY_COMPLETE')?.amount ?? 0;

  const championshipMastery = session.race.championshipId
    ? await getMasteryForChampionship(userId, session.race.championshipId).catch(() => null)
    : null;

  return {
    sessionId: session.id,
    raceId: session.raceId,
    raceName: session.race.name,

    realSeconds: session.realSeconds,
    timelineSeconds: session.timelineSeconds,
    newCoverageSeconds: session.newCoverageSeconds,
    playbackSpeed: session.playbackSpeed,

    coverageBeforePercent: Math.round((session.coverageBeforeSec / runtime) * 1000) / 10,
    coverageAfterPercent: Math.round((session.coverageAfterSec / runtime) * 1000) / 10,

    careerXpAwarded,
    seasonXpAwarded,
    xpBreakdown: session.xpTransactions.map((t) => ({ label: t.description, amount: t.amount })),
    // Decided by when the stint was logged (the row's `createdAt`, stamped in
    // the same transaction), not when the summary is read and not `watchedAt`,
    // which can be backdated: the engine decided by the time of logging too.
    seasonClosure: seasonClosureNotice(session.createdAt),

    levelBefore: profile.level,
    levelAfter: profile.level,
    levelsGained: 0,
    newTitle: null,
    prestigeGained: 0,

    storyCompleted: storyBonus > 0,
    storyCompleteBonus: storyBonus,

    achievements: achievements.map((a) => ({
      key: a.achievement.key,
      name: a.achievement.name,
      description: a.achievement.description,
      rarity: a.achievement.rarity,
      iconKey: a.achievement.iconKey,
      xpAwarded: a.achievement.xpReward,
    })),
    milestones: milestones.map((m) => ({
      metric: m.metric,
      // The stored row holds the metric key; the human label lives with the
      // definition. Falling back to the key would print "1 realhours".
      label: MILESTONE_LABELS.get(m.metric) ?? m.metric,
      threshold: m.threshold,
      value: m.valueAtReach ?? m.threshold,
      xpAwarded: m.xpAwarded,
    })),
    mastery: mastery.map((m) => ({
      treeKey: m.node.tree.key,
      treeName: m.node.tree.name,
      nodeKey: m.node.key,
      nodeName: m.node.name,
      description: m.node.description,
      rarity: m.node.rarity,
      xpAwarded: m.node.xpReward,
      treeProgress: 0,
      treeCompleted: false,
    })),
    challenges: challenges.map((c) => ({
      id: c.challenge.id,
      scope: c.challenge.scope,
      title: c.challenge.title,
      xpAwarded: c.challenge.xpReward,
      // A challenge completed while the season was closed (0.3.1) paid no
      // season XP, whatever its row says it offered.
      seasonXpAwarded: isSeasonClosed(c.completedAt ?? session.watchedAt) ? 0 : c.challenge.seasonXpReward,
    })),
    seasonPassTiers: tiers.map((t) => ({
      tier: t.tier,
      rewardKey: t.rewardKey,
      rewardName: t.rewardName,
      rewardType: t.rewardType,
      rarity: t.rewardRarity,
      isMilestone: t.isMilestone,
    })),
    collections: { completedCollections: [], filledItems: [] },
    trophies: trophies.map((t) => ({
      key: t.key, name: t.name, description: t.description,
      category: t.category, rarity: t.rarity, iconKey: t.iconKey,
    })),
    hallOfFame: hallOfFame.map((h) => ({
      key: h.key, title: h.title, subtitle: h.subtitle, category: h.category, rarity: h.rarity,
    })),

    momentum: momentum ?? FALLBACK_MOMENTUM,
    streak: streak ?? FALLBACK_STREAK,

    weekActualHours: budget?.weekActualHours ?? 0,
    weekRecommendedHours: budget?.weekRecommendedHours ?? 0,

    championshipMastery: championshipMastery
      ? { name: championshipMastery.name, percent: championshipMastery.completionPercent }
      : null,

    heading: stintHeading(session.realSeconds / 60),
    celebrate: chooseCelebration({
      storyCompleted: storyBonus > 0,
      runtimeSec: session.race.runtimeSec,
      seasonCompleted: false,
      masteryTreeCompleted: false,
      prestigeGained: 0,
      rareUnlock: achievements.some((a) => a.achievement.rarity === 'LEGENDARY' || a.achievement.rarity === 'MYTHIC'),
      levelsGained: 0,
    }),
  };
}

const FALLBACK_MOMENTUM = {
  points: 0, tierKey: 'cold_tyres', tierName: 'Cold Tyres', tierColor: '#5b6b7a',
  tierBlurb: 'Out of the pits. No pressure.', progressToNext: 0, nextTierName: null,
  pointsToNext: 0, seasonXpBonus: 0,
};

const FALLBACK_STREAK = {
  currentDays: 0, longestDays: 0, lifetimeActiveDays: 0, lifetimeActiveWeeks: 0,
  lastActiveDate: null, daysSinceLastActive: 0,
};

/** Metric key to the human label the milestone was defined with. */
const MILESTONE_LABELS: ReadonlyMap<string, string> = new Map(
  MILESTONES.map((def) => [def.metric, def.label]),
);

export const LONG_HAUL_THRESHOLD = TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec;
