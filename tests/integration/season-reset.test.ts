/**
 * The one-time 0.3.1 season reset, against a real database.
 *
 * The careers it runs on were written by 0.3.0, when the season was open in
 * Q3 2026. 0.3.1 closes the season for any date before the reopening, so the
 * seed below has to write a Q3 career the way 0.3.0 did: `isSeasonClosed` is
 * switched off WHILE SEEDING ONLY, and the reset itself always runs with the
 * real closure.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const seeding = vi.hoisted(() => ({ asIn030: false }));

vi.mock('@/lib/domain/season-closure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domain/season-closure')>();
  return {
    ...actual,
    isSeasonClosed: (...args: Parameters<typeof actual.isSeasonClosed>) =>
      !seeding.asIn030 && actual.isSeasonClosed(...args),
  };
});

import { prisma, disconnectDb, type Tx } from '@/lib/db/client';
import { createAccount } from '@/lib/auth/accounts';
import { logViewingSession } from '@/lib/engines/session-engine';
import { awardXp } from '@/lib/engines/xp-ledger';
import { syncAchievementDefinitions } from '@/lib/engines/achievement-engine';
import { addSeasonXp, cumulativeXpForTier, rewardForTier, selectionKeyFor } from '@/lib/engines/season-pass-engine';
import { levelFromXp } from '@/lib/domain/progression';
import { DISPLAY_TITLE_KEY, passTitleChoice } from '@/lib/domain/cosmetics';
import { DEFAULT_RACE_CARD_KEY, DEFAULT_THEME_KEY, SEASON_PASS_CONFIG } from '@/lib/config';
import {
  SEASON_RESET_KEY, SEASON_RESET_VERSION, resetSeasonRewards, resetSeasonRewardsFor, resetSeasonRewardsInTx,
} from '@/lib/server/upgrades/season-reset';

const H = 3600;
const PREFIX = 'SeasonResetTest';
/** An evening in Q3 2026, as 0.3.0 saw it. */
const Q3 = new Date(2026, 7, 15, 20);
/** An evening in Q4 2026, after the reopening. */
const Q4 = new Date(2026, 9, 5, 20);
const Q3_SEASON = { year: 2026, quarter: 3 };
const Q4_SEASON = { year: 2026, quarter: 4 };

const silent = { info: () => undefined, error: () => undefined };

async function makeUser(name: string): Promise<string> {
  const user = await prisma.user.create({
    data: { name: `${PREFIX} ${name}`, careerProfile: { create: {} } },
    select: { id: true },
  });
  return user.id;
}

async function makeRace(userId: string, runtimeHours = 6): Promise<string> {
  const runtimeSec = runtimeHours * H;
  const race = await prisma.race.create({
    data: { userId, name: 'Reset Race', scheduledDurationSec: runtimeSec, runtimeSec, raceType: 'H6' },
    select: { id: true },
  });
  return race.id;
}

function stint(raceId: string, from: number, to: number) {
  return {
    raceId, mode: 'RANGE' as const, startTimestamp: from * H, endTimestamp: to * H,
    playbackSpeed: 1, watchedAt: null, note: undefined,
  };
}

/** A completed challenge and the XP it paid, as `evaluateChallenges` would leave them. */
async function completedChallenge(
  userId: string,
  scope: 'SEASONAL' | 'DAILY',
  periodStart: Date,
  periodEnd: Date,
  reward: { careerXp: number; seasonXp: number },
): Promise<string> {
  const challenge = await prisma.challenge.create({
    data: {
      userId, scope, templateKey: `reset-${scope.toLowerCase()}`, title: `${scope} test`,
      description: 'A test challenge.', metric: 'REAL_MINUTES', target: 10, params: {},
      xpReward: reward.careerXp, seasonXpReward: reward.seasonXp, periodStart, periodEnd,
      progress: { create: { value: 10, state: 'COMPLETED', completedAt: Q3 } },
    },
    select: { id: true },
  });
  await prisma.$transaction((tx) =>
    awardXp(tx as Tx, userId, {
      source: 'CHALLENGE', amount: reward.careerXp, seasonAmount: reward.seasonXp,
      description: `Challenge — ${scope} test`, sourceRef: challenge.id, dedupeKey: `challenge:${challenge.id}`,
    }),
  );
  return challenge.id;
}

interface Seeded {
  seasonalId: string;
  dailyId: string;
  q3Theme: string;
}

/**
 * A career with everything 0.3.0 could have given it in Q3 2026: a pass taken
 * to tier 35 through `addSeasonXp` (so tier XP bonuses exist), its collectible
 * trophy minted by a later stint, a completed SEASONAL and a completed DAILY
 * challenge, pass trophies and Hall of Fame entries, and a chosen look.
 */
async function seedQ3Career(userId: string): Promise<Seeded> {
  seeding.asIn030 = true;
  try {
    const raceId = await makeRace(userId);
    await logViewingSession(userId, stint(raceId, 0, 2), Q3);
    await prisma.$transaction((tx) => addSeasonXp(tx as Tx, userId, cumulativeXpForTier(35), Q3));
    // A second stint lets the awards engine mint the tier-30 collectible.
    await logViewingSession(userId, stint(raceId, 2, 3), Q3);

    const seasonalId = await completedChallenge(userId, 'SEASONAL', new Date(2026, 6, 1), new Date(2026, 9, 1), {
      careerXp: 15_000, seasonXp: 7_500,
    });
    const dailyId = await completedChallenge(userId, 'DAILY', new Date(2026, 7, 15), new Date(2026, 7, 16), {
      careerXp: 300, seasonXp: 200,
    });

    // What completing the Q3 pass would have minted.
    await prisma.trophy.create({
      data: {
        userId, key: 'season-pass-complete:2026q3', name: 'Q3 2026 Season Pass Trophy', description: 'Test.',
        category: 'SEASON_PASS', metadata: {}, awardedAt: Q3,
      },
    });
    await prisma.hallOfFameEntry.createMany({
      data: [
        { userId, key: 'first:season-pass', title: 'First Season Pass Completed', category: 'FIRST', snapshot: {}, occurredAt: Q3 },
        { userId, key: 'season-pass-complete:2026q3', title: 'Q3 2026 pass', category: 'SEASON_PASS', snapshot: {}, occurredAt: Q3 },
        // Not the season's: must survive.
        { userId, key: 'first:reset-test', title: 'Something else entirely', category: 'FIRST', snapshot: {}, occurredAt: Q3 },
      ],
    });
    await prisma.trophy.create({
      data: {
        userId, key: 'achievement:reset-test', name: 'Not a season trophy', description: 'Test.',
        category: 'ACHIEVEMENT', metadata: {}, awardedAt: Q3,
      },
    });

    // The look: an earned Q3 theme and card, the auto-filled badge and banner,
    // and a pass title on display.
    const q3Theme = selectionKeyFor(rewardForTier(20, SEASON_PASS_CONFIG, Q3_SEASON));
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: q3Theme, raceCardKey: 'timing' } });
    await prisma.configOverride.create({
      data: { userId, key: DISPLAY_TITLE_KEY, value: passTitleChoice('title_quarter_starter') },
    });

    return { seasonalId, dailyId, q3Theme };
  } finally {
    seeding.asIn030 = false;
  }
}

async function ledgerSum(userId: string): Promise<number> {
  const agg = await prisma.xPTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

async function snapshot(userId: string) {
  const [xpRows, achievements, milestones, sessions, passes, tiers, trophies, entries, profile, overrides] = await Promise.all([
    prisma.xPTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.achievementProgress.count({ where: { userId, unlockedAt: { not: null } } }),
    prisma.milestoneProgress.count({ where: { userId } }),
    prisma.raceViewingSession.count({ where: { userId } }),
    prisma.seasonPass.findMany({ where: { userId } }),
    prisma.seasonPassProgress.count({ where: { seasonPass: { userId }, unlockedAt: { not: null } } }),
    prisma.trophy.findMany({ where: { userId }, select: { key: true, category: true } }),
    prisma.hallOfFameEntry.findMany({ where: { userId }, select: { key: true, category: true } }),
    prisma.careerProfile.findUniqueOrThrow({ where: { userId } }),
    prisma.configOverride.findMany({ where: { userId }, select: { key: true, value: true } }),
  ]);
  return { xpRows, achievements, milestones, sessions, passes, tiers, trophies, entries, profile, overrides };
}

beforeAll(async () => {
  // Achievement definitions are global rows; without them no achievement can
  // unlock, and "achievements stay" would be true of nothing.
  await syncAchievementDefinitions();
});

beforeEach(async () => {
  seeding.asIn030 = false;
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await disconnectDb();
});

describe('the seed', () => {
  it('really is a Q3 career with everything the reset must remove', async () => {
    const userId = await makeUser('Seed');
    const { q3Theme } = await seedQ3Career(userId);
    const before = await snapshot(userId);
    expect(q3Theme).not.toBe(DEFAULT_THEME_KEY);
    expect(before.profile.themeKey).toBe(q3Theme);

    expect(before.passes).toHaveLength(1);
    expect(before.passes[0]).toMatchObject(Q3_SEASON);
    expect(before.tiers).toBeGreaterThanOrEqual(35);
    expect(before.xpRows.filter((row) => row.source === 'SEASON_PASS_TIER').length).toBeGreaterThan(0);
    expect(before.trophies.some((t) => t.key === 'season-pass:2026q3:t30')).toBe(true);
    expect(before.achievements).toBeGreaterThan(0);
    expect(before.milestones).toBeGreaterThan(0);
    expect(before.profile.badgeKey).not.toBeNull();
    expect(before.profile.bannerKey).not.toBeNull();
  });
});

describe('resetting one account', () => {
  it('removes the season and what it paid, and keeps everything else', async () => {
    const userId = await makeUser('One');
    const { seasonalId, dailyId } = await seedQ3Career(userId);
    const before = await snapshot(userId);

    const tierXp = before.xpRows.filter((row) => row.source === 'SEASON_PASS_TIER');
    const seasonalXp = before.xpRows.filter((row) => row.dedupeKey === `challenge:${seasonalId}`);
    const kept = before.xpRows.filter((row) => !tierXp.includes(row) && !seasonalXp.includes(row));
    expect(seasonalXp).toHaveLength(1);

    const summary = await resetSeasonRewardsFor(userId);
    const after = await snapshot(userId);

    // Gone: the pass and its tier rows, its XP, the seasonal challenge and its
    // XP, and the trophies and entries made from the pass.
    expect(after.passes).toEqual([]);
    expect(await prisma.seasonPassProgress.count({ where: { seasonPassId: before.passes[0]!.id } })).toBe(0);
    expect(after.xpRows.filter((row) => row.source === 'SEASON_PASS_TIER')).toEqual([]);
    expect(await prisma.challenge.findUnique({ where: { id: seasonalId } })).toBeNull();
    expect(await prisma.challengeProgress.count({ where: { challengeId: seasonalId } })).toBe(0);
    expect(after.trophies.filter((t) => t.category === 'SEASON_PASS')).toEqual([]);
    expect(after.entries.filter((e) => e.category === 'SEASON_PASS')).toEqual([]);
    expect(after.entries.some((e) => e.key === 'first:season-pass')).toBe(false);

    // Kept: every other ledger row exactly as it was, the daily challenge and
    // its XP, achievements, milestones, stints, and awards not from the pass.
    expect(after.xpRows.map((row) => [row.id, row.amount, row.seasonAmount]))
      .toEqual(kept.map((row) => [row.id, row.amount, row.seasonAmount]));
    expect(await prisma.challenge.findUnique({ where: { id: dailyId } })).not.toBeNull();
    expect(after.xpRows.some((row) => row.dedupeKey === `challenge:${dailyId}` && row.amount === 300)).toBe(true);
    expect(after.xpRows.filter((row) => row.source === 'VIEWING')).toHaveLength(2);
    expect(after.achievements).toBe(before.achievements);
    expect(after.milestones).toBe(before.milestones);
    expect(after.sessions).toBe(before.sessions);
    expect(after.trophies.some((t) => t.key === 'achievement:reset-test')).toBe(true);
    expect(after.entries.some((e) => e.key === 'first:reset-test')).toBe(true);

    // The career is rebuilt from what remains.
    const sum = await ledgerSum(userId);
    expect(Number(after.profile.careerXp)).toBe(sum);
    expect(after.profile.level).toBe(levelFromXp(sum).level);
    expect(Number(after.profile.careerXp)).toBeLessThan(Number(before.profile.careerXp));

    // The look is back to the defaults, and the title to Automatic.
    expect(after.profile.themeKey).toBe(DEFAULT_THEME_KEY);
    expect(after.profile.raceCardKey).toBe(DEFAULT_RACE_CARD_KEY);
    expect(after.profile.badgeKey).toBeNull();
    expect(after.profile.bannerKey).toBeNull();
    expect(after.overrides.some((row) => row.key === DISPLAY_TITLE_KEY)).toBe(false);

    // Marked, and the summary says what happened.
    expect(after.overrides.find((row) => row.key === SEASON_RESET_KEY)?.value).toBe(SEASON_RESET_VERSION);
    const removedXp = [...tierXp, ...seasonalXp].reduce((total, row) => total + row.amount, 0);
    expect(summary).toMatchObject({
      skipped: false,
      passesRemoved: 1,
      seasonalChallengesRemoved: 1,
      xpTransactionsRemoved: tierXp.length + 1,
      careerXpRemoved: removedXp,
      trophiesRemoved: 2,
      hallOfFameEntriesRemoved: 2,
      lookReset: true,
      careerXpBefore: Number(before.profile.careerXp),
      careerXpAfter: sum,
    });
    expect(summary.unlockedTiersRemoved).toBe(before.tiers);
  });

  it('does nothing the second time', async () => {
    const userId = await makeUser('Twice');
    await seedQ3Career(userId);
    await resetSeasonRewardsFor(userId);
    const once = await snapshot(userId);

    const again = await resetSeasonRewardsFor(userId);
    const twice = await snapshot(userId);

    expect(again.skipped).toBe(true);
    expect(twice.xpRows).toEqual(once.xpRows);
    expect(twice.profile).toEqual(once.profile);
    expect(twice.overrides).toEqual(once.overrides);
  });

  it('leaves a Q4 pass alone, even when forced to run again', async () => {
    const userId = await makeUser('Q4');
    await seedQ3Career(userId);
    await resetSeasonRewardsFor(userId);

    // The season reopens; the Q4 pass is earned and its theme put on.
    const raceId = await makeRace(userId);
    await logViewingSession(userId, stint(raceId, 0, 1), Q4);
    await prisma.$transaction((tx) => addSeasonXp(tx as Tx, userId, cumulativeXpForTier(25), Q4));
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: 'sarthe' } });
    const before = await snapshot(userId);
    expect(before.passes).toHaveLength(1);
    expect(before.passes[0]).toMatchObject(Q4_SEASON);

    const summary = await resetSeasonRewardsFor(userId, { force: true });
    const after = await snapshot(userId);

    expect(summary).toMatchObject({ skipped: false, passesRemoved: 0, xpTransactionsRemoved: 0, lookReset: false });
    expect(after.passes.map((pass) => pass.id)).toEqual(before.passes.map((pass) => pass.id));
    // The pass itself untouched: its season XP was added straight to it, with
    // no ledger row behind it, and must not be "rebuilt" away.
    expect(after.passes).toEqual(before.passes);
    expect(after.tiers).toBe(before.tiers);
    expect(after.xpRows.map((row) => row.id)).toEqual(before.xpRows.map((row) => row.id));
    expect(after.profile.themeKey).toBe('sarthe');
  });

  it('keeps a look earned in Q4 when it first runs after the reopening', async () => {
    // 0.3.1 started late: the account already has both quarters.
    const userId = await makeUser('Late');
    await seedQ3Career(userId);
    const raceId = await makeRace(userId);
    await logViewingSession(userId, stint(raceId, 0, 1), Q4);
    await prisma.$transaction((tx) => addSeasonXp(tx as Tx, userId, cumulativeXpForTier(25), Q4));
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: 'sarthe', raceCardKey: 'hyperpole' } });

    await resetSeasonRewardsFor(userId);
    const after = await snapshot(userId);

    expect(after.passes.map((pass) => [pass.year, pass.quarter])).toEqual([[2026, 4]]);
    // Sarthe is Q4's tier 20 and still earned; Hyperpole is tier 40, never reached.
    expect(after.profile.themeKey).toBe('sarthe');
    expect(after.profile.raceCardKey).toBe(DEFAULT_RACE_CARD_KEY);
  });

  it('keeps a Q4 pass\'s momentum-boosted season XP when it first runs after the reopening', async () => {
    // 0.3.0 kept running into October, with momentum above Cold Tyres, and
    // 0.3.1 starts for the first time afterwards. No Q3 data at all.
    const userId = await makeUser('Momentum');
    await prisma.careerProfile.update({ where: { userId }, data: { momentumPoints: 150, momentumUpdatedAt: Q4 } });
    const raceId = await makeRace(userId);
    await logViewingSession(userId, stint(raceId, 0, 3), Q4);
    // As the app would have stamped them: the ledger rows at the stint.
    await prisma.xPTransaction.updateMany({ where: { userId }, data: { createdAt: Q4 } });

    const before = await snapshot(userId);
    expect(before.passes).toHaveLength(1);
    const ledgerSeason = before.xpRows.reduce((total, row) => total + row.seasonAmount, 0);
    // The precondition that makes this test mean something: the pass holds
    // more than the ledger's unboosted season XP.
    expect(before.passes[0]!.seasonXp).toBeGreaterThan(ledgerSeason);

    const summary = await resetSeasonRewardsFor(userId);
    const after = await snapshot(userId);

    expect(summary).toMatchObject({ skipped: false, passesRemoved: 0, xpTransactionsRemoved: 0, lookReset: false });
    expect(after.passes).toEqual(before.passes);
  });

  it('scopes by quarter, so a time zone change cannot bring the Q4 pass into scope', async () => {
    // The Q4 rows were written in a zone one hour east of this one: their
    // starts fall an hour before this machine's reopening.
    const userId = await makeUser('Zone');
    const east = new Date(new Date(2026, 9, 1).getTime() - 3600_000);
    const raceId = await makeRace(userId);
    await logViewingSession(userId, stint(raceId, 0, 1), Q4);
    await prisma.$transaction((tx) => addSeasonXp(tx as Tx, userId, cumulativeXpForTier(35), Q4));
    // A second stint mints the tier-30 collectible trophy for the Q4 pass.
    await logViewingSession(userId, stint(raceId, 1, 2), Q4);
    await prisma.seasonPass.updateMany({ where: { userId }, data: { startsAt: east } });
    const seasonalId = await completedChallenge(userId, 'SEASONAL', east, new Date(2027, 0, 1), {
      careerXp: 15_000, seasonXp: 7_500,
    });
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: 'sarthe' } });

    const before = await snapshot(userId);
    expect(before.passes[0]).toMatchObject(Q4_SEASON);
    expect(before.trophies.some((t) => t.key === 'season-pass:2026q4:t30')).toBe(true);

    const summary = await resetSeasonRewardsFor(userId);
    const after = await snapshot(userId);

    expect(summary).toMatchObject({
      passesRemoved: 0, seasonalChallengesRemoved: 0, xpTransactionsRemoved: 0,
      trophiesRemoved: 0, hallOfFameEntriesRemoved: 0, lookReset: false,
    });
    expect(after.passes).toEqual(before.passes);
    expect(after.xpRows.map((row) => row.id)).toEqual(before.xpRows.map((row) => row.id));
    expect(await prisma.challenge.findUnique({ where: { id: seasonalId } })).not.toBeNull();
    expect(after.trophies).toEqual(before.trophies);
    expect(after.profile.themeKey).toBe('sarthe');
  });

  it('marks an account with no career profile instead of failing on it', async () => {
    // An account whose creation stopped between the user row and `ensureCareer`.
    const bare = await prisma.user.create({ data: { name: `${PREFIX} Bare` }, select: { id: true } });
    const normal = await makeUser('Normal');
    await seedQ3Career(normal);

    const errors: string[] = [];
    const summaries = await resetSeasonRewards({ info: () => undefined, error: (line) => errors.push(line) });

    expect(errors).toEqual([]);
    expect(summaries.find((summary) => summary.userId === bare.id)).toMatchObject({ skipped: false, passesRemoved: 0 });
    expect(summaries.find((summary) => summary.userId === normal)).toMatchObject({ passesRemoved: 1 });
    for (const userId of [bare.id, normal]) {
      const marker = await prisma.configOverride.findUnique({ where: { userId_key: { userId, key: SEASON_RESET_KEY } } });
      expect(marker?.value).toBe(SEASON_RESET_VERSION);
    }
    expect(await prisma.careerProfile.findUnique({ where: { userId: bare.id } })).toBeNull();
  });

  it('changes nothing, and leaves no marker, when its transaction fails', async () => {
    const userId = await makeUser('Fails');
    await seedQ3Career(userId);
    const before = await snapshot(userId);

    await expect(
      prisma.$transaction(async (tx) => {
        await resetSeasonRewardsInTx(tx as Tx, userId);
        throw new Error('the disk went away');
      }),
    ).rejects.toThrow('the disk went away');

    const after = await snapshot(userId);
    expect(after.passes).toHaveLength(1);
    expect(after.xpRows).toEqual(before.xpRows);
    expect(after.overrides.some((row) => row.key === SEASON_RESET_KEY)).toBe(false);
  });
});

describe('resetting every account', () => {
  it('never touches an account created on 0.3.1', async () => {
    const userId = await createAccount({ name: `${PREFIX} New` });
    const marker = await prisma.configOverride.findUnique({ where: { userId_key: { userId, key: SEASON_RESET_KEY } } });
    expect(marker?.value).toBe(SEASON_RESET_VERSION);

    // Even with season data on it — which a new account could only have from
    // a reopened season — the reset passes it by.
    await seedQ3Career(userId);
    const before = await snapshot(userId);

    const summaries = await resetSeasonRewards(silent);
    expect(summaries.some((summary) => summary.userId === userId)).toBe(false);
    const after = await snapshot(userId);
    expect(after.passes.map((pass) => pass.id)).toEqual(before.passes.map((pass) => pass.id));
    expect(after.xpRows).toEqual(before.xpRows);
    expect(after.profile).toEqual(before.profile);
  });

  it('resets each account on its own', async () => {
    const alex = await makeUser('Alex');
    const sam = await makeUser('Sam');
    await seedQ3Career(alex);
    await seedQ3Career(sam);

    // One account first: the other is untouched by it.
    await resetSeasonRewardsFor(alex);
    expect(await prisma.seasonPass.count({ where: { userId: alex } })).toBe(0);
    expect(await prisma.seasonPass.count({ where: { userId: sam } })).toBe(1);

    // Then every account: the one already done is not processed again.
    const lines: string[] = [];
    const summaries = await resetSeasonRewards({ info: (line) => lines.push(line), error: () => undefined });
    expect(summaries.some((summary) => summary.userId === alex)).toBe(false);
    const samSummary = summaries.find((summary) => summary.userId === sam);
    expect(samSummary).toMatchObject({ skipped: false, passesRemoved: 1, lookReset: true });
    expect(lines.some((line) => line.includes(sam) && line.includes('career XP'))).toBe(true);

    for (const userId of [alex, sam]) {
      const after = await snapshot(userId);
      expect(after.passes).toEqual([]);
      expect(Number(after.profile.careerXp)).toBe(await ledgerSum(userId));
      expect(after.overrides.find((row) => row.key === SEASON_RESET_KEY)?.value).toBe(SEASON_RESET_VERSION);
    }
  });
});
