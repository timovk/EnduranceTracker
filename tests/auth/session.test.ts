/**
 * Sign-in sessions, against the real database.
 *
 * A session is the only thing standing between one person's career and the
 * next person's, so the interesting cases are all the ones where it should
 * come back empty: a cookie for a row that has been deleted, a cookie that has
 * expired, a cookie from before someone signed out. Every one of those has to
 * read as "nobody is signed in" rather than as an error, or the account screens
 * become unreachable from the very state they exist to fix.
 *
 * `session.ts` is a server module: it imports `server-only`, which resolves
 * only inside Next's bundler, and it reads cookies through `next/headers`,
 * which needs a request. Both are replaced here with the smallest thing that
 * behaves like the real one — a map that remembers what was set, including the
 * options, because one of those options is load-bearing (see below).
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface StoredCookie {
  value: string;
  options: Record<string, unknown>;
}

const jar = vi.hoisted(() => new Map<string, StoredCookie>());

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get(name: string) {
      const stored = jar.get(name);
      return stored === undefined ? undefined : { name, value: stored.value };
    },
    set(name: string, value: string, options: Record<string, unknown> = {}) {
      jar.set(name, { value, options });
    },
    delete(name: string) {
      jar.delete(name);
    },
  }),
}));

vi.mock('next/navigation', () => ({
  // The real `redirect` throws too, which is how it interrupts a render.
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { prisma, disconnectDb } from '@/lib/db/client';
import {
  SESSION_COOKIE,
  createSession,
  getSessionUser,
  getSessionUserId,
  requireUserId,
  signOut,
  signOutEverywhere,
} from '@/lib/auth/session';

const DAY = 24 * 60 * 60 * 1000;

/** This file's own accounts. The name is unique in the schema, so it must be unique here too. */
const ALEX = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000a2';

async function resetAccounts(): Promise<void> {
  jar.clear();
  await prisma.user.deleteMany({ where: { id: { in: [ALEX, SAM] } } });
  await prisma.user.create({
    data: {
      id: ALEX,
      name: 'Session Test Alex',
      avatarKey: 'stopwatch',
      accentKey: 'crimson',
      careerProfile: { create: { level: 12, careerXp: BigInt(48_500), titleKey: 'Stint Specialist' } },
    },
  });
  await prisma.user.create({
    data: { id: SAM, name: 'Session Test Sam', careerProfile: { create: {} } },
  });
}

beforeEach(async () => {
  await resetAccounts();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ALEX, SAM] } } });
  await disconnectDb();
});

describe('signing in', () => {
  it('hands the browser an opaque token and keeps everything else server-side', async () => {
    const token = await createSession(ALEX);

    // 32 bytes of base64url. There is nothing in it to read, forge or decode —
    // it is a row id, and the row is the session.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jar.get(SESSION_COOKIE)?.value).toBe(token);

    const row = await prisma.userSession.findUnique({ where: { id: token } });
    expect(row?.userId).toBe(ALEX);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY);
  });

  it('never marks the cookie secure', async () => {
    // The app is served over plain HTTP on 127.0.0.1. A secure cookie is never
    // sent back over http://, so signing in would appear to work and then
    // silently fail — looking exactly like a wrong password. This assertion is
    // here because that failure is so much more confusing than it sounds.
    await createSession(ALEX);
    const options = jar.get(SESSION_COOKIE)?.options ?? {};

    expect(options.secure).toBeFalsy();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it('records when the account was last used, for the picker’s ordering', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ALEX }, select: { lastActiveAt: true } });
    expect(before.lastActiveAt).toBeNull();

    await createSession(ALEX);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ALEX }, select: { lastActiveAt: true } });
    expect(after.lastActiveAt).not.toBeNull();
  });
});

describe('resolving the signed-in account', () => {
  it('returns everything the chrome renders, in one read', async () => {
    await createSession(ALEX);

    const user = await getSessionUser();
    expect(user).toEqual({
      id: ALEX,
      name: 'Session Test Alex',
      avatarKey: 'stopwatch',
      accentKey: 'crimson',
      level: 12,
      careerXp: 48_500,
      titleKey: 'Stint Specialist',
    });
  });

  it('returns nobody when there is no cookie at all', async () => {
    expect(await getSessionUser()).toBeNull();
    expect(await getSessionUserId()).toBeNull();
  });

  it('returns nobody for a token that was never issued', async () => {
    // The database file can be replaced — restored from a backup, say — while
    // a browser still holds a cookie from the one before it.
    jar.set(SESSION_COOKIE, { value: 'not-a-real-token', options: {} });

    expect(await getSessionUser()).toBeNull();
    expect(await getSessionUserId()).toBeNull();
  });

  it('returns nobody once the session has expired, and clears the row', async () => {
    const token = await createSession(ALEX);
    await prisma.userSession.update({
      where: { id: token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await getSessionUser()).toBeNull();
    expect(await prisma.userSession.findUnique({ where: { id: token } })).toBeNull();
  });

  it('survives a career profile that has not been created yet', async () => {
    // `createAccount` always makes one, but a database restored mid-upgrade
    // might not have it, and the chrome must still render rather than crash.
    await prisma.careerProfile.deleteMany({ where: { userId: SAM } });
    await createSession(SAM);

    const user = await getSessionUser();
    expect(user?.level).toBe(1);
    expect(user?.careerXp).toBe(0);
    expect(user?.titleKey).toBeNull();
  });
});

describe('requiring an account', () => {
  it('returns the id when somebody is signed in', async () => {
    await createSession(ALEX);
    expect(await requireUserId()).toBe(ALEX);
  });

  it('sends a signed-out visitor to the picker', async () => {
    // Every page in the application calls this first. Getting the picker
    // instead of an empty dashboard is the whole guard.
    await expect(requireUserId()).rejects.toThrow('NEXT_REDIRECT:/accounts');
  });
});

describe('refreshing the last-seen time', () => {
  it('does not turn every page load into a write', async () => {
    const token = await createSession(ALEX);
    const before = await prisma.userSession.findUniqueOrThrow({ where: { id: token } });

    await getSessionUserId();
    await getSessionUserId();

    const after = await prisma.userSession.findUniqueOrThrow({ where: { id: token } });
    expect(after.lastSeenAt.getTime()).toBe(before.lastSeenAt.getTime());
  });

  it('refreshes it once the session has been quiet for an hour', async () => {
    const token = await createSession(ALEX);
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.userSession.update({ where: { id: token }, data: { lastSeenAt: stale } });

    await getSessionUserId();

    const after = await prisma.userSession.findUniqueOrThrow({ where: { id: token } });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });
});

describe('signing out', () => {
  it('deletes the session and the cookie together', async () => {
    const token = await createSession(ALEX);

    await signOut();

    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma.userSession.findUnique({ where: { id: token } })).toBeNull();
    expect(await getSessionUser()).toBeNull();
  });

  it('is happy to be asked twice', async () => {
    await createSession(ALEX);
    await signOut();
    await expect(signOut()).resolves.toBeUndefined();
  });

  it('ends every session this account has on the machine', async () => {
    // Three windows, three sessions. "Sign out everywhere" is what makes the
    // password worth setting after somebody else has used the PC.
    const tokens = [await createSession(ALEX), await createSession(ALEX), await createSession(ALEX)];
    const otherAccount = await createSession(SAM);

    await signOutEverywhere(ALEX);

    expect(await prisma.userSession.count({ where: { userId: ALEX } })).toBe(0);
    for (const token of tokens) {
      expect(await prisma.userSession.findUnique({ where: { id: token } })).toBeNull();
    }
    // Sam was signed in on this machine too, and had nothing to do with it.
    expect(await prisma.userSession.findUnique({ where: { id: otherAccount } })).not.toBeNull();
  });

  it('leaves the current cookie alone when it belonged to someone else', async () => {
    await createSession(ALEX);
    const sam = await createSession(SAM);
    // Sam's session is the one the cookie now points at.
    expect(jar.get(SESSION_COOKIE)?.value).toBe(sam);

    await signOutEverywhere(ALEX);

    expect(jar.get(SESSION_COOKIE)?.value).toBe(sam);
    expect(await getSessionUserId()).toBe(SAM);
  });
});
