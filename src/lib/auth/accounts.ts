/**
 * Accounts — the data layer behind the account screens.
 *
 * Every query the picker, the sign-in prompt and the account settings need
 * lives here, so no component ever writes one. That is the same rule the rest
 * of the application follows for game logic, applied to identity: a screen
 * renders what it is handed and nothing else.
 *
 * Every function takes the account id it operates on. There is no ambient
 * "current user" in this module — that is resolved once, from the session, by
 * whoever calls in.
 */

import { prisma } from '@/lib/db/client';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { ensureCareer } from '@/lib/server/bootstrap';

export const MAX_ACCOUNT_NAME_LENGTH = 32;

/** Why an account operation could not go ahead, in a form the screen can act on. */
export type AccountErrorCode =
  | 'name-missing'
  | 'name-too-long'
  | 'name-taken'
  | 'not-found'
  | 'wrong-password'
  | 'weak-password';

/**
 * A refusal the user is meant to read.
 *
 * `message` is already written in the application's voice, so a screen can
 * show it directly; `code` is there for the cases where a screen wants to put
 * the message beside a particular field instead.
 */
export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

export function isAccountError(error: unknown): error is AccountError {
  return error instanceof AccountError;
}

/** One card in the account picker. */
export interface AccountSummary {
  id: string;
  name: string;
  avatarKey: string;
  accentKey: string;
  hasPassword: boolean;
  level: number;
  careerXp: number;
  titleKey: string | null;
  racesCompleted: number;
  hoursWatched: number;
  lastActiveAt: Date | null;
}

/** What deleting an account would take with it. */
export interface AccountLosses {
  races: number;
  hours: number;
  achievements: number;
}

export interface NewAccountInput {
  name: string;
  avatarKey?: string;
  accentKey?: string;
  /** Optional. An account with no password opens straight from the picker. */
  password?: string | null;
}

export interface AccountCosmetics {
  avatarKey?: string;
  accentKey?: string;
}

export type AuthenticationOutcome = 'ok' | 'wrong-password' | 'not-found';

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  avatarKey: true,
  accentKey: true,
  passwordHash: true,
  lastActiveAt: true,
  careerProfile: { select: { level: true, careerXp: true, titleKey: true } },
} as const;

/**
 * Every account on this machine, most recently played first.
 *
 * Three queries regardless of how many accounts there are: the accounts, then
 * one aggregate each for the two numbers a card shows. Sorting happens here
 * rather than in SQL because "never played" has to fall to the end, and
 * SQLite's null ordering is not something worth relying on for it.
 */
export async function listAccounts(): Promise<AccountSummary[]> {
  const [users, completed, watched] = await Promise.all([
    prisma.user.findMany({ select: ACCOUNT_SELECT }),
    prisma.race.groupBy({
      by: ['userId'],
      // The same definition of "completed" the career metrics use: a story
      // seen through counts, and so does a race the user marked done.
      where: { OR: [{ storyCompletedAt: { not: null } }, { status: 'COMPLETED' }] },
      _count: { _all: true },
    }),
    prisma.raceViewingSession.groupBy({ by: ['userId'], _sum: { realSeconds: true } }),
  ]);

  const completedByUser = new Map(completed.map((row) => [row.userId, row._count._all]));
  const secondsByUser = new Map(watched.map((row) => [row.userId, row._sum.realSeconds ?? 0]));

  return users
    .map((user) => toSummary(user, completedByUser.get(user.id) ?? 0, secondsByUser.get(user.id) ?? 0))
    .sort(
      (a, b) =>
        (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** One account, for the sign-in prompt and the settings page. Null when it is gone. */
export async function getAccount(id: string): Promise<AccountSummary | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: ACCOUNT_SELECT });
  if (user === null) return null;

  const [completed, watched] = await Promise.all([
    prisma.race.count({
      where: { userId: id, OR: [{ storyCompletedAt: { not: null } }, { status: 'COMPLETED' }] },
    }),
    prisma.raceViewingSession.aggregate({ where: { userId: id }, _sum: { realSeconds: true } }),
  ]);

  return toSummary(user, completed, watched._sum.realSeconds ?? 0);
}

/** How many accounts exist. The first-run check, kept to one cheap count. */
export async function countAccounts(): Promise<number> {
  return prisma.user.count();
}

/**
 * Create an account and the career behind it.
 *
 * Returns the new account's id. The caller signs in with it — this module
 * deliberately knows nothing about cookies.
 */
export async function createAccount(input: NewAccountInput): Promise<string> {
  const name = normaliseName(input.name);
  await assertNameIsFree(name);

  const password = typeof input.password === 'string' && input.password !== '' ? input.password : null;
  const record = password === null ? null : hashOrRefuse(password);

  let id: string;
  try {
    const created = await prisma.user.create({
      data: {
        name,
        avatarKey: normaliseKey(input.avatarKey, 'helmet'),
        accentKey: normaliseKey(input.accentKey, 'amber'),
        passwordHash: record?.hash ?? null,
        passwordSalt: record?.salt ?? null,
      },
      select: { id: true },
    });
    id = created.id;
  } catch (error) {
    // The unique index is the real arbiter. Two people creating the same name
    // at the same moment get here rather than a 500.
    if (isUniqueNameViolation(error)) throw nameTaken(name);
    throw error;
  }

  await ensureCareer(id);
  return id;
}

/**
 * Check a password against an account.
 *
 * An account with no password is always 'ok' — the picker opens it directly,
 * and anything supplied is simply ignored. No lockout, no counter, no delay:
 * on a local machine those only ever inconvenience the person they belong to.
 */
export async function authenticateAccount(id: string, password?: string): Promise<AuthenticationOutcome> {
  const account = await prisma.user.findUnique({
    where: { id },
    select: { passwordHash: true, passwordSalt: true },
  });
  if (account === null) return 'not-found';

  const record = passwordRecordOf(account);
  if (record === null) return 'ok';
  if (typeof password !== 'string' || password === '') return 'wrong-password';

  return verifyPassword(password, record) ? 'ok' : 'wrong-password';
}

/** Rename an account. The name is what the picker calls it, so it stays unique. */
export async function renameAccount(id: string, name: string): Promise<void> {
  const normalised = normaliseName(name);
  await assertNameIsFree(normalised, id);

  try {
    await prisma.user.update({ where: { id }, data: { name: normalised } });
  } catch (error) {
    if (isUniqueNameViolation(error)) throw nameTaken(normalised);
    if (isMissingRecord(error)) throw notFound();
    throw error;
  }
}

/**
 * Set or change an account's password.
 *
 * When one is already set, the current one has to be given: otherwise anyone
 * sitting at an unlocked, signed-in machine could lock the owner out of their
 * own career.
 */
export async function setAccountPassword(
  id: string,
  password: string,
  currentPassword?: string,
): Promise<void> {
  await assertCurrentPassword(id, currentPassword);
  const record = hashOrRefuse(password);
  await updateAccount(id, { passwordHash: record.hash, passwordSalt: record.salt });
}

/** Remove an account's password, leaving it openable straight from the picker. */
export async function removeAccountPassword(id: string, currentPassword?: string): Promise<void> {
  await assertCurrentPassword(id, currentPassword);
  // Both halves go together. A hash with no salt could never be verified again.
  await updateAccount(id, { passwordHash: null, passwordSalt: null });
}

/** Change the account card's look. Keys are slugs resolved against config when rendered. */
export async function updateAccountCosmetics(id: string, cosmetics: AccountCosmetics): Promise<void> {
  const data: { avatarKey?: string; accentKey?: string } = {};
  if (cosmetics.avatarKey !== undefined) data.avatarKey = normaliseKey(cosmetics.avatarKey, 'helmet');
  if (cosmetics.accentKey !== undefined) data.accentKey = normaliseKey(cosmetics.accentKey, 'amber');
  if (Object.keys(data).length === 0) return;

  await updateAccount(id, data);
}

/**
 * What deleting this account would take with it.
 *
 * Read this first and put the numbers in the confirmation. "This cannot be
 * undone" is a shrug; "142 races, 318 hours, 47 achievements" is a decision.
 */
export async function describeAccountLosses(id: string): Promise<AccountLosses | null> {
  const account = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (account === null) return null;

  const [races, watched, achievements] = await Promise.all([
    prisma.race.count({ where: { userId: id } }),
    prisma.raceViewingSession.aggregate({ where: { userId: id }, _sum: { realSeconds: true } }),
    prisma.achievementProgress.count({ where: { userId: id, unlockedAt: { not: null } } }),
  ]);

  return {
    races,
    hours: hoursFrom(watched._sum.realSeconds ?? 0),
    achievements,
  };
}

/**
 * Delete an account and everything it owns.
 *
 * Every table hangs off `users` with `ON DELETE CASCADE`, so this one delete
 * takes the races, the sessions, the XP ledger, the trophies and the open
 * sessions with it. Nothing else on the machine is touched.
 */
export async function deleteAccount(id: string): Promise<void> {
  // deleteMany rather than delete: confirming twice is not an error worth
  // showing anyone a stack trace for.
  await prisma.user.deleteMany({ where: { id } });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  name: string;
  avatarKey: string;
  accentKey: string;
  passwordHash: string | null;
  lastActiveAt: Date | null;
  careerProfile: { level: number; careerXp: bigint; titleKey: string | null } | null;
};

function toSummary(user: AccountRow, racesCompleted: number, watchedSeconds: number): AccountSummary {
  return {
    id: user.id,
    name: user.name,
    avatarKey: user.avatarKey,
    accentKey: user.accentKey,
    hasPassword: user.passwordHash !== null,
    level: user.careerProfile?.level ?? 1,
    careerXp: Number(user.careerProfile?.careerXp ?? 0),
    titleKey: user.careerProfile?.titleKey ?? null,
    racesCompleted,
    hoursWatched: hoursFrom(watchedSeconds),
    lastActiveAt: user.lastActiveAt,
  };
}

function hoursFrom(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

function normaliseName(raw: string): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (name === '') throw new AccountError('name-missing', 'Give the account a name to race under.');
  if (name.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new AccountError(
      'name-too-long',
      `Account names can be up to ${MAX_ACCOUNT_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

/**
 * Cosmetic keys are stored as slugs and resolved against configuration when a
 * card is rendered, so a name that does not resolve shows the default rather
 * than an empty square. Anything that is not slug-shaped never reaches the
 * database.
 */
function normaliseKey(raw: string | undefined, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const key = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(key) ? key : fallback;
}

/**
 * Uniqueness, case-insensitively.
 *
 * SQLite can only enforce the exact-match constraint, and "Alex" sitting next
 * to "alex" in the picker would be a puzzle rather than a feature. There are
 * only ever a handful of accounts, so comparing in memory costs nothing.
 */
async function assertNameIsFree(name: string, exceptId?: string): Promise<void> {
  const taken = await prisma.user.findMany({ select: { id: true, name: true } });
  const wanted = name.toLowerCase();
  for (const row of taken) {
    if (row.id === exceptId) continue;
    if (row.name.toLowerCase() === wanted) throw nameTaken(name);
  }
}

async function assertCurrentPassword(id: string, currentPassword?: string): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id },
    select: { passwordHash: true, passwordSalt: true },
  });
  if (account === null) throw notFound();

  const record = passwordRecordOf(account);
  if (record === null) return;
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, record)) {
    throw new AccountError('wrong-password', 'That password didn’t match.');
  }
}

function passwordRecordOf(account: { passwordHash: string | null; passwordSalt: string | null }) {
  if (account.passwordHash === null || account.passwordSalt === null) return null;
  return { hash: account.passwordHash, salt: account.passwordSalt };
}

function hashOrRefuse(password: string) {
  const problem = passwordProblem(password);
  if (problem !== null) throw new AccountError('weak-password', problem);
  return hashPassword(password);
}

async function updateAccount(
  id: string,
  data: { name?: string; avatarKey?: string; accentKey?: string; passwordHash?: string | null; passwordSalt?: string | null },
): Promise<void> {
  try {
    await prisma.user.update({ where: { id }, data });
  } catch (error) {
    if (isMissingRecord(error)) throw notFound();
    throw error;
  }
}

function nameTaken(name: string): AccountError {
  return new AccountError('name-taken', `There is already an account called “${name}” on this PC.`);
}

function notFound(): AccountError {
  return new AccountError('not-found', 'That account is no longer on this PC.');
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** P2002 is a unique-constraint violation; `name` is the only one on this table. */
function isUniqueNameViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

/** P2025: the row an update was aimed at is not there any more. */
function isMissingRecord(error: unknown): boolean {
  return prismaCode(error) === 'P2025';
}
