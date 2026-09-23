/**
 * The 0.3.1 season closure, through the real engines and a real database.
 *
 * Before local midnight on 1 October 2026 a stint earns career XP and nothing
 * seasonal: no pass is created, every ledger row it writes has a season amount
 * of zero, and no SEASONAL challenge is generated. From that instant on,
 * everything behaves as 0.3.0 did. `now` is injected on both sides.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb, type Tx } from '@/lib/db/client';
import { logViewingSession } from '@/lib/engines/session-engine';
import { ensureChallenges, getActiveChallenges } from '@/lib/engines/challenge-engine';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import { getDashboard } from '@/lib/server/dashboard';
import {
  SeasonClosedError, addSeasonXp, getOrCreateCurrentPass,
} from '@/lib/engines/season-pass-engine';

const H = 3600;
const USER = '00000000-0000-4000-8000-0000000003a1';

const REOPENS = new Date(2026, 9, 1);
/** An evening inside the closure. */
const CLOSED = new Date(2026, 8, 29, 20);
/** An evening just after the reopening. */
const OPEN = new Date(2026, 9, 2, 20);

async function makeRace(runtimeHours = 6, name = 'Closure Race'): Promise<string> {
  const runtimeSec = Math.round(runtimeHours * H);
  const race = await prisma.race.create({
    data: { userId: USER, name, scheduledDurationSec: runtimeSec, runtimeSec, raceType: 'H6' },
    select: { id: true },
  });
  return race.id;
}

/** A DAILY challenge for `now`'s day that an hour of watching completes. */
async function dailyChallenge(now: Date): Promise<{ id: string; xpReward: number; seasonXpReward: number }> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return prisma.challenge.create({
    data: {
      userId: USER, scope: 'DAILY', templateKey: 'closure-test', title: 'Watch ten minutes',
      description: 'Ten real minutes.', metric: 'REAL_MINUTES', target: 10, params: {},
      xpReward: 300, seasonXpReward: 200, periodStart: start, periodEnd: end,
    },
    select: { id: true, xpReward: true, seasonXpReward: true },
  });
}

function stint(raceId: string, hours: number) {
  return {
    raceId, mode: 'RANGE' as const, startTimestamp: 0, endTimestamp: hours * H,
    playbackSpeed: 1, watchedAt: null, note: undefined,
  };
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, name: 'Closure Test', careerProfile: { create: {} } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

describe('while the season is closed', () => {
  it('creates no pass, and pays career XP with no season XP on any row', async () => {
    // A two-hour race watched end to end: viewing AND a Story Complete bonus,
    // and a daily challenge completed by the same stint.
    const raceId = await makeRace(2);
    const challenge = await dailyChallenge(CLOSED);

    const outcome = await logViewingSession(USER, stint(raceId, 2), CLOSED);

    expect(await prisma.seasonPass.count({ where: { userId: USER } })).toBe(0);
    expect(outcome.seasonXpAwarded).toBe(0);
    expect(outcome.seasonPassTiers).toEqual([]);
    // The summary says when the pass opens instead of showing a season XP figure.
    expect(outcome.seasonClosure).toEqual({ label: 'Q4 2026', reopensAt: REOPENS.toISOString() });
    expect(outcome.storyCompleted).toBe(true);
    expect(outcome.careerXpAwarded).toBeGreaterThan(0);

    const rows = await prisma.xPTransaction.findMany({ where: { userId: USER } });
    const sources = new Set(rows.map((row) => row.source));
    expect(sources).toContain('VIEWING');
    expect(sources).toContain('STORY_COMPLETE');
    expect(sources).toContain('CHALLENGE');
    for (const row of rows) expect(row.seasonAmount, `${row.source} ${row.description}`).toBe(0);

    // The daily challenge keeps its career XP; only its season XP is withheld.
    const award = rows.find((row) => row.dedupeKey === `challenge:${challenge.id}`);
    expect(award?.amount).toBe(challenge.xpReward);
    expect(outcome.challenges.find((c) => c.id === challenge.id)?.seasonXpAwarded).toBe(0);

    const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } });
    expect(Number(profile.careerXp)).toBe(rows.reduce((sum, row) => sum + row.amount, 0));
  });

  it('pays a Season Complete with career XP and no season XP', async () => {
    // A one-race championship season, finished by this stint.
    const championship = await prisma.championship.create({
      data: { userId: USER, name: 'Closure Championship', slug: 'closure-championship' },
      select: { id: true },
    });
    const season = await prisma.championshipSeason.create({
      data: { championshipId: championship.id, year: 2026, plannedRaceCount: 1 },
      select: { id: true },
    });
    const raceId = await makeRace(2);
    await prisma.race.update({ where: { id: raceId }, data: { championshipId: championship.id, seasonId: season.id } });

    await logViewingSession(USER, stint(raceId, 2), CLOSED);

    const award = await prisma.xPTransaction.findFirst({ where: { userId: USER, source: 'SEASON_COMPLETE' } });
    expect(award, 'the stint should have completed the season').not.toBeNull();
    expect(award!.amount).toBeGreaterThan(0);
    expect(award!.seasonAmount).toBe(0);
    expect(await prisma.seasonPass.count({ where: { userId: USER } })).toBe(0);
  });

  it('neither shows nor pays a seasonal challenge left over from before the closure', async () => {
    // Possible only if the reset failed for this account: a Q3 SEASONAL
    // challenge whose period still runs until the reopening.
    const leftover = await prisma.challenge.create({
      data: {
        userId: USER, scope: 'SEASONAL', templateKey: 'closure-leftover', title: 'Watch ten minutes this quarter',
        description: 'Ten real minutes.', metric: 'REAL_MINUTES', target: 10, params: {},
        xpReward: 15_000, seasonXpReward: 7_500, periodStart: new Date(2026, 6, 1), periodEnd: REOPENS,
      },
      select: { id: true },
    });

    expect((await getActiveChallenges(USER, CLOSED)).some((view) => view.id === leftover.id)).toBe(false);

    const raceId = await makeRace(2);
    await logViewingSession(USER, stint(raceId, 2), CLOSED);
    expect(await prisma.xPTransaction.count({ where: { userId: USER, dedupeKey: `challenge:${leftover.id}` } })).toBe(0);
  });

  it('gives the dashboard the closed state while closed, and none once open', async () => {
    const closed = await getDashboard(USER, CLOSED);
    expect(closed.seasonPass).toBeNull();
    expect(closed.seasonPassClosure).toMatchObject({ label: 'Q4 2026' });
    expect(closed.seasonPassClosure!.reopensAt.getTime()).toBe(REOPENS.getTime());

    const open = await getDashboard(USER, OPEN);
    expect(open.seasonPassClosure).toBeNull();
  });

  it('rebuilds the same summary afterwards, judged by when the stint was logged', async () => {
    // The page shows the summary rebuilt from the database, not the one the
    // engine returned, so the rebuilt one has to say the same thing.
    const raceId = await makeRace(2);
    const challenge = await dailyChallenge(CLOSED);
    const logged = await logViewingSession(USER, stint(raceId, 2), CLOSED);

    // `createdAt` is stamped by the database clock; pin it to the side of the
    // boundary under test so this does not depend on the day the suite runs.
    await prisma.raceViewingSession.update({ where: { id: logged.sessionId }, data: { createdAt: CLOSED } });
    const rebuilt = await buildOutcomeForSession(USER, logged.sessionId);
    expect(rebuilt?.seasonXpAwarded).toBe(0);
    expect(rebuilt?.seasonClosure).toEqual(logged.seasonClosure);
    // The daily challenge it completed paid no season XP, whatever it offered.
    const rebuiltChallenge = rebuilt?.challenges.find((c) => c.id === challenge.id);
    expect(rebuiltChallenge).toBeDefined();
    expect(challenge.seasonXpReward).toBeGreaterThan(0);
    expect(rebuiltChallenge!.seasonXpAwarded).toBe(0);

    // Survives the JSON route unchanged.
    expect(JSON.parse(JSON.stringify(rebuilt)).seasonClosure).toEqual(logged.seasonClosure);

    // A stint logged after the reopening carries no notice.
    await prisma.raceViewingSession.update({ where: { id: logged.sessionId }, data: { createdAt: OPEN } });
    expect((await buildOutcomeForSession(USER, logged.sessionId))?.seasonClosure).toBeNull();
  });

  it('refuses to create a pass however it is asked', async () => {
    await expect(
      prisma.$transaction((tx) => getOrCreateCurrentPass(tx as Tx, USER, CLOSED)),
    ).rejects.toBeInstanceOf(SeasonClosedError);

    const unlocks = await prisma.$transaction((tx) => addSeasonXp(tx as Tx, USER, 50_000, CLOSED));
    expect(unlocks).toEqual([]);
    expect(await prisma.seasonPass.count({ where: { userId: USER } })).toBe(0);
  });

  it('refuses right up to the last millisecond before the reopening', async () => {
    const lastMoment = new Date(REOPENS.getTime() - 1);
    await expect(
      prisma.$transaction((tx) => getOrCreateCurrentPass(tx as Tx, USER, lastMoment)),
    ).rejects.toBeInstanceOf(SeasonClosedError);
  });

  it('generates daily, weekly and monthly challenges, but no seasonal ones', async () => {
    for (let i = 0; i < 4; i += 1) await makeRace(6, `Closure Race ${i}`);

    const board = await ensureChallenges(USER, CLOSED);
    const scopes = new Set(board.map((challenge) => challenge.scope));
    expect(scopes.has('SEASONAL')).toBe(false);
    expect(scopes).toContain('DAILY');
    expect(scopes).toContain('WEEKLY');
    expect(scopes).toContain('MONTHLY');
    expect(await prisma.challenge.count({ where: { userId: USER, scope: 'SEASONAL' } })).toBe(0);

    // What the board advertises is what completing it would pay now.
    for (const view of await getActiveChallenges(USER, CLOSED)) {
      expect(view.seasonXpReward, view.title).toBe(0);
      expect(view.scope).not.toBe('SEASONAL');
    }
  });
});

describe('once the season has reopened', () => {
  it('creates the Q4 pass and fills it with season XP', async () => {
    const raceId = await makeRace(2);
    const challenge = await dailyChallenge(OPEN);

    const outcome = await logViewingSession(USER, stint(raceId, 2), OPEN);

    const passes = await prisma.seasonPass.findMany({ where: { userId: USER } });
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ year: 2026, quarter: 4 });
    expect(passes[0]!.startsAt.getTime()).toBe(REOPENS.getTime());
    expect(passes[0]!.seasonXp).toBeGreaterThan(0);
    expect(outcome.seasonXpAwarded).toBe(passes[0]!.seasonXp);
    expect(outcome.seasonClosure).toBeNull();

    const viewing = await prisma.xPTransaction.findFirstOrThrow({ where: { userId: USER, source: 'VIEWING' } });
    expect(viewing.seasonAmount).toBeGreaterThan(0);
    const award = await prisma.xPTransaction.findFirstOrThrow({ where: { userId: USER, dedupeKey: `challenge:${challenge.id}` } });
    expect(award.seasonAmount).toBe(challenge.seasonXpReward);
  });

  it('opens at exactly midnight', async () => {
    const pass = await prisma.$transaction((tx) => getOrCreateCurrentPass(tx as Tx, USER, REOPENS));
    expect(pass).toMatchObject({ year: 2026, quarter: 4 });
  });

  it('generates the Q4 seasonal challenges again', async () => {
    for (let i = 0; i < 4; i += 1) await makeRace(6, `Closure Race ${i}`);

    const board = await ensureChallenges(USER, OPEN);
    const seasonal = board.filter((challenge) => challenge.scope === 'SEASONAL');
    expect(seasonal.length).toBeGreaterThan(0);
    for (const challenge of seasonal) {
      expect(challenge.periodStart.getTime()).toBe(REOPENS.getTime());
      expect(challenge.seasonXpReward).toBeGreaterThan(0);
    }
  });
});
