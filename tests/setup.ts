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
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

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

// A missing or empty file means the schema has never been applied. Applying it
// is cheap and idempotent, so there is no reason to make the user do it.
if (file !== null && (!existsSync(file) || statSync(file).size === 0)) {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'ignore',
  });
}
