/**
 * The update log is read by the person using the app, after an update, to
 * find out what changed. It must never be missing the version they are on,
 * and the Markdown copy in the repository must never drift from the one the
 * app shows.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHANGELOG, formatReleaseDate, releaseNotesFor, releaseNotesSince, renderChangelogMarkdown, type ChangelogEntry,
} from '@/lib/changelog';
import { APP_VERSION } from '@/lib/version';

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('the update log', () => {
  it('leads with the version in package.json', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(manifest.version);
    expect(CHANGELOG[0]?.version).toBe(APP_VERSION);
    expect(releaseNotesFor(APP_VERSION)).not.toBeNull();
  });

  it('runs newest first, one entry per version', () => {
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      expect(compare(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version), CHANGELOG[i]!.version).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    }
  });

  it('says something about every version', () => {
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.summary.trim()).not.toBe('');
      expect(entry.changes.flatMap((group) => group.items).length, entry.version).toBeGreaterThan(0);
    }
  });

  it('matches CHANGELOG.md exactly — run `npm run changelog` if this fails', () => {
    const onDisk = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(renderChangelogMarkdown());
  });

  it('writes dates out in full', () => {
    expect(formatReleaseDate('2026-09-23')).toBe('23 September 2026');
    expect(formatReleaseDate('2027-01-01')).toBe('1 January 2027');
  });
});

describe('notes since the last version seen', () => {
  const entry = (version: string): ChangelogEntry => ({ version, date: '2026-09-24', title: version, summary: '', changes: [] });
  const LOG = ['0.3.2', '0.3.1', '0.3.0', '0.2.0'].map(entry);
  const versions = (entries: ChangelogEntry[]): string[] => entries.map((e) => e.version);

  it('gives every version after the last one seen, newest first', () => {
    expect(versions(releaseNotesSince('0.3.0', '0.3.2', LOG))).toEqual(['0.3.2', '0.3.1']);
    expect(versions(releaseNotesSince('0.2.0', '0.3.2', LOG))).toEqual(['0.3.2', '0.3.1', '0.3.0']);
    expect(versions(releaseNotesSince('0.3.1', '0.3.2', LOG))).toEqual(['0.3.2']);
  });

  it('gives nothing once the current version has been seen', () => {
    expect(releaseNotesSince('0.3.2', '0.3.2', LOG)).toEqual([]);
  });

  it('gives only the current version when the last one seen is unknown', () => {
    expect(versions(releaseNotesSince(null, '0.3.2', LOG))).toEqual(['0.3.2']);
    expect(versions(releaseNotesSince('0.1.9-dev', '0.3.2', LOG))).toEqual(['0.3.2']);
    // Running an older build than the one last seen.
    expect(versions(releaseNotesSince('0.3.2', '0.3.1', LOG))).toEqual(['0.3.1']);
  });

  it('gives nothing for a version the log does not have', () => {
    expect(releaseNotesSince('0.3.0', '9.9.9', LOG)).toEqual([]);
  });

  it('reaches the real log: 0.3.0 to this version includes 0.3.1', () => {
    expect(versions(releaseNotesSince('0.3.0', APP_VERSION))).toEqual(
      expect.arrayContaining([APP_VERSION, '0.3.1']),
    );
  });
});
