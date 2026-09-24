/**
 * Event suggestions: which races look like editions of one recurring event.
 * Suggestions only; nothing here links anything.
 */

import { describe, expect, it } from 'vitest';
import type { AssociationEvent, AssociationRace } from '@/lib/domain/event-association';
import { suggestEventLinks } from '@/lib/domain/event-association';

const H = 3600;

function raceOf(id: string, name: string, overrides: Partial<AssociationRace> = {}): AssociationRace {
  const year = /\b(20\d\d)\b/.exec(name)?.[1];
  return {
    id,
    name,
    circuitSlug: null,
    runtimeSec: 24 * H,
    championshipId: null,
    eventKey: null,
    raceDate: year ? new Date(`${year}-06-13`) : null,
    seasonYear: null,
    ...overrides,
  };
}

function eventOf(key: string, name: string, overrides: Partial<AssociationEvent> = {}): AssociationEvent {
  return { key, name, memberCount: 1, createdAt: new Date('2026-09-22T12:00:00Z'), active: true, ...overrides };
}

const NONE = new Set<string>();

describe('linking a race to an event', () => {
  it('suggests an event whose editions share the race name without its year', () => {
    const races = [
      raceOf('lm25', '2025 24 Hours of Fort Aurelia', { eventKey: 'fort-aurelia-24' }),
      raceOf('lm26', '2026 24 Hours of Fort Aurelia'),
    ];
    expect(suggestEventLinks(races, [eventOf('fort-aurelia-24', '24 Hours of Fort Aurelia')], NONE)).toEqual([{
      id: 'link:lm26:fort-aurelia-24', kind: 'link', raceId: 'lm26', eventKey: 'fort-aurelia-24',
      strength: 'strong', reason: 'name',
    }]);
  });

  it('says so when the circuit agrees as well', () => {
    const races = [
      raceOf('a', '2025 Twelve Hours of Redstone', { eventKey: 'redstone', circuitSlug: 'redstone' }),
      raceOf('b', '2026 Twelve Hours of Redstone', { circuitSlug: 'redstone' }),
    ];
    const [suggestion] = suggestEventLinks(races, [eventOf('redstone', 'Twelve Hours of Redstone')], NONE);
    expect(suggestion).toMatchObject({ strength: 'strong', reason: 'name-and-circuit' });
  });

  it('suggests by circuit and length when names differ', () => {
    const races = [
      raceOf('a', 'Karoo Ten Hours 2025', { eventKey: 'karoo-10', circuitSlug: 'karoo', runtimeSec: 10 * H, championshipId: 'cec' }),
      raceOf('b', 'CEC Round 3, South Africa', { circuitSlug: 'karoo', runtimeSec: 10 * H + 600, championshipId: 'cec' }),
      // Same circuit, another length: a different race held there.
      raceOf('c', 'Karoo Sprint', { circuitSlug: 'karoo', runtimeSec: 3 * H }),
      // Same circuit and length, another championship: not the same event.
      raceOf('d', 'Karoo Endurance Classic', { circuitSlug: 'karoo', runtimeSec: 10 * H, championshipId: 'other' }),
    ];
    expect(suggestEventLinks(races, [eventOf('karoo-10', 'Karoo Ten Hours')], NONE)).toEqual([{
      id: 'link:b:karoo-10', kind: 'link', raceId: 'b', eventKey: 'karoo-10', strength: 'likely', reason: 'circuit-and-length',
    }]);
  });

  it('suggests only the strongest link for each race', () => {
    const races = [
      raceOf('m1', '2025 Six Hours of Northport', { eventKey: 'small', circuitSlug: 'northport', runtimeSec: 6 * H }),
      raceOf('m2', 'Northport Classic', { eventKey: 'big', circuitSlug: 'northport', runtimeSec: 6 * H }),
      raceOf('new', '2026 Six Hours of Northport', { circuitSlug: 'northport', runtimeSec: 6 * H }),
    ];
    const events = [eventOf('small', 'Six Hours of Northport'), eventOf('big', 'Northport Classic', { memberCount: 5 })];
    const suggestions = suggestEventLinks(races, events, NONE);
    expect(suggestions.filter((s) => s.kind === 'link')).toEqual([
      expect.objectContaining({ raceId: 'new', eventKey: 'small', reason: 'name-and-circuit' }),
    ]);
  });

  it('ignores names too short to say anything, and events that are archived or merged', () => {
    const races = [
      raceOf('a', 'GT 3', { eventKey: 'short' }),
      raceOf('b', 'GT 3'),
      raceOf('c', '2025 Four Hours of Vallegrande', { eventKey: 'gone' }),
      raceOf('d', '2026 Four Hours of Vallegrande'),
    ];
    const events = [eventOf('short', 'GT'), eventOf('gone', 'Four Hours of Vallegrande', { active: false })];
    const suggestions = suggestEventLinks(races, events, NONE);
    expect(suggestions.filter((s) => s.kind === 'link')).toEqual([]);
  });
});

describe('creating an event', () => {
  it('suggests creating an event for two unlinked editions, named after the latest race', () => {
    const races = [
      raceOf('b', '2026 24 Hours of Nürburgring'),
      raceOf('a', '2025 24 Hours of Nurburgring'),
    ];
    expect(suggestEventLinks(races, [], NONE)).toEqual([{
      id: 'create:24 hours of nurburgring', kind: 'create', name: '24 Hours of Nürburgring', raceIds: ['a', 'b'],
    }]);
  });

  it('needs two different editions, not two races of one year', () => {
    const races = [raceOf('a', '2026 Petit Le Mans'), raceOf('b', 'Petit Le Mans 2026')];
    expect(suggestEventLinks(races, [], NONE)).toEqual([]);
    const withAnother = [...races, raceOf('c', '2025 Petit Le Mans')];
    expect(suggestEventLinks(withAnother, [], NONE)).toEqual([
      expect.objectContaining({ kind: 'create', raceIds: ['c', 'a', 'b'] }),
    ]);
  });
});

describe('merging events', () => {
  it('suggests merging events whose keys differ only in case', () => {
    const events = [
      eventOf('Spa-24', 'Spa 24', { memberCount: 1, createdAt: new Date('2026-09-23T00:00:00Z') }),
      eventOf('spa-24', '24 Hours of Spa', { memberCount: 3 }),
    ];
    expect(suggestEventLinks([], events, NONE)).toEqual([
      { id: 'merge:Spa-24:spa-24', kind: 'merge', fromKey: 'Spa-24', intoKey: 'spa-24' },
    ]);
  });

  it('merges the later of two equal events into the earlier', () => {
    const events = [
      eventOf('sebring-12-b', 'Sebring 12', { createdAt: new Date('2026-09-24T00:00:00Z') }),
      eventOf('sebring-12', 'Twelve Hours of Sebring', { createdAt: new Date('2026-09-22T00:00:00Z') }),
    ];
    // One's name normalises to the other's key: "sebring-12".
    expect(suggestEventLinks([], events, NONE)).toEqual([
      expect.objectContaining({ fromKey: 'sebring-12-b', intoKey: 'sebring-12' }),
    ]);
  });
});

describe('every suggestion', () => {
  it('never uses a hard-coded list of famous races', () => {
    // A single famous race suggests nothing; two editions of an invented one do.
    expect(suggestEventLinks([raceOf('lm', '2026 24 Hours of Le Mans')], [], NONE)).toEqual([]);
    const invented = [raceOf('x1', '2025 Nine Hours of Kaltenberg'), raceOf('x2', '2026 Nine Hours of Kaltenberg')];
    expect(suggestEventLinks(invented, [], NONE)).toEqual([expect.objectContaining({ kind: 'create' })]);
  });

  it('dismissed suggestions stay dismissed', () => {
    const races = [
      raceOf('a', '2025 24 Hours of Fort Aurelia', { eventKey: 'fa' }),
      raceOf('b', '2026 24 Hours of Fort Aurelia'),
    ];
    const events = [eventOf('fa', 'Fort Aurelia'), eventOf('FA', 'fort aurelia', { createdAt: new Date('2026-09-23T00:00:00Z') })];
    const all = suggestEventLinks(races, events, NONE);
    expect(all.map((s) => s.id)).toEqual(['merge:FA:fa', 'link:b:fa']);
    const dismissed = new Set(all.map((s) => s.id));
    expect(suggestEventLinks(races, events, dismissed)).toEqual([]);
  });

  it('lists merges, then strong links, then likely links, then new events', () => {
    const races = [
      raceOf('a1', '2025 Eight Hours of Cape Meridian', { eventKey: 'cape', circuitSlug: 'cape', runtimeSec: 8 * H }),
      raceOf('a2', '2026 Eight Hours of Cape Meridian'),
      raceOf('b1', 'Cape Round Six', { circuitSlug: 'cape', runtimeSec: 8 * H }),
      raceOf('c1', '2025 Three Hours of Glasmoor'),
      raceOf('c2', '2026 Three Hours of Glasmoor'),
    ];
    const events = [eventOf('cape', 'Eight Hours of Cape Meridian'), eventOf('Cape', 'CAPE', { createdAt: new Date('2026-09-23T00:00:00Z') })];
    expect(suggestEventLinks(races, events, NONE).map((s) => s.id)).toEqual([
      'merge:Cape:cape', 'link:a2:cape', 'link:b1:cape', 'create:three hours of glasmoor',
    ]);
  });
});
