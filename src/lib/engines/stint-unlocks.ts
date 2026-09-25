/**
 * What a stint unlocked, rebuilt from committed data (0.4.0).
 *
 * A stint's summary can be reopened at any time, long after it was logged, and
 * has to show what that stint unlocked then — not what the career has
 * unlocked since. Every unlock is written in the stint's own transaction and
 * stamped with its `now`, which is when the stint was logged (`watchedAt`), so
 * the unlocks are found by time: those stamped close to the stint's instant.
 *
 * The window is bounded on both sides, and by the neighbouring stints: two
 * stints logged a couple of minutes apart must not claim each other's
 * unlocks, and an old stint must not claim what later ones reached.
 *
 * Moved here from the summary route so the engines can use it too, inside a
 * transaction, with whichever client they hold.
 */

import type { Tx } from '@/lib/db/client';
import { MILESTONES, TIMELINE_SHAPE } from '@/lib/config';
import { isSeasonClosed } from '@/lib/domain/season-closure';
import type {
  AchievementUnlock, ChallengeCompletion, HallOfFameAward, MasteryUnlock, MilestoneUnlock,
  SeasonPassTierUnlock, TrophyAward,
} from './contracts';

export interface StintUnlocks {
  achievements: AchievementUnlock[];
  mastery: MasteryUnlock[];
  milestones: MilestoneUnlock[];
  challenges: ChallengeCompletion[];
  seasonPassTiers: SeasonPassTierUnlock[];
  trophies: TrophyAward[];
  hallOfFame: HallOfFameAward[];
}

/**
 * The span an unlock must be stamped in to belong to a stint logged at
 * `watchedAt`: a few minutes either side of it (the recognition slack), cut
 * at the stints logged just before and just after it, so no instant is ever
 * claimed by two stints.
 */
export function stintUnlockWindow(
  watchedAt: Date,
  neighbours: { previousWatchedAt: Date | null; nextWatchedAt: Date | null },
): { from: Date; to: Date } {
  const slack = TIMELINE_SHAPE.recognitionSlackMinutes * 60_000;
  let from = watchedAt.getTime() - slack;
  let to = watchedAt.getTime() + slack;
  if (neighbours.previousWatchedAt !== null) from = Math.max(from, neighbours.previousWatchedAt.getTime() + 1);
  if (neighbours.nextWatchedAt !== null) to = Math.min(to, neighbours.nextWatchedAt.getTime() - 1);
  return { from: new Date(from), to: new Date(to) };
}

/**
 * The unlock window of one of this account's stints, with its neighbours read
 * from the database. Neighbours are the stints logged strictly before and
 * strictly after it; two stints logged at the very same instant cannot be
 * told apart by time, and share it.
 */
export async function stintUnlockWindowFor(
  db: Tx,
  userId: string,
  session: { watchedAt: Date },
): Promise<{ from: Date; to: Date }> {
  const [previous, next] = await Promise.all([
    db.raceViewingSession.findFirst({
      where: { userId, watchedAt: { lt: session.watchedAt } },
      orderBy: { watchedAt: 'desc' },
      select: { watchedAt: true },
    }),
    db.raceViewingSession.findFirst({
      where: { userId, watchedAt: { gt: session.watchedAt } },
      orderBy: { watchedAt: 'asc' },
      select: { watchedAt: true },
    }),
  ]);
  return stintUnlockWindow(session.watchedAt, {
    previousWatchedAt: previous?.watchedAt ?? null,
    nextWatchedAt: next?.watchedAt ?? null,
  });
}

/** Everything this account unlocked inside a stint's unlock window. */
export async function reconstructStintUnlocks(
  db: Tx,
  userId: string,
  session: { id: string; watchedAt: Date },
): Promise<StintUnlocks> {
  const { from, to } = await stintUnlockWindowFor(db, userId, session);
  const within = { gte: from, lte: to };

  const [achievements, mastery, challenges, milestones, tiers, trophies, hallOfFame] = await Promise.all([
    db.achievementProgress.findMany({
      where: { userId, unlockedAt: within },
      select: { achievement: true },
    }),
    db.masteryProgress.findMany({
      where: { userId, unlockedAt: within },
      select: {
        node: {
          select: {
            key: true, name: true, description: true, rarity: true, xpReward: true,
            tree: { select: { key: true, name: true } },
          },
        },
      },
    }),
    db.challengeProgress.findMany({
      where: { challenge: { userId }, completedAt: within },
      select: {
        completedAt: true,
        challenge: { select: { id: true, scope: true, title: true, xpReward: true, seasonXpReward: true } },
      },
    }),
    db.milestoneProgress.findMany({
      where: { userId, reachedAt: within },
      select: { metric: true, threshold: true, valueAtReach: true, xpAwarded: true },
    }),
    db.seasonPassProgress.findMany({
      where: { seasonPass: { userId }, unlockedAt: within },
      orderBy: { tier: 'asc' },
    }),
    db.trophy.findMany({ where: { userId, awardedAt: within } }),
    db.hallOfFameEntry.findMany({ where: { userId, occurredAt: within } }),
  ]);

  return {
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
    trophies: trophies.map((t) => ({
      key: t.key, name: t.name, description: t.description,
      category: t.category, rarity: t.rarity, iconKey: t.iconKey,
    })),
    hallOfFame: hallOfFame.map((h) => ({
      key: h.key, title: h.title, subtitle: h.subtitle, category: h.category, rarity: h.rarity,
    })),
  };
}

/** Metric key to the human label the milestone was defined with. */
const MILESTONE_LABELS: ReadonlyMap<string, string> = new Map(
  MILESTONES.map((def) => [def.metric, def.label]),
);
