/**
 * The 0.4.0 career backfill (`src/lib/server/upgrades/career-backfill.ts`).
 *
 * A career recorded before 0.4.0 has what 0.4.0 needs only in its stints: no
 * credited time on its races, no dates on its milestones, none of the new
 * rungs, and perhaps a race whose runtime was shortened after it was watched.
 * The backfill brings it up to date in phases — P1 the races, P2 the
 * recurring events, P3 the milestones — each chunk in its own transaction
 * together with the marker that records it, so a start that runs out of time
 * loses nothing and the next one carries on.
 *
 * The careers here are logged through the real engine and then put back the
 * way 0.3.2 would have left them (`asRecordedBy032`), so the backfill's dates
 * can be checked against the ones the live path gave the same history.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { careerMilestoneDedupeKey, careerMilestoneOfRow } from '@/lib/config';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { creditedSeconds } from '@/lib/domain/career-timeline';
import { storyCompleteBonus } from '@/lib/domain/progression';
import { recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { revokeXpByDedupeKeys, settleLedger } from '@/lib/engines/xp-ledger';
import {
  type BackfillClock, backfillRaces, buildPhaseContext, CAREER_BACKFILL_KEY, CAREER_BACKFILL_PHASES,
  type CareerBackfillSummary, deadlineClock, describeCareerBackfill, describeLeftovers, isCareerBackfillApplied,
  markCareerBackfillApplied, readCareerBackfillMarker, runCareerBackfill, runCareerBackfillFor,
} from '@/lib/server/upgrades/career-backfill';
import { MASTERY_CONFIG } from '@/lib/config';
import {
  addRace, createCareerUser, eventStepProblems, H, insertLegacyShortenedRace, ledgerProblems, logStint,
} from '../helpers/career-db';

const DATED = '00000000-0000-4000-8000-0000000004b1';
const REPLAY_LATER = '00000000-0000-4000-8000-0000000004b2';
const RACES = '00000000-0000-4000-8000-0000000004b3';
const INTERRUPTED = '00000000-0000-4000-8000-0000000004b4';
const UNINTERRUPTED = '00000000-0000-4000-8000-0000000004b5';
const SERVED_RECENTLY = '00000000-0000-4000-8000-0000000004b6';
const SERVED_LONG_AGO = '00000000-0000-4000-8000-0000000004b7';
const NEVER_SERVED = '00000000-0000-4000-8000-0000000004b8';
const EARLIER_BUILD = '00000000-0000-4000-8000-0000000004b9';
const LEFTOVERS = '00000000-0000-4000-8000-0000000004ba';
const SOMEONE_ELSE = '00000000-0000-4000-8000-0000000004bb';
const EVENTS = '00000000-0000-4000-8000-0000000004bc';
const USERS = [
  DATED, REPLAY_LATER, RACES, INTERRUPTED, UNINTERRUPTED, SERVED_RECENTLY, SERVED_LONG_AGO, NEVER_SERVED,
  EARLIER_BUILD, LEFTOVERS, SOMEONE_ELSE, EVENTS,
];

/** The first start after the update. */
const STARTED = new Date(2026, 8, 25, 9, 0);

/** A start-up with time for everything. */
const PLENTY_OF_TIME: BackfillClock = { shouldStartChunk: () => true };

/**
 * A start-up with time for exactly one chunk: its clock reads 0 when first
 * asked and a millisecond later ever after, and its deadline leaves room for
 * one chunk of the smallest estimate the backfill makes (a second).
 */
function oneChunkPerStart(): BackfillClock {
  let asked = 0;
  return deadlineClock(1_000, () => (asked++ === 0 ? 0 : 1));
}

const QUIET_LOG = { info: () => undefined, error: () => undefined };

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  await disconnectDb();
});

/** 48-hour races watched whole, one every 49 hours from `from`, each logged when it ended. */
async function watchLongRaces(userId: string, count: number, from: Date): Promise<{ raceId: string; sessionId: string; at: Date }[]> {
  const stints: { raceId: string; sessionId: string; at: Date }[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = new Date(from.getTime() + index * 49 * H * 1000);
    const raceId = await addRace(userId, { name: `Long Race ${index + 1}`, hours: 48 });
    const outcome = await logStint(userId, raceId, { from: 0, to: 48 * H, watchedAt: at, now: at });
    stints.push({ raceId, sessionId: outcome.sessionId, at });
  }
  return stints;
}

/**
 * Put an account back the way 0.3.2 left it: none of the new milestone rungs
 * (nor the XP they paid), no dates on any milestone or event step, no
 * credited time on any race, and no backfill marker.
 */
async function asRecordedBy032(userId: string): Promise<void> {
  const rows = await prisma.milestoneProgress.findMany({ where: { userId }, select: { id: true, metric: true, threshold: true } });
  const careerRows = rows.flatMap((row) => {
    const match = careerMilestoneOfRow(row.metric, row.threshold);
    return match !== null && match.def.owner === 'career' ? [{ id: row.id, key: careerMilestoneDedupeKey(match.def, match.year) }] : [];
  });
  await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const revocation = await revokeXpByDedupeKeys(db, userId, careerRows.map((row) => row.key));
    await settleLedger(db, userId, [revocation]);
    await db.milestoneProgress.deleteMany({ where: { id: { in: careerRows.map((row) => row.id) } } });
    await db.milestoneProgress.updateMany({
      where: { userId },
      data: { achievedAt: null, achievedPrecision: null, sessionId: null, raceId: null, eventId: null, subjectName: null },
    });
    await db.masteryProgress.updateMany({ where: { userId }, data: { achievedAt: null, achievedPrecision: null, achievedSessionId: null } });
    await db.race.updateMany({ where: { userId }, data: { creditedViewingSec: null } });
    await db.configOverride.deleteMany({ where: { userId, key: CAREER_BACKFILL_KEY } });
  });
}

function milestoneRows(userId: string) {
  return prisma.milestoneProgress.findMany({ where: { userId }, orderBy: [{ metric: 'asc' }, { threshold: 'asc' }] });
}

function ledger(userId: string) {
  return prisma.xPTransaction.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, source: true, amount: true, seasonAmount: true, dedupeKey: true, careerXpAfter: true, levelAfter: true },
  });
}

describe('P3: milestones', () => {
  it('dates existing rungs from history, as the live path dated them', async () => {
    await createCareerUser(DATED, 'CareerBackfillTest Dated');
    await watchLongRaces(DATED, 6, new Date(2025, 2, 1, 8, 0));
    const live = new Map((await milestoneRows(DATED)).map((row) => [`${row.metric}:${row.threshold}`, row]));
    const ladders = [...live.values()].filter((row) => careerMilestoneOfRow(row.metric, row.threshold)?.def.owner !== 'career');
    expect(ladders.length).toBeGreaterThan(10);

    await asRecordedBy032(DATED);
    expect(await prisma.milestoneProgress.count({ where: { userId: DATED, achievedPrecision: { not: null } } })).toBe(0);

    const summary = await runCareerBackfillFor(DATED, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary).toMatchObject({ completed: true, skipped: false, pausedBefore: null, racesCredited: 6 });

    const after = new Map((await milestoneRows(DATED)).map((row) => [`${row.metric}:${row.threshold}`, row]));
    for (const before of ladders) {
      const key = `${before.metric}:${before.threshold}`;
      const backfilled = after.get(key)!;
      expect(backfilled.achievedPrecision, key).toBe(before.achievedPrecision);
      expect(backfilled.achievedAt, key).toEqual(before.achievedAt);
      if (before.achievedPrecision !== 'RECOGNISED') {
        expect([backfilled.sessionId, backfilled.raceId, backfilled.subjectName], key)
          .toEqual([before.sessionId, before.raceId, before.subjectName]);
      }
      // Recorded when 0.3.2 recorded it, and paid what it paid then.
      expect([backfilled.reachedAt, backfilled.xpAwarded], key).toEqual([before.reachedAt, before.xpAwarded]);
    }
    expect(summary.datesFilled + summary.datesRecognised).toBe(after.size);
  });

  it('awards new rungs that were already passed, once, as career XP only', async () => {
    const rows = await milestoneRows(DATED);
    const careerRows = rows.filter((row) => careerMilestoneOfRow(row.metric, row.threshold)?.def.owner === 'career');
    expect(careerRows.map((row) => `${row.metric}:${row.threshold}`).sort()).toEqual(
      ['racesStarted:1', 'realHours:250', 'stories6h:1'],
    );
    // Recorded now, dated when they happened.
    for (const row of careerRows) {
      expect(row.reachedAt).toEqual(STARTED);
      expect(row.achievedAt!.getTime()).toBeLessThan(new Date(2025, 3, 1).getTime());
    }
    expect(rows.find((row) => row.metric === 'realHours' && row.threshold === 250)?.achievedPrecision).toBe('INTERPOLATED');

    for (const [key, amount] of [['milestone:stories6h:1', 500], ['milestone:realHours:250', 1_000]] as const) {
      const paid = await prisma.xPTransaction.findMany({ where: { userId: DATED, dedupeKey: key } });
      expect(paid, key).toHaveLength(1);
      expect(paid[0], key).toMatchObject({ source: 'MILESTONE', amount, seasonAmount: 0 });
    }
    expect(await prisma.xPTransaction.count({ where: { userId: DATED, dedupeKey: 'milestone:racesStarted:1' } })).toBe(0);
    expect(await ledgerProblems(DATED)).toEqual([]);
  });

  it('a forced second backfill changes no ledger row', async () => {
    const [ledgerBefore, rowsBefore, racesBefore] = await Promise.all([
      ledger(DATED), milestoneRows(DATED), prisma.race.findMany({ where: { userId: DATED }, orderBy: { id: 'asc' } }),
    ]);
    const forced = await runCareerBackfillFor(DATED, { now: new Date(STARTED.getTime() + 86_400_000), clock: PLENTY_OF_TIME, force: true });
    expect(forced).toMatchObject({
      completed: true, racesCredited: 0, legacyRacesRepaired: 0, storyBonusesAwarded: 0, storyBonusesRevoked: 0,
      milestonesCreated: 0, milestoneXp: 0, datesFilled: 0, datesRecognised: 0,
    });
    expect(await ledger(DATED)).toEqual(ledgerBefore);
    expect(await milestoneRows(DATED)).toEqual(rowsBefore);
    expect(await prisma.race.findMany({ where: { userId: DATED }, orderBy: { id: 'asc' } })).toEqual(racesBefore);
  });

  it('marks rungs history cannot place as recognised', async () => {
    await createCareerUser(REPLAY_LATER, 'CareerBackfillTest Replay Later');
    const stints = await watchLongRaces(REPLAY_LATER, 4, new Date(2025, 2, 1, 8, 0));
    // The second stint goes after its rungs were recorded: the replay now
    // crosses 50 and 100 hours a stint later than the app recorded them.
    await prisma.raceViewingSession.delete({ where: { id: stints[1]!.sessionId } });
    await asRecordedBy032(REPLAY_LATER);

    const summary = await runCareerBackfillFor(REPLAY_LATER, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary.completed).toBe(true);
    expect(summary.datesRecognised).toBeGreaterThan(0);

    const byKey = new Map((await milestoneRows(REPLAY_LATER)).map((row) => [`${row.metric}:${row.threshold}`, row]));
    // Never dated after the moment it was known to have happened.
    for (const key of ['realHours:50', 'realHours:100']) {
      expect(byKey.get(key), key).toMatchObject({ achievedPrecision: 'RECOGNISED', achievedAt: null, sessionId: null });
    }
    // What the replay still places before it was recorded keeps its date.
    expect(byKey.get('realHours:25')).toMatchObject({ achievedPrecision: 'INTERPOLATED', sessionId: stints[0]!.sessionId });
    // Counts of what is in the library carry no instant of their own.
    expect(byKey.get('racesCompleted:1')).toMatchObject({ achievedPrecision: 'RECOGNISED', achievedAt: null });
  });
});

describe('P1: races', () => {
  it('writes credited time where it differs, and nowhere else', async () => {
    await createCareerUser(RACES, 'CareerBackfillTest Races');
    const at = new Date(2026, 8, 20, 20, 0);
    const slow = await addRace(RACES, { name: 'Watched Slowly' });
    const untouched = await addRace(RACES, { name: 'Not Watched Yet' });
    await logStint(RACES, slow, { from: 0, to: H, speed: 0.5, now: at });
    await asRecordedBy032(RACES);

    const summary = await runCareerBackfillFor(RACES, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary.racesCredited).toBe(2);
    const races = new Map((await prisma.race.findMany({ where: { userId: RACES }, select: { id: true, creditedViewingSec: true } }))
      .map((race) => [race.id, race.creditedViewingSec]));
    // Half speed is credited as 0.75×, the way XP credits it.
    expect(races.get(slow)).toBe(creditedSeconds({ realSeconds: 2 * H, timelineSeconds: H }));
    expect(races.get(slow)).toBe(4_800);
    expect(races.get(untouched)).toBe(0);

    const again = await runCareerBackfillFor(RACES, { now: STARTED, clock: PLENTY_OF_TIME, force: true });
    expect(again.racesCredited).toBe(0);
  });

  it('repairs a race whose coverage runs past a runtime shortened under 0.3.x, keeping its status, and takes back its bonus', async () => {
    const legacy = await insertLegacyShortenedRace(RACES, {
      name: 'Shortened After Watching',
      hours: 5,
      stints: [
        { from: 0, to: 2 * H, watchedAt: new Date(2026, 8, 21, 20, 0) },
        { from: 3 * H, to: 6 * H, watchedAt: new Date(2026, 8, 22, 20, 0) },
      ],
      storyCompleted: true,
      bonusPaid: true,
    });
    const before = await prisma.race.findUniqueOrThrow({ where: { id: legacy.raceId } });
    expect(await ledgerProblems(RACES)).toEqual([]);

    const summary = await runCareerBackfillFor(RACES, { now: STARTED, clock: PLENTY_OF_TIME, force: true });
    expect(summary).toMatchObject({ legacyRacesRepaired: 1, storyBonusesRevoked: 1, storyBonusesAwarded: 0 });

    const intervals = await prisma.watchedInterval.findMany({ where: { raceId: legacy.raceId }, orderBy: { startSec: 'asc' } });
    expect(intervals.map((interval) => [interval.startSec, interval.endSec])).toEqual([[0, 2 * H], [3 * H, 5 * H]]);
    const after = await prisma.race.findUniqueOrThrow({ where: { id: legacy.raceId } });
    // The status the user saw is kept; the coverage past the new end is not.
    expect([after.status, after.completedAt]).toEqual([before.status, before.completedAt]);
    expect(after.coverageSec).toBe(4 * H);
    expect(after.storyCompletedAt).toBeNull();
    expect(after.creditedViewingSec).toBe(5 * H);
    expect(await prisma.xPTransaction.count({ where: { userId: RACES, dedupeKey: `story-complete:${legacy.raceId}` } })).toBe(0);
    expect(await ledgerProblems(RACES)).toEqual([]);

    // One more stint fills the real gap, and completes the story for real, once.
    const outcome = await logStint(RACES, legacy.raceId, { from: 2 * H, to: 3 * H, now: new Date(2026, 8, 25, 20, 0) });
    expect(outcome.storyCompleted).toBe(true);
    expect(await prisma.xPTransaction.count({ where: { userId: RACES, dedupeKey: `story-complete:${legacy.raceId}` } })).toBe(1);
    expect(await ledgerProblems(RACES)).toEqual([]);
  });

  it('pays a Story Complete bonus a 0.3.x runtime edit skipped, as career XP only', async () => {
    const at = new Date(2026, 8, 23, 20, 0);
    const raceId = await addRace(RACES, { name: 'Seven Hours, Really Six', hours: 7 });
    const watched = await logStint(RACES, raceId, { from: 0, to: 6 * H, now: at });
    expect(watched.storyCompleted).toBe(false);
    // 0.3.x saved the shorter runtime and recomputed the race, and paid nothing.
    await prisma.$transaction(async (tx) => {
      await tx.race.update({ where: { id: raceId }, data: { runtimeSec: 6 * H, scheduledDurationSec: 6 * H } });
      await recomputeRaceAggregates(tx as Tx, raceId, at);
    });
    expect(await prisma.xPTransaction.count({ where: { userId: RACES, dedupeKey: `story-complete:${raceId}` } })).toBe(0);

    const summary = await runCareerBackfillFor(RACES, { now: STARTED, clock: PLENTY_OF_TIME, force: true });
    expect(summary.storyBonusesAwarded).toBe(1);
    const bonus = await prisma.xPTransaction.findMany({ where: { userId: RACES, dedupeKey: `story-complete:${raceId}` } });
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({
      source: 'STORY_COMPLETE', amount: storyCompleteBonus(6 * H, false).careerXp, seasonAmount: 0, sessionId: watched.sessionId,
    });
    expect(await ledgerProblems(RACES)).toEqual([]);
  });
  it('leaves a race of another account in its chunk exactly as it is', async () => {
    // Another account's 0.3.x race, shortened after it was watched and still
    // holding its bonus: everything P1 would repair, were it this account's.
    await createCareerUser(SOMEONE_ELSE, 'CareerBackfillTest Someone Else');
    const theirs = await insertLegacyShortenedRace(SOMEONE_ELSE, {
      hours: 5,
      stints: [{ from: 0, to: 6 * H, watchedAt: new Date(2026, 8, 21, 20, 0) }],
      storyCompleted: true,
      bonusPaid: true,
    });
    const snapshot = () => Promise.all([
      prisma.race.findUniqueOrThrow({ where: { id: theirs.raceId } }),
      prisma.watchedInterval.findMany({ where: { raceId: theirs.raceId }, orderBy: { id: 'asc' } }),
      ledger(SOMEONE_ELSE),
    ]);
    const before = await snapshot();

    const context = await buildPhaseContext(RACES, STARTED);
    const result = await prisma.$transaction((tx) => backfillRaces(tx as Tx, context, [theirs.raceId]));
    expect(result).toEqual({ racesCredited: 0, legacyRacesRepaired: 0, storyBonusesAwarded: 0, storyBonusesRevoked: 0 });
    expect(await snapshot()).toEqual(before);
    expect(await ledgerProblems(SOMEONE_ELSE)).toEqual([]);
  });
});

describe('P2: events', () => {
  /** The steps 0.4.0 appended to every event tree, and the names 0.3.2 gave the six it renamed. */
  const APPENDED = MASTERY_CONFIG.raceEventNodes.slice(8).map((node) => node.key);
  const NAMES_032: Record<string, string> = {
    edition_1: 'First Edition', edition_3: 'Three Editions', edition_5: 'Five Editions', edition_10: 'A Decade of Editions',
    consecutive_3: 'Three in a Row', consecutive_5: 'Five in a Row',
  };

  /**
   * Put the account's events back the way 0.3.2 left them, on top of
   * `asRecordedBy032`: event trees without the appended steps (nor anything
   * they paid), the old names, and no credits.
   */
  async function eventsAsRecordedBy032(userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const db = tx as Tx;
      const keys = (await db.xPTransaction.findMany({
        where: { userId, dedupeKey: { startsWith: 'mastery:event:' } },
        select: { dedupeKey: true },
      })).flatMap((row) => (APPENDED.some((node) => row.dedupeKey?.endsWith(`:${node}`)) ? [row.dedupeKey!] : []));
      await settleLedger(db, userId, [await revokeXpByDedupeKeys(db, userId, keys)]);
      await db.masteryNode.deleteMany({ where: { key: { in: APPENDED }, tree: { userId, kind: 'RACE_EVENT' } } });
      for (const [key, name] of Object.entries(NAMES_032)) {
        await db.masteryNode.updateMany({ where: { key, tree: { userId, kind: 'RACE_EVENT' } }, data: { name } });
      }
      await db.eventStepCredit.deleteMany({ where: { userId } });
    });
    await asRecordedBy032(userId);
  }

  it('credits every step an event had reached and pays the new steps it had passed, once, then dates them', async () => {
    await createCareerUser(EVENTS, 'CareerBackfillTest Events');
    const races: string[] = [];
    for (const [index, year] of [2023, 2024, 2025].entries()) {
      const raceId = await addRace(EVENTS, { name: `${year} Backfill Classic`, hours: 1, iconicKey: 'backfill-classic', raceDate: new Date(Date.UTC(year, 5, 1)) });
      const at = new Date(2025, 8, 1 + index, 20, 0);
      // The first is watched whole; the other two for a quarter of an hour, which is enough to have experienced them.
      await logStint(EVENTS, raceId, { from: 0, to: index === 0 ? H : 15 * 60, watchedAt: at, now: at });
      races.push(raceId);
    }
    await eventsAsRecordedBy032(EVENTS);
    // A build before this one had already run the race and milestone phases.
    await prisma.configOverride.create({
      data: { userId: EVENTS, key: CAREER_BACKFILL_KEY, value: { version: '0.4.0', done: ['P1', 'P3'], cursors: {}, lastRunAt: null } },
    });
    expect(await prisma.masteryNode.count({ where: { tree: { userId: EVENTS, kind: 'RACE_EVENT' } } })).toBe(8);

    const summary = await runCareerBackfillFor(EVENTS, { now: STARTED, clock: PLENTY_OF_TIME });
    // Only the new phase ran: the first experienced edition (recorded, no XP) and three experienced editions (300).
    expect(summary).toMatchObject({ completed: true, racesCredited: 0, eventStepsUnlocked: 2, eventStepXp: 300, milestonesCreated: 0 });
    // Credits: the complete edition for First Complete Edition, and all three for each experienced step.
    expect(summary.creditsWritten).toBe(1 + 3 + 3);
    expect(describeCareerBackfill(summary, 'Events')).toContain('2 event steps (+300 XP), 7 credits;');

    const tree = await prisma.masteryTree.findFirstOrThrow({
      where: { userId: EVENTS, key: 'event:backfill-classic' },
      select: { nodes: { select: { key: true, name: true, progress: { select: { unlockedAt: true, achievedPrecision: true, achievedSessionId: true } } } } },
    });
    const byKey = new Map(tree.nodes.map((node) => [node.key, node]));
    expect(tree.nodes).toHaveLength(17);
    expect(byKey.get('edition_1')?.name).toBe('First Complete Edition');
    // The steps it unlocked are dated from history here, since the milestone phase will not run again.
    const third = await prisma.raceViewingSession.findFirstOrThrow({ where: { raceId: races[2] } });
    expect(byKey.get('experienced_3')?.progress[0]).toMatchObject({ achievedPrecision: 'STINT', achievedSessionId: third.id });
    expect(byKey.get('experienced_1')?.progress[0]?.achievedPrecision).toBe('STINT');

    const paid = await prisma.xPTransaction.findMany({ where: { userId: EVENTS, dedupeKey: 'mastery:event:backfill-classic:experienced_3' } });
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amount: 300, seasonAmount: 0 });
    expect(await ledgerProblems(EVENTS)).toEqual([]);
    expect(await eventStepProblems(EVENTS)).toEqual([]);

    // Forced again: nothing more.
    const before = await ledger(EVENTS);
    const again = await runCareerBackfillFor(EVENTS, { now: STARTED, clock: PLENTY_OF_TIME, force: true });
    expect(again).toMatchObject({ eventStepsUnlocked: 0, eventStepXp: 0, creditsWritten: 0 });
    expect(await ledger(EVENTS)).toEqual(before);
  });
});

describe('the start-up budget', () => {
  /** Two long races, one with a Story Complete bonus a runtime edit skipped, and 1,100 races never watched. */
  async function career(userId: string, name: string): Promise<void> {
    await createCareerUser(userId, name);
    await watchLongRaces(userId, 2, new Date(2025, 5, 1, 8, 0));
    const skipped = await addRace(userId, { name: 'Skipped Bonus', hours: 7 });
    await logStint(userId, skipped, { from: 0, to: 6 * H, now: new Date(2025, 6, 1, 20, 0) });
    await prisma.race.update({ where: { id: skipped }, data: { runtimeSec: 6 * H, scheduledDurationSec: 6 * H } });
    await prisma.race.createMany({
      data: Array.from({ length: 1_100 }, (_, index) => ({
        userId, name: `Library Race ${index}`, scheduledDurationSec: 6 * H, runtimeSec: 6 * H, raceType: 'H6' as const,
      })),
    });
    await asRecordedBy032(userId);
  }

  /** What a backfill leaves behind, without the ids and clock times two accounts cannot share. */
  async function outcome(userId: string) {
    const [awards, milestones, races, profile] = await Promise.all([
      prisma.xPTransaction.findMany({ where: { userId }, select: { source: true, amount: true, seasonAmount: true } }),
      prisma.milestoneProgress.findMany({
        where: { userId },
        orderBy: [{ metric: 'asc' }, { threshold: 'asc' }],
        select: { metric: true, threshold: true, xpAwarded: true, achievedAt: true, achievedPrecision: true, subjectName: true },
      }),
      prisma.race.findMany({ where: { userId }, orderBy: { name: 'asc' }, select: { name: true, creditedViewingSec: true, status: true } }),
      prisma.careerProfile.findUniqueOrThrow({ where: { userId }, select: { careerXp: true, level: true } }),
    ]);
    const key = (award: { source: string; amount: number; seasonAmount: number }) => `${award.source}:${award.amount}:${award.seasonAmount}`;
    return { awards: awards.map(key).sort(), milestones, races, profile };
  }

  it('with a tiny deadline it makes progress on every start, completes after N starts, and ends with the same ledger as one uninterrupted run', async () => {
    await career(INTERRUPTED, 'CareerBackfillTest Interrupted');
    await career(UNINTERRUPTED, 'CareerBackfillTest Uninterrupted');
    const raceCount = await prisma.race.count({ where: { userId: INTERRUPTED } });
    expect(raceCount).toBe(1_103);

    const summaries: CareerBackfillSummary[] = [];
    const markers: string[] = [];
    for (let start = 0; start < 10; start += 1) {
      const now = new Date(STARTED.getTime() + start * 60_000);
      const summary = await runCareerBackfillFor(INTERRUPTED, { now, clock: oneChunkPerStart() });
      summaries.push(summary);
      const marker = await readCareerBackfillMarker(INTERRUPTED);
      // Every start records progress, and when it ran.
      expect(marker?.lastRunAt, `start ${start + 1}`).toBe(now.toISOString());
      markers.push(JSON.stringify({ done: marker?.done, cursors: marker?.cursors }));
      if (summary.completed) break;
    }

    // Three chunks of races (500 at a time), then the events, then the milestones.
    const starts = Math.ceil(raceCount / 500) + 2;
    expect(summaries).toHaveLength(starts);
    expect(new Set(markers).size).toBe(starts);
    expect(summaries.map((summary) => summary.pausedBefore?.phase ?? null)).toEqual(['P1', 'P1', 'P2', 'P3', null]);
    expect(summaries[0]?.pausedBefore?.cursor).toEqual(expect.any(String));
    expect(summaries[2]?.pausedBefore?.cursor).toBeNull();
    expect(summaries[3]?.pausedBefore?.cursor).toBeNull();
    expect(summaries.map((summary) => summary.racesCredited)).toEqual([500, 500, 103, 0, 0]);
    expect(summaries.reduce((sum, summary) => sum + summary.storyBonusesAwarded, 0)).toBe(1);
    expect(summaries[4]).toMatchObject({ completed: true, pausedBefore: null });
    expect(await isCareerBackfillApplied(INTERRUPTED)).toBe(true);

    // What a paused start says in the log.
    expect(describeCareerBackfill(summaries[0]!, 'Interrupted')).toBe(
      `[career-backfill] Interrupted (${INTERRUPTED}): credited 500 races, 0 legacy races repaired, story bonuses +${summaries[0]!.storyBonusesAwarded}/−0; `
        + '0 event steps (+0 XP), 0 credits; '
        + `0 new milestones (+0 XP), 0 dates filled, 0 recorded only; paused before P1 (after race ${summaries[0]!.pausedBefore!.cursor}); `
        + 'continues on the next start',
    );
    expect(describeCareerBackfill(summaries[2]!, 'Interrupted')).toMatch(/; paused before P2; continues on the next start$/);
    expect(describeCareerBackfill(summaries[3]!, 'Interrupted')).toMatch(/; paused before P3; continues on the next start$/);

    const whole = await runCareerBackfillFor(UNINTERRUPTED, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(whole).toMatchObject({ completed: true, racesCredited: 1_103, storyBonusesAwarded: 1 });
    expect(await outcome(INTERRUPTED)).toEqual(await outcome(UNINTERRUPTED));
    expect(await ledgerProblems(INTERRUPTED)).toEqual([]);
    expect(await ledgerProblems(UNINTERRUPTED)).toEqual([]);
  }, 120_000);

  it('asks the clock before every chunk, and never starts one that would run past the deadline', () => {
    const clock = deadlineClock(10_000, () => 8_000);
    expect(clock.shouldStartChunk(1_000)).toBe(true);
    expect(clock.shouldStartChunk(2_000)).toBe(true);
    expect(clock.shouldStartChunk(2_001)).toBe(false);
  });

  it('serves the accounts that got time least recently first', async () => {
    for (const [userId, name] of [
      [SERVED_RECENTLY, 'CareerBackfillTest Served Recently'],
      [SERVED_LONG_AGO, 'CareerBackfillTest Served Long Ago'],
      [NEVER_SERVED, 'CareerBackfillTest Never Served'],
    ] as const) {
      await createCareerUser(userId, name);
    }
    for (const [userId, lastRunAt] of [[SERVED_RECENTLY, '2026-09-24T08:00:00.000Z'], [SERVED_LONG_AGO, '2026-09-20T08:00:00.000Z']] as const) {
      await prisma.configOverride.create({
        data: { userId, key: CAREER_BACKFILL_KEY, value: { version: '0.4.0', done: [], cursors: {}, lastRunAt } },
      });
    }

    const summaries = await runCareerBackfill({ now: STARTED, clock: PLENTY_OF_TIME, log: QUIET_LOG });
    const order = summaries.map((summary) => summary.userId).filter((id) => [SERVED_RECENTLY, SERVED_LONG_AGO, NEVER_SERVED].includes(id));
    expect(order).toEqual([NEVER_SERVED, SERVED_LONG_AGO, SERVED_RECENTLY]);
    for (const userId of order) expect(await isCareerBackfillApplied(userId)).toBe(true);
  });
});

describe('the marker', () => {
  it('lets an account an earlier build completed run only the phases added since', async () => {
    await createCareerUser(EARLIER_BUILD, 'CareerBackfillTest Earlier Build');
    const stints = await watchLongRaces(EARLIER_BUILD, 1, new Date(2025, 2, 1, 8, 0));
    await asRecordedBy032(EARLIER_BUILD);
    await prisma.configOverride.create({
      data: { userId: EARLIER_BUILD, key: CAREER_BACKFILL_KEY, value: { version: '0.4.0', done: ['P1'], cursors: {}, lastRunAt: null } },
    });
    expect(await isCareerBackfillApplied(EARLIER_BUILD)).toBe(false);

    const summary = await runCareerBackfillFor(EARLIER_BUILD, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary).toMatchObject({ completed: true, racesCredited: 0 });
    expect(summary.datesFilled).toBeGreaterThan(0);
    // P1 was not run again: the race's credited time is still to be written by a stint or recompute.
    expect((await prisma.race.findUniqueOrThrow({ where: { id: stints[0]!.raceId } })).creditedViewingSec).toBeNull();
    expect((await readCareerBackfillMarker(EARLIER_BUILD))?.done).toEqual([...CAREER_BACKFILL_PHASES]);
  });

  it('compares the marker by value: another version’s marker is not this one’s progress', async () => {
    await prisma.configOverride.update({
      where: { userId_key: { userId: EARLIER_BUILD, key: CAREER_BACKFILL_KEY } },
      data: { value: { version: '0.3.9', done: [...CAREER_BACKFILL_PHASES], cursors: {}, lastRunAt: '2026-09-01T00:00:00.000Z' } },
    });
    expect(await isCareerBackfillApplied(EARLIER_BUILD)).toBe(false);
    const summary = await runCareerBackfillFor(EARLIER_BUILD, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary).toMatchObject({ completed: true, racesCredited: 1 });

    // Pre-marking (a new account, or recompute) keeps when the account was last served.
    await markCareerBackfillApplied(EARLIER_BUILD);
    expect(await readCareerBackfillMarker(EARLIER_BUILD)).toEqual({
      version: '0.4.0', done: [...CAREER_BACKFILL_PHASES], cursors: {}, lastRunAt: STARTED.toISOString(),
    });
    expect(await runCareerBackfillFor(EARLIER_BUILD, { now: STARTED, clock: PLENTY_OF_TIME }))
      .toMatchObject({ completed: true, skipped: true });
  });
});

describe('what 0.3.x left in the ledger', () => {
  it('is counted and logged, and left where it is for db:recompute', async () => {
    await createCareerUser(LEFTOVERS, 'CareerBackfillTest Leftovers');
    const at = new Date(2026, 8, 20, 20, 0);
    const deletedRace = await addRace(LEFTOVERS, { name: 'Deleted Under 0.3.x', hours: 1 });
    const kept = await addRace(LEFTOVERS, { name: 'Kept' });
    await logStint(LEFTOVERS, deletedRace, { from: 0, to: 1_800, now: at });
    await logStint(LEFTOVERS, deletedRace, { from: 1_800, to: H, now: new Date(at.getTime() + 60_000) });
    const orphan = await logStint(LEFTOVERS, kept, { from: 0, to: H, now: new Date(at.getTime() + 120_000) });
    // 0.3.x deleted rows without taking their XP back: a stint, and a whole race.
    await prisma.raceViewingSession.delete({ where: { id: orphan.sessionId } });
    await prisma.race.delete({ where: { id: deletedRace } });
    const ledgerBefore = await ledger(LEFTOVERS);

    const summary = await runCareerBackfillFor(LEFTOVERS, { now: STARTED, clock: PLENTY_OF_TIME });
    expect(summary.completed).toBe(true);
    expect(summary.leftovers).toEqual({ orphanedViewingRows: 3, storyBonusesOfDeletedRaces: 1 });
    expect(describeLeftovers(summary, 'Leftovers')).toBe(
      `[career-backfill] Leftovers (${LEFTOVERS}): 3 viewing XP rows whose stint was deleted and 1 Story Complete bonuses `
        + 'of races deleted before 0.4.0 were left as they were (db:recompute removes them)',
    );
    // Nothing of it was removed.
    const ledgerAfter = await ledger(LEFTOVERS);
    for (const row of ledgerBefore) expect(ledgerAfter.some((candidate) => candidate.id === row.id)).toBe(true);
    expect(await ledgerProblems(LEFTOVERS)).toEqual([]);
  });
});
