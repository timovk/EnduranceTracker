/**
 * The challenge board is rebuilt on every page load, and must do it quietly.
 *
 * `ensureChallenges` generates the same board deterministically each time, so
 * on all but the first load of a period every row it wants to insert is
 * already there. It used to find that out by inserting anyway and catching the
 * unique-constraint violation — correct, but Prisma logs every failed
 * statement before the promise rejects, so opening the dashboard printed
 * thirty-odd `prisma:error` lines. On the web that is invisible; in a desktop
 * application it goes straight into the log file the user is asked to send
 * when something looks wrong, and buries the real thing.
 *
 * So this asserts the mechanism rather than the symptom: the second run must
 * not issue a `createMany` at all, and must never fall back to the row-by-row
 * path that only a rejected insert can reach.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import { ensureChallenges } from '@/lib/engines/challenge-engine';
import type { Tx } from '@/lib/db/client';

const USER = '00000000-0000-4000-8000-0000000000fe';

interface Counts {
  createMany: number;
  create: number;
  rejected: number;
}

/**
 * `prisma` with the challenge delegate's writes counted.
 *
 * A Proxy rather than a mock: every other delegate has to behave exactly as it
 * normally does, because the point is what the real engine does against the
 * real database.
 */
function counting(counts: Counts): Tx {
  const challenge = new Proxy(prisma.challenge, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'createMany' && property !== 'create') return value;
      const call = value as (args: unknown) => Promise<unknown>;
      return async (args: unknown) => {
        counts[property] += 1;
        try {
          return await call.call(target, args);
        } catch (error) {
          counts.rejected += 1;
          throw error;
        }
      };
    },
  });

  return new Proxy(prisma, {
    get: (target, property, receiver) =>
      property === 'challenge' ? challenge : Reflect.get(target, property, receiver),
  }) as unknown as Tx;
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({
    data: { id: USER, name: 'Challenge Noise', careerProfile: { create: {} } },
  });
  await prisma.race.create({
    data: {
      userId: USER,
      name: 'Noise Test Race',
      scheduledDurationSec: 6 * 3600,
      runtimeSec: 6 * 3600,
      raceType: 'H6',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

describe('rebuilding the challenge board', () => {
  it('inserts once and then stops writing entirely', async () => {
    const now = new Date();

    const first: Counts = { createMany: 0, create: 0, rejected: 0 };
    const built = await ensureChallenges(USER, now, counting(first));

    expect(built.length).toBeGreaterThan(0);
    expect(first.createMany).toBe(1);
    expect(first.rejected).toBe(0);

    const second: Counts = { createMany: 0, create: 0, rejected: 0 };
    const again = await ensureChallenges(USER, now, counting(second));

    // Same board, and not a single statement sent to produce it.
    expect(again.map((row) => row.id).sort()).toEqual(built.map((row) => row.id).sort());
    expect(second.createMany).toBe(0);
    expect(second.create).toBe(0);
    expect(second.rejected).toBe(0);
  });
});
