/**
 * Editions of recurring events: their years, their identities, runs of them,
 * the gaps between them, and the fingerprint that outlives a deleted race.
 */

import { describe, expect, it } from 'vitest';
import {
  editionFingerprint, editionIdentity, editionYear, eventNameFromRaceName, eventNameSignature, fingerprintMatches,
  longestConsecutiveRun, missingEditionYears, normaliseEventKey, serialiseFingerprint,
} from '@/lib/domain/edition';
import { inTimeZone, ZONES } from '../helpers/time-zone';

describe('edition years and identities', () => {
  it('edition year comes from the UTC race date', () => {
    expect(editionYear({ raceDate: new Date('2026-06-13T00:00:00Z'), seasonYear: 2025 })).toBe(2026);
  });

  it('falls back to the season year', () => {
    expect(editionYear({ raceDate: null, seasonYear: 2024 })).toBe(2024);
    expect(editionYear({ raceDate: null, seasonYear: null })).toBeNull();
  });

  it('two races of one year are one edition', () => {
    const race = { id: 'a', raceDate: new Date('2026-06-13T00:00:00Z'), seasonYear: null };
    const reupload = { id: 'b', raceDate: new Date('2026-06-14T00:00:00Z'), seasonYear: null };
    expect(editionIdentity(race)).toBe(editionIdentity(reupload));
    expect(editionIdentity(race)).toBe('2026');
  });

  it('an undated race is its own edition', () => {
    expect(editionIdentity({ id: 'a', raceDate: null, seasonYear: null })).toBe('race:a');
    expect(editionIdentity({ id: 'b', raceDate: null, seasonYear: null })).not.toBe(
      editionIdentity({ id: 'a', raceDate: null, seasonYear: null }),
    );
  });
});

describe('west of Greenwich', () => {
  inTimeZone(ZONES.losAngeles.zone, ZONES.losAngeles.offsets);

  it('a race dated 1 January keeps its edition year west of Greenwich', () => {
    // Stored as UTC midnight of the typed day, which is still 31 December in
    // Los Angeles. The edition is the year the user typed.
    const raceDate = new Date('2027-01-01');
    expect(raceDate.getFullYear()).toBe(2026);
    expect(editionYear({ raceDate, seasonYear: null })).toBe(2027);
  });
});

describe('runs and gaps', () => {
  it('longest run of consecutive years', () => {
    expect(longestConsecutiveRun([2020, 2021, 2023, 2024, 2025, 2027])).toEqual({ length: 3, fromYear: 2023, toYear: 2025 });
    // Repeats count once, and order does not matter.
    expect(longestConsecutiveRun([2026, 2025, 2025, 2024])).toEqual({ length: 3, fromYear: 2024, toYear: 2026 });
    expect(longestConsecutiveRun([2030])).toEqual({ length: 1, fromYear: 2030, toYear: 2030 });
    expect(longestConsecutiveRun([])).toBeNull();
  });

  it('gives a tie to the earliest run', () => {
    expect(longestConsecutiveRun([2010, 2011, 2020, 2021])).toEqual({ length: 2, fromYear: 2010, toYear: 2011 });
  });

  it('lists the years between the first and latest edition with no race', () => {
    expect(missingEditionYears([2020, 2023, 2021, 2025])).toEqual([2022, 2024]);
    expect(missingEditionYears([2020, 2021])).toEqual([]);
    expect(missingEditionYears([])).toEqual([]);
  });
});

describe('names', () => {
  it('reduces a race name to what stays the same from year to year', () => {
    expect(eventNameSignature('2026 24 Hours of Le Mans')).toBe('24 hours of le mans');
    expect(eventNameSignature('The 94th Annual 24 Hours of Le Mans')).toBe('24 hours of le mans');
    expect(eventNameSignature('24 Hours Nürburgring 2025 (Edition)')).toBe('24 hours nurburgring');
    // A 24 or a 1000 is part of the name, not a year.
    expect(eventNameSignature('Spa 1000 km')).toBe('spa 1000 km');
  });

  it('proposes an event name in the user’s own words', () => {
    expect(eventNameFromRaceName('2026 24 Hours of Nürburgring')).toBe('24 Hours of Nürburgring');
    expect(eventNameFromRaceName('Petit Le Mans – 2025')).toBe('Petit Le Mans');
    expect(eventNameFromRaceName('12 Hours of Sebring (2024)')).toBe('12 Hours of Sebring');
    expect(eventNameFromRaceName('2026')).toBe('2026');
  });

  it('normalises keys and names alike', () => {
    expect(normaliseEventKey('Le-Mans 24')).toBe('le-mans-24');
    expect(normaliseEventKey('  le mans  24 ')).toBe('le-mans-24');
    expect(normaliseEventKey('Nürburgring 24h')).toBe('nurburgring-24h');
  });
});

describe('fingerprints', () => {
  const original = editionFingerprint({
    editionYear: 2026, circuitSlug: 'circuit-de-la-sarthe', name: '2026 24 Hours of Le Mans', runtimeSec: 86_400,
  });

  it('serialises stably, keys in order', () => {
    expect(serialiseFingerprint(original)).toBe(
      '{"circuit":"circuit-de-la-sarthe","hours":24,"signature":"24 hours of le mans","year":2026}',
    );
  });

  it('fingerprints match across a few seconds of runtime and either circuit or name', () => {
    const stored = serialiseFingerprint(original);
    const again = (overrides: Partial<Parameters<typeof editionFingerprint>[0]>) => editionFingerprint({
      editionYear: 2026, circuitSlug: 'circuit-de-la-sarthe', name: '2026 24 Hours of Le Mans', runtimeSec: 86_400, ...overrides,
    });
    expect(fingerprintMatches(stored, again({ runtimeSec: 86_393 }))).toBe(true);
    expect(fingerprintMatches(stored, again({ name: 'Le Mans, re-added' }))).toBe(true);
    expect(fingerprintMatches(stored, again({ circuitSlug: null }))).toBe(true);
    // Both changed: a different edition as far as anyone can tell.
    expect(fingerprintMatches(stored, again({ circuitSlug: null, name: 'Something else entirely' }))).toBe(false);
    // Another year or another length is another edition.
    expect(fingerprintMatches(stored, again({ editionYear: 2027 }))).toBe(false);
    expect(fingerprintMatches(stored, again({ runtimeSec: 6 * 3600 }))).toBe(false);
  });

  it('never matches on an empty name or a missing circuit', () => {
    const bare = serialiseFingerprint({ year: 2026, hours: 6, circuit: null, signature: '' });
    expect(fingerprintMatches(bare, { year: 2026, hours: 6, circuit: null, signature: '' })).toBe(false);
    expect(fingerprintMatches('not json', original)).toBe(false);
  });
});
