/**
 * `src/instrumentation.ts` — the only thing that starts the one-time 0.3.1
 * season reset.
 *
 * The reset module has its own tests; these make sure the server start really
 * reaches it, only in the Node runtime, and that a failure is logged rather
 * than stopping the server.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import { SEASON_RESET_KEY } from '@/lib/server/upgrades/season-reset';

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
});
