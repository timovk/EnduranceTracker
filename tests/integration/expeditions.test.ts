/**
 * Race Expeditions (SPEC §4.3): checkpoints that follow the coverage, the
 * switch that never takes XP back, the permanent summary, and what the stint
 * summary, the race page, the dashboard and the Expedition page show.
 *
 * Stints are logged through the real engine at injected times, on the real
 * test database. After every test the ledger is settled (I2) and every race
 * holds only the checkpoints its coverage reaches, each once (I3).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signedIn = vi.hoisted(() => ({ userId: '00000000-0000-4000-8000-0000000005e1' }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'endurance_session',
  requireUserId: async () => signedIn.userId,
  getSessionUserId: async () => signedIn.userId,
  getSessionUser: async () => null,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { expeditionSummarySnapshotSchema } from '@/lib/domain/expedition';
import {
  getExpeditionSummary, getExpeditionView, reconcileExpedition,
} from '@/lib/engines/expedition-engine';
import { deleteRace, deleteViewingSession } from '@/lib/engines/session-engine';
import { settleLedger, revokeXpByDedupeKeys } from '@/lib/engines/xp-ledger';
import { updateRaceAction } from '@/lib/server/actions';
import { setExpeditionModeAction } from '@/lib/server/career-actions';
import { getCurrentStint, getRaceDetail, listRaces } from '@/lib/server/races';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import { runCareerBackfillFor } from '@/lib/server/upgrades/career-backfill';
import {
  addRace, createCareerUser, expeditionProblems, H, ledgerProblems, logStint,
} from '../helpers/career-db';

const USER = signedIn.userId;
const PLENTY_OF_TIME = { shouldStartChunk: () => true };

beforeEach(async () => {
  await createCareerUser(USER, 'ExpeditionsTest');
});

afterEach(async () => {
  expect(await ledgerProblems(USER)).toEqual([]);
  expect(await expeditionProblems(USER)).toEqual([]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

function inTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => work(tx as Tx), { maxWait: 15_000, timeout: 60_000 });
}

/** A stint at a local time, logged then. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 5, day, hour, minute);
}

async function stint(raceId: string, from: number, to: number, when: Date, speed = 1) {
  return logStint(USER, raceId, { from: from * H, to: to * H, speed, watchedAt: when, now: when });
}

/** The checkpoint rows a race holds, by percent. */
async function held(raceId: string): Promise<{ percent: number; amount: number; sessionId: string | null; seasonAmount: number }[]> {
  const rows = await prisma.xPTransaction.findMany({
    where: { userId: USER, source: 'EXPEDITION', sourceRef: raceId },
    select: { dedupeKey: true, amount: true, sessionId: true, seasonAmount: true },
  });
  return rows
    .map((row) => ({ percent: Number(row.dedupeKey!.split(':')[2]), amount: row.amount, sessionId: row.sessionId, seasonAmount: row.seasonAmount }))
    .sort((a, b) => a.percent - b.percent);
}

async function careerXp(): Promise<number> {
  return Number((await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } })).careerXp);
}

/** What 0.3.2 left: no checkpoint and no summary. The ledger is settled. */
async function withoutExpeditions(): Promise<void> {
  const rows = await prisma.xPTransaction.findMany({ where: { userId: USER, source: 'EXPEDITION' }, select: { dedupeKey: true } });
  await inTx(async (tx) => {
    const revocation = await revokeXpByDedupeKeys(tx, USER, rows.map((row) => row.dedupeKey!));
    await settleLedger(tx, USER, [revocation]);
    await tx.expeditionSummary.deleteMany({ where: { userId: USER } });
  });
}

function raceForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    raceType: 'H24', priority: 'NORMAL', excitement: '3', status: 'WATCHING', ...fields,
  })) data.append(key, value);
  return data;
}

// ---------------------------------------------------------------------------
// Crossing checkpoints
// ---------------------------------------------------------------------------

describe('checkpoints', () => {
  it('a stint crossing 50% pays 10, 25 and 50 once each', async () => {
    const race = await addRace(USER, { name: '24 Hours of Crossing', hours: 24 });
    const outcome = await stint(race, 0, 12, at(13, 23));

    expect(await held(race)).toEqual([
      { percent: 10, amount: 300, sessionId: outcome.sessionId, seasonAmount: 0 },
      { percent: 25, amount: 450, sessionId: outcome.sessionId, seasonAmount: 0 },
      { percent: 50, amount: 750, sessionId: outcome.sessionId, seasonAmount: 0 },
    ]);
    expect(outcome.expedition).toMatchObject({
      coveragePercentText: '50%',
      began: true,
      checkpointsReached: [{ percent: 10, xpAwarded: 300 }, { percent: 25, xpAwarded: 450 }, { percent: 50, xpAwarded: 750 }],
      nextCheckpoint: { percent: 75, xp: 750 },
      completed: false,
      summaryId: null,
    });
    expect(outcome.xpBreakdown).toContainEqual({ label: 'Expedition — 50% of the story', amount: 750 });
    const description = await prisma.xPTransaction.findFirstOrThrow({
      where: { userId: USER, dedupeKey: `expedition:${race}:50` }, select: { description: true },
    });
    expect(description.description).toBe('Expedition — 24 Hours of Crossing: 50% of the story');
  });

  it('each checkpoint names the stint that crossed it', async () => {
    const race = await addRace(USER, { name: '24 Hours of Stints', hours: 24 });
    const first = await stint(race, 0, 3, at(13, 20));
    const second = await stint(race, 3, 7, at(14, 20));
    const third = await stint(race, 7, 13, at(15, 20));

    expect((await held(race)).map((row) => [row.percent, row.sessionId])).toEqual([
      [10, first.sessionId], [25, second.sessionId], [50, third.sessionId],
    ]);
    const view = await getExpeditionView(USER, race, at(16, 12));
    expect(view!.figures.checkpoints.slice(0, 3).map((checkpoint) => [checkpoint.percent, checkpoint.sessionId, checkpoint.reachedAt, checkpoint.held]))
      .toEqual([
        [10, first.sessionId, at(13, 20), true], [25, second.sessionId, at(14, 20), true], [50, third.sessionId, at(15, 20), true],
      ]);
    expect(second.expedition?.checkpointsReached).toEqual([{ percent: 25, xpAwarded: 450 }]);
    expect(second.expedition?.began).toBe(false);
  });

  it('a retroactive checkpoint carries no stint, so an old stint’s summary is unchanged', async () => {
    const race = await addRace(USER, { name: '24 Hours of Hindsight', hours: 24 });
    expect((await setExpeditionModeAction(race, 'off')).message)
      .toBe('Expedition Mode is off. Checkpoints you already reached keep their XP.');
    const logged = await stint(race, 0, 13, at(13, 23));
    expect(await held(race)).toEqual([]);
    expect(logged.expedition).toBeNull();
    const before = await buildOutcomeForSession(USER, logged.sessionId);

    const result = await setExpeditionModeAction(race, 'on');
    expect(result).toMatchObject({ ok: true, message: 'Expedition Mode is on. 3 checkpoints were already behind you: +1,500 XP.' });
    expect((await held(race)).map((row) => row.sessionId)).toEqual([null, null, null]);

    const after = await buildOutcomeForSession(USER, logged.sessionId);
    expect(after!.careerXpAwarded).toBe(before!.careerXpAwarded);
    expect(after!.xpBreakdown).toEqual(before!.xpBreakdown);
    // Reached with that stint, and shown so, but paid later and not by it.
    expect(after!.expedition?.checkpointsReached).toEqual([
      { percent: 10, xpAwarded: 0 }, { percent: 25, xpAwarded: 0 }, { percent: 50, xpAwarded: 0 },
    ]);
  });

  it('a stint logged into the past pays what the coverage now reaches, and says so the same when reopened', async () => {
    const race = await addRace(USER, { name: '24 Hours of Afterthought', hours: 24 });
    const later = await stint(race, 0, 3, at(14, 20));
    // Watched the night before, logged a day after: first in the replay.
    const earlier = await logStint(USER, race, { from: 3 * H, to: 7 * H, watchedAt: at(13, 20), now: at(15, 9) });

    expect((await held(race)).map((row) => [row.percent, row.amount, row.sessionId])).toEqual([
      [10, 300, later.sessionId], [25, 450, earlier.sessionId],
    ]);
    // It crossed 10% in the replay (already paid) and paid 25%.
    expect(earlier.expedition?.checkpointsReached).toEqual([{ percent: 10, xpAwarded: 0 }, { percent: 25, xpAwarded: 450 }]);
    expect(earlier.xpBreakdown).toContainEqual({ label: 'Expedition — 25% of the story', amount: 450 });
    const reopened = await buildOutcomeForSession(USER, earlier.sessionId);
    expect(reopened!.xpBreakdown).toContainEqual({ label: 'Expedition — 24 Hours of Afterthought: 25% of the story', amount: 450 });
    expect(reopened!.expedition).toEqual(earlier.expedition);
    // The page still says which stint's coverage reached each one.
    const view = await getExpeditionView(USER, race, at(15, 12));
    expect(view!.figures.checkpoints.slice(0, 2).map((checkpoint) => [checkpoint.percent, checkpoint.sessionId, checkpoint.reachedAt]))
      .toEqual([[10, earlier.sessionId, at(13, 20)], [25, later.sessionId, at(14, 20)]]);
  });

  it('more stints past a checkpoint never pay it again', async () => {
    const race = await addRace(USER, { name: '24 Hours of Again', hours: 24 });
    await stint(race, 0, 6, at(13, 20));
    await stint(race, 6, 7, at(13, 22));
    // A re-watch of everything so far, twice.
    await stint(race, 0, 7, at(14, 20));
    await stint(race, 0, 7, at(15, 20));
    expect((await held(race)).map((row) => row.percent)).toEqual([10, 25]);
    expect(await prisma.xPTransaction.count({ where: { userId: USER, source: 'EXPEDITION' } })).toBe(2);
  });

  it('reconcile twice changes nothing', async () => {
    const race = await addRace(USER, { name: '24 Hours of Twice', hours: 24 });
    await stint(race, 0, 20, at(13, 20));
    const ledger = await prisma.xPTransaction.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } });
    for (let round = 0; round < 2; round += 1) {
      const reconcile = await inTx((tx) => reconcileExpedition(tx, USER, race, { resize: true }));
      expect(reconcile).toMatchObject({ isExpedition: true, awarded: [], revoked: [], resized: [], storyCompleted: false });
      expect(reconcile.revocation.transactions).toBe(0);
    }
    expect(await prisma.xPTransaction.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } })).toEqual(ledger);
  });

  it('backfill after live play pays nothing new', async () => {
    const race = await addRace(USER, { name: '10 Hours of Live Play', hours: 10 });
    await stint(race, 0, 5, at(13, 20));
    await stint(race, 5, 10, at(14, 20));
    const summaries = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(summaries).toHaveLength(1);
    const ledger = await prisma.xPTransaction.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } });

    const summary = await runCareerBackfillFor(USER, { now: at(20, 9), clock: PLENTY_OF_TIME, force: true });
    expect(summary).toMatchObject({ completed: true, expeditionCheckpoints: 0, expeditionXp: 0, summariesWritten: 0 });
    expect(await prisma.xPTransaction.findMany({ where: { userId: USER }, orderBy: { id: 'asc' } })).toEqual(ledger);
    expect(await prisma.expeditionSummary.findMany({ where: { userId: USER } })).toEqual(summaries);
  });

  it('switching Expedition Mode off keeps held checkpoints', async () => {
    const race = await addRace(USER, { name: '24 Hours of Keeping', hours: 24 });
    await stint(race, 0, 13, at(13, 20));
    const kept = await held(race);
    const xp = await careerXp();

    expect((await setExpeditionModeAction(race, 'off')).message)
      .toBe('Expedition Mode is off. Checkpoints you already reached keep their XP.');
    expect(await held(race)).toEqual(kept);
    expect(await careerXp()).toBe(xp);
    // And no new ones while it is off.
    await stint(race, 13, 19, at(14, 20));
    expect(await held(race)).toEqual(kept);
  });

  it('watching the last hour first does not cross 90%', async () => {
    const race = await addRace(USER, { name: '10 Hours of Backwards', hours: 10 });
    const last = await stint(race, 9, 10, at(13, 20));
    expect(last.expedition?.checkpointsReached).toEqual([{ percent: 10, xpAwarded: 120 }]);
    await stint(race, 0, 7, at(14, 20));
    expect((await held(race)).map((row) => row.percent)).toEqual([10, 25, 50, 75]);

    const view = await getExpeditionView(USER, race, at(15, 9));
    // The end has been reached; the story has not.
    expect(view!.figures.fragments.furthestSec).toBe(10 * H);
    expect(view!.figures.completionPercentText).toBe('80%');
    expect(view!.figures.checkpoints.find((checkpoint) => checkpoint.percent === 90)?.reachedAt).toBeNull();
  });

  it('deleting a stint pays no checkpoint the upgrade has yet to pay, and says only what came off', async () => {
    const race = await addRace(USER, { name: '10 Hours of Unfinished Upgrades', hours: 10 });
    await stint(race, 0, 5, at(13, 20));
    const rewatch = await stint(race, 4, 5, at(14, 20));
    // As 0.3.2 left it, with the upgrade paused before its Expeditions.
    await withoutExpeditions();
    const xp = await careerXp();
    const rewatchXp = await prisma.xPTransaction.aggregate({
      where: { userId: USER, sessionId: rewatch.sessionId, source: { in: ['VIEWING', 'REWATCH'] } }, _sum: { amount: true },
    });

    const removal = await deleteViewingSession(USER, rewatch.sessionId, at(15, 9));
    expect(removal).toMatchObject({ expeditionXpRemoved: 0, checkpointsRemoved: [], careerXpRemoved: rewatchXp._sum.amount! });
    expect(await held(race)).toEqual([]);
    expect(await careerXp()).toBe(xp - removal.careerXpRemoved);

    // The upgrade pays them when it gets there, naming no stint.
    const summary = await runCareerBackfillFor(USER, { now: at(16, 9), clock: PLENTY_OF_TIME, force: true });
    expect(summary).toMatchObject({ expeditionCheckpoints: 3, expeditionXp: 600 });
    expect((await held(race)).map((row) => [row.percent, row.sessionId])).toEqual([[10, null], [25, null], [50, null]]);
  });

  it('deleting a stint revokes checkpoints no longer covered', async () => {
    const race = await addRace(USER, { name: '24 Hours of Undo', hours: 24 });
    await stint(race, 0, 3, at(13, 20));
    const second = await stint(race, 3, 13, at(14, 20));
    const xp = await careerXp();

    const removal = await deleteViewingSession(USER, second.sessionId, at(15, 9));
    expect(removal).toMatchObject({ expeditionXpRemoved: 1_200, checkpointsRemoved: [25, 50] });
    expect(removal.careerXpRemoved).toBeGreaterThan(1_200);
    expect(await careerXp()).toBe(xp - removal.careerXpRemoved);
    expect((await held(race)).map((row) => row.percent)).toEqual([10]);

    // Crossing them again pays them again, once.
    await stint(race, 3, 13, at(16, 20));
    expect((await held(race)).map((row) => row.percent)).toEqual([10, 25, 50]);
  });
});

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

describe('the Expedition Summary', () => {
  it('completing a 24h expedition writes one summary with exact figures', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'expedition-wec', name: 'Expedition WEC', accentColor: '#4f8fd0' },
      select: { id: true },
    });
    const race = await addRace(USER, { name: '24 Hours of Figures', hours: 24, championshipId: championship.id });
    const s1 = await stint(race, 0, 8, at(13, 23));
    const s2 = await stint(race, 8, 16, at(14, 12), 2);
    const s3 = await stint(race, 6, 7, at(14, 20));
    const s4 = await stint(race, 16, 24, at(15, 21));
    expect(s4.expedition).toMatchObject({ completed: true, coveragePercentText: '100%', nextCheckpoint: null });

    const rows = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(s4.expedition?.summaryId).toBe(row.id);
    expect(row).toMatchObject({
      raceId: race, raceName: '24 Hours of Figures', retrospective: false, schemaVersion: 1,
      startedAt: at(13, 15), completedAt: at(15, 21), createdAt: at(15, 21),
    });

    const viewing = await prisma.xPTransaction.aggregate({
      where: { userId: USER, source: 'VIEWING', sessionId: { in: [s1.sessionId, s2.sessionId, s4.sessionId] } }, _sum: { amount: true },
    });
    const rewatch = await prisma.xPTransaction.aggregate({ where: { userId: USER, source: 'REWATCH', sessionId: s3.sessionId }, _sum: { amount: true } });
    const snapshot = expeditionSummarySnapshotSchema.parse(row.snapshot);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      race: {
        id: race, name: '24 Hours of Figures', championshipName: 'Expedition WEC', eventKey: null, eventName: null,
        editionYear: null, circuit: null, runtimeSec: 24 * H,
      },
      startedAt: at(13, 15).toISOString(),
      completedAt: at(15, 21).toISOString(),
      completingSessionId: s4.sessionId,
      // 8 h, 4 h at 2×, 1 h of re-watching and 8 h.
      creditedSeconds: 21 * H,
      uniqueCoverageSeconds: 24 * H,
      rewatchSeconds: H,
      sessions: 4,
      calendarDays: 3,
      // From 15:00 on 13 June to 21:00 on 15 June.
      elapsedSeconds: 54 * H,
      averageSessionSeconds: (21 * H) / 4,
      longestSessionSeconds: 8 * H,
      finalCompletionText: '100%',
      xp: {
        viewing: viewing._sum.amount!, rewatch: rewatch._sum.amount!, storyComplete: 7_500, checkpoints: 3_000,
        total: viewing._sum.amount! + rewatch._sum.amount! + 7_500 + 3_000,
      },
      checkpoints: [
        { percent: 10, reachedAt: at(13, 23).toISOString(), xp: 300 },
        { percent: 25, reachedAt: at(13, 23).toISOString(), xp: 450 },
        { percent: 50, reachedAt: at(14, 12).toISOString(), xp: 750 },
        { percent: 75, reachedAt: at(15, 21).toISOString(), xp: 750 },
        { percent: 90, reachedAt: at(15, 21).toISOString(), xp: 750 },
      ],
      mastery: { event: null },
      unlocks: 'live',
    });
    expect(snapshot.mastery.championship).toMatchObject({ name: expect.any(String), percent: expect.any(Number) });
    expect(snapshot.achievements.map((achievement) => achievement.name)).toEqual(
      expect.arrayContaining(['The Whole Story', 'Twice Around the Clock']),
    );
    expect(snapshot.records.map((record) => record.kind)).toEqual([
      'longest-session', 'longest-race-story-completed', 'fastest-long-race-completion', 'longest-start-to-finish',
    ]);
    expect(snapshot.records[0]).toEqual({ kind: 'longest-session', label: 'Longest session', valueText: '8h 00m' });

    // A re-watch of the podium afterwards changes nothing, and writes no second summary.
    await stint(race, 23, 24, at(16, 21));
    const again = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(again).toEqual(rows);
  });

  it('the summary survives deleting the completing stint and deleting the race', async () => {
    const race = await addRace(USER, { name: '10 Hours of Permanence', hours: 10 });
    await stint(race, 0, 5, at(13, 20));
    const completing = await stint(race, 5, 10, at(14, 20));
    const [row] = await prisma.expeditionSummary.findMany({ where: { userId: USER } });

    const removal = await deleteViewingSession(USER, completing.sessionId, at(15, 9));
    expect(removal).toMatchObject({ storyBonusRemoved: true, expeditionXpRemoved: 600, checkpointsRemoved: [75, 90] });
    expect(await prisma.expeditionSummary.findMany({ where: { userId: USER } })).toEqual([row]);

    // Completed again: the summary already exists, and is never rewritten.
    await stint(race, 5, 10, at(16, 20));
    expect(await prisma.expeditionSummary.findMany({ where: { userId: USER } })).toEqual([row]);

    const gone = await deleteRace(USER, race, at(17, 9));
    expect(gone).toMatchObject({ expeditionXpRemoved: 1_200, storyBonusRemoved: true });
    const kept = await getExpeditionSummary(USER, row!.id);
    expect(kept).toMatchObject({ id: row!.id, raceId: null, retrospective: false });
    expect(kept!.snapshot).toEqual(expeditionSummarySnapshotSchema.parse(row!.snapshot));
  });

  it('completing an expedition celebrates spectacularly', async () => {
    // Below the twelve-hour long-haul length, where a Story Complete alone is only NOTABLE.
    const race = await addRace(USER, { name: '10 Hours of Celebration', hours: 10 });
    await stint(race, 0, 5, at(13, 20));
    const completing = await stint(race, 5, 10, at(14, 20));
    expect(completing).toMatchObject({ storyCompleted: true, celebrate: 'SPECTACULAR' });
    expect(completing.expedition?.completed).toBe(true);

    const reopened = await buildOutcomeForSession(USER, completing.sessionId);
    expect(reopened).toMatchObject({ celebrate: 'SPECTACULAR', expedition: completing.expedition });

    // A two-hour race followed by choice is celebrated the same way.
    const short = await addRace(USER, { name: '2 Hours of Choice', hours: 2 });
    await setExpeditionModeAction(short, 'on');
    const done = await stint(short, 0, 2, at(15, 20));
    expect(done).toMatchObject({ celebrate: 'SPECTACULAR', expedition: { completed: true, checkpointsReached: [
      { percent: 10, xpAwarded: 0 }, { percent: 25, xpAwarded: 0 }, { percent: 50, xpAwarded: 0 },
      { percent: 75, xpAwarded: 0 }, { percent: 90, xpAwarded: 0 },
    ] } });
    expect(await held(short)).toEqual([]);
  });

  it('a race completed before 0.4.0 gets a retrospective summary', async () => {
    const race = await addRace(USER, { name: '12 Hours of Before', hours: 12 });
    await stint(race, 0, 6, at(13, 20));
    const completing = await stint(race, 6, 12, at(14, 20));
    await withoutExpeditions();

    const summary = await runCareerBackfillFor(USER, { now: at(25, 9), clock: PLENTY_OF_TIME });
    expect(summary).toMatchObject({ completed: true, expeditionCheckpoints: 5, expeditionXp: 1_200, summariesWritten: 1 });
    expect((await held(race)).map((row) => row.sessionId)).toEqual([null, null, null, null, null]);

    const [row] = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(row).toMatchObject({ raceId: race, retrospective: true, completedAt: at(14, 20), createdAt: at(25, 9) });
    const snapshot = expeditionSummarySnapshotSchema.parse(row!.snapshot);
    expect(snapshot).toMatchObject({ completingSessionId: completing.sessionId, unlocks: 'reconstructed', mastery: { championship: null } });
    // Rebuilt from what was stamped around the completing stint.
    expect(snapshot.achievements.map((achievement) => achievement.name)).toContain('The Whole Story');
    expect(snapshot.xp.checkpoints).toBe(1_200);
  });

  it('a retrospective summary never shows mastery reached after completion', async () => {
    const early = await addRace(USER, { name: '10 Hours of Legacy 2025', hours: 10, iconicKey: 'ten-hours-of-legacy', raceDate: new Date(Date.UTC(2025, 5, 1)) });
    const late = await addRace(USER, { name: '10 Hours of Legacy 2026', hours: 10, iconicKey: 'ten-hours-of-legacy', raceDate: new Date(Date.UTC(2026, 5, 1)) });
    await stint(early, 0, 10, at(13, 20));
    await stint(late, 0, 10, at(20, 20));
    await withoutExpeditions();
    await runCareerBackfillFor(USER, { now: at(25, 9), clock: PLENTY_OF_TIME });

    const snapshots = new Map((await prisma.expeditionSummary.findMany({ where: { userId: USER } }))
      .map((row) => [row.raceId, expeditionSummarySnapshotSchema.parse(row.snapshot)]));
    expect(snapshots.get(early)?.mastery).toMatchObject({
      championship: null, event: { editionsExperienced: 1, editionsStoryComplete: 1 },
    });
    expect(snapshots.get(late)?.mastery.event).toMatchObject({ editionsExperienced: 2, editionsStoryComplete: 2 });
    // The first edition's step, reached with the early race; never the second's.
    const earlyNodes = snapshots.get(early)!.mastery.nodes.map((node) => node.nodeName);
    expect(earlyNodes).toContain('First Complete Edition');
    expect(earlyNodes).not.toContain('Three Complete Editions');
  });

  it('a race edit never writes a summary; the next stint writes the one that is missing', async () => {
    // In a championship, so the stint path has a mastery figure to offer the
    // summary — which a retrospective one must still leave out.
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'expedition-later', name: 'Expedition Later', accentColor: '#4f8fd0' },
      select: { id: true },
    });
    // Nine hours, watched whole: complete, and not an Expedition.
    const race = await addRace(USER, { name: '9 Hours of Later', hours: 9, championshipId: championship.id });
    const completing = await stint(race, 0, 9, at(13, 20));
    expect(await prisma.expeditionSummary.count({ where: { userId: USER } })).toBe(0);

    // Advertised as ten hours, run for nine: an Expedition now, its story already complete.
    const edit = await updateRaceAction(raceForm({
      id: race, name: '9 Hours of Later', championshipId: championship.id, scheduledDuration: '10:00:00', actualDuration: '09:00:00',
    }));
    expect(edit.ok, edit.message).toBe(true);
    expect(edit.message).toContain('Its coverage now reaches more Expedition checkpoints: +1,200 XP.');
    expect(await prisma.expeditionSummary.count({ where: { userId: USER } })).toBe(0);

    expect(await prisma.race.findUniqueOrThrow({ where: { id: race }, select: { championshipId: true } }))
      .toEqual({ championshipId: championship.id });

    const rewatch = await stint(race, 8, 9, at(14, 20));
    expect(rewatch.expedition?.completed).toBe(false);
    const [row] = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(row).toMatchObject({ raceId: race, retrospective: true, completedAt: at(13, 20) });
    const snapshot = expeditionSummarySnapshotSchema.parse(row!.snapshot);
    expect(snapshot.race.championshipName).toBe('Expedition Later');
    expect(snapshot).toMatchObject({ unlocks: 'reconstructed', mastery: { championship: null }, completingSessionId: completing.sessionId });
    // The journey stops at the completing stint: the re-watch that wrote the
    // summary is not part of it, nor is its XP.
    const viewing = await prisma.xPTransaction.aggregate({
      where: { userId: USER, source: 'VIEWING', sessionId: completing.sessionId }, _sum: { amount: true },
    });
    expect(await prisma.xPTransaction.count({ where: { userId: USER, source: 'REWATCH', sessionId: rewatch.sessionId } })).toBe(1);
    expect(snapshot).toMatchObject({ sessions: 1, rewatchSeconds: 0, creditedSeconds: 9 * H });
    expect(snapshot.xp).toMatchObject({ viewing: viewing._sum.amount!, rewatch: 0 });
  });

  it('switching Expedition Mode on for a race whose story is complete writes its summary, once', async () => {
    // Nine hours, watched whole: complete, and not an Expedition by its length.
    const race = await addRace(USER, { name: '9 Hours of Hindsight', hours: 9 });
    const completing = await stint(race, 0, 9, at(13, 20));
    expect(await prisma.expeditionSummary.count({ where: { userId: USER } })).toBe(0);

    const on = await setExpeditionModeAction(race, 'on');
    expect(on.ok).toBe(true);
    expect(on.message).toBe(
      'Expedition Mode is on. 5 checkpoints were already behind you: +1,200 XP. '
        + 'The story is already complete, so its Expedition Summary is ready.',
    );
    const rows = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ raceId: race, retrospective: true, completedAt: at(13, 20) });
    expect(expeditionSummarySnapshotSchema.parse(rows[0]!.snapshot)).toMatchObject({
      completingSessionId: completing.sessionId, unlocks: 'reconstructed', mastery: { championship: null },
      xp: { checkpoints: 1_200 },
    });

    // Off and on again: the summary stays, and no second one is written.
    expect((await setExpeditionModeAction(race, 'off')).message)
      .toBe('Expedition Mode is off. Checkpoints you already reached keep their XP. Its Expedition Summary stays.');
    expect((await setExpeditionModeAction(race, 'on')).message).toBe('Expedition Mode is on. Its checkpoints are at 10%, 25%, 50%, 75% and 90% of the story.');
    expect(await prisma.expeditionSummary.findMany({ where: { userId: USER } })).toEqual(rows);
  });

  it('a mistyped runtime that is corrected leaves no summary, and the real completion writes one', async () => {
    const race = await addRace(USER, { name: '24 Hours of Typos', hours: 24 });
    await stint(race, 0, 20, at(13, 20));
    const achievements = await prisma.achievementProgress.count({ where: { userId: USER, unlockedAt: { not: null } } });

    const typo = await updateRaceAction(raceForm({ id: race, name: '24 Hours of Typos', scheduledDuration: '20:00:00' }));
    expect(typo.ok).toBe(true);
    expect(typo.message).toContain('Its coverage now reaches more Expedition checkpoints: +750 XP.');
    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `story-complete:${race}` } })).toBe(1);
    expect(await prisma.expeditionSummary.count({ where: { userId: USER } })).toBe(0);

    const corrected = await updateRaceAction(raceForm({ id: race, name: '24 Hours of Typos', scheduledDuration: '24:00:00' }));
    expect(corrected.message).toContain('Expedition checkpoints worth 750 XP came off because the coverage no longer reaches them at 24:00:00.');
    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `story-complete:${race}` } })).toBe(0);
    expect(await prisma.expeditionSummary.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.achievementProgress.count({ where: { userId: USER, unlockedAt: { not: null } } })).toBe(achievements);

    const real = await stint(race, 20, 24, at(14, 20));
    expect(real.expedition?.completed).toBe(true);
    const [row] = await prisma.expeditionSummary.findMany({ where: { userId: USER } });
    expect(row).toMatchObject({ retrospective: false, completedAt: at(14, 20) });
  });
});

// ---------------------------------------------------------------------------
// Where an Expedition shows
// ---------------------------------------------------------------------------

describe('what the pages show', () => {
  it('an Expedition begins with its first stint', async () => {
    const race = await addRace(USER, { name: '24 Hours of Beginnings', hours: 24 });
    const first = await stint(race, 0, 1, at(13, 20));
    const second = await stint(race, 1, 2, at(13, 22));
    // An hour of a 24-hour race reaches no checkpoint, and the Expedition has begun all the same.
    expect(first.expedition).toMatchObject({ began: true, checkpointsReached: [], coveragePercentText: '4.1%', nextCheckpoint: { percent: 10 } });
    expect(second.expedition?.began).toBe(false);
    expect((await buildOutcomeForSession(USER, first.sessionId))?.expedition).toEqual(first.expedition);
  });

  it('the Expedition page reads one race of the signed-in account, before and after its first stint', async () => {
    const race = await addRace(USER, { name: '12 Hours of Pages', hours: 12 });
    const fresh = await getExpeditionView(USER, race, at(13, 9));
    expect(fresh).toMatchObject({
      mode: 'auto', isExpedition: true, checkpointsPayXp: true, stints: [], summary: null,
      figures: { sessions: 0, startedAt: null, completionPercentText: '0%', remainingTimelineSec: 12 * H },
      storyBonus: { careerXp: 3_000 },
    });
    expect(await getExpeditionView(USER, '00000000-0000-4000-8000-00000000dead', at(13, 9))).toBeNull();

    await stint(race, 0, 3, at(13, 20));
    const deleted = await stint(race, 3, 4, at(13, 21));
    await stint(race, 2, 6, at(14, 20));
    await deleteViewingSession(USER, deleted.sessionId, at(14, 21));
    const view = await getExpeditionView(USER, race, at(15, 9));
    // New coverage comes from the replay, so it is right after the delete.
    expect(view!.stints.map((stintEvent) => stintEvent.addedCoverageSeconds)).toEqual([3 * H, 3 * H]);
    const detail = await getRaceDetail(USER, race);
    expect(detail!.sessions.map((session) => session.newCoverageSeconds).sort()).toEqual([3 * H, 3 * H]);
    expect(detail!.expedition).toMatchObject({ isExpedition: true, completionText: '50%', nextCheckpoint: { percent: 75 } });
  });

  it('a race that is not an Expedition still has a page, and a switch', async () => {
    const race = await addRace(USER, { name: '6 Hours of Choice', hours: 6 });
    const view = await getExpeditionView(USER, race, at(13, 9));
    expect(view).toMatchObject({ isExpedition: false, mode: 'auto', checkpointsPayXp: true });
    expect((await setExpeditionModeAction(race, 'on')).message)
      .toBe('Expedition Mode is on. Its checkpoints are at 10%, 25%, 50%, 75% and 90% of the story.');
    const short = await addRace(USER, { name: '4 Hours of Choice', hours: 4 });
    expect((await setExpeditionModeAction(short, 'on')).message)
      .toBe('Expedition Mode is on. Checkpoints on races of 6 hours or more also earn XP.');
    expect((await setExpeditionModeAction(short, 'auto')).message)
      .toBe('Expedition Mode follows the race’s length again (automatic from 10 hours).');
    expect((await setExpeditionModeAction(short, 'sideways')).ok).toBe(false);
    expect((await listRaces(USER)).map((card) => [card.name, card.isExpedition]).sort()).toEqual([
      ['4 Hours of Choice', false], ['6 Hours of Choice', true],
    ]);
  });

  it('the dashboard’s current stint says how far an Expedition is', async () => {
    const race = await addRace(USER, { name: '24 Hours of the Dashboard', hours: 24 });
    await stint(race, 0, 15, at(13, 20));
    expect((await getCurrentStint(USER))?.expedition).toEqual({ completionText: '62.5%', nextCheckpointPercent: 75 });
    await setExpeditionModeAction(race, 'off');
    expect((await getCurrentStint(USER))?.expedition).toBeNull();
  });
});
