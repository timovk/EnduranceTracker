/**
 * Upgrading a database the real 0.3.2 code wrote.
 *
 * `tests/fixtures/career-0.3.2.db` holds the demonstration career exactly as
 * 0.3.2 left it — ledger re-stamps, intervals built in insertion order, and
 * achievement, mastery, milestone and Hall of Fame rows across two calendar
 * years (see `tests/fixtures/README.md`). Each run works on a copy.
 *
 * This file grows with the release: the migration is checked here first, and
 * the career backfill, Event Legacy, Expeditions and the Chronicle add their
 * own checks against the same data.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { runMigrations } from '../../desktop/src/migrate';
import type { FixtureCopy } from '../helpers/fixture-db';
import { copyFixtureDatabase, FIXTURE_USER_ID } from '../helpers/fixture-db';

const MIGRATIONS = join(resolve(process.cwd()), 'prisma', 'migrations');
const CAREER_HISTORY = '20260924120000_career_history';

let copy: FixtureCopy;

beforeAll(() => {
  copy = copyFixtureDatabase();
});

afterAll(() => {
  copy.cleanup();
});

function counts(file: string): Record<string, number> {
  const db = new Database(file, { readonly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]).map((row) => row.name);
    return Object.fromEntries(tables.map((table) => [
      table, (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
    ]));
  } finally {
    db.close();
  }
}

/** Every row of the tables a migration must never touch, in a stable order. */
function history(file: string): unknown[][] {
  const db = new Database(file, { readonly: true });
  try {
    return ['race_viewing_sessions', 'watched_intervals', 'xp_transactions', 'milestone_progress', 'mastery_progress', 'races']
      .map((table) => db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all() as unknown[]);
  } finally {
    db.close();
  }
}

describe('migrating the 0.3.2 fixture', () => {
  let before: Record<string, number>;
  let rowsBefore: unknown[][];

  beforeAll(() => {
    before = counts(copy.file);
    rowsBefore = history(copy.file);
  });

  it('is the career 0.3.2 wrote', () => {
    const db = new Database(copy.file, { readonly: true });
    try {
      const applied = (db.prepare('SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "migration_name"').all() as { migration_name: string }[])
        .map((row) => row.migration_name);
      expect(applied).not.toContain(CAREER_HISTORY);
      expect(applied).toHaveLength(3);
      const user = db.prepare('SELECT "id" FROM "users"').all() as { id: string }[];
      expect(user).toEqual([{ id: FIXTURE_USER_ID }]);
    } finally {
      db.close();
    }
    expect(before.race_viewing_sessions).toBeGreaterThan(0);
    expect(before.xp_transactions).toBeGreaterThan(0);
  });

  it('applies only the 0.4.0 migration and keeps every row', () => {
    const report = runMigrations(copy.file, MIGRATIONS);
    expect(report.applied.map((migration) => migration.name)).toEqual([CAREER_HISTORY]);
    expect(report.checksumMismatches).toEqual([]);

    const after = counts(copy.file);
    for (const [table, count] of Object.entries(before)) {
      expect(after[table], table).toBe(table === '_prisma_migrations' ? count + 1 : count);
    }
    for (const table of ['expedition_summaries', 'chronicle_years', 'event_step_credits']) {
      expect(after[table], table).toBe(0);
    }
    // Not a value changed in the stints, the intervals, the ledger, the
    // landmarks or the races, and every new column is empty on every old row.
    const rowsAfter = history(copy.file);
    for (const [index, rows] of rowsBefore.entries()) {
      const upgraded = rowsAfter[index] as Record<string, unknown>[];
      const oldColumns = new Set(Object.keys((rows[0] ?? {}) as object));
      expect(upgraded).toHaveLength(rows.length);
      expect(upgraded.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => oldColumns.has(column)))))
        .toEqual(rows);
      for (const row of upgraded) {
        for (const [column, value] of Object.entries(row)) {
          if (!oldColumns.has(column)) expect(value, column).toBeNull();
        }
      }
    }
  });

  it('leaves no foreign key violation and an intact file', () => {
    const db = new Database(copy.file, { readonly: true });
    try {
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });

  it('is a no-op the second time', () => {
    const settled = counts(copy.file);
    const again = runMigrations(copy.file, MIGRATIONS);
    expect(again.applied).toEqual([]);
    expect(counts(copy.file)).toEqual(settled);
  });
});
