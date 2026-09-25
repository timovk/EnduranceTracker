/**
 * Settling the ledger after XP is taken back (R13).
 *
 * Every path that deletes an XP row ends with `settleLedger`: the running
 * totals are re-stamped from the earliest removed row, in batches, and season
 * XP is rebuilt only when a removed row carried some. These tests hold the
 * batched re-stamp to the row-by-row replay it replaced, hold the re-stamp
 * from a position to a full rebuild, and check invariant I2 — career XP is the
 * ledger's sum and every running total is right — after every way XP can be
 * taken back.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { levelFromXp } from '@/lib/domain/progression';
import { resyncAfterRaceEdit } from '@/lib/engines/progression-resync';
import { rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { deleteRace, deleteViewingSession, repairXpLedger } from '@/lib/engines/session-engine';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import {
  rebuildCareerTotals, revokeSessionsXp, revokeXpByDedupeKeys, settleLedger,
} from '@/lib/engines/xp-ledger';
import {
  addRace, createCareerUser, H, insertLegacyShortenedRace, ledgerProblems, logStint,
} from '../helpers/career-db';

const USER = '00000000-0000-4000-8000-0000000002a1';
const NOW = new Date(2026, 8, 24, 20, 0);

beforeEach(async () => {
  await createCareerUser(USER, 'LedgerSettleTest');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

/**
 * `count` ledger rows written directly, with running totals that are all
 * wrong. Three rows share each timestamp, so the order between them is the
 * row id's — the tie-break every rebuild must honour.
 */
async function seedUnstampedLedger(count: number): Promise<void> {
  const base = new Date(2026, 0, 1).getTime();
  await prisma.xPTransaction.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: USER,
      source: 'VIEWING' as const,
      amount: 50 + ((index * 37) % 400),
      seasonAmount: 0,
      description: `Row ${index}`,
      careerXpAfter: BigInt(0),
      levelAfter: 1,
      createdAt: new Date(base + Math.floor(index / 3) * 60_000),
    })),
  });
}

/** The running totals as a row-by-row replay of the ledger computes them. */
async function replayRowByRow(): Promise<Map<string, { careerXpAfter: number; levelAfter: number }>> {
  const rows = await prisma.xPTransaction.findMany({
    where: { userId: USER },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true },
  });
  const expected = new Map<string, { careerXpAfter: number; levelAfter: number }>();
  let running = 0;
  for (const row of rows) {
    running += row.amount;
    expected.set(row.id, { careerXpAfter: running, levelAfter: levelFromXp(running).level });
  }
  return expected;
}

async function stamps(): Promise<Map<string, { careerXpAfter: number; levelAfter: number }>> {
  const rows = await prisma.xPTransaction.findMany({
    where: { userId: USER },
    select: { id: true, careerXpAfter: true, levelAfter: true },
  });
  return new Map(rows.map((row) => [row.id, { careerXpAfter: Number(row.careerXpAfter), levelAfter: row.levelAfter }]));
}

describe('rebuilding the running totals', () => {
  it('re-stamps in batches exactly as a row-by-row replay would', async () => {
    // 1,000 rows is three batches of 400 and a part batch.
    await seedUnstampedLedger(1_000);

    const result = await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER), { timeout: 60_000 });

    expect(result.rowsRestamped).toBe(1_000);
    expect(await stamps()).toEqual(await replayRowByRow());
    expect(await ledgerProblems(USER)).toEqual([]);
    // The values are stored as integers, as an award stores them.
    const types = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT DISTINCT typeof("careerXpAfter") AS kind FROM "xp_transactions" WHERE "userId" = ${USER}`;
    expect(types).toEqual([{ kind: 'integer' }]);
  });

  it('writes nothing when every total is already right', async () => {
    await seedUnstampedLedger(30);
    await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER));

    const again = await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER));
    expect(again.rowsRestamped).toBe(0);
  });

  it('from a position gives what a full rebuild gives, even between rows that share a timestamp', async () => {
    await seedUnstampedLedger(600);
    await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER), { timeout: 60_000 });

    // The middle row of a group of three that share one timestamp.
    const ordered = await prisma.xPTransaction.findMany({
      where: { userId: USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, createdAt: true },
    });
    const removed = ordered[301]!;
    expect(ordered[300]!.createdAt.getTime()).toBe(removed.createdAt.getTime());
    expect(ordered[302]!.createdAt.getTime()).toBe(removed.createdAt.getTime());
    await prisma.xPTransaction.delete({ where: { id: removed.id } });

    const partial = await prisma.$transaction((tx) =>
      rebuildCareerTotals(tx as Tx, USER, { from: { createdAt: removed.createdAt, id: removed.id } }),
    );
    // Every row after the removed one moved, and none before it was read.
    expect(partial.rowsRestamped).toBe(ordered.length - 302);
    expect(await ledgerProblems(USER)).toEqual([]);

    const full = await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER));
    expect(full.rowsRestamped).toBe(0);
    expect(full.careerXpAfter).toBe(partial.careerXpAfter);
    expect(full.levelAfter).toBe(partial.levelAfter);
  });

  it('leaves the rows before the position alone', async () => {
    await seedUnstampedLedger(9);
    await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER));
    const ordered = await prisma.xPTransaction.findMany({
      where: { userId: USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, createdAt: true },
    });
    await prisma.xPTransaction.update({ where: { id: ordered[0]!.id }, data: { careerXpAfter: BigInt(1) } });

    const from = { createdAt: ordered[5]!.createdAt, id: ordered[5]!.id };
    await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER, { from }));

    const first = await prisma.xPTransaction.findUniqueOrThrow({ where: { id: ordered[0]!.id } });
    expect(Number(first.careerXpAfter)).toBe(1);
  });
});

describe('settling', () => {
  it('does nothing when nothing was removed', async () => {
    await seedUnstampedLedger(3);
    const result = await prisma.$transaction((tx) =>
      settleLedger(tx as Tx, USER, [{ transactions: 0, careerXp: 0, seasonXp: 0, earliest: null }]),
    );
    expect(result).toBeNull();
    // The wrong totals are still there: settling is for removals only.
    expect(await ledgerProblems(USER)).not.toEqual([]);
  });

  it('rebuilds season XP only when a removed row carried season XP', async () => {
    const now = new Date();
    const pass = await prisma.seasonPass.create({
      data: {
        userId: USER, year: now.getFullYear(), quarter: 1,
        startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 86_400_000),
        // 1,000 season XP in the ledger, boosted by momentum to 1,100.
        seasonXp: 1_100, tier: 1,
      },
      select: { id: true },
    });
    const { awardXp } = await import('@/lib/engines/xp-ledger');
    await prisma.$transaction(async (tx) => {
      await awardXp(tx as Tx, USER, { source: 'ACHIEVEMENT', amount: 100, description: 'career only', dedupeKey: 'career-only' });
      await awardXp(tx as Tx, USER, {
        source: 'CHALLENGE', amount: 200, seasonAmount: 1_000, description: 'with season XP', dedupeKey: 'with-season',
      });
    });

    await prisma.$transaction(async (tx) => {
      const revocation = await revokeXpByDedupeKeys(tx as Tx, USER, ['career-only']);
      await settleLedger(tx as Tx, USER, [revocation]);
    });
    // The momentum boost is not the ledger's, so a career-only removal leaves it be.
    expect((await prisma.seasonPass.findUniqueOrThrow({ where: { id: pass.id } })).seasonXp).toBe(1_100);

    await prisma.$transaction(async (tx) => {
      const revocation = await revokeXpByDedupeKeys(tx as Tx, USER, ['with-season']);
      expect(revocation.seasonXp).toBe(1_000);
      await settleLedger(tx as Tx, USER, [revocation]);
    });
    expect((await prisma.seasonPass.findUniqueOrThrow({ where: { id: pass.id } })).seasonXp).toBe(0);
    expect(await ledgerProblems(USER)).toEqual([]);
  });
});

describe('invariant I2 holds after every way XP is taken back', () => {
  it('deleting a stint', async () => {
    const raceId = await addRace(USER);
    const stints = [];
    for (const [from, to] of [[0, 1], [1, 2], [2, 6]] as const) {
      stints.push(await logStint(USER, raceId, { from: from * H, to: to * H, now: NOW }));
    }
    await deleteViewingSession(USER, stints[1]!.sessionId, NOW);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('deleting a race', async () => {
    const kept = await addRace(USER, { name: 'Kept' });
    const removed = await addRace(USER, { name: 'Removed' });
    await logStint(USER, removed, { from: 0, to: 6 * H, now: NOW });
    await logStint(USER, kept, { from: 0, to: H, now: NOW });
    await logStint(USER, removed, { from: 0, to: H, now: NOW });

    const removal = await deleteRace(USER, removed, NOW);
    expect(removal?.careerXpRemoved).toBeGreaterThan(0);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('repairing a ledger 0.3.x left behind', async () => {
    const raceId = await addRace(USER);
    const first = await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });
    await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    // What 0.3.x deletion did: the stint went, its XP stayed, and the race
    // stopped being complete while its bonus stayed.
    await prisma.raceViewingSession.delete({ where: { id: first.sessionId } });
    await prisma.race.update({ where: { id: raceId }, data: { storyCompletedAt: null } });

    const repair = await repairXpLedger(USER);
    expect(repair.orphanedTransactions).toBeGreaterThan(0);
    expect(repair.staleStoryBonuses).toBe(1);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('a stint that finds its race’s Story Complete bonus no longer supported', async () => {
    const legacy = await insertLegacyShortenedRace(USER, {
      hours: 6,
      // 0:00-1:00 and 2:00-7:00 of a race now 6 hours long: six hours stored,
      // five inside the runtime, and a one-hour gap.
      stints: [
        { from: 2 * H, to: 7 * H, watchedAt: new Date(2026, 5, 1, 20, 0) },
        { from: 0, to: H, watchedAt: new Date(2026, 5, 2, 20, 0) },
      ],
      storyCompleted: true,
      bonusPaid: true,
    });
    expect(await ledgerProblems(USER)).toEqual([]);

    // Ten new minutes, from 1:00 to 1:10.
    const outcome = await logStint(USER, legacy.raceId, { from: H, to: H + 600, now: NOW });

    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `story-complete:${legacy.raceId}` } })).toBe(0);
    const race = await prisma.race.findUniqueOrThrow({ where: { id: legacy.raceId } });
    expect(race.storyCompletedAt).toBeNull();
    expect(race.coverageSec).toBe(5 * H + 600);
    expect(await ledgerProblems(USER)).toEqual([]);

    // The summary measures the race the same way, cut at its runtime: five
    // hours before the stint and ten minutes more after it, both when it is
    // shown and when it is opened again from the stint's snapshot.
    const coverage = { coverageBeforeSec: 5 * H, coverageAfterSec: 5 * H + 600, runtimeSec: 6 * H };
    expect(outcome).toMatchObject({ ...coverage, coverageBeforePercent: 83.3, coverageAfterPercent: 86.1 });
    expect(await buildOutcomeForSession(USER, outcome.sessionId))
      .toMatchObject({ ...coverage, coverageBeforePercent: 83.3, coverageAfterPercent: 86.1 });
  });

  it('an edit that lengthens a complete race', async () => {
    const raceId = await addRace(USER);
    await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });

    const resync = await prisma.$transaction(async (tx) => {
      const db = tx as Tx;
      await db.race.update({ where: { id: raceId }, data: { scheduledDurationSec: 7 * H, runtimeSec: 7 * H } });
      await rebuildRaceIntervals(db, raceId);
      await recomputeRaceAggregates(db, raceId, NOW);
      return resyncAfterRaceEdit(db, USER, raceId, NOW, { runtimeChanged: true });
    }, { timeout: 60_000 });

    expect(resync.storyBonus.revoked).toBeGreaterThan(0);
    expect(resync.xpRevoked).toBe(resync.storyBonus.revoked);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('takes nothing back for a stint of another account', async () => {
    const other = await createCareerUser('00000000-0000-4000-8000-0000000002a2', 'LedgerSettleTest Other');
    const theirs = await logStint(other, await addRace(other), { from: 0, to: H, now: NOW });
    try {
      const revocation = await prisma.$transaction((tx) => revokeSessionsXp(tx as Tx, USER, [theirs.sessionId]));
      expect(revocation.transactions).toBe(0);
      expect(await prisma.xPTransaction.count({ where: { sessionId: theirs.sessionId } })).toBeGreaterThan(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: other } });
    }
  });

  it('revoking more stints than one list of ids holds', async () => {
    const raceId = await addRace(USER);
    const stint = await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    const ids = [...Array.from({ length: 1_199 }, (_, index) => `missing-${index}`), stint.sessionId];

    await prisma.$transaction(async (tx) => {
      const revocation = await revokeSessionsXp(tx as Tx, USER, ids);
      expect(revocation.transactions).toBe(1);
      expect(revocation.careerXp).toBe(stint.xpBreakdown.find((line) => line.label === 'Viewing time')?.amount);
      await settleLedger(tx as Tx, USER, [revocation]);
    });
    expect(await ledgerProblems(USER)).toEqual([]);
  });
});
