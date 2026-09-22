/**
 * The XP ledger.
 *
 * Career XP is never stored as a bare mutable number. Every award writes an
 * `XPTransaction`, and the profile's `careerXp` is a running total that can be
 * rebuilt from the ledger at any time (`recalculateCareerXp`). This is what
 * makes progression auditable, and what lets a re-balance be replayed.
 *
 * `dedupeKey` is the structural guard against double-awarding: it is UNIQUE in
 * the database, so a one-shot bonus physically cannot be granted twice, no
 * matter how many times an engine is re-run.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { levelFromXp, prestigeForLevel, titleForLevel } from '@/lib/domain/progression';
import type { XPSource } from '@/lib/domain/types';

export interface XpAward {
  source: XPSource;
  /** Career XP. Must be >= 0 — there is no negative XP in this application. */
  amount: number;
  /** Quarterly season XP, a separate currency. */
  seasonAmount?: number;
  description: string;
  sourceRef?: string;
  sessionId?: string;
  seasonPassId?: string;
  /**
   * Set for one-shot awards (a Story Complete bonus, an achievement, a
   * mastery node). Leave undefined for repeatable awards such as viewing XP,
   * which are already bounded by the session they belong to.
   */
  dedupeKey?: string;
}

export interface XpAwardResult {
  /** Career XP actually granted (0 when the award was a duplicate). */
  granted: number;
  seasonGranted: number;
  duplicate: boolean;
  careerXpAfter: number;
  levelAfter: number;
  levelsGained: number;
  prestigeAfter: number;
  prestigeGained: number;
  newTitle: string | null;
}

/**
 * Grant XP inside an existing transaction.
 *
 * Returns `duplicate: true` and grants nothing when `dedupeKey` has been used
 * before. Callers treat that as success, not as an error — re-running an
 * engine must be safe.
 */
export async function awardXp(tx: Tx, userId: string, award: XpAward): Promise<XpAwardResult> {
  const amount = Math.max(0, Math.round(award.amount));
  const seasonAmount = Math.max(0, Math.round(award.seasonAmount ?? 0));

  if (award.dedupeKey) {
    const existing = await tx.xPTransaction.findUnique({
      where: { dedupeKey: award.dedupeKey },
      select: { id: true },
    });
    if (existing) {
      const profile = await tx.careerProfile.findUniqueOrThrow({ where: { userId } });
      return {
        granted: 0,
        seasonGranted: 0,
        duplicate: true,
        careerXpAfter: Number(profile.careerXp),
        levelAfter: profile.level,
        levelsGained: 0,
        prestigeAfter: profile.prestige,
        prestigeGained: 0,
        newTitle: null,
      };
    }
  }

  const profile = await tx.careerProfile.findUniqueOrThrow({ where: { userId } });
  const before = Number(profile.careerXp);
  const after = before + amount;

  const stateBefore = levelFromXp(before);
  const stateAfter = levelFromXp(after);
  const prestigeBefore = prestigeForLevel(stateBefore.level);
  const prestigeAfter = prestigeForLevel(stateAfter.level);
  const titleAfter = titleForLevel(stateAfter.level);
  const titleBefore = titleForLevel(stateBefore.level);

  await tx.xPTransaction.create({
    data: {
      userId,
      source: award.source,
      amount,
      seasonAmount,
      description: award.description,
      sourceRef: award.sourceRef ?? null,
      sessionId: award.sessionId ?? null,
      seasonPassId: award.seasonPassId ?? null,
      careerXpAfter: BigInt(after),
      levelAfter: stateAfter.level,
      dedupeKey: award.dedupeKey ?? null,
    },
  });

  await tx.careerProfile.update({
    where: { userId },
    data: {
      careerXp: BigInt(after),
      level: stateAfter.level,
      prestige: prestigeAfter,
      titleKey: titleAfter.title,
    },
  });

  return {
    granted: amount,
    seasonGranted: seasonAmount,
    duplicate: false,
    careerXpAfter: after,
    levelAfter: stateAfter.level,
    levelsGained: stateAfter.level - stateBefore.level,
    prestigeAfter,
    prestigeGained: prestigeAfter - prestigeBefore,
    newTitle: titleAfter.title !== titleBefore.title ? titleAfter.title : null,
  };
}

/** Grant XP in its own transaction. Convenience for single awards. */
export async function awardXpStandalone(userId: string, award: XpAward): Promise<XpAwardResult> {
  return prisma.$transaction((tx) => awardXp(tx as Tx, userId, award));
}

/**
 * Rebuild `careerProfile.careerXp` from the ledger.
 *
 * The ledger is authoritative. If the running total ever disagrees with the
 * sum of transactions, this is what puts it right — and it is what makes a
 * configuration re-balance replayable rather than destructive.
 */
export async function recalculateCareerXp(userId: string): Promise<{ before: number; after: number }> {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.careerProfile.findUniqueOrThrow({ where: { userId } });
    const agg = await tx.xPTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
    const total = agg._sum.amount ?? 0;
    const state = levelFromXp(total);

    await tx.careerProfile.update({
      where: { userId },
      data: {
        careerXp: BigInt(total),
        level: state.level,
        prestige: prestigeForLevel(state.level),
        titleKey: titleForLevel(state.level).title,
      },
    });

    return { before: Number(profile.careerXp), after: total };
  });
}

/** XP earned in a window, grouped by source. Powers the XP breakdown chart. */
export async function xpBySource(
  userId: string,
  from?: Date,
  to?: Date,
): Promise<{ source: XPSource; amount: number }[]> {
  const rows = await prisma.xPTransaction.groupBy({
    by: ['source'],
    where: {
      userId,
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ source: r.source as XPSource, amount: r._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
}
