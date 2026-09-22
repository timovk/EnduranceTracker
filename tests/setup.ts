/**
 * Test environment.
 *
 * Integration tests run against a real SQLite database — progression integrity
 * is exactly the kind of thing an in-memory fake would let through. `.env.test`
 * points at a separate file so a test run can never touch a real viewing
 * history.
 *
 * The database is created and migrated automatically on first run. SQLite
 * makes that possible: there is no server to start and no database to create
 * by hand, so `npm test` works on a fresh clone with no setup at all.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const root = process.cwd();
const testEnv = resolve(root, '.env.test');
config({ path: existsSync(testEnv) ? testEnv : resolve(root, '.env'), quiet: true });

/**
 * Resolve a `file:./x.db` URL to a path.
 *
 * The better-sqlite3 adapter resolves these against the working directory, not
 * against the schema folder, so the database file sits beside package.json.
 */
function databaseFile(url: string | undefined): string | null {
  if (!url?.startsWith('file:')) return null;
  return resolve(root, url.slice('file:'.length));
}

const file = databaseFile(process.env.DATABASE_URL);

/**
 * Whether the database is behind the migrations on disk.
 *
 * Checking only for a missing file is not enough: a database created before
 * the newest migration existed stays behind forever, and what it produces is
 * a "no such column" from deep inside some query rather than anything that
 * points at the schema. Comparing the two lists is a few milliseconds, where
 * shelling out to `migrate deploy` on every test file is a second each.
 */
function needsMigrating(path: string): boolean {
  if (!existsSync(path) || statSync(path).size === 0) return true;

  const onDisk = readdirSync(resolve(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const database = new Database(path, { readonly: true });
  try {
    const applied = new Set(
      (
        database
          .prepare(
            'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL',
          )
          .all() as { migration_name: string }[]
      ).map((row) => row.migration_name),
    );
    return onDisk.some((name) => !applied.has(name));
  } catch {
    // No `_prisma_migrations` table at all, so nothing has ever been applied.
    return true;
  } finally {
    database.close();
  }
}

if (file !== null && needsMigrating(file)) {
  // `npm run`, never `npx`. npx falls back to fetching the registry's
  // `latest` when it cannot resolve a local binary, and prisma's `latest` is
  // currently a release candidate for the NEXT major version with a different
  // command set — which fails with a baffling "unknown command" error. Going
  // through the npm script resolves node_modules/.bin and nothing else.
  execFileSync(NPM, ['run', 'db:deploy'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'ignore',
    // npm is a .cmd on Windows, which execFile cannot launch directly.
    shell: process.platform === 'win32',
  });
}
