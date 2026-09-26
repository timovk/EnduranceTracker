/**
 * `src/instrumentation.ts` — the only thing that starts the one-time 0.3.1
 * season reset, the 0.4.0 career backfill and the Chronicle's freeze pass.
 *
 * Each module has its own tests; these make sure the server start really
 * reaches them, only in the Node runtime, that one failing never stops the
 * others or the server, and that a second start finds nothing left to do.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import { createAccount } from '@/lib/auth/accounts';
import { SEASON_RESET_KEY } from '@/lib/server/upgrades/season-reset';
import { isCareerBackfillApplied, markCareerBackfillApplied } from '@/lib/server/upgrades/career-backfill';
import { addRace, H, logStint } from '../helpers/career-db';

const PREFIX = 'InstrumentationTest';
const originalRuntime = process.env.NEXT_RUNTIME;

/** An account as 0.3.0 left it: unmarked, with a Q3 2026 pass. */
async function seedUnmarkedQ3Account(): Promise<{ userId: string; passId: string }> {
  const user = await prisma.user.create({
    data: { name: `${PREFIX} ${Math.random()}`, careerProfile: { create: {} } },
    select: { id: true },
  });
  const pass = await prisma.seasonPass.create({
    data: {
      userId: user.id, year: 2026, quarter: 3,
      startsAt: new Date(2026, 6, 1), endsAt: new Date(2026, 9, 1), seasonXp: 1000, tier: 1,
    },
    select: { id: true },
  });
  return { userId: user.id, passId: pass.id };
}

/**
 * An account with a career as 0.3.2 left it: a finished race, with no credited
 * time on it and no dates on its milestones, and no backfill marker.
 */
async function seedCareerFrom032(): Promise<string> {
  const user = await prisma.user.create({
    data: { name: `${PREFIX} ${Math.random()}`, careerProfile: { create: {} } },
    select: { id: true },
  });
  const raceId = await addRace(user.id, { name: 'Six Hours Before 0.4.0' });
  await logStint(user.id, raceId, { from: 0, to: 6 * H, now: new Date(2026, 8, 20, 20, 0) });
  await prisma.milestoneProgress.updateMany({
    where: { userId: user.id },
    data: { achievedAt: null, achievedPrecision: null, sessionId: null, raceId: null, subjectName: null },
  });
  await prisma.race.updateMany({ where: { userId: user.id }, data: { creditedViewingSec: null } });
  return user.id;
}

/** A career with a finished year: a race watched on a day of 2025, as a stint of 2025 logs it. */
async function seedCareerWithAFinishedYear(): Promise<string> {
  const user = await prisma.user.create({
    data: { name: `${PREFIX} ${Math.random()}`, careerProfile: { create: {} } },
    select: { id: true },
  });
  const raceId = await addRace(user.id, { name: 'Six Hours of 2025' });
  const watchedAt = new Date(2025, 5, 14, 21, 0);
  await logStint(user.id, raceId, { from: 0, to: 3 * H, watchedAt, now: watchedAt });
  return user.id;
}

/** Everything the career backfill and the freeze pass write for an account. */
async function backfilled(userId: string) {
  const [ledger, milestones, races, marker, chapters] = await Promise.all([
    prisma.xPTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.milestoneProgress.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.race.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.configOverride.findMany({ where: { userId }, orderBy: { key: 'asc' } }),
    prisma.chronicleYear.findMany({ where: { userId }, orderBy: { year: 'asc' } }),
  ]);
  return { ledger, milestones, races, marker, chapters };
}

async function chaptersOf(userId: string): Promise<number[]> {
  return (await prisma.chronicleYear.findMany({ where: { userId }, orderBy: { year: 'asc' }, select: { year: true } }))
    .map((row) => row.year);
}

async function marked(userId: string): Promise<boolean> {
  const row = await prisma.configOverride.findUnique({ where: { userId_key: { userId, key: SEASON_RESET_KEY } } });
  return row !== null;
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
  vi.doUnmock('@/lib/server/upgrades/season-reset');
  vi.doUnmock('@/lib/server/upgrades/career-backfill');
  vi.doUnmock('@/lib/server/upgrades/chronicle-freeze');
  vi.resetModules();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await disconnectDb();
});

describe('register()', () => {
  it('runs the season reset in the Node runtime', async () => {
    const { userId, passId } = await seedUnmarkedQ3Account();
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await register();

    expect(await marked(userId)).toBe(true);
    expect(await prisma.seasonPass.findUnique({ where: { id: passId } })).toBeNull();
  });

  it('touches nothing outside the Node runtime', async () => {
    const { userId, passId } = await seedUnmarkedQ3Account();
    delete process.env.NEXT_RUNTIME;

    const { register } = await import('@/instrumentation');
    await register();

    process.env.NEXT_RUNTIME = 'edge';
    await register();

    expect(await marked(userId)).toBe(false);
    expect(await prisma.seasonPass.findUnique({ where: { id: passId } })).not.toBeNull();
  });

  it('logs a failure and still lets the server start', async () => {
    vi.resetModules();
    vi.doMock('@/lib/server/upgrades/season-reset', () => ({
      resetSeasonRewards: () => Promise.reject(new Error('the disk went away')),
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('[season-reset] could not run at start-up');
  });

  it('runs the career backfill in the Node runtime', async () => {
    const userId = await seedCareerFrom032();
    expect(await isCareerBackfillApplied(userId)).toBe(false);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await register();

    expect(await isCareerBackfillApplied(userId)).toBe(true);
    expect(await prisma.milestoneProgress.count({ where: { userId, achievedPrecision: null } })).toBe(0);
    expect(await prisma.race.count({ where: { userId, creditedViewingSec: null } })).toBe(0);
    // Its new rungs were written, as the first start after the update does.
    expect(await prisma.milestoneProgress.count({ where: { userId, metric: 'racesStarted', threshold: 1 } })).toBe(1);
  });

  it('the season reset failing does not stop the career backfill', async () => {
    const userId = await seedCareerFrom032();
    vi.resetModules();
    vi.doMock('@/lib/server/upgrades/season-reset', () => ({
      resetSeasonRewards: () => Promise.reject(new Error('the disk went away')),
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('[season-reset] could not run at start-up');
    expect(await isCareerBackfillApplied(userId)).toBe(true);
  });

  it('logs a failure of the career backfill and still lets the server start', async () => {
    const { userId, passId } = await seedUnmarkedQ3Account();
    vi.resetModules();
    vi.doMock('@/lib/server/upgrades/career-backfill', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/server/upgrades/career-backfill')>(),
      runCareerBackfill: () => Promise.reject(new Error('the disk went away')),
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('[career-backfill] could not run at start-up');
    // The season reset before it still ran.
    expect(await marked(userId)).toBe(true);
    expect(await prisma.seasonPass.findUnique({ where: { id: passId } })).toBeNull();
  });

  it('a second start changes nothing', async () => {
    const userId = await seedCareerFrom032();
    const withAChapter = await seedCareerWithAFinishedYear();
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await register();
    const first = await backfilled(userId);
    const firstWithAChapter = await backfilled(withAChapter);
    expect(firstWithAChapter.chapters.map((row) => row.year)).toEqual([2025]);
    expect(logs.mock.calls.some((call) => String(call[0]).includes(userId))).toBe(true);

    logs.mockClear();
    await register();
    expect(await backfilled(userId)).toEqual(first);
    expect(await backfilled(withAChapter)).toEqual(firstWithAChapter);
    // Nothing was left to do for either, so nothing was said about them.
    expect(logs.mock.calls.some((call) => String(call[0]).includes(userId))).toBe(false);
    expect(logs.mock.calls.some((call) => String(call[0]).includes(withAChapter))).toBe(false);
  });

  it('freezes the finished years of a complete account at start-up', async () => {
    const userId = await seedCareerWithAFinishedYear();
    await markCareerBackfillApplied(userId);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await register();
    expect(await chaptersOf(userId)).toEqual([2025]);
  });

  it('the freeze pass skips accounts whose backfill is not complete', async () => {
    const incomplete = await seedCareerWithAFinishedYear();
    const complete = await seedCareerWithAFinishedYear();
    await markCareerBackfillApplied(complete);
    // A start whose backfill got no further: the first account is still to be upgraded.
    vi.resetModules();
    vi.doMock('@/lib/server/upgrades/career-backfill', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/server/upgrades/career-backfill')>(),
      runCareerBackfill: () => Promise.resolve([]),
    }));
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await register();
    expect(await isCareerBackfillApplied(incomplete)).toBe(false);
    expect(await chaptersOf(incomplete)).toEqual([]);
    expect(await chaptersOf(complete)).toEqual([2025]);
  });

  it('logs a failure of the freeze pass and still lets the server start', async () => {
    const userId = await seedCareerFrom032();
    vi.resetModules();
    vi.doMock('@/lib/server/upgrades/chronicle-freeze', () => ({
      freezeAllChronicles: () => Promise.reject(new Error('the disk went away')),
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('[chronicle] could not freeze finished years at start-up');
    // The backfill before it still ran.
    expect(await isCareerBackfillApplied(userId)).toBe(true);
  });

  it('new accounts are pre-marked', async () => {
    const id = await createAccount({ name: `${PREFIX} New` });
    expect(await isCareerBackfillApplied(id)).toBe(true);
    expect(await marked(id)).toBe(true);

    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('@/instrumentation');
    await register();
    expect(logs.mock.calls.some((call) => String(call[0]).includes(id))).toBe(false);
  });
});
