/**
 * Applying `prisma/migrations` to the user's database, without the Prisma CLI.
 *
 * The CLI is tens of megabytes and a platform-specific schema engine, none of
 * which an installed game needs. What it actually does to a SQLite file on
 * `migrate deploy` is small enough to do here: run each migration's SQL in a
 * transaction, and record it in `_prisma_migrations`.
 *
 * That table is written in exactly the shape Prisma writes it, checksums and
 * epoch-millisecond timestamps included, so a developer who later points
 * `prisma migrate` at the same file agrees with us about what has been applied
 * rather than trying to start again. The shapes below were read back out of a
 * database Prisma itself had migrated, not inferred.
 *
 * Re-running is a no-op: the only migrations applied are the ones with no
 * finished row.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AppliedMigration {
  name: string;
  checksum: string;
  durationMs: number;
}

export interface MigrationReport {
  databaseFile: string;
  /** Migrations this run applied, in order. */
  applied: AppliedMigration[];
  /** Migrations that were already recorded as finished. */
  alreadyApplied: string[];
  /**
   * Applied migrations whose file no longer matches what was recorded.
   *
   * Not fatal — refusing to start would help nobody at this point — but the
   * database and the shipped migrations have diverged, and the log should say
   * so before the symptoms start.
   */
  checksumMismatches: string[];
  durationMs: number;
}

/** Prisma's own table definition, character for character. */
const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

interface MigrationOnDisk {
  name: string;
  sql: string;
  checksum: string;
}

interface RecordedMigration {
  migration_name: string;
  checksum: string;
  finished_at: number | null;
  rolled_back_at: number | null;
}

/**
 * Bring `databaseFile` up to date with `migrationsDir`, creating it if it does
 * not exist yet. Throws if a migration fails; the database is left untouched
 * by the one that failed, because each is applied in a transaction.
 */
export function runMigrations(databaseFile: string, migrationsDir: string): MigrationReport {
  const startedAll = Date.now();
  mkdirSync(dirname(databaseFile), { recursive: true });

  const pending = readMigrations(migrationsDir);
  const database = new Database(databaseFile);

  try {
    // WAL keeps a reader (the backup) from blocking the writer (the server),
    // and survives in the file itself, so this only really matters on the
    // first launch.
    database.pragma('journal_mode = WAL');

    // Foreign keys stay OFF while migrations run, and this is load-bearing
    // rather than laziness.
    //
    // Prisma emits a "RedefineTables" migration for almost any column change
    // on SQLite: create `new_users`, copy the rows across, `DROP TABLE users`,
    // rename. With foreign keys enforced, that DROP fires `ON DELETE CASCADE`
    // down every child table and takes the whole career with it. The migration
    // opens with `PRAGMA foreign_keys=OFF`, but a pragma is a no-op inside a
    // transaction — and we apply each migration in one — so the migration
    // cannot protect itself here. Prisma's own engine survives this only
    // because its connection has foreign keys off to begin with.
    //
    // better-sqlite3 opens connections with them ON, so turning them off has
    // to happen here, outside any transaction, and they go back on below once
    // every migration has been applied.
    database.pragma('foreign_keys = OFF');
    database.exec(CREATE_MIGRATIONS_TABLE);

    const recorded = new Map<string, RecordedMigration>();
    for (const row of database
      .prepare('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"')
      .all() as RecordedMigration[]) {
      recorded.set(row.migration_name, row);
    }

    const insert = database.prepare(
      `INSERT INTO "_prisma_migrations"
         ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES (@id, @checksum, @finished_at, @migration_name, NULL, NULL, @started_at, 1)`,
    );

    const applied: AppliedMigration[] = [];
    const alreadyApplied: string[] = [];
    const checksumMismatches: string[] = [];

    for (const migration of pending) {
      const existing = recorded.get(migration.name);

      if (existing && existing.finished_at !== null) {
        alreadyApplied.push(migration.name);
        if (existing.checksum !== migration.checksum) checksumMismatches.push(migration.name);
        continue;
      }

      if (existing) {
        // Only the Prisma CLI can leave this behind — we never record a
        // migration we did not finish. Guessing would risk applying half a
        // migration twice, so say plainly what is wrong instead.
        throw new Error(
          `Migration "${migration.name}" is recorded as started but never finished. ` +
            'The database needs repairing with the Prisma CLI before the application can open it.',
        );
      }

      const startedAt = Date.now();
      const apply = database.transaction(() => {
        // Prisma's SQLite migrations are a plain multi-statement script, and
        // `exec` runs one directly — there is no need to split on semicolons,
        // which is the traditional way to break a migration containing a
        // trigger body.
        database.exec(migration.sql);
        insert.run({
          id: randomUUID(),
          checksum: migration.checksum,
          migration_name: migration.name,
          started_at: startedAt,
          finished_at: Date.now(),
        });
      });
      apply();

      applied.push({
        name: migration.name,
        checksum: migration.checksum,
        durationMs: Date.now() - startedAt,
      });
    }

    // Every cascade in the schema depends on these being on, so the database
    // is handed back to the application with them enforced.
    database.pragma('foreign_keys = ON');

    return {
      databaseFile,
      applied,
      alreadyApplied,
      checksumMismatches,
      durationMs: Date.now() - startedAll,
    };
  } finally {
    database.close();
  }
}

/** Every migration in the directory, in the order Prisma names them. */
export function readMigrations(migrationsDir: string): MigrationOnDisk[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`No migrations found at ${migrationsDir}. This installation is incomplete.`);
  }

  const directories = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Prisma's names begin with a sortable timestamp, so lexicographic order
    // is chronological order. Compare explicitly rather than relying on the
    // platform's locale collation.
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  return directories.map((name) => {
    const file = join(migrationsDir, name, 'migration.sql');
    if (!existsSync(file)) {
      throw new Error(`Migration "${name}" has no migration.sql. This installation is incomplete.`);
    }
    // The checksum is over the bytes, which is how Prisma computes it too;
    // reading as a buffer keeps line endings out of the answer.
    const bytes = readFileSync(file);
    return {
      name,
      sql: bytes.toString('utf8'),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  });
}
