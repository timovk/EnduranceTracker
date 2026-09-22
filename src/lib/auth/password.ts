/**
 * Local password hashing.
 *
 * Deliberately small and deliberately honest about what it is for. This
 * application runs on one machine with the database sitting in a file the
 * account holder owns; a password here keeps a housemate out of someone's
 * career, it does not defend the file against anyone holding the disk. So
 * there is no pepper, no key-management ceremony and no pretence of either.
 *
 * What it does do properly: scrypt with parameters that cost real time, a
 * fresh salt per password, and a constant-time comparison — because the one
 * thing that would be unforgivable is a weak hash of a password the user
 * reuses elsewhere.
 *
 * Pure. No database, no configuration, no I/O. Everything here is unit-tested.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** A stored password. Both halves travel together, or neither is written. */
export interface PasswordRecord {
  hash: string;
  salt: string;
}

/**
 * scrypt work factors.
 *
 * N = 2^15 costs roughly a tenth of a second here, which is imperceptible on
 * the one sign-in a session and expensive at scale. `maxmem` has to be raised
 * explicitly: scrypt needs about 128 * N * r bytes (32 MB at these settings)
 * and Node's default ceiling is exactly 32 MB, so the call throws without it.
 */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Why this password cannot be used, or null when it can.
 *
 * There is no complexity rule on purpose. A local application has nobody to
 * defend against by demanding a symbol, and a rule that annoys the one person
 * it belongs to buys nothing at all.
 */
export function passwordProblem(plain: string): string | null {
  if (typeof plain !== 'string' || plain.trim() === '') {
    return 'Give your password at least one character that is not a space.';
  }
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    return `Passwords can be up to ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Hash a password for storage. Throws when the password is unusable. */
export function hashPassword(plain: string): PasswordRecord {
  const problem = passwordProblem(plain);
  if (problem !== null) throw new Error(problem);

  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain.normalize('NFKC'), salt, KEY_BYTES, SCRYPT);
  return { hash: derived.toString('hex'), salt: salt.toString('hex') };
}

/**
 * Check a password against a stored record.
 *
 * Returns false for anything malformed rather than throwing. A corrupted row
 * should read as "that did not match" and leave the account reachable by every
 * other route; it should never take down the page that asked.
 */
export function verifyPassword(plain: string, record: PasswordRecord): boolean {
  if (typeof plain !== 'string' || plain.length > MAX_PASSWORD_LENGTH) return false;

  const salt = decodeHex(record?.salt, SALT_BYTES);
  const expected = decodeHex(record?.hash, KEY_BYTES);
  if (salt === null || expected === null) return false;

  try {
    const derived = scryptSync(plain.normalize('NFKC'), salt, KEY_BYTES, SCRYPT);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Hex of an exact byte length, or null. Guards `timingSafeEqual`, which throws on a length mismatch. */
function decodeHex(value: unknown, bytes: number): Buffer | null {
  if (typeof value !== 'string' || value.length !== bytes * 2) return null;
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  const buffer = Buffer.from(value, 'hex');
  return buffer.length === bytes ? buffer : null;
}
