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
 * What a removal took back out of the ledger.
 *
 * Reported rather than silently applied, because the user is owed a plain
 * statement of what changed when they delete something.
 */
export interface XpRevocation {
  transactions: number;
  careerXp: number;
  seasonXp: number;
}

const NOTHING_REVOKED: XpRevocation = { transactions: 0, careerXp: 0, seasonXp: 0 };

/**
 * The sources a logged stint is allowed to take back with it.
 *
 * Viewing XP belongs to its session and to nothing else, so deleting the
 * session deletes the award. Everything else a session happened to trigger —
 * an achievement, a mastery node, a challenge, a collection — is a landmark
 * rather than a balance, and those are never revoked. That distinction is the
 * whole rule: XP follows the data, landmarks stay earned.
 */
const SESSION_BOUND_SOURCES: XPSource[] = ['VIEWING', 'REWATCH'];

/**
 * Remove the XP a stint earned.
 *
 * Must run BEFORE the `RaceViewingSession` row is deleted: the relation is
 * `onDelete: SetNull`, so deleting the session first would strand these rows
 * with a null `sessionId` and nothing left to identify them by.
 *
 * Note what this does NOT do: it writes no negative transaction and decrements
 * no counter. The rows simply cease to exist, and the totals are rebuilt from
 * what remains. There is still no negative XP in this application.
 */
export async function revokeSessionXp(tx: Tx, userId: string, sessionId: string): Promise<XpRevocation> {
  const rows = await tx.xPTransaction.findMany({
    where: { userId, sessionId, source: { in: SESSION_BOUND_SOURCES } },
    select: { id: true, amount: true, seasonAmount: true },
  });
  if (rows.length === 0) return NOTHING_REVOKED;

  await tx.xPTransaction.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });

  return {
    transactions: rows.length,
    careerXp: rows.reduce((sum, row) => sum + row.amount, 0),
    seasonXp: rows.reduce((sum, row) => sum + row.seasonAmount, 0),
  };
}

/**
 * Remove a one-shot award by its dedupe key.
 *
 * Deleting the row is what frees the key. That matters more than the XP: the
 * key is UNIQUE, so a bonus whose row outlives the thing it was awarded for
 * can never be earned again — the next attempt is silently swallowed as a
 * duplicate. Removing it together with the condition keeps "the bonus exists
 * exactly when the thing is true" an invariant rather than a hope.
 */
export async function revokeXpByDedupeKey(tx: Tx, userId: string, dedupeKey: string): Promise<XpRevocation> {
  const row = await tx.xPTransaction.findUnique({
    where: { dedupeKey },
    select: { id: true, userId: true, amount: true, seasonAmount: true },
  });
  if (!row || row.userId !== userId) return NOTHING_REVOKED;

  await tx.xPTransaction.delete({ where: { id: row.id } });

  return { transactions: 1, careerXp: row.amount, seasonXp: row.seasonAmount };
}

/**
 * Delete viewing XP whose session no longer exists.
 *
 * `session-engine` is the only thing in the application that awards VIEWING or
 * REWATCH, and it always records the session the award belongs to — so one of
 * these rows with a null `sessionId` can only have come from a stint that was
 * deleted while the relation's `onDelete: SetNull` quietly cut it loose.
 *
 * This is a repair for careers written before deletion took its XP back with
 * it. It is safe to run at any time: in a healthy ledger it finds nothing.
 */
export async function purgeOrphanedSessionXp(tx: Tx, userId: string): Promise<XpRevocation> {
  const rows = await tx.xPTransaction.findMany({
    where: { userId, sessionId: null, source: { in: SESSION_BOUND_SOURCES } },
    select: { id: true, amount: true, seasonAmount: true },
  });
  if (rows.length === 0) return NOTHING_REVOKED;

  await tx.xPTransaction.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });

  return {
    transactions: rows.length,
    careerXp: rows.reduce((sum, row) => sum + row.amount, 0),
    seasonXp: rows.reduce((sum, row) => sum + row.seasonAmount, 0),
  };
}

/** How a rebuild moved the career. */
export interface LedgerRebuild {
  careerXpBefore: number;
  careerXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** Historical rows whose running total had to be corrected. */
  rowsRestamped: number;
}

/**
 * Rebuild every career total from the ledger.
 *
 * The ledger is authoritative. If the running total ever disagrees with the
 * sum of transactions, this is what puts it right — and it is what makes a
 * configuration re-balance replayable rather than destructive.
 *
 * It also re-stamps `careerXpAfter` and `levelAfter` on the transactions
 * themselves. Those are a historical snapshot taken at award time, and they
 * are what the career XP graph is drawn from; remove a row from the middle of
 * the history and every snapshot after it is describing a career that no
 * longer happened. Replaying in order is the only way the graph stays true.
 */
export async function rebuildCareerTotals(tx: Tx, userId: string): Promise<LedgerRebuild> {
  const profile = await tx.careerProfile.findUniqueOrThrow({ where: { userId } });

  // `id` breaks ties: two awards inside one transaction share a timestamp, and
  // an unstable order would re-stamp them differently on every rebuild.
  const rows = await tx.xPTransaction.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, careerXpAfter: true, levelAfter: true },
  });

  let running = 0;
  let rowsRestamped = 0;
  for (const row of rows) {
    running += row.amount;
    const level = levelFromXp(running).level;
    if (Number(row.careerXpAfter) === running && row.levelAfter === level) continue;
    await tx.xPTransaction.update({
      where: { id: row.id },
      data: { careerXpAfter: BigInt(running), levelAfter: level },
    });
    rowsRestamped += 1;
  }

  const state = levelFromXp(running);
  await tx.careerProfile.update({
    where: { userId },
    data: {
      careerXp: BigInt(running),
      level: state.level,
      prestige: prestigeForLevel(state.level),
      titleKey: titleForLevel(state.level).title,
    },
  });

  return {
    careerXpBefore: Number(profile.careerXp),
    careerXpAfter: running,
    levelBefore: profile.level,
    levelAfter: state.level,
    rowsRestamped,
  };
}

/** `rebuildCareerTotals` in its own transaction, for scripts and one-off repairs. */
export async function recalculateCareerXp(userId: string): Promise<{ before: number; after: number }> {
  const result = await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, userId));
  return { before: result.careerXpBefore, after: result.careerXpAfter };
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
