/**
 * Local password hashing.
 *
 * This is the one piece of the accounts work with no database, no session and
 * no UI behind it, which makes it the piece worth testing hardest: every
 * account on the machine is only as private as this file is correct.
 *
 * Two properties matter more than the rest. A record must never verify a
 * password that did not produce it, and a record that has been corrupted —
 * truncated, hand-edited, half-written — must read as "that didn't match"
 * rather than taking down the sign-in screen with it.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from '@/lib/auth/password';

/** scrypt at N=2^15 is deliberately slow, so hash once and reuse. */
const PASSWORD = 'le-mans-1991';
const RECORD = hashPassword(PASSWORD);

describe('hashing a password', () => {
  it('verifies the password it was made from', () => {
    expect(verifyPassword(PASSWORD, RECORD)).toBe(true);
  });

  it('writes a 64-byte key and a 16-byte salt, as hex', () => {
    // The lengths are load-bearing: `verifyPassword` uses them to reject a
    // malformed record before `timingSafeEqual`, which throws on a mismatch.
    expect(RECORD.hash).toMatch(/^[0-9a-f]{128}$/);
    expect(RECORD.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never produces the same record twice for the same password', () => {
    // A fresh salt per password is what stops two accounts that chose the
    // same password being visibly the same in the database file.
    const again = hashPassword(PASSWORD);
    expect(again.salt).not.toBe(RECORD.salt);
    expect(again.hash).not.toBe(RECORD.hash);
    expect(verifyPassword(PASSWORD, again)).toBe(true);
  });

  it('treats the same characters typed two ways as the same password', () => {
    // "café" composed vs decomposed is the same word to the person typing it,
    // and some keyboards and password managers disagree about which they send.
    const composed = 'café-racer';
    const decomposed = 'café-racer';
    expect(composed).not.toBe(decomposed);
    expect(verifyPassword(decomposed, hashPassword(composed))).toBe(true);
  });
});

describe('checking a password', () => {
  it('refuses a password that is merely close', () => {
    expect(verifyPassword('le-mans-1992', RECORD)).toBe(false);
    expect(verifyPassword('le-mans-199', RECORD)).toBe(false);
    expect(verifyPassword('LE-MANS-1991', RECORD)).toBe(false);
    expect(verifyPassword('', RECORD)).toBe(false);
  });

  it('refuses another account’s record', () => {
    expect(verifyPassword(PASSWORD, hashPassword('spa-francorchamps'))).toBe(false);
  });

  it('reads a corrupted record as a mismatch rather than throwing', () => {
    // Anything here should leave the account reachable by every other route —
    // clearing the password from settings, for one — instead of turning the
    // sign-in page into a stack trace.
    const broken = [
      { hash: RECORD.hash, salt: '' },
      { hash: '', salt: RECORD.salt },
      { hash: RECORD.hash.slice(0, 126), salt: RECORD.salt },
      { hash: RECORD.hash, salt: RECORD.salt.slice(0, 30) },
      { hash: `${RECORD.hash}ff`, salt: RECORD.salt },
      { hash: RECORD.hash.replace(/^../, 'zz'), salt: RECORD.salt },
      { hash: RECORD.hash, salt: RECORD.salt.replace(/^../, 'zz') },
      // A record where only one half was written. The schema allows it, so
      // the code has to cope with it.
      { hash: RECORD.hash, salt: null as unknown as string },
      { hash: null as unknown as string, salt: RECORD.salt },
      { hash: undefined as unknown as string, salt: undefined as unknown as string },
    ];

    for (const record of broken) {
      expect(() => verifyPassword(PASSWORD, record)).not.toThrow();
      expect(verifyPassword(PASSWORD, record)).toBe(false);
    }
  });

  it('refuses an absurdly long attempt without hashing it', () => {
    // Bounded before scrypt sees it: a megabyte of input should cost a
    // comparison, not a megabyte of key derivation.
    expect(verifyPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), RECORD)).toBe(false);
  });
});

describe('what counts as a usable password', () => {
  it('accepts anything from the minimum length upwards', () => {
    expect(passwordProblem('x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordProblem('x'.repeat(MAX_PASSWORD_LENGTH))).toBeNull();
    // No complexity rule, deliberately. There is nobody to defend against by
    // demanding a symbol, and the rule would only ever annoy the one person
    // it belongs to.
    expect(passwordProblem('aaaa')).toBeNull();
    expect(passwordProblem('a pass phrase with spaces in it')).toBeNull();
  });

  it('explains, in the application’s voice, why one cannot be used', () => {
    for (const unusable of ['', '   ', 'abc', 'x'.repeat(MAX_PASSWORD_LENGTH + 1)]) {
      const problem = passwordProblem(unusable);
      expect(problem, JSON.stringify(unusable)).not.toBeNull();
      // Written to be shown, so it ends as a sentence does.
      expect(problem).toMatch(/\.$/);
    }
  });

  it('refuses to hash a password it would not accept', () => {
    expect(() => hashPassword('abc')).toThrow();
    expect(() => hashPassword('   ')).toThrow();
    expect(() => hashPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toThrow();
  });
});
