import 'server-only';

/**
 * Sign-in sessions.
 *
 * The cookie carries nothing but an opaque row id. Everything a session means
 * lives in the database, which is what makes signing out a delete and "sign
 * out everywhere" a deleteMany — there is no signed blob out in the world that
 * keeps being valid after we have stopped believing in it.
 *
 * The threat model is a shared PC, not the internet. The application is served
 * over plain HTTP on 127.0.0.1, so the cookie is deliberately NOT marked
 * `secure`: a secure cookie is never sent back over http://, and sign-in would
 * fail in a way that looks like the password being wrong.
 */

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/client';
import { SESSION_COOKIE } from '@/lib/auth/cookie';

export { SESSION_COOKIE } from '@/lib/auth/cookie';

/** Thirty days. Long, because being asked to sign in to your own PC is a chore. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

/** `lastSeenAt` is an ordering hint, not an audit log, so an hour of slack is free. */
const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;

/** How often one process bothers to clear out sessions that have already expired. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Everything the chrome needs to render the signed-in account, in one read. */
export interface SessionUser {
  id: string;
  name: string;
  avatarKey: string;
  accentKey: string;
  level: number;
  careerXp: number;
  titleKey: string | null;
}

const SESSION_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  lastSeenAt: true,
  user: {
    select: {
      id: true,
      name: true,
      avatarKey: true,
      accentKey: true,
      careerProfile: { select: { level: true, careerXp: true, titleKey: true } },
    },
  },
} as const;

/**
 * Start a session for an account and hand the browser its cookie.
 *
 * Must be called from a server action or a route handler: Next cannot attach a
 * `Set-Cookie` header to a response whose body has already started streaming,
 * so calling this while rendering a page throws.
 */
export async function createSession(userId: string): Promise<string> {
  const now = new Date();
  // 32 bytes from the CSPRNG is the whole secret. It is the row id as well as
  // the cookie value, so there is exactly one thing to look up and nothing to
  // keep in step.
  const token = randomBytes(32).toString('base64url');

  await prisma.userSession.create({
    data: { id: token, userId, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastSeenAt: now },
  });

  // Signing in is the moment that decides the order of the account picker.
  await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: now } });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return token;
}

/** The signed-in account, or null when there is no usable session. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await resolveSession();
  if (session === null) return null;

  const { user } = session;
  const profile = user.careerProfile;
  return {
    id: user.id,
    name: user.name,
    avatarKey: user.avatarKey,
    accentKey: user.accentKey,
    level: profile?.level ?? 1,
    careerXp: Number(profile?.careerXp ?? 0),
    titleKey: profile?.titleKey ?? null,
  };
}

/** The signed-in account's id, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await resolveSession();
  return session?.userId ?? null;
}

/**
 * The signed-in account's id, or a redirect to the picker.
 *
 * This is what every page and every server action resolves first. An id is
 * never accepted from the client, so a page can only ever read and write the
 * rows belonging to whoever is actually signed in.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (userId === null) redirect('/accounts');
  return userId;
}

/** End this session on this machine. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  // deleteMany, not delete: a cookie for a session that is already gone is an
  // ordinary thing to hold, not an error.
  if (token !== undefined) await prisma.userSession.deleteMany({ where: { id: token } });
  store.delete(SESSION_COOKIE);
}

/** End every session belonging to an account, on this machine. */
export async function signOutEverywhere(userId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const current =
    token === null
      ? null
      : await prisma.userSession.findUnique({ where: { id: token }, select: { userId: true } });

  await prisma.userSession.deleteMany({ where: { userId } });

  // Only drop the cookie if it was this account's. Someone signing another
  // account out of everything should not be signed out themselves.
  if (current?.userId === userId) store.delete(SESSION_COOKIE);
}

/**
 * Validate the cookie and return the live session row.
 *
 * Never writes a cookie, because this runs during page rendering where Next
 * cannot set one.
 */
async function resolveSession(now: Date = new Date()) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  await sweepExpiredSessions(now);

  const session = await prisma.userSession.findUnique({ where: { id: token }, select: SESSION_SELECT });
  if (session === null) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.userSession.deleteMany({ where: { id: session.id } });
    return null;
  }

  // Refreshing on every page load would turn a read into a write for no gain.
  //
  // `lastActiveAt` rides along on the same throttle. Writing it only at
  // sign-in would be nearly useless: sessions last thirty days, so somebody
  // who opens the application every morning would still be told on the picker
  // that they last raced three weeks ago.
  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS) {
    await prisma.$transaction([
      prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }),
      prisma.user.update({ where: { id: session.userId }, data: { lastActiveAt: now } }),
    ]);
  }

  return session;
}

/** Wall-clock of the last sweep in this process. Per-process is the right grain: it is housekeeping. */
let lastSweepAt = 0;

async function sweepExpiredSessions(now: Date): Promise<void> {
  if (now.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
  // Claimed before the await so concurrent requests do not all sweep at once.
  lastSweepAt = now.getTime();
  await prisma.userSession.deleteMany({ where: { expiresAt: { lt: now } } });
}
