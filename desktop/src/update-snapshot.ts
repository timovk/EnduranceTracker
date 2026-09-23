/**
 * A copy of the career, taken the first time a new version starts.
 *
 * An update can change the database: a migration adds a column, rebuilds a
 * table, moves data. Every one is applied in a transaction and tested, but the
 * person whose career it is should not have to take that on trust, and should
 * not have to remember to make a backup first either. So before anything else
 * touches the file, a new version saves a copy of it.
 *
 * "New version" is decided by a marker in the user-data folder recording the
 * last version that started SUCCESSFULLY. It is written only once the window is
 * open, so an update that fails to start is recognised as new again on the
 * next attempt — and finds its snapshot already there rather than taking a
 * second one. Versions before 0.3.0 wrote no marker, so the first start of
 * 0.3.0 over an existing career always takes a copy.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export const SNAPSHOT_PREFIX = 'pre-update-';

/** How many pre-update copies are kept. Manual backups are never touched. */
export const SNAPSHOTS_KEPT = 5;

export function readLastVersion(markerFile: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(markerFile, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function recordVersion(markerFile: string, version: string, now: Date = new Date()): void {
  writeFileSync(markerFile, `${JSON.stringify({ version, startedAt: now.toISOString() }, null, 2)}\n`, 'utf8');
}

/** `pre-update-0.3.0-2026-09-23.db` — the version being started, and the day. */
export function snapshotFileName(version: string, now: Date = new Date()): string {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
  return `${SNAPSHOT_PREFIX}${version}-${day}.db`;
}

export interface SnapshotDecision {
  take: boolean;
  reason: string;
}

export function decideSnapshot(facts: {
  databaseBytes: number | null;
  lastVersion: string | null;
  currentVersion: string;
}): SnapshotDecision {
  if (facts.databaseBytes === null || facts.databaseBytes === 0) {
    return { take: false, reason: 'there is no career yet' };
  }
  if (facts.lastVersion === facts.currentVersion) {
    return { take: false, reason: `${facts.currentVersion} has started here before` };
  }
  return {
    take: true,
    reason: facts.lastVersion === null
      ? `first start of ${facts.currentVersion} (no earlier version recorded)`
      : `first start of ${facts.currentVersion} after ${facts.lastVersion}`,
  };
}

/** The pre-update copies to delete so that only the newest `keep` remain. */
export function snapshotsToPrune(
  files: readonly { name: string; modifiedMs: number }[],
  keep: number = SNAPSHOTS_KEPT,
): string[] {
  return files
    .filter((file) => file.name.startsWith(SNAPSHOT_PREFIX) && file.name.endsWith('.db'))
    .sort((a, b) => b.modifiedMs - a.modifiedMs || b.name.localeCompare(a.name))
    .slice(keep)
    .map((file) => file.name);
}

export interface SnapshotResult {
  /** The copy that was written, or null. */
  taken: string | null;
  /** Why no copy was written, when none was. */
  skipped: string | null;
  pruned: string[];
}

export function takePreUpdateSnapshot(options: {
  databaseFile: string;
  backupDir: string;
  markerFile: string;
  currentVersion: string;
  now?: Date;
}): SnapshotResult {
  const now = options.now ?? new Date();
  const decision = decideSnapshot({
    databaseBytes: existsSync(options.databaseFile) ? statSync(options.databaseFile).size : null,
    lastVersion: readLastVersion(options.markerFile),
    currentVersion: options.currentVersion,
  });
  if (!decision.take) return { taken: null, skipped: decision.reason, pruned: [] };

  mkdirSync(options.backupDir, { recursive: true });
  const target = join(options.backupDir, snapshotFileName(options.currentVersion, now));

  // Already there means this version tried to start earlier today and did not
  // get as far as recording itself. That copy predates any change it made.
  if (existsSync(target)) return { taken: null, skipped: 'a copy for this version was already taken today', pruned: [] };

  // VACUUM INTO, not a file copy: the career may have writes still sitting in
  // the -wal file, which copying endurance.db alone would leave behind.
  const source = new Database(options.databaseFile, { readonly: true, fileMustExist: true });
  try {
    source.prepare('VACUUM INTO ?').run(target);
  } finally {
    source.close();
  }

  const existing = readdirSync(options.backupDir).map((name) => ({
    name,
    modifiedMs: statSync(join(options.backupDir, name)).mtimeMs,
  }));
  const pruned = snapshotsToPrune(existing);
  for (const name of pruned) unlinkSync(join(options.backupDir, name));

  return { taken: target, skipped: null, pruned };
}
