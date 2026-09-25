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
import { highestMilestoneCelebration } from '@/lib/domain/celebration';
import { chooseCelebration } from '@/lib/engines/session-engine';
import { getMomentum, getStreak } from '@/lib/engines/momentum-engine';
import { getBudgetSnapshot } from '@/lib/engines/budget-engine';
import { getMasteryForChampionship } from '@/lib/engines/mastery-engine';
import { isCareerMilestoneRung, listStintCareerMilestones } from '@/lib/engines/career-milestone-engine';
import { reconstructStintUnlocks } from '@/lib/engines/stint-unlocks';
import { TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
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

  // What unlocked with this stint: stamped close to its instant, and not
  // claimed by the stints logged just before or after it (`stint-unlocks`).
  const [profile, momentum, streak, budget, unlocks, careerMilestones] = await Promise.all([
    prisma.careerProfile.findUniqueOrThrow({ where: { userId } }),
    getMomentum(userId).catch(() => null),
    getStreak(userId).catch(() => null),
    getBudgetSnapshot(userId).catch(() => null),
    reconstructStintUnlocks(prisma, userId, session),
    listStintCareerMilestones(prisma, userId, session.id),
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
    // The stint's own snapshot of the race's coverage, taken when it was
    // logged: the summary shows the stint as it was, not the race as it is.
    coverageBeforeSec: session.coverageBeforeSec,
    coverageAfterSec: session.coverageAfterSec,
    runtimeSec: session.race.runtimeSec,

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

    achievements: unlocks.achievements,
    // A rung that is also a Career Milestone is shown with those instead.
    milestones: unlocks.milestones.filter((milestone) => !isCareerMilestoneRung(milestone)),
    careerMilestones,
    mastery: unlocks.mastery,
    challenges: unlocks.challenges,
    seasonPassTiers: unlocks.seasonPassTiers,
    collections: { completedCollections: [], filledItems: [] },
    trophies: unlocks.trophies,
    hallOfFame: unlocks.hallOfFame,

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
      rareUnlock: unlocks.achievements.some((a) => a.rarity === 'LEGENDARY' || a.rarity === 'MYTHIC'),
      levelsGained: 0,
      careerMilestoneCelebration: highestMilestoneCelebration(careerMilestones),
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

export const LONG_HAUL_THRESHOLD = TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec;
