/**
 * Dashboard assembly.
 *
 * One place that gathers what the home page shows, so the page component stays
 * a layout and every engine is called exactly once. Engines that are not
 * essential to the page degrade to null rather than taking the dashboard down
 * with them — opening the application should always work.
 */

import { prisma } from '@/lib/db/client';
import { computeCareerMetrics } from '@/lib/engines/metrics';
import { getBudgetSnapshot } from '@/lib/engines/budget-engine';
import { getRecommendations } from '@/lib/engines/strategist-engine';
import { getMomentum, getStreak } from '@/lib/engines/momentum-engine';
import { ensureChallenges, expireStaleChallenges, getActiveChallenges } from '@/lib/engines/challenge-engine';
import {
  archiveExpiredPasses, getSeasonPassView, seasonPassClosure, type SeasonPassClosure,
} from '@/lib/engines/season-pass-engine';
import { getCareerView } from './career';
import { getCurrentStint } from './races';
import { welcomeBack } from '@/lib/copy/tone';
import type { BudgetSnapshot, Recommendation } from '@/lib/engines/contracts';
import type { ChallengeRow, SeasonPassSummaryData, UnlockRowData, CareerSnapshotData } from '@/components/dashboard/panels';
import type { CareerHeaderData } from '@/components/dashboard/career-header';
import type { CurrentStintData } from '@/components/dashboard/current-stint';

export interface DashboardData {
  header: CareerHeaderData;
  stint: CurrentStintData | null;
  recommendations: Recommendation[];
  budget: BudgetSnapshot | null;
  seasonPass: SeasonPassSummaryData | null;
  /**
   * Set while the season pass is closed (0.3.1): when it reopens and what the
   * reopening pass offers. Null once it is open. `seasonPass` is null
   * throughout the closure, because no pass exists.
   */
  seasonPassClosure: SeasonPassClosure | null;
  challenges: ChallengeRow[];
  unlocks: UnlockRowData[];
  snapshot: CareerSnapshotData;
  unwatchedCount: number;
}

export async function getDashboard(userId: string, now: Date = new Date()): Promise<DashboardData> {
  // Housekeeping first, so the page reflects the current period rather than
  // whatever was true when it was last opened. All of it is idempotent.
  await Promise.all([
    ensureChallenges(userId, now).catch(() => undefined),
    expireStaleChallenges(userId, now).catch(() => undefined),
    archiveExpiredPasses(userId, now).catch(() => undefined),
  ]);

  const [career, momentum, streak, stint, recommendations, budget, pass, challenges, metrics, unlocks, unwatchedCount] =
    await Promise.all([
      getCareerView(userId, now),
      getMomentum(userId, now).catch(() => null),
      getStreak(userId, now).catch(() => null),
      getCurrentStint(userId),
      getRecommendations(userId, { now }).catch(() => [] as Recommendation[]),
      getBudgetSnapshot(userId, now).catch(() => null),
      getSeasonPassView(userId).catch(() => null),
      getActiveChallenges(userId, now).catch(() => []),
      computeCareerMetrics(userId),
      recentUnlocks(userId),
      prisma.race.count({
        where: { userId, coverageSec: 0, status: { notIn: ['ARCHIVED', 'ABANDONED', 'COMPLETED'] } },
      }),
    ]);

  const daysAway = streak?.daysSinceLastActive ?? career.daysSinceLastActive;

  return {
    header: {
      level: career.level,
      xpIntoLevel: career.xpIntoLevel,
      xpForLevel: career.xpForLevel,
      progress: career.progress,
      careerXp: career.careerXp,
      prestige: career.prestige,
      prestigeLabel: career.prestigeLabel,
      title: career.title,
      nextTitle: career.nextTitle,
      momentum: momentum ?? {
        points: career.momentumPoints,
        tierKey: career.momentumTierKey,
        tierName: 'Cold Tyres',
        tierColor: '#5b6b7a',
        tierBlurb: 'Out of the pits. No pressure.',
        progressToNext: 0,
        nextTierName: null,
        pointsToNext: 0,
        seasonXpBonus: 0,
      },
      greeting: welcomeBack(daysAway),
    },

    stint,
    recommendations,
    budget,

    seasonPass: pass
      ? {
          label: pass.label,
          tier: pass.tier,
          tierCount: pass.tierCount,
          seasonXp: pass.seasonXp,
          intoTier: pass.intoTier,
          tierCost: pass.tierCost,
          daysRemaining: pass.daysRemaining,
          nextRewardName: pass.nextTiers[0]?.rewardName ?? null,
          nextRewardRarity: pass.nextTiers[0]?.rarity ?? null,
        }
      : null,

    seasonPassClosure: seasonPassClosure(now),

    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      scope: challenge.scope,
      title: challenge.title,
      description: challenge.description,
      value: challenge.value,
      target: challenge.target,
      completed: challenge.state === 'COMPLETED',
      expired: challenge.state === 'EXPIRED',
      xpReward: challenge.xpReward,
      endsAt: challenge.periodEnd.toISOString(),
    })),

    unlocks,

    snapshot: {
      realHours: metrics.realHours,
      storyCompletes: metrics.storyCompletes,
      seasonsCompleted: metrics.seasonsCompleted,
      level: career.level,
      racesInLibrary: metrics.racesInLibrary,
      championships: metrics.championships,
      circuits: metrics.circuits,
      equivalentDays: Math.round((metrics.realHours / 24) * 10) / 10,
    },

    unwatchedCount,
  };
}

/**
 * The most recent things to unlock, across every system.
 *
 * A shelf rather than a feed: it celebrates what happened, and says nothing at
 * all about what has not.
 */
async function recentUnlocks(userId: string, limit = 8): Promise<UnlockRowData[]> {
  const [achievements, mastery, trophies, hallOfFame] = await Promise.all([
    prisma.achievementProgress.findMany({
      where: { userId, unlockedAt: { not: null } },
      orderBy: { unlockedAt: 'desc' },
      take: limit,
      select: { achievement: { select: { key: true, name: true, description: true, rarity: true } }, unlockedAt: true },
    }),
    prisma.masteryProgress.findMany({
      where: { userId, unlockedAt: { not: null } },
      orderBy: { unlockedAt: 'desc' },
      take: limit,
      select: {
        unlockedAt: true,
        node: { select: { key: true, name: true, rarity: true, tree: { select: { key: true, name: true } } } },
      },
    }),
    prisma.trophy.findMany({
      where: { userId },
      orderBy: { awardedAt: 'desc' },
      take: limit,
      select: { key: true, name: true, description: true, rarity: true, awardedAt: true },
    }),
    prisma.hallOfFameEntry.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: { key: true, title: true, subtitle: true, rarity: true, occurredAt: true },
    }),
  ]);

  const rows: UnlockRowData[] = [
    ...achievements.map((row) => ({
      key: `achievement:${row.achievement.key}`,
      kind: 'achievement' as const,
      name: row.achievement.name,
      detail: row.achievement.description,
      rarity: row.achievement.rarity,
      at: (row.unlockedAt ?? new Date()).toISOString(),
      href: '/achievements',
    })),
    ...mastery.map((row) => ({
      // Node keys are unique within a tree, not across them: every
      // championship tree has a `first_race`. The tree has to be in the key.
      key: `mastery:${row.node.tree.key}:${row.node.key}`,
      kind: 'mastery' as const,
      name: row.node.name,
      detail: row.node.tree.name,
      rarity: row.node.rarity,
      at: (row.unlockedAt ?? new Date()).toISOString(),
      href: '/mastery',
    })),
    ...trophies.map((row) => ({
      key: `trophy:${row.key}`,
      kind: 'trophy' as const,
      name: row.name,
      detail: row.description,
      rarity: row.rarity,
      at: row.awardedAt.toISOString(),
      href: '/trophies',
    })),
    ...hallOfFame.map((row) => ({
      key: `hof:${row.key}`,
      kind: 'hall-of-fame' as const,
      name: row.title,
      detail: row.subtitle,
      rarity: row.rarity,
      at: row.occurredAt.toISOString(),
      href: '/hall-of-fame',
    })),
  ];

  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
