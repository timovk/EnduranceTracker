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

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { levelFromXp } from '@/lib/domain/progression';
import { resyncAfterRaceEdit } from '@/lib/engines/progression-resync';
import { rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { deleteRace, deleteViewingSession, repairXpLedger } from '@/lib/engines/session-engine';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import { seasonXpToTakeBack, tierForXp } from '@/lib/engines/season-pass-engine';
import {
  awardXp, NOTHING_REVOKED, rebuildCareerTotals, revokeSessionsXp, revokeXpByDedupeKeys, settleLedger,
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

describe('stamping an award', () => {
  /** Grant each amount in turn, in one transaction, described by its place in the list. */
  async function grant(amounts: readonly number[], name: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      for (const [index, amount] of amounts.entries()) {
        await awardXp(tx as Tx, USER, { source: 'CHALLENGE', amount, description: `${name} ${index}` });
      }
    });
  }

  function inLedgerOrder() {
    return prisma.xPTransaction.findMany({
      where: { userId: USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { description: true, createdAt: true, careerXpAfter: true },
    });
  }

  it('keeps awards written inside one millisecond in the order they were written', async () => {
    const instant = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(instant);
    try {
      await grant([50, 60, 70, 80, 90], 'Burst');
    } finally {
      clock.mockRestore();
    }

    const rows = await inLedgerOrder();
    expect(rows.map((row) => row.description)).toEqual(['Burst 0', 'Burst 1', 'Burst 2', 'Burst 3', 'Burst 4']);
    expect(rows.map((row) => row.createdAt.getTime() - instant)).toEqual([0, 1, 2, 3, 4]);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('is not held back by a row stamped ahead of the clock, and keeps every total right', async () => {
    await grant([100, 200], 'Earlier');
    // One row written while the computer's clock was a day ahead.
    const ahead = await prisma.xPTransaction.findFirstOrThrow({ where: { userId: USER, description: 'Earlier 1' } });
    await prisma.xPTransaction.update({ where: { id: ahead.id }, data: { createdAt: new Date(Date.now() + 24 * 3_600_000) } });

    const from = Date.now();
    await grant([300, 400], 'Later');
    const to = Date.now();

    // The later awards are stamped on the clock, before the row ahead of it,
    // whose running total now includes them.
    const rows = await inLedgerOrder();
    expect(rows.map((row) => row.description)).toEqual(['Earlier 0', 'Later 0', 'Later 1', 'Earlier 1']);
    for (const row of rows.slice(1, 3)) {
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(from);
      // A millisecond after the one before it at most, in a burst.
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(to + 1);
    }
    expect(rows.map((row) => Number(row.careerXpAfter))).toEqual([100, 400, 800, 1_000]);
    expect(await ledgerProblems(USER)).toEqual([]);
  });
});

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
      settleLedger(tx as Tx, USER, [NOTHING_REVOKED]),
    );
    expect(result).toBeNull();
    // The wrong totals are still there: settling is for removals only.
    expect(await ledgerProblems(USER)).not.toEqual([]);
  });

  it('takes back only the removed rows’ season XP, and leaves the momentum bonus on the rest', async () => {
    const now = new Date();
    const pass = await prisma.seasonPass.create({
      data: {
        userId: USER, year: now.getFullYear(), quarter: 1,
        startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 86_400_000),
        // Two stints' season XP, boosted by momentum: 1,000 at Ironman
        // (+7.5%) is 1,075, and 400 at In the Window (+3%) is 412.
        seasonXp: 1_487, tier: tierForXp(1_487).tier,
      },
      select: { id: true },
    });
    // A pass of another quarter, which none of these rows counted in.
    const earlier = await prisma.seasonPass.create({
      data: {
        userId: USER, year: now.getFullYear() - 1, quarter: 4,
        startsAt: new Date(now.getTime() - 200 * 86_400_000), endsAt: new Date(now.getTime() - 100 * 86_400_000),
        seasonXp: 500, tier: tierForXp(500).tier,
      },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await awardXp(tx as Tx, USER, { source: 'ACHIEVEMENT', amount: 100, description: 'career only', dedupeKey: 'career-only' });
      await awardXp(tx as Tx, USER, {
        source: 'CHALLENGE', amount: 200, seasonAmount: 1_000, description: 'at Ironman', dedupeKey: 'at-ironman',
      });
      await awardXp(tx as Tx, USER, {
        source: 'CHALLENGE', amount: 80, seasonAmount: 400, description: 'in the window', dedupeKey: 'in-the-window',
      });
    });
    const passXp = async () => (await prisma.seasonPass.findUniqueOrThrow({ where: { id: pass.id } }));
    const take = (keys: string[]) => prisma.$transaction(async (tx) => {
      const revocation = await revokeXpByDedupeKeys(tx as Tx, USER, keys);
      await settleLedger(tx as Tx, USER, [revocation]);
      return revocation;
    });

    // A career-only removal leaves the pass be.
    await take(['career-only']);
    expect((await passXp()).seasonXp).toBe(1_487);

    // The 400: it comes off with the largest momentum bonus there is (430),
    // and the 1,000 keeps its own — rebuilding from the ledger would have
    // left 1,000.
    expect(seasonXpToTakeBack(400)).toBe(430);
    const revocation = await take(['in-the-window']);
    expect(revocation).toMatchObject({ seasonXp: 400, seasonRows: [{ seasonAmount: 400 }] });
    expect(await passXp()).toMatchObject({ seasonXp: 1_057, tier: tierForXp(1_057).tier });

    // The last of it: nothing is left, and nothing is below nothing.
    await take(['at-ironman']);
    expect(await passXp()).toMatchObject({ seasonXp: 0, tier: 0 });
    expect((await prisma.seasonPass.findUniqueOrThrow({ where: { id: earlier.id } })).seasonXp).toBe(500);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('never takes back less than a stint added, whatever its momentum', () => {
    for (const bonus of [0, 0.015, 0.03, 0.045, 0.06, 0.075]) {
      for (let seasonXp = 0; seasonXp <= 5_000; seasonXp += 7) {
        // What the stint path adds to the pass (`session-engine.ts`).
        const added = Math.round(seasonXp * (1 + bonus));
        expect(seasonXpToTakeBack(seasonXp)).toBeGreaterThanOrEqual(added);
        expect(seasonXpToTakeBack(seasonXp)).toBeLessThanOrEqual(Math.ceil(seasonXp * 1.075) + 1);
      }
    }
  });
});

describe('season XP taken back, with the season open', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deleting a stint or a race takes back only its own season XP, and every other stint keeps its momentum', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // After the season reopened on 1 October 2026.
    const at = (day: number, hour: number, minute = 0) => {
      const instant = new Date(2026, 9, day, hour, minute);
      vi.setSystemTime(instant);
      return instant;
    };
    const pass = async () => (await prisma.seasonPass.findFirstOrThrow({
      where: { userId: USER, year: 2026, quarter: 4 }, select: { seasonXp: true },
    })).seasonXp;
    const ledgerSeasonXp = async () => (await prisma.xPTransaction.aggregate({
      where: { userId: USER }, _sum: { seasonAmount: true },
    }))._sum.seasonAmount ?? 0;

    // Five evenings of two and a half hours take momentum up the ladder.
    const builder = await addRace(USER, { name: 'Momentum', hours: 24 });
    for (let day = 0; day < 5; day += 1) {
      const evening = at(10 + day, 22);
      await logStint(USER, builder, { from: day * 2.5 * H, to: (day + 1) * 2.5 * H, watchedAt: evening, now: evening });
    }
    expect(await pass()).toBeGreaterThan(await ledgerSeasonXp());

    // A stint deleted: the pass loses that stint's season XP and no more
    // than the top momentum bonus on it — not every other stint's bonus.
    const short = await addRace(USER, { name: 'Short', hours: 1 });
    let evening = at(15, 20);
    const stint = await logStint(USER, short, { from: 0, to: 600, watchedAt: evening, now: evening });
    const beforeStint = await pass();
    const stintRemoval = await deleteViewingSession(USER, stint.sessionId, at(15, 20, 5));
    expect(stintRemoval.seasonXpRemoved).toBeGreaterThan(0);
    expect(await pass()).toBe(beforeStint - seasonXpToTakeBack(stintRemoval.seasonXpRemoved));

    // A race deleted: the same, for everything the race held.
    evening = at(15, 21);
    await logStint(USER, short, { from: 0, to: 600, watchedAt: evening, now: evening });
    await logStint(USER, short, { from: 600, to: 1_200, watchedAt: at(15, 21, 30), now: at(15, 21, 30) });
    const beforeRace = await pass();
    const raceRemoval = await deleteRace(USER, short, at(15, 22));
    expect(raceRemoval!.seasonXpRemoved).toBeGreaterThan(0);
    expect(await pass()).toBe(beforeRace - seasonXpToTakeBack(raceRemoval!.seasonXpRemoved));

    // What the builder's evenings earned keeps its momentum bonus.
    expect(await pass()).toBeGreaterThan(await ledgerSeasonXp());
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
      return resyncAfterRaceEdit(db, USER, raceId, NOW, { runtimeChanged: true, wasExpedition: false });
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
