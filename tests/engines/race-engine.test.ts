/**
 * Race status derivation and circuit normalisation.
 *
 * Status matters because it decides what the library shows and what the
 * strategist is allowed to suggest. The rule it has to honour is that a
 * deliberate choice by the user — archived, set aside, queued — is never
 * silently overridden.
 */

import { describe, expect, it } from 'vitest';
import { circuitSlug, deriveStatus } from '@/lib/engines/race-engine';
import type { RaceStatus } from '@/lib/domain/types';

const H = 3600;

function facts(overrides: Partial<Parameters<typeof deriveStatus>[1]> = {}) {
  return {
    hasSessions: false,
    storyComplete: false,
    coverageSec: 0,
    runtimeSec: 6 * H,
    ...overrides,
  };
}

describe('deriveStatus', () => {
  it('marks a finished story as completed, whatever it was before', () => {
    for (const status of ['UNWATCHED', 'QUEUED', 'WATCHING', 'PAUSED', 'ARCHIVED', 'ABANDONED'] as RaceStatus[]) {
      expect(deriveStatus(status, facts({ storyComplete: true, hasSessions: true, coverageSec: 6 * H })))
        .toBe('COMPLETED');
    }
  });

  it('leaves an archived race archived', () => {
    expect(deriveStatus('ARCHIVED', facts({ hasSessions: true, coverageSec: 2 * H }))).toBe('ARCHIVED');
  });

  it('leaves a race the user set aside alone', () => {
    // "Set aside" is a choice, not a state to be corrected.
    expect(deriveStatus('ABANDONED', facts({ hasSessions: true, coverageSec: 2 * H }))).toBe('ABANDONED');
  });

  it('keeps a paused race paused', () => {
    expect(deriveStatus('PAUSED', facts({ hasSessions: true, coverageSec: 2 * H }))).toBe('PAUSED');
  });

  it('keeps a queued race queued until something is watched', () => {
    expect(deriveStatus('QUEUED', facts())).toBe('QUEUED');
    expect(deriveStatus('QUEUED', facts({ hasSessions: true, coverageSec: H }))).toBe('WATCHING');
  });

  it('moves an unwatched race to watching on its first stint', () => {
    expect(deriveStatus('UNWATCHED', facts({ hasSessions: true, coverageSec: H }))).toBe('WATCHING');
  });

  it('falls back to unwatched when every session is removed', () => {
    expect(deriveStatus('WATCHING', facts({ hasSessions: false }))).toBe('UNWATCHED');
  });

  it('steps a completed race back when its coverage no longer supports it', () => {
    // A session was deleted. Claiming the race is still finished would be a lie.
    expect(deriveStatus('COMPLETED', facts({ hasSessions: true, coverageSec: 2 * H })))
      .toBe('WATCHING');
  });

  it('is stable — deriving twice changes nothing', () => {
    const cases: [RaceStatus, ReturnType<typeof facts>][] = [
      ['UNWATCHED', facts()],
      ['QUEUED', facts()],
      ['WATCHING', facts({ hasSessions: true, coverageSec: H })],
      ['PAUSED', facts({ hasSessions: true, coverageSec: H })],
      ['ARCHIVED', facts({ hasSessions: true })],
      ['ABANDONED', facts({ hasSessions: true })],
    ];
    for (const [status, state] of cases) {
      const once = deriveStatus(status, state);
      expect(deriveStatus(once, state), status).toBe(once);
    }
  });
});

describe('circuitSlug', () => {
  it('normalises case and spacing', () => {
    expect(circuitSlug('Fuji Speedway')).toBe('fuji-speedway');
    expect(circuitSlug('  FUJI   SPEEDWAY  ')).toBe('fuji-speedway');
  });

  it('collapses accents, so one circuit is one circuit', () => {
    expect(circuitSlug('Circuit de la Sarthe')).toBe(circuitSlug('Circuit de la Sárthe'));
    expect(circuitSlug('Nürburgring')).toBe('nurburgring');
  });

  it('strips punctuation', () => {
    expect(circuitSlug("Mount Panorama, Bathurst")).toBe('mount-panorama-bathurst');
    expect(circuitSlug('Spa-Francorchamps')).toBe('spa-francorchamps');
  });

  it('returns null for nothing worth normalising', () => {
    expect(circuitSlug(null)).toBeNull();
    expect(circuitSlug(undefined)).toBeNull();
    expect(circuitSlug('')).toBeNull();
    expect(circuitSlug('   ')).toBeNull();
    expect(circuitSlug('!!!')).toBeNull();
  });

  it('is idempotent', () => {
    const once = circuitSlug('Autódromo José Carlos Pace')!;
    expect(circuitSlug(once)).toBe(once);
  });
});
