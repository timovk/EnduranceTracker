/**
 * Deleting a race takes its XP back (owner decision D4).
 *
 * Exactly as if its stints had been deleted one by one: the viewing and
 * re-watch XP of every stint and the Story Complete bonus come off the ledger,
 * including viewing XP a stint deleted under 0.3.x left behind, and the
 * totals are rebuilt. Achievements, milestones, mastery nodes, trophies and
 * Hall of Fame plaques stay. Also here: deleting a stint from the first year
 * of a long ledger, which re-stamps everything after it, in batches.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { deleteRace, deleteViewingSession } from '@/lib/engines/session-engine';
import { rebuildCareerTotals } from '@/lib/engines/xp-ledger';
import {
  addRace, backdateLedgerRows, createCareerUser, H, ledgerProblems, logStint,
} from '../helpers/career-db';

const USER = '00000000-0000-4000-8000-0000000002b1';
const OTHER = '00000000-0000-4000-8000-0000000002b2';
const NOW = new Date(2026, 8, 24, 20, 0);

beforeEach(async () => {
  await createCareerUser(USER, 'DeleteRaceTest');
  await createCareerUser(OTHER, 'DeleteRaceTest Other');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await disconnectDb();
});

/** Every landmark the account holds, counted. None of these may ever go down. */
async function landmarks(userId: string) {
  const [achievements, milestones, mastery, trophies, hallOfFame] = await Promise.all([
    prisma.achievementProgress.count({ where: { userId, unlockedAt: { not: null } } }),
    prisma.milestoneProgress.count({ where: { userId } }),
    prisma.masteryProgress.count({ where: { userId, unlockedAt: { not: null } } }),
    prisma.trophy.count({ where: { userId } }),
    prisma.hallOfFameEntry.count({ where: { userId } }),
  ]);
  return { achievements, milestones, mastery, trophies, hallOfFame };
}

describe('deleting a race', () => {
  it('takes back exactly its viewing, re-watch and Story Complete XP, and keeps every landmark', async () => {
    const kept = await addRace(USER, { name: 'Kept 6 Hours' });
    const removed = await addRace(USER, { name: 'Removed 6 Hours' });
    await logStint(USER, removed, { from: 0, to: 6 * H, now: NOW });
    await logStint(USER, kept, { from: 0, to: 2 * H, now: NOW });
    await logStint(USER, removed, { from: 0, to: H, now: NOW });

    const ownRows = await prisma.xPTransaction.findMany({
      where: {
        userId: USER,
        OR: [
          { source: { in: ['VIEWING', 'REWATCH'] }, sourceRef: removed },
          { dedupeKey: `story-complete:${removed}` },
        ],
      },
      select: { id: true, source: true, amount: true },
    });
    expect(new Set(ownRows.map((row) => row.source))).toEqual(new Set(['VIEWING', 'REWATCH', 'STORY_COMPLETE']));
    const others = await prisma.xPTransaction.findMany({
      where: { userId: USER, id: { notIn: ownRows.map((row) => row.id) } },
      select: { id: true },
    });
    const before = await landmarks(USER);
    expect(before.hallOfFame).toBeGreaterThan(0);

    const removal = await deleteRace(USER, removed, NOW);

    expect(removal).toMatchObject({
      raceName: 'Removed 6 Hours',
      sessionsRemoved: 2,
      careerXpRemoved: ownRows.reduce((sum, row) => sum + row.amount, 0),
      seasonXpRemoved: 0,
      storyBonusRemoved: true,
    });
    // Exactly its own rows went; every other row is still there.
    expect(await prisma.xPTransaction.count({ where: { id: { in: ownRows.map((row) => row.id) } } })).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { id: { in: others.map((row) => row.id) } } })).toBe(others.length);
    expect(await prisma.race.count({ where: { id: removed } })).toBe(0);
    expect(await prisma.raceViewingSession.count({ where: { raceId: removed } })).toBe(0);

    // Landmarks stay, and a plaque that named the race keeps its place.
    expect(await landmarks(USER)).toEqual(before);
    expect(await prisma.hallOfFameEntry.count({ where: { userId: USER, raceId: removed } })).toBe(0);
    expect(await ledgerProblems(USER)).toEqual([]);

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    expect(removal?.levelAfter).toBe(profile.level);
  });

  it('also takes back viewing XP whose stint was deleted under 0.3.x', async () => {
    const raceId = await addRace(USER);
    const first = await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    await logStint(USER, raceId, { from: H, to: 2 * H, now: NOW });
    // 0.3.x deleted the stint and left its XP, cut loose from any session.
    await prisma.raceViewingSession.delete({ where: { id: first.sessionId } });
    const orphaned = await prisma.xPTransaction.findMany({
      where: { userId: USER, sessionId: null, sourceRef: raceId, source: 'VIEWING' },
      select: { amount: true },
    });
    expect(orphaned).toHaveLength(1);
    const viewing = await prisma.xPTransaction.aggregate({
      where: { userId: USER, sourceRef: raceId, source: { in: ['VIEWING', 'REWATCH'] } },
      _sum: { amount: true },
    });

    const removal = await deleteRace(USER, raceId, NOW);

    expect(removal?.careerXpRemoved).toBe(viewing._sum.amount);
    expect(await prisma.xPTransaction.count({ where: { userId: USER, sourceRef: raceId, source: { in: ['VIEWING', 'REWATCH'] } } })).toBe(0);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('says nothing was there when the race is not in this account’s library', async () => {
    const theirs = await addRace(OTHER);
    await logStint(OTHER, theirs, { from: 0, to: 2 * H, now: NOW });
    const theirXp = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: OTHER } });

    expect(await deleteRace(USER, theirs, NOW)).toBeNull();
    expect(await deleteRace(USER, '00000000-0000-4000-8000-00000000dead', NOW)).toBeNull();

    expect(await prisma.race.count({ where: { id: theirs } })).toBe(1);
    const after = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: OTHER } });
    expect(after.careerXp).toBe(theirXp.careerXp);
  });

  it('takes a race with no XP away cleanly', async () => {
    const raceId = await addRace(USER, { name: 'Never Watched' });
    const removal = await deleteRace(USER, raceId, NOW);
    expect(removal).toMatchObject({ raceName: 'Never Watched', sessionsRemoved: 0, careerXpRemoved: 0, storyBonusRemoved: false });
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('drops the edition from its event’s figures', async () => {
    const one = await addRace(USER, { iconicKey: 'test-24', raceDate: new Date(Date.UTC(2025, 5, 14)) });
    const two = await addRace(USER, { iconicKey: 'test-24', raceDate: new Date(Date.UTC(2026, 5, 13)) });
    await logStint(USER, one, { from: 0, to: 6 * H, now: NOW });
    await logStint(USER, two, { from: 0, to: 6 * H, now: NOW });
    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'test-24' } } });
    expect(event.editionsStoryComplete).toBe(2);

    await deleteRace(USER, two, NOW);

    const after = await prisma.raceMastery.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.editionsTracked).toBe(1);
    expect(after.editionsStoryComplete).toBe(1);
  });
});

describe('deleting a stint from the first year', () => {
  it('re-stamps the ledger in batches and keeps I2', async () => {
    const raceId = await addRace(USER);
    const first = await logStint(USER, raceId, {
      from: 0, to: H, watchedAt: new Date(2025, 0, 10, 20, 0), now: NOW,
    });

    // Its XP was written a year and a half before everything else. The
    // ledger's `createdAt` is always the real clock, so the test moves it.
    const firstRows = await prisma.xPTransaction.findMany({ where: { userId: USER }, select: { id: true } });
    await backdateLedgerRows(USER, firstRows.map((row) => row.id), new Date(2025, 0, 10, 20, 0));

    // A long career after it: 1,000 rows, two and a half batches.
    const base = new Date(2025, 1, 1).getTime();
    await prisma.xPTransaction.createMany({
      data: Array.from({ length: 1_000 }, (_, index) => ({
        userId: USER, source: 'CHALLENGE' as const, amount: 25 + (index % 7) * 10, seasonAmount: 0,
        description: `Later ${index}`, createdAt: new Date(base + index * 3_600_000),
      })),
    });
    await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, USER), { timeout: 60_000 });
    expect(await ledgerProblems(USER)).toEqual([]);

    const removal = await deleteViewingSession(USER, first.sessionId, NOW);

    expect(removal.careerXpRemoved).toBeGreaterThan(0);
    expect(removal.careerXpAfter).toBe(removal.careerXpBefore - removal.careerXpRemoved);
    expect(await ledgerProblems(USER)).toEqual([]);
  });
});
