/**
 * Accounts — creating them, naming them, locking them, deleting them.
 *
 * These run against the real database because almost every rule here is a
 * database rule: the name is unique, the career profile has to exist by the
 * time the account is usable, and deleting an account has to take precisely
 * what it owns and nothing else.
 *
 * Passwords cost real time on purpose (scrypt at N=2^15), so this file sets
 * one only where the test is actually about the password.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  authenticateAccount,
  countAccounts,
  createAccount,
  deleteAccount,
  describeAccountLosses,
  getAccount,
  isAccountError,
  listAccounts,
  removeAccountPassword,
  renameAccount,
  setAccountPassword,
  updateAccountCosmetics,
} from '@/lib/auth/accounts';

/**
 * Every account this file makes is named with this prefix, so the assertions
 * can ignore anything else that happens to be in the database.
 */
const PREFIX = 'AcctTest';
const name = (suffix: string) => `${PREFIX} ${suffix}`;

async function wipe(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

/** Only the accounts this file owns, in the order the picker would show them. */
async function ours() {
  const all = await listAccounts();
  return all.filter((account) => account.name.startsWith(PREFIX));
}

beforeEach(async () => {
  await wipe();
});

afterAll(async () => {
  await wipe();
  await disconnectDb();
});

describe('creating an account', () => {
  it('gives it a career the moment it exists', async () => {
    // An account with no career profile would be a dashboard that throws on
    // first open, which is the worst possible first impression.
    const id = await createAccount({ name: name('Alex') });

    const profile = await prisma.careerProfile.findUnique({ where: { userId: id } });
    expect(profile).not.toBeNull();
    expect(profile?.level).toBe(1);
  });

  it('tidies the name rather than refusing it', async () => {
    const id = await createAccount({ name: `  ${PREFIX}   Jo  ` });
    const account = await getAccount(id);
    expect(account?.name).toBe(`${PREFIX} Jo`);
  });

  it('refuses a name that is only spaces, and says what to do', async () => {
    await expect(createAccount({ name: '   ' })).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'name-missing',
    );
  });

  it('refuses a name longer than a card can show', async () => {
    await expect(createAccount({ name: 'x'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1) })).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'name-too-long',
    );
  });

  it('refuses a name already on this PC, whatever the capitals', async () => {
    // "Alex" beside "alex" in the picker is a puzzle, not a feature. SQLite
    // cannot express the case-insensitive constraint, so the app layer does.
    await createAccount({ name: name('Alex') });

    await expect(createAccount({ name: name('Alex') })).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'name-taken',
    );
    await expect(createAccount({ name: name('Alex').toUpperCase() })).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'name-taken',
    );
  });

  it('falls back to the default look rather than storing nonsense', async () => {
    // Cosmetic keys are resolved against configuration when a card renders, so
    // anything that is not slug-shaped would render as an empty square.
    const id = await createAccount({ name: name('Nonsense'), avatarKey: '../../etc', accentKey: '' });
    const account = await getAccount(id);

    expect(account?.avatarKey).toBe('helmet');
    expect(account?.accentKey).toBe('amber');
  });

  it('counts towards the first-run check', async () => {
    const before = await countAccounts();
    await createAccount({ name: name('Counted') });
    expect(await countAccounts()).toBe(before + 1);
  });
});

describe('opening an account', () => {
  it('opens straight from the picker when no password is set', async () => {
    const id = await createAccount({ name: name('Open') });

    expect(await authenticateAccount(id)).toBe('ok');
    // Anything typed is simply ignored rather than treated as wrong.
    expect(await authenticateAccount(id, 'whatever')).toBe('ok');
  });

  it('checks the password when one is set', async () => {
    const id = await createAccount({ name: name('Locked'), password: 'sebring-12' });

    expect(await authenticateAccount(id, 'sebring-12')).toBe('ok');
    expect(await authenticateAccount(id, 'sebring-13')).toBe('wrong-password');
    expect(await authenticateAccount(id)).toBe('wrong-password');
  });

  it('reports an account that is no longer on this PC', async () => {
    expect(await authenticateAccount('00000000-0000-4000-8000-00000000dead')).toBe('not-found');
    expect(await getAccount('00000000-0000-4000-8000-00000000dead')).toBeNull();
  });
});

describe('changing an account', () => {
  it('renames it', async () => {
    const id = await createAccount({ name: name('Before') });
    await renameAccount(id, name('After'));
    expect((await getAccount(id))?.name).toBe(name('After'));
  });

  it('lets an account re-capitalise its own name', async () => {
    // The uniqueness check has to exclude the account doing the renaming, or
    // "alex" could never become "Alex".
    const id = await createAccount({ name: name('alex') });
    await renameAccount(id, name('ALEX'));
    expect((await getAccount(id))?.name).toBe(name('ALEX'));
  });

  it('refuses a rename onto another account’s name', async () => {
    await createAccount({ name: name('Taken') });
    const id = await createAccount({ name: name('Mover') });

    await expect(renameAccount(id, name('taken'))).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'name-taken',
    );
    expect((await getAccount(id))?.name).toBe(name('Mover'));
  });

  it('changes the card’s look', async () => {
    const id = await createAccount({ name: name('Cosmetic') });
    await updateAccountCosmetics(id, { avatarKey: 'chequered', accentKey: 'teal' });

    const account = await getAccount(id);
    expect(account?.avatarKey).toBe('chequered');
    expect(account?.accentKey).toBe('teal');
  });
});

describe('the password on an account', () => {
  it('can be set on an account that had none', async () => {
    const id = await createAccount({ name: name('Setter') });
    expect((await getAccount(id))?.hasPassword).toBe(false);

    await setAccountPassword(id, 'nordschleife');

    expect((await getAccount(id))?.hasPassword).toBe(true);
    expect(await authenticateAccount(id, 'nordschleife')).toBe('ok');
  });

  it('needs the current one before it can be changed', async () => {
    // Otherwise anyone sitting at an unlocked, signed-in machine could lock
    // the owner out of their own career.
    const id = await createAccount({ name: name('Changer'), password: 'first-pass' });

    await expect(setAccountPassword(id, 'second-pass', 'wrong-pass')).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'wrong-password',
    );
    expect(await authenticateAccount(id, 'first-pass')).toBe('ok');

    await setAccountPassword(id, 'second-pass', 'first-pass');
    expect(await authenticateAccount(id, 'second-pass')).toBe('ok');
  });

  it('can be removed, leaving both halves null together', async () => {
    const id = await createAccount({ name: name('Remover'), password: 'monza-1000' });

    await expect(removeAccountPassword(id, 'not-it')).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'wrong-password',
    );

    await removeAccountPassword(id, 'monza-1000');

    // A hash with no salt could never be verified again, so they go together.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { passwordHash: true, passwordSalt: true },
    });
    expect(row.passwordHash).toBeNull();
    expect(row.passwordSalt).toBeNull();
    expect(await authenticateAccount(id)).toBe('ok');
  });

  it('refuses a password it could not accept later', async () => {
    const id = await createAccount({ name: name('Weak') });
    await expect(setAccountPassword(id, 'abc')).rejects.toSatisfy(
      (error: unknown) => isAccountError(error) && error.code === 'weak-password',
    );
    expect((await getAccount(id))?.hasPassword).toBe(false);
  });
});

describe('the picker’s ordering', () => {
  it('puts the account you used last at the front, and the unplayed at the back', async () => {
    const played = await createAccount({ name: name('Played') });
    const older = await createAccount({ name: name('Older') });
    await createAccount({ name: name('Zed Never') });
    await createAccount({ name: name('Abe Never') });

    await prisma.user.update({ where: { id: played }, data: { lastActiveAt: new Date() } });
    await prisma.user.update({
      where: { id: older },
      data: { lastActiveAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    const listed = await ours();
    expect(listed.map((account) => account.name)).toEqual([
      name('Played'),
      name('Older'),
      // Never played falls to the end, alphabetically among themselves.
      name('Abe Never'),
      name('Zed Never'),
    ]);
  });
});

describe('deleting an account', () => {
  /** A race with one logged stint, written directly: this is about the delete, not the engine. */
  async function giveCareerHistory(userId: string): Promise<void> {
    const race = await prisma.race.create({
      data: {
        userId,
        name: 'Test Race',
        scheduledDurationSec: 6 * 3600,
        runtimeSec: 6 * 3600,
        raceType: 'H6',
        status: 'COMPLETED',
      },
      select: { id: true },
    });
    await prisma.raceViewingSession.create({
      data: {
        userId,
        raceId: race.id,
        startTimestampSec: 0,
        endTimestampSec: 2 * 3600,
        playbackSpeed: 1,
        timelineSeconds: 2 * 3600,
        realSeconds: 2 * 3600,
        newCoverageSeconds: 2 * 3600,
        coverageBeforeSec: 0,
        coverageAfterSec: 2 * 3600,
        watchedAt: new Date(),
      },
    });
    await prisma.xPTransaction.create({
      data: { userId, source: 'VIEWING', amount: 1200, description: 'Test stint' },
    });
  }

  it('says exactly what would be lost before it happens', async () => {
    // "This cannot be undone" is a shrug. Numbers are a decision.
    const id = await createAccount({ name: name('Losses') });
    await giveCareerHistory(id);

    const losses = await describeAccountLosses(id);
    expect(losses).toEqual({ races: 1, hours: 2, achievements: 0 });
  });

  it('takes everything it owns with it', async () => {
    const id = await createAccount({ name: name('Doomed') });
    await giveCareerHistory(id);

    await deleteAccount(id);

    expect(await getAccount(id)).toBeNull();
    expect(await prisma.race.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.raceViewingSession.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.careerProfile.count({ where: { userId: id } })).toBe(0);
  });

  it('leaves every other account on the machine untouched', async () => {
    const doomed = await createAccount({ name: name('Doomed Two') });
    const keeper = await createAccount({ name: name('Keeper') });
    await giveCareerHistory(doomed);
    await giveCareerHistory(keeper);

    await deleteAccount(doomed);

    expect(await prisma.race.count({ where: { userId: keeper } })).toBe(1);
    expect(await prisma.raceViewingSession.count({ where: { userId: keeper } })).toBe(1);
    expect(await prisma.xPTransaction.count({ where: { userId: keeper } })).toBe(1);
    expect((await getAccount(keeper))?.name).toBe(name('Keeper'));
  });

  it('is happy to be asked twice', async () => {
    const id = await createAccount({ name: name('Twice') });
    await deleteAccount(id);
    await expect(deleteAccount(id)).resolves.toBeUndefined();
  });

  it('frees the name for somebody else', async () => {
    const id = await createAccount({ name: name('Recycled') });
    await deleteAccount(id);
    await expect(createAccount({ name: name('Recycled') })).resolves.toEqual(expect.any(String));
  });
});
