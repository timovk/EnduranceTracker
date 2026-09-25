/**
 * `db:recompute` (`recomputeCareer`): rebuilding every derived figure from the
 * stints, the races and the ledger.
 *
 * It must be idempotent — a second run changes nothing — and it must put
 * right what 0.3.x could leave behind: coverage stored past a shortened
 * runtime, and a Story Complete bonus a runtime edit skipped (paid once,
 * career XP only) or one the clamped coverage no longer supports (released).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma } from '@/lib/db/client';
import { storyCompleteBonus } from '@/lib/domain/progression';
import { recomputeCareer } from '@/lib/server/recompute';
import { isCareerBackfillApplied } from '@/lib/server/upgrades/career-backfill';
import {
  addRace, createCareerUser, H, insertLegacyShortenedRace, ledgerProblems, logStint,
} from '../helpers/career-db';

const USER = '00000000-0000-4000-8000-0000000002e1';
const NOW = new Date(2026, 8, 24, 20, 0);

beforeEach(async () => {
  await createCareerUser(USER, 'RecomputeTest');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

/** Everything recompute derives, without the ids and timestamps a rebuild legitimately renews. */
async function derivedState() {
  const [ledger, races, intervals, masteryProgress, achievements, milestones, events, profile] = await Promise.all([
    prisma.xPTransaction.findMany({
      where: { userId: USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, source: true, amount: true, seasonAmount: true, careerXpAfter: true, levelAfter: true, dedupeKey: true, sessionId: true },
    }),
    prisma.race.findMany({
      where: { userId: USER },
      orderBy: { id: 'asc' },
      select: {
        id: true, runtimeSec: true, coverageSec: true, realViewingSec: true, creditedViewingSec: true,
        timelineWatchedSec: true, sessionCount: true, furthestTimestampSec: true, avgPlaybackSpeed: true,
        startedAt: true, lastWatchedAt: true, storyCompletedAt: true, completedAt: true, status: true,
        raceMasteryId: true, iconicKey: true,
      },
    }),
    prisma.watchedInterval.findMany({
      where: { race: { userId: USER } },
      orderBy: [{ raceId: 'asc' }, { startSec: 'asc' }],
      select: { raceId: true, startSec: true, endSec: true },
    }),
    prisma.masteryProgress.findMany({
      where: { userId: USER },
      orderBy: { nodeId: 'asc' },
      select: { nodeId: true, value: true, target: true, unlockedAt: true },
    }),
    prisma.achievementProgress.findMany({
      where: { userId: USER },
      orderBy: { achievementKey: 'asc' },
      select: { achievementKey: true, unlockedAt: true },
    }),
    prisma.milestoneProgress.findMany({
      where: { userId: USER },
      orderBy: [{ metric: 'asc' }, { threshold: 'asc' }],
      select: {
        metric: true, threshold: true, reachedAt: true, xpAwarded: true,
        achievedAt: true, achievedPrecision: true, sessionId: true, raceId: true, subjectName: true,
      },
    }),
    prisma.raceMastery.findMany({
      where: { userId: USER },
      orderBy: { key: 'asc' },
      select: {
        key: true, name: true, editionsTracked: true, editionsStoryComplete: true, totalRealSec: true,
        totalTimelineSec: true, firstCompletedYear: true, latestCompletedYear: true, longestConsecutiveEditions: true,
      },
    }),
    prisma.careerProfile.findUniqueOrThrow({
      where: { userId: USER },
      select: { careerXp: true, level: true, prestige: true, titleKey: true },
    }),
  ]);
  return { ledger, races, intervals, masteryProgress, achievements, milestones, events, profile };
}

describe('recompute', () => {
  it('running recompute twice changes nothing', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'recompute-cup', name: 'Recompute Cup' },
      select: { id: true },
    });
    const complete = await addRace(USER, { name: 'Complete', championshipId: championship.id, iconicKey: 'recompute-6' });
    const partial = await addRace(USER, { name: 'Partial', hours: 24, raceDate: new Date(Date.UTC(2026, 5, 13)) });
    const edition = await addRace(USER, { name: 'Edition', iconicKey: 'recompute-6', raceDate: new Date(Date.UTC(2025, 5, 14)) });
    await logStint(USER, complete, { from: 0, to: 3 * H, watchedAt: new Date(2026, 3, 1, 20, 0), now: NOW });
    await logStint(USER, complete, { from: 3 * H, to: 6 * H, speed: 1.5, watchedAt: new Date(2026, 3, 2, 20, 0), now: NOW });
    await logStint(USER, complete, { from: H, to: 2 * H, watchedAt: new Date(2026, 3, 3, 20, 0), now: NOW });
    await logStint(USER, partial, { from: 0, to: 5 * H, speed: 0.5, watchedAt: new Date(2026, 5, 20, 20, 0), now: NOW });
    await logStint(USER, edition, { from: 0, to: 6 * H, watchedAt: new Date(2026, 6, 1, 20, 0), now: NOW });
    await insertLegacyShortenedRace(USER, {
      name: 'Legacy',
      hours: 6,
      stints: [{ from: 0, to: 7 * H, watchedAt: new Date(2026, 7, 1, 20, 0) }],
      storyCompleted: true,
      bonusPaid: false,
    });

    await recomputeCareer(USER, { now: NOW });
    const once = await derivedState();
    expect(await ledgerProblems(USER)).toEqual([]);

    const second = await recomputeCareer(USER, { now: NOW });
    expect(await derivedState()).toEqual(once);
    expect(second).toMatchObject({
      racesRebuilt: 4,
      storyBonusesAwarded: 0,
      storyBonusesRevoked: 0,
      ledger: { orphanedTransactions: 0, staleStoryBonuses: 0 },
      collectionCardsFilled: 0,
      masteryNodesUnlocked: 0,
      achievementsUnlocked: 0,
      milestonesReached: 0,
      careerMilestonesReached: 0,
      careerMilestoneXp: 0,
      datesFilled: 0,
      datesRecognised: 0,
      milestoneDatesRebuilt: 0,
    });
  });

  it('recompute rebuilds intervals and pays a Story Complete bonus a runtime edit skipped', async () => {
    // Watched to seven hours; the runtime was then cut to six, and 0.3.2
    // marked the race complete without paying its bonus.
    const legacy = await insertLegacyShortenedRace(USER, {
      name: 'Shortened Six Hours',
      hours: 6,
      stints: [
        { from: 0, to: 3 * H, watchedAt: new Date(2026, 4, 1, 20, 0) },
        { from: 3 * H, to: 7 * H, watchedAt: new Date(2026, 4, 2, 20, 0) },
      ],
      storyCompleted: true,
      bonusPaid: false,
    });
    expect(await prisma.watchedInterval.findMany({ where: { raceId: legacy.raceId }, select: { startSec: true, endSec: true } }))
      .toEqual([{ startSec: 0, endSec: 7 * H }]);

    const report = await recomputeCareer(USER, { now: NOW });

    expect(report.storyBonusesAwarded).toBe(1);
    expect(await prisma.watchedInterval.findMany({ where: { raceId: legacy.raceId }, select: { startSec: true, endSec: true } }))
      .toEqual([{ startSec: 0, endSec: 6 * H }]);
    const bonus = await prisma.xPTransaction.findFirstOrThrow({
      where: { userId: USER, dedupeKey: `story-complete:${legacy.raceId}` },
    });
    expect(bonus.amount).toBe(storyCompleteBonus(6 * H).careerXp);
    expect(bonus.seasonAmount).toBe(0);
    // Paid to the stint that completed the story.
    expect(bonus.sessionId).toBe(legacy.sessionIds[1]);
    const race = await prisma.race.findUniqueOrThrow({ where: { id: legacy.raceId } });
    expect(race).toMatchObject({ coverageSec: 6 * H, status: 'COMPLETED', creditedViewingSec: 7 * H });
    expect(await ledgerProblems(USER)).toEqual([]);

    const again = await recomputeCareer(USER, { now: NOW });
    expect(again.storyBonusesAwarded).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `story-complete:${legacy.raceId}` } })).toBe(1);
  });

  it('releases a Story Complete bonus the clamped coverage no longer supports', async () => {
    const legacy = await insertLegacyShortenedRace(USER, {
      hours: 6,
      stints: [
        { from: 2 * H, to: 7 * H, watchedAt: new Date(2026, 4, 1, 20, 0) },
        { from: 0, to: H, watchedAt: new Date(2026, 4, 2, 20, 0) },
      ],
      storyCompleted: true,
      bonusPaid: true,
    });

    const report = await recomputeCareer(USER, { now: NOW });

    expect(report.storyBonusesRevoked).toBe(1);
    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `story-complete:${legacy.raceId}` } })).toBe(0);
    const race = await prisma.race.findUniqueOrThrow({ where: { id: legacy.raceId } });
    expect(race.storyCompletedAt).toBeNull();
    expect(race.coverageSec).toBe(5 * H);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('writes and dates Career Milestones, and records the account’s backfill as done', async () => {
    const raceId = await addRace(USER, { name: 'Six Hours' });
    const watched = await logStint(USER, raceId, { from: 0, to: 6 * H, watchedAt: new Date(2026, 3, 1, 20, 0), now: NOW });
    // As 0.3.2 left it: no new rungs, and no dates on the rest.
    await prisma.xPTransaction.deleteMany({ where: { userId: USER, dedupeKey: 'milestone:stories6h:1' } });
    await prisma.milestoneProgress.deleteMany({ where: { userId: USER, metric: { in: ['racesStarted', 'stories6h'] } } });
    await prisma.milestoneProgress.updateMany({
      where: { userId: USER },
      data: { achievedAt: null, achievedPrecision: null, sessionId: null, raceId: null, subjectName: null },
    });
    expect(await isCareerBackfillApplied(USER)).toBe(false);

    const report = await recomputeCareer(USER, { now: NOW });

    expect(report).toMatchObject({ careerMilestonesReached: 2, careerMilestoneXp: 500 });
    expect(report.datesFilled).toBeGreaterThan(0);
    expect(report.datesRecognised).toBeGreaterThan(0);
    expect(await prisma.milestoneProgress.count({ where: { userId: USER, achievedPrecision: null } })).toBe(0);
    const sixHours = await prisma.milestoneProgress.findUniqueOrThrow({
      where: { userId_metric_threshold: { userId: USER, metric: 'stories6h', threshold: 1 } },
    });
    expect(sixHours).toMatchObject({
      reachedAt: NOW, xpAwarded: 500, achievedPrecision: 'STINT', achievedAt: new Date(2026, 3, 1, 20, 0), sessionId: watched.sessionId,
    });
    expect(await isCareerBackfillApplied(USER)).toBe(true);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('never moves a milestone’s date unless asked, and then only where the replay passes the same test', async () => {
    const raceId = await addRace(USER, { name: 'Six Hours' });
    const at = new Date(2026, 3, 1, 20, 0);
    await logStint(USER, raceId, { from: 0, to: 6 * H, watchedAt: at, now: NOW });
    const key = (metric: string, threshold: number) => ({ userId_metric_threshold: { userId: USER, metric, threshold } });
    const story = await prisma.milestoneProgress.findUniqueOrThrow({ where: key('storyCompletes', 1) });
    expect(story).toMatchObject({ achievedPrecision: 'STINT', achievedAt: at });

    // A date gone wrong, a rung the replay would place after it was recorded,
    // and a rung history cannot place at all.
    const wrong = new Date(at.getTime() - 3_600_000);
    await prisma.milestoneProgress.update({ where: key('storyCompletes', 1), data: { achievedAt: wrong } });
    const hoursBefore = await prisma.milestoneProgress.update({
      where: key('realHours', 5),
      data: { reachedAt: new Date(at.getTime() - 86_400_000), achievedAt: wrong },
    });
    const recognised = await prisma.milestoneProgress.findUniqueOrThrow({ where: key('racesCompleted', 1) });
    expect(recognised.achievedPrecision).toBe('RECOGNISED');

    const plain = await recomputeCareer(USER, { now: NOW });
    expect(plain.milestoneDatesRebuilt).toBe(0);
    expect((await prisma.milestoneProgress.findUniqueOrThrow({ where: key('storyCompletes', 1) })).achievedAt).toEqual(wrong);

    const untouched = (await prisma.milestoneProgress.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } }))
      .filter((row) => !(row.metric === 'storyCompletes' && row.threshold === 1));
    const rebuilt = await recomputeCareer(USER, { now: NOW, rebuildMilestoneDates: true });
    // Only the date that had gone wrong moves; the rest already match the replay.
    expect(rebuilt.milestoneDatesRebuilt).toBe(1);
    expect(await prisma.milestoneProgress.findUniqueOrThrow({ where: key('storyCompletes', 1) }))
      .toMatchObject({ achievedAt: at, achievedPrecision: 'STINT' });
    expect(await prisma.milestoneProgress.findUniqueOrThrow({ where: key('realHours', 5) })).toEqual(hoursBefore);
    expect(await prisma.milestoneProgress.findUniqueOrThrow({ where: key('racesCompleted', 1) })).toEqual(recognised);
    expect((await prisma.milestoneProgress.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } }))
      .filter((row) => !(row.metric === 'storyCompletes' && row.threshold === 1))).toEqual(untouched);

    // A second rebuild finds nothing to move, and writes nothing.
    const settled = await prisma.milestoneProgress.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } });
    const again = await recomputeCareer(USER, { now: NOW, rebuildMilestoneDates: true });
    expect(again.milestoneDatesRebuilt).toBe(0);
    expect(await prisma.milestoneProgress.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } })).toEqual(settled);
  });

  it('a rebuild counts only the dates it moves, not the ones the same run has just filled', async () => {
    const raceId = await addRace(USER, { name: 'Six Hours' });
    await logStint(USER, raceId, { from: 0, to: 6 * H, watchedAt: new Date(2026, 3, 1, 20, 0), now: NOW });
    await prisma.milestoneProgress.updateMany({
      where: { userId: USER },
      data: { achievedAt: null, achievedPrecision: null, sessionId: null, raceId: null, subjectName: null },
    });

    const report = await recomputeCareer(USER, { now: NOW, rebuildMilestoneDates: true });
    expect(report.datesFilled).toBeGreaterThan(0);
    expect(report.milestoneDatesRebuilt).toBe(0);
  });
});
