/**
 * The 0.3.2 fixture database, copied for a test to work on.
 *
 * `tests/fixtures/career-0.3.2.db` was written by the real 0.3.2 code (see
 * `tests/fixtures/README.md`), and it is never opened for writing: every test
 * works on its own copy in a temporary directory.
 *
 * `pointPrismaAtFixture` also points `DATABASE_URL` at the copy, for tests that
 * go through Prisma. That only works before the first query of the test file:
 * the client is created lazily, on first use (`src/lib/db/client.ts`), and
 * every test file runs in its own process, so setting the variable in
 * `beforeAll` is early enough — and it refuses loudly if a client already
 * exists, rather than quietly testing the wrong database.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_DATABASE = resolve(process.cwd(), 'tests', 'fixtures', 'career-0.3.2.db');

/** When the fixture was generated: the `now` for tests that reason about its dates. */
export const FIXTURE_GENERATED_AT = new Date('2026-09-24T16:41:05.000Z');

/** The demonstration account the fixture holds. */
export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000001';

export interface FixtureCopy {
  /** Absolute path of the copy. */
  file: string;
  /** Remove the copy (and put `DATABASE_URL` back, if it was changed). */
  cleanup: () => void;
}

/** A private copy of the fixture, in a directory of its own. */
export function copyFixtureDatabase(): FixtureCopy {
  const directory = mkdtempSync(join(tmpdir(), 'endurance-fixture-'));
  const file = join(directory, 'career-0.3.2.db');
  copyFileSync(FIXTURE_DATABASE, file);
  return { file, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/** A copy of the fixture, with `DATABASE_URL` pointing at it until `cleanup`. */
export function pointPrismaAtFixture(): FixtureCopy {
  if ((globalThis as { prisma?: unknown }).prisma !== undefined) {
    throw new Error('The Prisma client already exists; point DATABASE_URL at the fixture before the first query.');
  }
  const copy = copyFixtureDatabase();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${copy.file}`;
  return {
    file: copy.file,
    cleanup: () => {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      copy.cleanup();
    },
  };
}
