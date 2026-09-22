/**
 * End-to-end progression integrity, against a real SQLite database.
 *
 * These are the tests that would catch a corrupted career: overlapping
 * sessions double-counting coverage, a Story Complete bonus paid twice, a
 * deleted session leaving stale aggregates behind. An in-memory fake would let
 * all three through, so this runs against the real schema.
 *
 * Requires `.env.test` to point at a database that can be wiped.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import { logViewingSession, deleteViewingSession, repairXpLedger } from '@/lib/engines/session-engine';
import { recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { awardXp, recalculateCareerXp } from '@/lib/engines/xp-ledger';
import { coverageSeconds, fromRows } from '@/lib/domain/intervals';
import { XP_CONFIG } from '@/lib/config';
import type { Tx } from '@/lib/db/client';

const H = 3600;
const USER = '00000000-0000-4000-8000-0000000000ff';

/** Wipe everything this user owns. Cascades take the rest. */
async function resetUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, name: 'Test', careerProfile: { create: {} } } });
}

async function makeRace(options: {
  runtimeHours?: number;
  name?: string;
  isMajorEvent?: boolean;
  championshipId?: string;
} = {}): Promise<string> {
  const runtimeSec = Math.round((options.runtimeHours ?? 6) * H);
  const race = await prisma.race.create({
    data: {
      userId: USER,
      name: options.name ?? 'Test Race',
      scheduledDurationSec: runtimeSec,
      runtimeSec,
      raceType: 'H6',
      isMajorEvent: options.isMajorEvent ?? false,
      championshipId: options.championshipId ?? null,
    },
    select: { id: true },
  });
  return race.id;
}

async function coverageOf(raceId: string): Promise<number> {
  const rows = await prisma.watchedInterval.findMany({
    where: { raceId },
    select: { startSec: true, endSec: true },
  });
  return coverageSeconds(fromRows(rows));
}

beforeEach(async () => {
  await resetUser();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

describe('logging a stint', () => {
  it('records the raw session and the merged coverage separately', async () => {
    const raceId = await makeRace();

    const outcome = await logViewingSession(USER, {
      raceId, mode: 'RANGE',
      startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1.25, watchedAt: null, note: undefined,
    });

    expect(outcome.timelineSeconds).toBe(2 * H);
    // Two hours of timeline at 1.25x costs 1h36m of real life.
    expect(outcome.realSeconds).toBe(Math.round((2 * H) / 1.25));
    expect(outcome.newCoverageSeconds).toBe(2 * H);
    expect(await coverageOf(raceId)).toBe(2 * H);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.coverageSec).toBe(2 * H);
    expect(race.realViewingSec).toBe(Math.round((2 * H) / 1.25));
    expect(race.timelineWatchedSec).toBe(2 * H);
    expect(race.sessionCount).toBe(1);
    expect(race.status).toBe('WATCHING');
  });

  it('accepts a stint described by its duration instead of its end point', async () => {
    const raceId = await makeRace();
    const outcome = await logViewingSession(USER, {
      raceId, mode: 'DURATION',
      startTimestamp: H, endTimestamp: undefined,
      realMinutes: 60, playbackSpeed: 1.5, watchedAt: null, note: undefined,
    });

    // An hour of real time at 1.5x advances the race by ninety minutes.
    expect(outcome.timelineSeconds).toBe(Math.round(1.5 * H));
    expect(outcome.realSeconds).toBe(H);
  });

  it('awards XP for the viewing time at the configured rate', async () => {
    const raceId = await makeRace();
    const outcome = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    // The viewing award itself is exactly the configured rate. The session
    // total is larger, because a first stint also unlocks the first
    // achievements and milestones — which is the point of logging one.
    const viewing = await prisma.xPTransaction.findFirstOrThrow({
      where: { userId: USER, sessionId: outcome.sessionId, source: 'VIEWING' },
    });
    expect(viewing.amount).toBe(XP_CONFIG.xpPerRealMinute * 60);

    expect(outcome.careerXpAwarded).toBeGreaterThanOrEqual(viewing.amount);

    // Whatever the total, the profile and the ledger agree.
    const [profile, ledger] = await Promise.all([
      prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } }),
      prisma.xPTransaction.aggregate({ where: { userId: USER }, _sum: { amount: true } }),
    ]);
    expect(Number(profile.careerXp)).toBe(ledger._sum.amount ?? 0);
  });

  it('clamps a stint that runs past the chequered flag', async () => {
    const raceId = await makeRace({ runtimeHours: 4 });
    const outcome = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    expect(outcome.newCoverageSeconds).toBe(4 * H);
    expect(await coverageOf(raceId)).toBe(4 * H);
  });
});

describe('overlapping sessions never double-count', () => {
  it('follows the worked example from the specification', async () => {
    const raceId = await makeRace();

    // Watch 00:00-01:00, then re-watch 00:30-01:00.
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    const second = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 1800, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });

    // Real viewing time is 1h30m. Unique coverage is 1h.
    expect(race.realViewingSec).toBe(5400);
    expect(race.coverageSec).toBe(3600);
    expect(second.newCoverageSeconds).toBe(0);
  });

  it('pays only the re-watch rate for timeline already seen', async () => {
    const raceId = await makeRace();

    const first = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    const rewatch = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    // Compare the viewing awards themselves, not the session totals: the first
    // session of a career also unlocks achievements, which are not the subject
    // of this test.
    const [firstViewing, rewatchViewing] = await Promise.all([
      prisma.xPTransaction.findFirstOrThrow({
        where: { userId: USER, sessionId: first.sessionId, source: 'VIEWING' },
      }),
      prisma.xPTransaction.findFirstOrThrow({
        where: { userId: USER, sessionId: rewatch.sessionId, source: 'REWATCH' },
      }),
    ]);

    expect(rewatchViewing.amount)
      .toBe(Math.round(firstViewing.amount * XP_CONFIG.rewatchXpMultiplier));
    // A genuine re-watch still counts for something.
    expect(rewatchViewing.amount).toBeGreaterThan(0);
  });

  it('keeps total new coverage equal to final coverage across many stints', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const stints: [number, number][] = [
      [0, 1.2], [0.9, 2.4], [3, 3.6], [0, 0.6], [2.4, 3], [3.6, 5.4], [5.4, 6], [1, 2],
    ];

    let totalNew = 0;
    for (const [from, to] of stints) {
      const outcome = await logViewingSession(USER, {
        raceId, mode: 'RANGE',
        startTimestamp: Math.round(from * H), endTimestamp: Math.round(to * H),
        playbackSpeed: 1, watchedAt: null, note: undefined,
      });
      totalNew += outcome.newCoverageSeconds;
    }

    // The invariant that makes completion honest.
    expect(totalNew).toBe(await coverageOf(raceId));
  });
});

describe('Story Complete', () => {
  it('unlocks only when the whole timeline has been watched', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });

    // Watch the first two hours and the last three — an hour is skipped.
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    const skipping = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 3 * H, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    expect(skipping.storyCompleted).toBe(false);
    let race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.storyCompletedAt).toBeNull();
    // The furthest point reached is the end of the race, and it still does not count.
    expect(race.furthestTimestampSec).toBe(6 * H);

    // Go back and watch the skipped hour.
    const repairing = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 2 * H, endTimestamp: 3 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    expect(repairing.storyCompleted).toBe(true);
    race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.storyCompletedAt).not.toBeNull();
    expect(race.status).toBe('COMPLETED');
  });

  it('pays its bonus exactly once, however many times a stint is logged', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });

    const completing = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect(completing.storyCompleted).toBe(true);
    expect(completing.storyCompleteBonus).toBe(1_500);

    // Log the whole race again. The bonus must not be paid a second time.
    const again = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect(again.storyCompleteBonus).toBe(0);

    const bonuses = await prisma.xPTransaction.count({
      where: { userId: USER, source: 'STORY_COMPLETE', sourceRef: raceId },
    });
    expect(bonuses).toBe(1);
  });

  it('scales the bonus with race length', async () => {
    for (const [hours, expected] of [[4, 1_000], [6, 1_500], [12, 3_000], [24, 7_500]] as const) {
      await resetUser();
      const raceId = await makeRace({ runtimeHours: hours });
      const outcome = await logViewingSession(USER, {
        raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: hours * H,
        playbackSpeed: 1, watchedAt: null, note: undefined,
      });
      expect(outcome.storyCompleteBonus, `${hours}h`).toBe(expected);
    }
  });
});

describe('the XP ledger is authoritative', () => {
  it('refuses to grant a one-shot award twice', async () => {
    await prisma.$transaction(async (tx) => {
      const first = await awardXp(tx as Tx, USER, {
        source: 'ACHIEVEMENT', amount: 5_000, description: 'Test', dedupeKey: 'test:once',
      });
      const second = await awardXp(tx as Tx, USER, {
        source: 'ACHIEVEMENT', amount: 5_000, description: 'Test', dedupeKey: 'test:once',
      });

      expect(first.granted).toBe(5_000);
      expect(first.duplicate).toBe(false);
      expect(second.granted).toBe(0);
      expect(second.duplicate).toBe(true);
    });

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    expect(Number(profile.careerXp)).toBe(5_000);
  });

  it('never grants a negative award', async () => {
    await prisma.$transaction(async (tx) => {
      const result = await awardXp(tx as Tx, USER, {
        source: 'MANUAL_ADJUSTMENT', amount: -9_999, description: 'Should not happen',
      });
      expect(result.granted).toBe(0);
    });

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    expect(Number(profile.careerXp)).toBeGreaterThanOrEqual(0);
  });

  it('rebuilds the running total from the ledger', async () => {
    const raceId = await makeRace();
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    // Corrupt the cached total, then rebuild it.
    await prisma.careerProfile.update({ where: { userId: USER }, data: { careerXp: BigInt(999_999) } });
    const result = await recalculateCareerXp(USER);

    const ledger = await prisma.xPTransaction.aggregate({ where: { userId: USER }, _sum: { amount: true } });
    expect(result.after).toBe(ledger._sum.amount ?? 0);
    expect(result.before).toBe(999_999);
  });

  it('records the running total and level on every transaction', async () => {
    const raceId = await makeRace();
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 3 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const rows = await prisma.xPTransaction.findMany({
      where: { userId: USER }, orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThan(0);

    let running = 0;
    for (const row of rows) {
      running += row.amount;
      expect(Number(row.careerXpAfter)).toBe(running);
      expect(row.levelAfter).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('deleting a session', () => {
  it('rebuilds coverage from what is left rather than subtracting', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });

    const first = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: H, endTimestamp: 3 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    expect(await coverageOf(raceId)).toBe(3 * H);

    // Removing the FIRST session must leave 01:00-03:00, not 02:00-03:00 —
    // which is what naive subtraction of merged intervals would produce.
    await deleteViewingSession(USER, first.sessionId);

    const rows = await prisma.watchedInterval.findMany({
      where: { raceId }, select: { startSec: true, endSec: true }, orderBy: { startSec: 'asc' },
    });
    expect(rows).toEqual([{ startSec: H, endSec: 3 * H }]);
    expect(await coverageOf(raceId)).toBe(2 * H);
  });

  it('takes back the XP the stint earned', async () => {
    const raceId = await makeRace();
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const before = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    const viewing = await prisma.xPTransaction.aggregate({
      where: { userId: USER, sessionId: session.sessionId, source: { in: ['VIEWING', 'REWATCH'] } },
      _sum: { amount: true },
    });
    expect(viewing._sum.amount ?? 0).toBeGreaterThan(0);

    const removal = await deleteViewingSession(USER, session.sessionId);
    const after = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });

    // XP follows the data: the stint is gone, so the XP it earned is gone with
    // it. The race reading "not started" while the career kept the XP for
    // watching it was the contradiction this replaced.
    expect(removal.careerXpRemoved).toBe(viewing._sum.amount ?? 0);
    expect(Number(after.careerXp)).toBe(Number(before.careerXp) - removal.careerXpRemoved);
  });

  it('leaves the profile agreeing with the ledger', async () => {
    const raceId = await makeRace();
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    await deleteViewingSession(USER, session.sessionId);

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    const ledger = await prisma.xPTransaction.aggregate({
      where: { userId: USER },
      _sum: { amount: true },
    });

    // The ledger is the only authoritative thing. Anything else is a cache.
    expect(Number(profile.careerXp)).toBe(ledger._sum.amount ?? 0);
  });

  it('frees the Story Complete bonus so the race can earn it again', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const bonusKey = `story-complete:${raceId}`;

    const first = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(1);

    const removal = await deleteViewingSession(USER, first.sessionId);
    expect(removal.storyBonusRemoved).toBe(true);
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(0);

    // The dedupeKey is UNIQUE, so a bonus row outliving the completion it was
    // awarded for would block the race from ever earning it again — the next
    // award would be silently swallowed as a duplicate.
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(1);
  });

  it('keeps the Story Complete bonus while the race is still complete', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const bonusKey = `story-complete:${raceId}`;

    const first = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    // A second pass over the whole race: coverage now survives the first going.
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    // The bonus row belongs to the FIRST session, which is the one being
    // deleted — but the bonus is keyed to the race, not to whichever stint
    // happened to finish it, so it must survive.
    const removal = await deleteViewingSession(USER, first.sessionId);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.storyCompletedAt).not.toBeNull();
    expect(removal.storyBonusRemoved).toBe(false);
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(1);
  });

  it('re-stamps the running totals so the XP graph stays true', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const logged = [];
    for (const [from, to] of [[0, 1], [2, 3], [4, 5]] as const) {
      logged.push(await logViewingSession(USER, {
        raceId, mode: 'RANGE', startTimestamp: from * H, endTimestamp: to * H,
        playbackSpeed: 1, watchedAt: null, note: undefined,
      }));
    }

    await deleteViewingSession(USER, logged[1].sessionId);

    const rows = await prisma.xPTransaction.findMany({
      where: { userId: USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { amount: true, careerXpAfter: true },
    });

    // `careerXpAfter` is the snapshot the career XP graph is drawn from.
    // Remove a row from the middle of the history and every snapshot after it
    // describes a career that no longer happened unless they are replayed.
    let running = 0;
    for (const row of rows) {
      running += row.amount;
      expect(Number(row.careerXpAfter)).toBe(running);
    }

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    expect(Number(profile.careerXp)).toBe(running);
  });

  it('never revokes a landmark, only a balance', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const before = await Promise.all([
      prisma.achievementProgress.count({ where: { userId: USER, unlockedAt: { not: null } } }),
      prisma.trophy.count({ where: { userId: USER } }),
      prisma.masteryProgress.count({ where: { userId: USER, unlockedAt: { not: null } } }),
    ]);

    await deleteViewingSession(USER, session.sessionId);

    const after = await Promise.all([
      prisma.achievementProgress.count({ where: { userId: USER, unlockedAt: { not: null } } }),
      prisma.trophy.count({ where: { userId: USER } }),
      prisma.masteryProgress.count({ where: { userId: USER, unlockedAt: { not: null } } }),
    ]);

    // Achievements, trophies and mastery nodes are landmarks, not balances.
    // Nothing here takes back something it has already given.
    expect(after).toEqual(before);
  });

  it('steps a completed race back to in progress', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect((await prisma.race.findUniqueOrThrow({ where: { id: raceId } })).status).toBe('COMPLETED');

    await deleteViewingSession(USER, session.sessionId);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.coverageSec).toBe(0);
    expect(race.storyCompletedAt).toBeNull();
    expect(race.status).not.toBe('COMPLETED');
  });

  it('restores everything when the last session goes', async () => {
    const raceId = await makeRace();
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    await deleteViewingSession(USER, session.sessionId);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.sessionCount).toBe(0);
    expect(race.coverageSec).toBe(0);
    expect(race.realViewingSec).toBe(0);
    expect(race.startedAt).toBeNull();
    expect(await prisma.watchedInterval.count({ where: { raceId } })).toBe(0);
  });
});

describe('cached aggregates are only ever a cache', () => {
  it('rebuilds exactly from the sources of truth', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    for (const [from, to, speed] of [[0, 1.5, 1], [1.2, 3, 1.25], [4, 6, 1.5]] as const) {
      await logViewingSession(USER, {
        raceId, mode: 'RANGE',
        startTimestamp: Math.round(from * H), endTimestamp: Math.round(to * H),
        playbackSpeed: speed, watchedAt: null, note: undefined,
      });
    }

    const before = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });

    // Corrupt every cached figure, then rebuild.
    await prisma.race.update({
      where: { id: raceId },
      data: {
        coverageSec: 1, realViewingSec: 2, timelineWatchedSec: 3,
        sessionCount: 4, furthestTimestampSec: 5, avgPlaybackSpeed: 6,
      },
    });
    await prisma.$transaction((tx) => recomputeRaceAggregates(tx as Tx, raceId));

    const after = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(after.coverageSec).toBe(before.coverageSec);
    expect(after.realViewingSec).toBe(before.realViewingSec);
    expect(after.timelineWatchedSec).toBe(before.timelineWatchedSec);
    expect(after.sessionCount).toBe(before.sessionCount);
    expect(after.furthestTimestampSec).toBe(before.furthestTimestampSec);
    expect(after.avgPlaybackSpeed).toBeCloseTo(before.avgPlaybackSpeed, 3);
  });

  it('weights the average playback speed by timeline, not by session count', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 4 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 4 * H, endTimestamp: 4 * H + 120,
      playbackSpeed: 3, watchedAt: null, note: undefined,
    });

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    // A two-minute blast at 3x barely moves a four-hour average.
    expect(race.avgPlaybackSpeed).toBeLessThan(1.02);
  });
});

describe('nothing in the application can reduce progression', () => {
  it('never writes a negative XP transaction', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    await deleteViewingSession(USER, session.sessionId);

    const negative = await prisma.xPTransaction.count({ where: { userId: USER, amount: { lt: 0 } } });
    expect(negative).toBe(0);
  });

  it('never lets career XP or level go backwards', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    let previousXp = 0;
    let previousLevel = 1;

    for (const [from, to] of [[0, 1], [1, 2], [0, 1], [2, 4], [4, 6]] as const) {
      await logViewingSession(USER, {
        raceId, mode: 'RANGE', startTimestamp: from * H, endTimestamp: to * H,
        playbackSpeed: 1, watchedAt: null, note: undefined,
      });
      const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
      expect(Number(profile.careerXp)).toBeGreaterThanOrEqual(previousXp);
      expect(profile.level).toBeGreaterThanOrEqual(previousLevel);
      previousXp = Number(profile.careerXp);
      previousLevel = profile.level;
    }
  });
});

describe('repairing a career written before deletion took its XP back', () => {
  it('removes viewing XP whose stint no longer exists', async () => {
    const raceId = await makeRace();
    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const inflated = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });

    // Delete the session row directly, which is exactly what the old
    // behaviour left behind: `onDelete: SetNull` cuts the award loose and the
    // career keeps XP for a stint that is gone.
    await prisma.raceViewingSession.delete({ where: { id: session.sessionId } });
    const orphaned = await prisma.xPTransaction.count({
      where: { userId: USER, sessionId: null, source: { in: ['VIEWING', 'REWATCH'] } },
    });
    expect(orphaned).toBeGreaterThan(0);

    const repair = await repairXpLedger(USER);

    expect(repair.orphanedTransactions).toBe(orphaned);
    expect(repair.careerXpAfter).toBeLessThan(Number(inflated.careerXp));
    expect(await prisma.xPTransaction.count({
      where: { userId: USER, sessionId: null, source: { in: ['VIEWING', 'REWATCH'] } },
    })).toBe(0);

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    const ledger = await prisma.xPTransaction.aggregate({ where: { userId: USER }, _sum: { amount: true } });
    expect(Number(profile.careerXp)).toBe(ledger._sum.amount ?? 0);
  });

  it('releases a Story Complete bonus held by a race that is no longer complete', async () => {
    const raceId = await makeRace({ runtimeHours: 6 });
    const bonusKey = `story-complete:${raceId}`;

    const session = await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 6 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(1);

    // Strip the coverage the way the old deletion path did — the race falls
    // back to incomplete while the bonus, and its unique key, stay behind.
    await prisma.raceViewingSession.delete({ where: { id: session.sessionId } });
    await prisma.watchedInterval.deleteMany({ where: { raceId } });
    await prisma.race.update({ where: { id: raceId }, data: { storyCompletedAt: null, coverageSec: 0 } });

    const repair = await repairXpLedger(USER);

    expect(repair.staleStoryBonuses).toBe(1);
    expect(await prisma.xPTransaction.count({ where: { dedupeKey: bonusKey } })).toBe(0);
  });

  it('changes nothing in a healthy career', async () => {
    const raceId = await makeRace();
    await logViewingSession(USER, {
      raceId, mode: 'RANGE', startTimestamp: 0, endTimestamp: 2 * H,
      playbackSpeed: 1, watchedAt: null, note: undefined,
    });

    const before = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    const repair = await repairXpLedger(USER);
    const after = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });

    expect(repair.orphanedTransactions).toBe(0);
    expect(repair.staleStoryBonuses).toBe(0);
    expect(Number(after.careerXp)).toBe(Number(before.careerXp));
    expect(after.level).toBe(before.level);
  });
});
