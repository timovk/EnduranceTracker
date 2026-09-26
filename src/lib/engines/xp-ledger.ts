/**
 * The XP ledger.
 *
 * Career XP is never stored as a bare mutable number. Every award writes an
 * `XPTransaction`, and the profile's `careerXp` is a running total that can be
 * rebuilt from the ledger at any time (`recalculateCareerXp`). This is what
 * makes progression auditable, and what lets a re-balance be replayed.
 *
 * `dedupeKey` is the structural guard against double-awarding: it is UNIQUE
 * per account in the database, so a one-shot bonus physically cannot be
 * granted twice to the same account, no matter how many times an engine is
 * re-run — while a second account can still earn it for the first time.
 */

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { levelFromXp, prestigeForLevel, titleForLevel } from '@/lib/domain/progression';
import type { XPSource } from '@/lib/domain/types';
import { rebuildSeasonXpFromLedger } from './season-pass-engine';

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
 * How far ahead of the clock the account's latest row may be and still be
 * followed a millisecond later (`ledgerStamp`). A burst of awards stays far
 * inside it; a row further ahead was stamped by a clock that was set ahead.
 */
const LEDGER_BURST_SLACK_MS = 1_000;

/**
 * When a new ledger row is stamped, and whether the running totals must be
 * re-stamped from it.
 *
 * The ledger's order is `(createdAt, id)`, and the running total an award
 * stamps is the total after every row written before it. Two awards written
 * inside the same millisecond would share a `createdAt` and be ordered by
 * their random ids instead of by when they were written, so the totals would
 * disagree with the ledger's own order (I2). Each row is therefore stamped on
 * the real clock, as it always was, but strictly after the account's latest
 * row when that row is at most a moment ahead: a millisecond later, in a burst
 * of awards.
 *
 * A row stamped well ahead of the clock (the computer's clock was once set
 * ahead) is not followed: it would pin every later award, and the month and
 * year its XP is counted in, to its own date. The new row goes on the clock,
 * after any burst before it, and so before that row; the caller then
 * re-stamps the running totals from the new row.
 */
async function ledgerStamp(tx: Tx, userId: string): Promise<{ createdAt: Date; restamp: boolean }> {
  const now = Date.now();
  const latest = await tx.xPTransaction.findFirst({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
  if (latest === null) return { createdAt: new Date(now), restamp: false };
  if (latest.createdAt.getTime() - now < LEDGER_BURST_SLACK_MS) {
    return { createdAt: new Date(Math.max(now, latest.createdAt.getTime() + 1)), restamp: false };
  }
  const recent = await tx.xPTransaction.findFirst({
    where: { userId, createdAt: { lt: new Date(now + LEDGER_BURST_SLACK_MS) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
  return { createdAt: new Date(Math.max(now, (recent?.createdAt.getTime() ?? 0) + 1)), restamp: true };
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
    // Scoped by account. The key is unique per user, not globally — an
    // achievement key carries no user id, so an unscoped lookup would report
    // the SECOND account's first unlock as a duplicate and pay it nothing.
    const existing = await tx.xPTransaction.findFirst({
      where: { userId, dedupeKey: award.dedupeKey },
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

  const stamp = await ledgerStamp(tx, userId);

  const stateBefore = levelFromXp(before);
  const stateAfter = levelFromXp(after);
  const prestigeBefore = prestigeForLevel(stateBefore.level);
  const prestigeAfter = prestigeForLevel(stateAfter.level);
  const titleAfter = titleForLevel(stateAfter.level);
  const titleBefore = titleForLevel(stateBefore.level);

  const row = await tx.xPTransaction.create({
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
      createdAt: stamp.createdAt,
    },
    select: { id: true },
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

  // Written before a row stamped ahead of the clock, whose running total did
  // not include this award: re-stamp from here (the rows before it are only
  // summed, and the few after it re-read).
  if (stamp.restamp) await rebuildCareerTotals(tx, userId, { from: { createdAt: stamp.createdAt, id: row.id } });

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
  /**
   * The earliest removed row in ledger order (`createdAt`, then `id`), or null
   * when nothing was removed. Every running total from this point on described
   * a career that included the row, so `settleLedger` re-stamps from here.
   */
  earliest: LedgerPosition | null;
}

/** A place in the ledger's order: `createdAt`, then `id` to break ties. */
export interface LedgerPosition {
  createdAt: Date;
  id: string;
}

const NOTHING_REVOKED: XpRevocation = { transactions: 0, careerXp: 0, seasonXp: 0, earliest: null };

/** Ids per `IN (…)` list, well inside SQLite's limit on bound parameters. */
const ID_CHUNK = 500;

/**
 * Rows re-stamped per UPDATE statement. One statement per row made a full
 * re-stamp of 180,000 rows take 29.6 s; batches of 400 take about 1 s
 * (`restampBatch`). Three parameters a row keeps a batch far inside SQLite's
 * limit on bound parameters.
 */
const LEDGER_RESTAMP_BATCH = 400;

/** True when `a` comes before `b` in ledger order. */
function isEarlier(a: LedgerPosition, b: LedgerPosition): boolean {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  return byTime !== 0 ? byTime < 0 : a.id < b.id;
}

function earlierOf(a: LedgerPosition | null, b: LedgerPosition | null): LedgerPosition | null {
  if (a === null) return b;
  if (b === null) return a;
  return isEarlier(b, a) ? b : a;
}

/** Several removals as one. */
export function combineRevocations(revocations: readonly XpRevocation[]): XpRevocation {
  return revocations.reduce<XpRevocation>(
    (total, revocation) => ({
      transactions: total.transactions + revocation.transactions,
      careerXp: total.careerXp + revocation.careerXp,
      seasonXp: total.seasonXp + revocation.seasonXp,
      earliest: earlierOf(total.earliest, revocation.earliest),
    }),
    NOTHING_REVOKED,
  );
}

/**
 * Delete these rows and say what they were worth.
 *
 * The one place a revocation deletes, so every path reports its removals the
 * same way — including the earliest row, which is where the settle starts.
 *
 * The rows were read inside the account a moment ago, in the same
 * transaction, and are deleted by primary key alone: with a `userId` term
 * SQLite plans the delete on the `(userId, createdAt)` index and walks the
 * whole account's ledger for every statement.
 */
async function removeRows(
  tx: Tx,
  rows: readonly { id: string; amount: number; seasonAmount: number; createdAt: Date }[],
): Promise<XpRevocation> {
  if (rows.length === 0) return NOTHING_REVOKED;

  for (let index = 0; index < rows.length; index += ID_CHUNK) {
    const ids = rows.slice(index, index + ID_CHUNK).map((row) => row.id);
    await tx.xPTransaction.deleteMany({ where: { id: { in: ids } } });
  }

  let earliest: LedgerPosition | null = null;
  for (const row of rows) earliest = earlierOf(earliest, { createdAt: row.createdAt, id: row.id });

  return {
    transactions: rows.length,
    careerXp: rows.reduce((sum, row) => sum + row.amount, 0),
    seasonXp: rows.reduce((sum, row) => sum + row.seasonAmount, 0),
    earliest,
  };
}

const REVOKED_ROW_SELECT = { id: true, amount: true, seasonAmount: true, createdAt: true } as const;

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
 * what remains (`settleLedger`). There is still no negative XP in this
 * application.
 */
export async function revokeSessionXp(tx: Tx, userId: string, sessionId: string): Promise<XpRevocation> {
  return revokeSessionsXp(tx, userId, [sessionId]);
}

/**
 * Remove the XP several stints earned — every stint of a race that is being
 * deleted, say. Same rule and same precondition as `revokeSessionXp`: it runs
 * before the stints go.
 *
 * The lookup is by `sessionId` alone, in chunks, so SQLite serves it from the
 * `sessionId` index: with a `userId` term it would choose the
 * `(userId, source)` index and read every viewing award the account holds.
 * The account is then checked on each row found, so a stint id from another
 * account takes nothing back.
 */
export async function revokeSessionsXp(
  tx: Tx,
  userId: string,
  sessionIds: readonly string[],
): Promise<XpRevocation> {
  const rows: { id: string; amount: number; seasonAmount: number; createdAt: Date }[] = [];
  for (let index = 0; index < sessionIds.length; index += ID_CHUNK) {
    const chunk = sessionIds.slice(index, index + ID_CHUNK);
    const found = await tx.xPTransaction.findMany({
      where: { sessionId: { in: [...chunk] }, source: { in: SESSION_BOUND_SOURCES } },
      select: { ...REVOKED_ROW_SELECT, userId: true },
    });
    for (const row of found) if (row.userId === userId) rows.push(row);
  }
  return removeRows(tx, rows);
}

/**
 * Remove every viewing award a race holds.
 *
 * The viewing award always names its race in `sourceRef`, so this finds the
 * rows `revokeSessionsXp` cannot: the ones whose stint was deleted under a
 * version that left the XP behind, which `onDelete: SetNull` cut loose from
 * any session. Deleting a race takes those back too (owner decision D4).
 */
export async function revokeRaceViewingXp(tx: Tx, userId: string, raceId: string): Promise<XpRevocation> {
  const rows = await tx.xPTransaction.findMany({
    where: { userId, sourceRef: raceId, source: { in: SESSION_BOUND_SOURCES } },
    select: REVOKED_ROW_SELECT,
  });
  return removeRows(tx, rows);
}

/**
 * Remove a one-shot award by its dedupe key.
 *
 * Deleting the row is what frees the key. That matters more than the XP: the
 * key is unique within the account, so a bonus whose row outlives the thing it
 * was awarded for
 * can never be earned again — the next attempt is silently swallowed as a
 * duplicate. Removing it together with the condition keeps "the bonus exists
 * exactly when the thing is true" an invariant rather than a hope.
 */
export async function revokeXpByDedupeKey(tx: Tx, userId: string, dedupeKey: string): Promise<XpRevocation> {
  return revokeXpByDedupeKeys(tx, userId, [dedupeKey]);
}

/** `revokeXpByDedupeKey` for several keys at once, through the unique index. */
export async function revokeXpByDedupeKeys(
  tx: Tx,
  userId: string,
  dedupeKeys: readonly string[],
): Promise<XpRevocation> {
  const rows: { id: string; amount: number; seasonAmount: number; createdAt: Date }[] = [];
  for (let index = 0; index < dedupeKeys.length; index += ID_CHUNK) {
    const chunk = dedupeKeys.slice(index, index + ID_CHUNK);
    rows.push(...await tx.xPTransaction.findMany({
      where: { userId, dedupeKey: { in: [...chunk] } },
      select: REVOKED_ROW_SELECT,
    }));
  }
  return removeRows(tx, rows);
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
    select: REVOKED_ROW_SELECT,
  });
  return removeRows(tx, rows);
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
 *
 * `from` limits the replay to the rows at or after that position: everything
 * before it is summed in one aggregate and left alone, because nothing before
 * the earliest removed row changed. Without it every row is replayed. Either
 * way the corrected rows are written a batch at a time, one statement per
 * `LEDGER_RESTAMP_BATCH` rows, which is what keeps deleting a stint from the
 * first year of a long career inside its transaction.
 */
export async function rebuildCareerTotals(
  tx: Tx,
  userId: string,
  options: { from?: LedgerPosition } = {},
): Promise<LedgerRebuild> {
  const profile = await tx.careerProfile.findUniqueOrThrow({ where: { userId } });
  const from = options.from;

  let running = 0;
  if (from !== undefined) {
    const before = await tx.xPTransaction.aggregate({
      where: {
        userId,
        OR: [{ createdAt: { lt: from.createdAt } }, { createdAt: from.createdAt, id: { lt: from.id } }],
      },
      _sum: { amount: true },
    });
    running = before._sum.amount ?? 0;
  }

  // `id` breaks ties: two awards inside one transaction share a timestamp, and
  // an unstable order would re-stamp them differently on every rebuild.
  const rows = await tx.xPTransaction.findMany({
    where: from === undefined
      ? { userId }
      : {
          userId,
          OR: [{ createdAt: { gt: from.createdAt } }, { createdAt: from.createdAt, id: { gte: from.id } }],
        },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, careerXpAfter: true, levelAfter: true },
  });

  const changed: { id: string; careerXpAfter: number; levelAfter: number }[] = [];
  // The level is solved again only when the running total leaves the current
  // level's band: solving it is a walk up the curve, and a long ledger crosses
  // a band a hundred times, not a hundred thousand.
  let band = levelFromXp(running);
  for (const row of rows) {
    running += row.amount;
    if (running < band.levelStartXp || running >= band.nextLevelXp) band = levelFromXp(running);
    const level = band.level;
    if (Number(row.careerXpAfter) === running && row.levelAfter === level) continue;
    changed.push({ id: row.id, careerXpAfter: running, levelAfter: level });
  }

  for (let index = 0; index < changed.length; index += LEDGER_RESTAMP_BATCH) {
    await restampBatch(tx, changed.slice(index, index + LEDGER_RESTAMP_BATCH));
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
    rowsRestamped: changed.length,
  };
}

/**
 * Write one batch of corrected running totals in a single statement:
 * `UPDATE … SET … FROM (VALUES (id, careerXpAfter, levelAfter), …) WHERE id = …`.
 *
 * The batch is joined to the ledger by primary key, one lookup a row. The
 * `CASE id WHEN … THEN … END` form this replaced tests every id of the batch
 * against every row it updates: a full re-stamp of 180,000 rows took 5.1 s
 * that way and takes 1.1 s this way.
 *
 * The rows are found by primary key alone. The ids were read inside the
 * account a moment ago, and a `userId` term would let SQLite choose the
 * `(userId, …)` index and scan the whole account's ledger for every batch.
 */
async function restampBatch(
  tx: Tx,
  batch: readonly { id: string; careerXpAfter: number; levelAfter: number }[],
): Promise<void> {
  if (batch.length === 0) return;
  const values = Prisma.join(batch.map((row) => Prisma.sql`(${row.id}, ${row.careerXpAfter}, ${row.levelAfter})`));
  await tx.$executeRaw`
    UPDATE "xp_transactions"
    SET "careerXpAfter" = "restamp"."column2", "levelAfter" = "restamp"."column3"
    FROM (VALUES ${values}) AS "restamp"
    WHERE "xp_transactions"."id" = "restamp"."column1"`;
}

/**
 * Settle the ledger after rows were removed (R13).
 *
 * Every transaction that deletes an `XPTransaction` row ends here, after its
 * last award, so the rows awarded after a removal are re-stamped as well and
 * "career XP equals the sum of the ledger" holds by construction rather than
 * because each caller remembered to rebuild. The replay starts at the earliest
 * row any of the revocations removed.
 *
 * Season XP is rebuilt only when a removed row carried some. Rebuilding it
 * otherwise would sum the ledger's unboosted `seasonAmount` and quietly take
 * the momentum bonus off a pass (see `season-reset.ts`).
 *
 * Returns null, having done nothing, when nothing was removed.
 */
export async function settleLedger(
  tx: Tx,
  userId: string,
  revocations: readonly XpRevocation[],
): Promise<LedgerRebuild | null> {
  const removed = combineRevocations(revocations);
  if (removed.transactions === 0 || removed.earliest === null) return null;

  const rebuild = await rebuildCareerTotals(tx, userId, { from: removed.earliest });
  if (removed.seasonXp > 0) await rebuildSeasonXpFromLedger(tx, userId);
  return rebuild;
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
