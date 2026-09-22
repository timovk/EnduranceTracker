/**
 * The migration runner the installed application carries instead of Prisma.
 *
 * This is the test that stops a broken installer reaching somebody. The
 * packaged app does not ship the Prisma CLI, so on every launch
 * `desktop/src/migrate.ts` is what turns an empty `%APPDATA%` folder into a
 * working career database. If it gets this wrong there is no recovery on the
 * user's side: no console, no `npm run db:deploy`, just a window that will not
 * open on a machine nobody here can reach.
 *
 * So the whole thing is exercised against real files and the real migration
 * SQL: apply it to a fresh database, check every table the schema declares is
 * there, check the bookkeeping matches what Prisma itself would have written,
 * and check that doing it again changes nothing at all.
 *
 * `desktop/**` has no `@` alias — it is a separate program from the web
 * application — so it is imported by relative path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readMigrations, runMigrations } from '../../desktop/src/migrate';

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');

/** Every table the schema declares, taken from the schema so the two cannot drift. */
const EXPECTED_TABLES = [
  ...readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8').matchAll(/@@map\("([a-z_]+)"\)/g),
].map((match) => match[1]!);

let scratch = '';
let counter = 0;

/** A path in a throwaway directory. The file itself is created by the runner. */
function freshDatabase(): string {
  counter += 1;
  return join(scratch, `run-${counter}`, 'endurance.db');
}

function open(file: string) {
  return new Database(file, { readonly: true });
}

function tablesIn(file: string): Set<string> {
  const database = open(file);
  try {
    const rows = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    return new Set(rows.map((row) => row.name));
  } finally {
    database.close();
  }
}

interface MigrationRow {
  id: string;
  checksum: string;
  migration_name: string;
  finished_at: number | null;
  rolled_back_at: number | null;
  started_at: number;
  applied_steps_count: number;
  logs: string | null;
}

function migrationRows(file: string): MigrationRow[] {
  const database = open(file);
  try {
    return database
      .prepare('SELECT * FROM "_prisma_migrations" ORDER BY migration_name')
      .all() as MigrationRow[];
  } finally {
    database.close();
  }
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'endurance-migrate-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('reading the migrations off disk', () => {
  it('finds the repository’s own migrations, oldest first', () => {
    const found = readMigrations(MIGRATIONS);

    expect(found.length).toBeGreaterThanOrEqual(2);
    // Prisma names each directory with a sortable timestamp, so this order is
    // chronological order — and applying them out of order would fail.
    expect([...found].sort((a, b) => a.name.localeCompare(b.name)).map((m) => m.name)).toEqual(
      found.map((m) => m.name),
    );
    expect(found.every((migration) => migration.sql.length > 0)).toBe(true);
    expect(found.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum))).toBe(true);
  });

  it('ignores anything that is not a migration directory', () => {
    // `migration_lock.toml` sits beside them and is not one.
    const names = readMigrations(MIGRATIONS).map((migration) => migration.name);
    expect(names.some((name) => name.endsWith('.toml'))).toBe(false);
  });

  it('says plainly that the installation is incomplete rather than starting anyway', () => {
    // An installer that dropped the migrations resource would otherwise
    // produce an empty database and a crash three screens later.
    expect(() => readMigrations(join(scratch, 'not-here'))).toThrow(/incomplete|No migrations/i);

    const broken = join(scratch, 'broken-migrations', '20260101000000_empty');
    mkdirSync(broken, { recursive: true });
    expect(() => readMigrations(join(scratch, 'broken-migrations'))).toThrow(/migration\.sql/);
  });
});

describe('applying the migrations to a fresh database', () => {
  let file = '';

  beforeAll(() => {
    file = freshDatabase();
  });

  it('creates the database file, and the folder it lives in', () => {
    // On a first launch `%APPDATA%/Endurance Racing Career/data` does not
    // exist yet. Nothing else creates it before this runs.
    const report = runMigrations(file, MIGRATIONS);

    expect(existsSync(file)).toBe(true);
    expect(report.databaseFile).toBe(file);
    expect(report.applied.map((migration) => migration.name)).toEqual(
      readMigrations(MIGRATIONS).map((migration) => migration.name),
    );
    expect(report.alreadyApplied).toEqual([]);
    expect(report.checksumMismatches).toEqual([]);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('creates every table the schema declares', () => {
    const tables = tablesIn(file);
    expect(EXPECTED_TABLES.length).toBe(28);

    const missing = EXPECTED_TABLES.filter((table) => !tables.has(table));
    expect(missing, 'tables the runtime migrator did not create').toEqual([]);
  });

  it('records each migration exactly as Prisma records it', () => {
    const rows = migrationRows(file);
    const onDisk = readMigrations(MIGRATIONS);
    expect(rows.length).toBe(onDisk.length);

    for (const row of rows) {
      const migration = onDisk.find((candidate) => candidate.name === row.migration_name);
      expect(migration, `${row.migration_name} is recorded but not on disk`).toBeDefined();

      // The checksum is what a later `prisma migrate` compares against. Wrong,
      // and the CLI reports the migration as modified and refuses to go on.
      expect(row.checksum).toBe(migration!.checksum);
      expect(row.checksum).toBe(createHash('sha256').update(migration!.sql, 'utf8').digest('hex'));
      expect(row.applied_steps_count).toBe(1);
      expect(row.rolled_back_at).toBeNull();
      expect(row.logs).toBeNull();
      expect(row.finished_at).not.toBeNull();
      expect(row.finished_at!).toBeGreaterThanOrEqual(row.started_at);
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('agrees with the checksums the Prisma CLI actually wrote', ({ skip }) => {
    // The test database is migrated by `prisma migrate deploy` (tests/setup.ts),
    // so it holds the CLI's own bookkeeping for the same migration files. That
    // makes it the one oracle available here for "do we compute the checksum
    // the same way Prisma does" — the question the comment in migrate.ts
    // claims to have answered by reading a real database.
    const url = process.env.DATABASE_URL;
    if (url === undefined || !url.startsWith('file:')) skip();
    const prismaFile = resolve(ROOT, url!.slice('file:'.length));
    if (!existsSync(prismaFile)) skip();

    const theirs = new Map(migrationRows(prismaFile).map((row) => [row.migration_name, row.checksum]));
    const ours = migrationRows(file);
    const comparable = ours.filter((row) => theirs.has(row.migration_name));

    expect(comparable.length).toBeGreaterThan(0);
    for (const row of comparable) {
      expect(row.checksum, `${row.migration_name} checksum disagrees with the Prisma CLI`).toBe(
        theirs.get(row.migration_name),
      );
    }
  });

  it('leaves the file in WAL mode', () => {
    // WAL is what lets the backup read the database while the server writes to
    // it. It is a property of the file, so it only has to be set once.
    const database = new Database(file);
    try {
      expect(String(database.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    } finally {
      database.close();
    }
  });

  it('produces a database the application’s own cascades work in', () => {
    // Foreign keys are off by default in SQLite, and every "delete my account"
    // in the application is a single delete that relies on the cascades being
    // real. This checks the migration SQL declared them, not just that the
    // connection had them switched on.
    const database = new Database(file);
    try {
      database.pragma('foreign_keys = ON');
      database
        .prepare(
          'INSERT INTO "users" ("id", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)',
        )
        .run('cascade-test', 'Cascade Test', Date.now(), Date.now());
      database
        .prepare(
          'INSERT INTO "user_sessions" ("id", "userId", "createdAt", "expiresAt", "lastSeenAt") VALUES (?, ?, ?, ?, ?)',
        )
        .run('session-token', 'cascade-test', Date.now(), Date.now() + 1000, Date.now());

      database.prepare('DELETE FROM "users" WHERE "id" = ?').run('cascade-test');

      const left = database
        .prepare('SELECT COUNT(*) AS count FROM "user_sessions"')
        .get() as { count: number };
      expect(left.count).toBe(0);
    } finally {
      database.close();
    }
  });
});

describe('applying them again', () => {
  it('is a genuine no-op, not merely a harmless one', () => {
    // Every launch runs this. If a second run rewrote anything, the first
    // thing it would rewrite is the user's career.
    const file = freshDatabase();
    runMigrations(file, MIGRATIONS);

    const database = new Database(file);
    database.prepare('INSERT INTO "users" ("id", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)')
      .run('keep-me', 'Keep Me', Date.now(), Date.now());
    database.close();

    const before = migrationRows(file);
    const report = runMigrations(file, MIGRATIONS);
    const after = migrationRows(file);

    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied).toEqual(before.map((row) => row.migration_name));
    expect(report.checksumMismatches).toEqual([]);
    // Same rows, same ids, same timestamps: nothing was re-applied and
    // nothing was re-recorded.
    expect(after).toEqual(before);

    const survivor = open(file);
    try {
      const row = survivor.prepare('SELECT "name" FROM "users" WHERE "id" = ?').get('keep-me') as
        | { name: string }
        | undefined;
      expect(row?.name).toBe('Keep Me');
    } finally {
      survivor.close();
    }
  });

  it('applies only what is new when a migration is added later', () => {
    // The upgrade path: an installed copy already has the init migration and
    // meets a build carrying one more.
    const file = freshDatabase();
    const all = readMigrations(MIGRATIONS);
    const firstOnly = join(scratch, `first-only-${counter}`);
    mkdirSync(join(firstOnly, all[0]!.name), { recursive: true });
    writeFileSync(join(firstOnly, all[0]!.name, 'migration.sql'), all[0]!.sql, 'utf8');

    const first = runMigrations(file, firstOnly);
    expect(first.applied.map((migration) => migration.name)).toEqual([all[0]!.name]);

    const second = runMigrations(file, MIGRATIONS);
    expect(second.applied.map((migration) => migration.name)).toEqual(
      all.slice(1).map((migration) => migration.name),
    );
    expect(second.alreadyApplied).toEqual([all[0]!.name]);
    expect([...tablesIn(file)]).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });
});

describe('a migration that rebuilds a table', () => {
  /**
   * The regression test for a way to lose an entire career in one launch.
   *
   * Prisma emits a "RedefineTables" migration for almost any column change on
   * SQLite: build `new_parent`, copy the rows, `DROP TABLE parent`, rename.
   * With foreign keys enforced, that DROP fires `ON DELETE CASCADE` down every
   * child table — so the upgrade that was meant to add a column silently takes
   * the races, the stints and the XP with it. The migration opens with
   * `PRAGMA foreign_keys=OFF`, but a pragma is a no-op inside a transaction
   * and the runner applies each migration in one, so the SQL cannot save
   * itself. The runner has to turn them off around the whole operation.
   *
   * The shape below is the shape Prisma writes, and the assertion is simply
   * that the child row is still there afterwards.
   */
  it('keeps the rows in every child table', () => {
    const file = freshDatabase();
    mkdirSync(join(file, '..'), { recursive: true });

    const seeded = new Database(file);
    seeded.exec(`
      CREATE TABLE "parents" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL);
      CREATE TABLE "children" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "parentId" TEXT NOT NULL,
        CONSTRAINT "children_parentId_fkey" FOREIGN KEY ("parentId")
          REFERENCES "parents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      INSERT INTO "parents" ("id", "name") VALUES ('p1', 'Driver');
      INSERT INTO "children" ("id", "parentId") VALUES ('c1', 'p1');
    `);
    seeded.close();

    const redefine = join(scratch, `redefine-${counter}`);
    mkdirSync(join(redefine, '20260101000000_redefine'), { recursive: true });
    writeFileSync(
      join(redefine, '20260101000000_redefine', 'migration.sql'),
      `-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_parents" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "avatarKey" TEXT NOT NULL DEFAULT 'helmet'
);
INSERT INTO "new_parents" ("id", "name") SELECT "id", "name" FROM "parents";
DROP TABLE "parents";
ALTER TABLE "new_parents" RENAME TO "parents";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`,
      'utf8',
    );

    runMigrations(file, redefine);

    const after = new Database(file, { readonly: true });
    const children = (after.prepare('SELECT COUNT(*) AS n FROM "children"').get() as { n: number }).n;
    const parents = (after.prepare('SELECT COUNT(*) AS n FROM "parents"').get() as { n: number }).n;
    // And the runner must hand the database back with them enforced again.
    const violations = after.pragma('foreign_key_check') as unknown[];
    after.close();

    expect(parents).toBe(1);
    expect(children).toBe(1);
    expect(violations).toEqual([]);
  });
});

describe('when the database and the shipped migrations disagree', () => {
  it('reports a changed migration instead of re-running it', () => {
    // Not fatal — refusing to open somebody's career at this point would help
    // nobody — but the log has to say so before the symptoms start.
    const file = freshDatabase();
    const report = runMigrations(file, MIGRATIONS);
    const [first] = report.applied;

    const database = new Database(file);
    database
      .prepare('UPDATE "_prisma_migrations" SET "checksum" = ? WHERE "migration_name" = ?')
      .run('0'.repeat(64), first!.name);
    database.close();

    const again = runMigrations(file, MIGRATIONS);
    expect(again.checksumMismatches).toEqual([first!.name]);
    expect(again.applied).toEqual([]);
  });

  it('refuses to guess when a migration was started and never finished', () => {
    // Only the Prisma CLI can leave this behind; this runner never records a
    // migration it did not complete. Applying half of one twice would be far
    // worse than saying what is wrong.
    const file = freshDatabase();
    const [first] = readMigrations(MIGRATIONS);

    mkdirSync(join(file, '..'), { recursive: true });
    const database = new Database(file);
    database.exec(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
        "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
      )`);
    database
      .prepare(
        'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at") VALUES (?, ?, ?, ?)',
      )
      .run('half-done', first!.checksum, first!.name, Date.now());
    database.close();

    expect(() => runMigrations(file, MIGRATIONS)).toThrow(/never finished|Prisma CLI/i);
  });
});
