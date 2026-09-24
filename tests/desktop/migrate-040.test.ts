/**
 * The 0.4.0 migration, applied by the desktop runner to a 0.3.2 database.
 *
 * The installed application runs `desktop/src/migrate.ts`, not Prisma, so this
 * is the path every upgrade actually takes. A career is written in exactly
 * the shape 0.3.2 leaves one — raw SQL, ISO dates with `+00:00`, a Story
 * Complete bonus and a milestone rung in the ledger, an event and its mastery
 * tree — and the 0.4.0 migration must add to it without touching a row.
 *
 * `desktop/**` has no `@` alias, so the runner is imported by relative path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readMigrations, runMigrations } from '../../desktop/src/migrate';

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');
const CAREER_HISTORY = '20260924120000_career_history';

/** The migrations 0.3.2 shipped with, and the tables they created. */
const MIGRATIONS_032 = ['20260922181417_init', '20260922191246_accounts', '20260922203126_xp_dedupe_per_account'];
const NEW_TABLES = ['expedition_summaries', 'chronicle_years', 'event_step_credits'];
const NEW_COLUMNS: Record<string, string[]> = {
  races: ['creditedViewingSec', 'expeditionMode'],
  race_masteries: ['archivedAt', 'createdByUser', 'displayName', 'mergedIntoId'],
  milestone_progress: ['achievedAt', 'achievedPrecision', 'eventId', 'raceId', 'sessionId', 'subjectName'],
  mastery_progress: ['achievedAt', 'achievedPrecision', 'achievedSessionId'],
};

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'endurance-migrate-040-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A migrations folder holding only what 0.3.2 shipped. */
function migrationsOf032(): string {
  const folder = join(scratch, 'migrations-0.3.2');
  for (const migration of readMigrations(MIGRATIONS).filter((m) => MIGRATIONS_032.includes(m.name))) {
    mkdirSync(join(folder, migration.name), { recursive: true });
    writeFileSync(join(folder, migration.name, 'migration.sql'), migration.sql, 'utf8');
  }
  return folder;
}

/** Dates exactly as the 0.3.2 client writes them through the adapter. */
const at = (day: string, time = '20:00:00') => `2026-${day}T${time}.000+00:00`;

/** A career in the shape 0.3.2 leaves one, written with raw SQL. */
function seed032Career(file: string): void {
  const db = new Database(file);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      INSERT INTO "users" ("id", "name", "timezone", "weekStart", "avatarKey", "accentKey", "createdAt", "updatedAt")
        VALUES ('u1', 'Driver One', 'UTC', 1, 'helmet', 'amber', '${at('09-01')}', '${at('09-01')}');
      INSERT INTO "career_profiles" ("id", "userId", "careerXp", "level", "createdAt", "updatedAt", "momentumUpdatedAt")
        VALUES ('p1', 'u1', 30490, 12, '${at('09-01')}', '${at('09-20')}', '${at('09-20')}');
      INSERT INTO "championships" ("id", "userId", "name", "slug", "createdAt", "updatedAt")
        VALUES ('ch1', 'u1', 'World Endurance', 'wec', '${at('09-01')}', '${at('09-01')}');
      INSERT INTO "championship_seasons" ("id", "championshipId", "year", "createdAt", "updatedAt")
        VALUES ('se1', 'ch1', 2026, '${at('09-01')}', '${at('09-01')}');
      INSERT INTO "race_masteries" ("id", "userId", "key", "name", "editionsTracked", "editionsStoryComplete", "totalRealSec", "createdAt", "updatedAt")
        VALUES ('rm1', 'u1', 'le-mans-24', '24 Hours of Le Mans', 1, 1, 86400, '${at('09-01')}', '${at('09-15')}');

      INSERT INTO "races" ("id", "userId", "name", "championshipId", "seasonId", "raceDate", "scheduledDurationSec", "runtimeSec",
          "raceType", "status", "isMajorEvent", "iconicKey", "coverageSec", "realViewingSec", "timelineWatchedSec", "sessionCount",
          "furthestTimestampSec", "startedAt", "completedAt", "lastWatchedAt", "storyCompletedAt", "createdAt", "updatedAt", "raceMasteryId")
        VALUES
          ('r1', 'u1', '24 Hours of Le Mans', 'ch1', 'se1', '2026-06-13T00:00:00.000+00:00', 86400, 86400, 'H24', 'COMPLETED', 1,
            'le-mans-24', 86400, 86400, 86400, 3, 86400, '${at('09-10')}', '${at('09-15')}', '${at('09-15')}', '${at('09-15')}',
            '${at('09-01')}', '${at('09-15')}', 'rm1'),
          ('r2', 'u1', '6 Hours of Spa', 'ch1', 'se1', '2026-05-09T00:00:00.000+00:00', 21600, 21600, 'H6', 'WATCHING', 0,
            NULL, 7200, 7200, 7200, 2, 7200, '${at('09-16')}', NULL, '${at('09-17')}', NULL, '${at('09-01')}', '${at('09-17')}', NULL),
          ('r3', 'u1', '8 Hours of Bahrain', NULL, NULL, NULL, 28800, 28800, 'H8', 'WATCHING', 0,
            NULL, 3600, 3600, 3600, 1, 3600, '${at('09-18')}', NULL, '${at('09-18')}', NULL, '${at('09-01')}', '${at('09-18')}', NULL);

      INSERT INTO "race_viewing_sessions" ("id", "raceId", "userId", "startTimestampSec", "endTimestampSec", "playbackSpeed",
          "timelineSeconds", "realSeconds", "newCoverageSeconds", "coverageBeforeSec", "coverageAfterSec", "watchedAt", "createdAt")
        VALUES
          ('s1', 'r1', 'u1', 0, 28800, 1, 28800, 28800, 28800, 0, 28800, '${at('09-10')}', '${at('09-10')}'),
          ('s2', 'r1', 'u1', 28800, 57600, 1, 28800, 28800, 28800, 28800, 57600, '${at('09-12')}', '${at('09-12')}'),
          ('s3', 'r1', 'u1', 57600, 86400, 1, 28800, 28800, 28800, 57600, 86400, '${at('09-15')}', '${at('09-15')}'),
          ('s4', 'r2', 'u1', 0, 3600, 1, 3600, 3600, 3600, 0, 3600, '${at('09-16')}', '${at('09-16')}'),
          ('s5', 'r2', 'u1', 3600, 7200, 1, 3600, 3600, 3600, 3600, 7200, '${at('09-17')}', '${at('09-17')}'),
          ('s6', 'r3', 'u1', 0, 3600, 1, 3600, 3600, 3600, 0, 3600, '${at('09-18')}', '${at('09-18')}');

      INSERT INTO "watched_intervals" ("id", "raceId", "startSec", "endSec", "sessionId", "createdAt")
        VALUES
          ('w1', 'r1', 0, 86400, NULL, '${at('09-15')}'),
          ('w2', 'r2', 0, 7200, 's5', '${at('09-17')}'),
          ('w3', 'r3', 0, 3600, 's6', '${at('09-18')}');

      INSERT INTO "xp_transactions" ("id", "userId", "source", "amount", "seasonAmount", "description", "sourceRef", "sessionId",
          "careerXpAfter", "levelAfter", "dedupeKey", "createdAt")
        VALUES
          ('x1', 'u1', 'VIEWING', 14400, 0, 'Viewing', 'r1', 's1', 14400, 8, NULL, '${at('09-10')}'),
          ('x2', 'u1', 'MILESTONE', 400, 0, 'Milestone — Real viewing hours: 1h', 'realHours:1', NULL, 14800, 8, 'milestone:realHours:1', '${at('09-10', '20:00:01')}'),
          ('x3', 'u1', 'VIEWING', 14400, 0, 'Viewing', 'r1', 's2', 29200, 11, NULL, '${at('09-12')}'),
          ('x4', 'u1', 'VIEWING', 14400, 0, 'Viewing', 'r1', 's3', 43600, 13, NULL, '${at('09-15')}'),
          ('x5', 'u1', 'STORY_COMPLETE', 7500, 0, 'Story Complete — 24 Hours of Le Mans', 'r1', 's3', 51100, 14, 'story-complete:r1', '${at('09-15', '20:00:01')}'),
          ('x6', 'u1', 'VIEWING', 1800, 0, 'Viewing', 'r2', 's4', 52900, 14, NULL, '${at('09-16')}'),
          ('x7', 'u1', 'VIEWING', 1800, 0, 'Viewing', 'r2', 's5', 54700, 14, NULL, '${at('09-17')}'),
          ('x8', 'u1', 'ACHIEVEMENT', 200, 0, 'Achievement — Green Flag', 'first_session', NULL, 54900, 14, 'achievement:first_session', '${at('09-10', '20:00:02')}');

      INSERT INTO "milestone_progress" ("id", "userId", "metric", "threshold", "reachedAt", "valueAtReach", "xpAwarded", "updatedAt")
        VALUES
          ('m1', 'u1', 'realHours', 1, '${at('09-10', '20:00:01')}', 8, 400, '${at('09-10', '20:00:01')}'),
          ('m2', 'u1', 'storyCompletes', 1, '${at('09-15', '20:00:01')}', 1, 720, '${at('09-15', '20:00:01')}');

      INSERT INTO "mastery_trees" ("id", "userId", "kind", "championshipId", "iconicKey", "key", "name", "createdAt", "updatedAt")
        VALUES ('t1', 'u1', 'RACE_EVENT', NULL, 'le-mans-24', 'event:le-mans-24', '24 Hours of Le Mans', '${at('09-01')}', '${at('09-01')}');
      INSERT INTO "mastery_nodes" ("id", "treeId", "key", "name", "description", "metric", "threshold", "xpReward", "tier", "sortOrder", "rarity")
        VALUES ('n1', 't1', 'edition_1', 'First Edition', 'Story Complete one edition.', 'editionsStoryComplete', 1, 1000, 1, 0, 'UNCOMMON');
      INSERT INTO "mastery_progress" ("id", "userId", "nodeId", "value", "target", "unlockedAt", "updatedAt")
        VALUES ('mp1', 'u1', 'n1', 1, 1, '${at('09-15', '20:00:01')}', '${at('09-15', '20:00:01')}');

      INSERT INTO "config_overrides" ("id", "userId", "key", "value", "updatedAt")
        VALUES
          ('c1', 'u1', 'seasonReset', '"0.3.1"', '${at('09-20')}'),
          ('c2', 'u1', 'lastSeenVersion', '"0.3.2"', '${at('09-20')}');
    `);
  } finally {
    db.close();
  }
}

function userTables(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]).map((row) => row.name);
}

function rowCounts(file: string): Map<string, number> {
  const db = new Database(file, { readonly: true });
  try {
    return new Map(userTables(db).map((table) => [
      table, (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
    ]));
  } finally {
    db.close();
  }
}

describe('the 0.4.0 migration on a 0.3.2 database', () => {
  let file = '';

  beforeAll(() => {
    file = join(scratch, 'upgraded', 'endurance.db');
    const first = runMigrations(file, migrationsOf032());
    expect(first.applied.map((m) => m.name)).toEqual(MIGRATIONS_032);
    seed032Career(file);
  });

  it('applies 0.4.0 to a 0.3.2 database without losing a row', () => {
    const before = rowCounts(file);
    const report = runMigrations(file, MIGRATIONS);

    expect(report.applied.map((m) => m.name)).toEqual([CAREER_HISTORY]);
    expect(report.alreadyApplied).toEqual(MIGRATIONS_032);
    expect(report.checksumMismatches).toEqual([]);

    const after = rowCounts(file);
    for (const [table, count] of before) {
      // `_prisma_migrations` gains exactly the one row that records 0.4.0.
      expect(after.get(table), table).toBe(table === '_prisma_migrations' ? count + 1 : count);
    }
    for (const table of NEW_TABLES) expect(after.get(table), table).toBe(0);

    const db = new Database(file, { readonly: true });
    try {
      for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
        const present = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name));
        for (const column of columns) {
          expect(present.has(column), `${table}.${column}`).toBe(true);
          const filled = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL`).get() as { n: number };
          expect(filled.n, `${table}.${column} on an old row`).toBe(0);
        }
      }

      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');

      const indexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((i) => i.name));
      for (const index of ['races_userId_raceMasteryId_idx', 'xp_transactions_sessionId_idx', 'watched_intervals_sessionId_idx', 'expedition_summaries_raceId_idx']) {
        expect(indexes.has(index), index).toBe(true);
      }

      // SQLite searches the child table by the foreign key column for every
      // deleted stint: only an index that starts with it can serve that.
      const plan = (table: string) => (db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM "${table}" WHERE "sessionId" = ?`)
        .all('s1') as { detail: string }[]).map((row) => row.detail).join(' ');
      expect(plan('xp_transactions')).toContain('xp_transactions_sessionId_idx');
      expect(plan('watched_intervals')).toContain('watched_intervals_sessionId_idx');
    } finally {
      db.close();
    }
  });

  it('is a no-op the second time', () => {
    const before = rowCounts(file);
    const again = runMigrations(file, MIGRATIONS);
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toEqual([...MIGRATIONS_032, CAREER_HISTORY]);
    expect(rowCounts(file)).toEqual(before);
  });
});

describe('the 0.4.0 migration itself', () => {
  it('uses only additive statements', () => {
    const sql = readFileSync(join(MIGRATIONS, CAREER_HISTORY, 'migration.sql'), 'utf8');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement, statement).toMatch(/^(ALTER TABLE "\w+" ADD COLUMN|CREATE TABLE|CREATE (UNIQUE )?INDEX)/);
      // `ON UPDATE CASCADE` inside a foreign key is not an UPDATE statement.
      expect(statement, statement).not.toMatch(/^\s*(DROP|INSERT|UPDATE|DELETE|PRAGMA|VACUUM)\b/im);
      if (/ADD COLUMN/.test(statement)) expect(statement, statement).not.toContain('NOT NULL');
    }
  });

  it('sorts after every migration 0.3.2 shipped', () => {
    const names = readMigrations(MIGRATIONS).map((m) => m.name);
    expect(names.slice(0, MIGRATIONS_032.length)).toEqual(MIGRATIONS_032);
    expect(names[names.length - 1]).toBe(CAREER_HISTORY);
  });
});
