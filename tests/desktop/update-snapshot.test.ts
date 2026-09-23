/**
 * The copy of a career taken the first time a new version starts.
 *
 * Runs against a real SQLite file: the point of the snapshot is that it can be
 * opened later and holds what the career held, and only a real file shows that.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SNAPSHOTS_KEPT, decideSnapshot, readLastVersion, recordVersion, snapshotFileName, snapshotsToPrune,
  takePreUpdateSnapshot,
} from '../../desktop/src/update-snapshot';

let root: string;
let databaseFile: string;
let backupDir: string;
let markerFile: string;
const NOW = new Date(2026, 8, 23, 20, 15);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'endurance-snapshot-'));
  mkdirSync(join(root, 'data'));
  databaseFile = join(root, 'data', 'endurance.db');
  backupDir = join(root, 'backups');
  markerFile = join(root, 'last-version.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedCareer(rows: number): void {
  const db = new Database(databaseFile);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE races (id INTEGER PRIMARY KEY, name TEXT)');
  const insert = db.prepare('INSERT INTO races (name) VALUES (?)');
  for (let i = 0; i < rows; i += 1) insert.run(`Race ${i}`);
  // Left open on purpose: rows still sitting in the -wal file are exactly
  // what a plain file copy would miss.
  openHandles.push(db);
}
const openHandles: Database.Database[] = [];
afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
});

describe('deciding whether to take a copy', () => {
  it('takes one on the first start of a new version', () => {
    expect(decideSnapshot({ databaseBytes: 4096, lastVersion: '0.2.0', currentVersion: '0.3.0' }).take).toBe(true);
  });

  it('takes one when no earlier version left a record', () => {
    // 0.2.0 wrote no marker, so this is every update to 0.3.0.
    expect(decideSnapshot({ databaseBytes: 4096, lastVersion: null, currentVersion: '0.3.0' }).take).toBe(true);
  });

  it('does not take one for a version that has started before', () => {
    expect(decideSnapshot({ databaseBytes: 4096, lastVersion: '0.3.0', currentVersion: '0.3.0' }).take).toBe(false);
  });

  it('does not take one when there is no career to copy', () => {
    expect(decideSnapshot({ databaseBytes: null, lastVersion: null, currentVersion: '0.3.0' }).take).toBe(false);
    expect(decideSnapshot({ databaseBytes: 0, lastVersion: '0.2.0', currentVersion: '0.3.0' }).take).toBe(false);
  });
});

describe('the version marker', () => {
  it('reads back what was recorded', () => {
    recordVersion(markerFile, '0.3.0', NOW);
    expect(readLastVersion(markerFile)).toBe('0.3.0');
  });

  it('treats a missing or damaged marker as no record', () => {
    expect(readLastVersion(markerFile)).toBeNull();
    writeFileSync(markerFile, '{ not json');
    expect(readLastVersion(markerFile)).toBeNull();
  });
});

describe('taking the copy', () => {
  it('writes a complete, openable copy of the career, including unflushed writes', () => {
    seedCareer(42);
    const result = takePreUpdateSnapshot({ databaseFile, backupDir, markerFile, currentVersion: '0.3.0', now: NOW });

    expect(result.taken).toBe(join(backupDir, 'pre-update-0.3.0-2026-09-23.db'));
    const copy = new Database(result.taken!, { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM races').get()).toEqual({ n: 42 });
    copy.close();
  });

  it('takes only one copy however many times the same version fails to start', () => {
    seedCareer(1);
    takePreUpdateSnapshot({ databaseFile, backupDir, markerFile, currentVersion: '0.3.0', now: NOW });
    const again = takePreUpdateSnapshot({ databaseFile, backupDir, markerFile, currentVersion: '0.3.0', now: NOW });
    expect(again.taken).toBeNull();
    expect(readdirSync(backupDir)).toHaveLength(1);
  });

  it('takes none once the version has started successfully', () => {
    seedCareer(1);
    recordVersion(markerFile, '0.3.0', NOW);
    const result = takePreUpdateSnapshot({ databaseFile, backupDir, markerFile, currentVersion: '0.3.0', now: NOW });
    expect(result.taken).toBeNull();
    expect(existsSync(backupDir)).toBe(false);
  });

  it('keeps the newest five pre-update copies and never touches a manual backup', () => {
    seedCareer(1);
    mkdirSync(backupDir);
    const manual = join(backupDir, 'endurance-2026-09-01.db');
    writeFileSync(manual, 'a backup made from the menu');
    for (let i = 0; i < 6; i += 1) {
      const file = join(backupDir, `pre-update-0.1.${i}-2026-09-0${i + 1}.db`);
      writeFileSync(file, 'old copy');
      const at = new Date(2026, 8, i + 1);
      utimesSync(file, at, at);
    }

    const result = takePreUpdateSnapshot({ databaseFile, backupDir, markerFile, currentVersion: '0.3.0', now: NOW });

    const left = readdirSync(backupDir).filter((name) => name.startsWith('pre-update-'));
    expect(left).toHaveLength(SNAPSHOTS_KEPT);
    expect(left).toContain('pre-update-0.3.0-2026-09-23.db');
    expect(result.pruned).toEqual(expect.arrayContaining(['pre-update-0.1.0-2026-09-01.db', 'pre-update-0.1.1-2026-09-02.db']));
    expect(existsSync(manual)).toBe(true);
  });
});

describe('naming and pruning', () => {
  it('names a copy after the version being started and the day', () => {
    expect(snapshotFileName('0.3.0', NOW)).toBe('pre-update-0.3.0-2026-09-23.db');
  });

  it('prunes oldest first and ignores anything that is not a pre-update copy', () => {
    const files = [
      { name: 'pre-update-a.db', modifiedMs: 1 },
      { name: 'pre-update-b.db', modifiedMs: 2 },
      { name: 'pre-update-c.db', modifiedMs: 3 },
      { name: 'endurance-2026-09-01.db', modifiedMs: 0 },
      { name: 'pre-update-notes.txt', modifiedMs: 0 },
    ];
    expect(snapshotsToPrune(files, 2)).toEqual(['pre-update-a.db']);
  });
});
