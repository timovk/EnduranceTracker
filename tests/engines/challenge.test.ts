/**
 * Challenge generation.
 *
 * The rule under test is the one that keeps challenges from becoming homework:
 * every target must be derived from the library that actually exists, so a
 * challenge can never be impossible. Generation must also be deterministic, or
 * the board would reshuffle itself on every page view.
 */

import { describe, expect, it } from 'vitest';
import {
  buildChallengesForScope, CHALLENGE_TEMPLATES, deterministicUnit, emptyLibrary,
  type LibraryRace, type LibrarySeason, type LibrarySnapshot,
} from '@/lib/engines/challenge-engine';
import { periodForScope } from '@/lib/domain/periods';
import { CHALLENGE_CONFIG } from '@/lib/config';
import type { ChallengeScope } from '@/lib/domain/types';

const H = 3600;
const NOW = new Date(2026, 8, 22, 19, 0);
const SCOPES: ChallengeScope[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL'];

function race(overrides: Partial<LibraryRace> = {}): LibraryRace {
  return {
    id: 'r1',
    name: '6 Hours of Somewhere',
    championshipId: 'c1',
    championshipName: 'Championship One',
    seasonId: 's1',
    runtimeSec: 6 * H,
    coverageSec: 0,
    isMajorEvent: false,
    storyComplete: false,
    started: false,
    setAside: false,
    ...overrides,
  };
}

function season(overrides: Partial<LibrarySeason> = {}): LibrarySeason {
  return {
    id: 's1',
    label: '2026 Championship One',
    championshipId: 'c1',
    target: 8,
    completedCount: 0,
    remainingRaceCount: 8,
    remainingRealMinutes: 8 * 6 * 60,
    completable: true,
    ...overrides,
  };
}

/** A library with enough in it that most templates are feasible. */
function richLibrary(): LibrarySnapshot {
  const races: LibraryRace[] = [];
  for (let c = 1; c <= 5; c += 1) {
    for (let r = 1; r <= 6; r += 1) {
      races.push(race({
        id: `c${c}-r${r}`,
        name: `Race ${c}-${r}`,
        championshipId: `c${c}`,
        championshipName: `Championship ${c}`,
        seasonId: `s${c}`,
        runtimeSec: (r === 1 ? 24 : r === 2 ? 12 : 6) * H,
        coverageSec: r <= 2 ? 2 * H : 0,
        started: r <= 2,
        isMajorEvent: r === 1,
      }));
    }
  }
  return {
    races,
    seasons: Array.from({ length: 5 }, (_, i) => season({
      id: `s${i + 1}`, championshipId: `c${i + 1}`, label: `2026 Championship ${i + 1}`,
    })),
    championships: Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, name: `Championship ${i + 1}` })),
    playbackSpeed: 1.25,
    paceRealMinutesPerDay: 70,
    paceSessionsPerDay: 1.2,
  };
}

describe('templates', () => {
  it('has unique keys', () => {
    expect(new Set(CHALLENGE_TEMPLATES.map((t) => t.key)).size).toBe(CHALLENGE_TEMPLATES.length);
  });

  it('covers all four scopes', () => {
    for (const scope of SCOPES) {
      expect(CHALLENGE_TEMPLATES.filter((t) => t.scope === scope).length).toBeGreaterThanOrEqual(
        CHALLENGE_CONFIG.counts[scope],
      );
    }
  });

  it('offers a broad catalogue rather than a handful', () => {
    expect(CHALLENGE_TEMPLATES.length).toBeGreaterThanOrEqual(22);
  });
});

describe('deterministicUnit', () => {
  it('is stable for a seed and key', () => {
    expect(deterministicUnit('2026-W39', 'weekly_real_minutes'))
      .toBe(deterministicUnit('2026-W39', 'weekly_real_minutes'));
  });

  it('differs between seeds and between keys', () => {
    expect(deterministicUnit('2026-W39', 'a')).not.toBe(deterministicUnit('2026-W40', 'a'));
    expect(deterministicUnit('2026-W39', 'a')).not.toBe(deterministicUnit('2026-W39', 'b'));
  });

  it('stays inside the unit interval', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = deterministicUnit(`seed-${i}`, `key-${i % 7}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generation never produces an impossible objective', () => {
  it('produces nothing at all for an empty library', () => {
    for (const scope of SCOPES) {
      const generated = buildChallengesForScope(scope, emptyLibrary(), periodForScope(scope, NOW), 'seed');
      expect(generated, scope).toEqual([]);
    }
  });

  it('never asks for a story completion the library cannot supply', () => {
    // One race, already finished: there is nothing left to complete. Time-based
    // challenges remain fair — a re-watch still counts as watching — but
    // nothing may ask for a completion that cannot happen.
    const library: LibrarySnapshot = {
      ...emptyLibrary(),
      races: [race({ storyComplete: true, coverageSec: 6 * H })],
      championships: [{ id: 'c1', name: 'Championship One' }],
    };

    const completionMetrics = ['STORY_COMPLETES', 'LONG_RACE_STORY_COMPLETE', 'SEASON_COMPLETED', 'DISTINCT_CHAMPIONSHIPS_STORIED'];

    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, library, periodForScope(scope, NOW), 'seed')) {
        if (generated.metric !== null && completionMetrics.includes(generated.metric)) {
          expect.fail(`${scope}/${generated.templateKey} asks for ${generated.metric} with nothing left to complete`);
        }
      }
    }
  });

  it('still offers something to do when everything is finished', () => {
    // A completionist who has watched it all is not left with a blank board.
    const library: LibrarySnapshot = {
      ...emptyLibrary(),
      races: [race({ storyComplete: true, coverageSec: 6 * H })],
      championships: [{ id: 'c1', name: 'Championship One' }],
      paceRealMinutesPerDay: 60,
    };
    const generated = buildChallengesForScope('DAILY', library, periodForScope('DAILY', NOW), 'seed');
    expect(generated.length).toBeGreaterThan(0);
  });

  it('never asks for a championship spread the library cannot provide', () => {
    const singleChampionship: LibrarySnapshot = {
      ...emptyLibrary(),
      races: Array.from({ length: 8 }, (_, i) => race({ id: `r${i}`, championshipId: 'c1' })),
      championships: [{ id: 'c1', name: 'Only Championship' }],
      seasons: [season()],
      paceRealMinutesPerDay: 60,
      paceSessionsPerDay: 1,
    };

    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, singleChampionship, periodForScope(scope, NOW), 's')) {
        if (generated.metric === 'DISTINCT_CHAMPIONSHIPS_STORIED') {
          expect(generated.target).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('never asks for a long race when there is none', () => {
    const shortOnly: LibrarySnapshot = {
      ...emptyLibrary(),
      races: Array.from({ length: 6 }, (_, i) => race({ id: `r${i}`, runtimeSec: 4 * H })),
      championships: [{ id: 'c1', name: 'Championship One' }],
      seasons: [season({ remainingRealMinutes: 6 * 4 * 60 })],
      paceRealMinutesPerDay: 60,
      paceSessionsPerDay: 1,
    };

    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, shortOnly, periodForScope(scope, NOW), 's')) {
        if (generated.metric === 'LONG_RACE_STORY_COMPLETE') {
          const minimum = Number(generated.params.minRuntimeSec ?? 0);
          expect(minimum).toBeLessThanOrEqual(4 * H);
        }
      }
    }
  });

  it('never asks a season to be completed that cannot be', () => {
    const incompletable: LibrarySnapshot = {
      ...richLibrary(),
      // The user declared 10 races but has only filed 6, so the set cannot be
      // completed from the library as it stands.
      seasons: [season({ target: 10, remainingRaceCount: 10, completable: false })],
    };

    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, incompletable, periodForScope(scope, NOW), 's')) {
        expect(generated.metric).not.toBe('SEASON_COMPLETED');
      }
    }
  });

  it('respects the feasibility caps for every scope', () => {
    const library = richLibrary();
    const caps = {
      DAILY: CHALLENGE_CONFIG.feasibility.maxDailyMinutes,
      WEEKLY: CHALLENGE_CONFIG.feasibility.maxWeeklyMinutes,
      MONTHLY: CHALLENGE_CONFIG.feasibility.maxMonthlyMinutes,
      SEASONAL: CHALLENGE_CONFIG.feasibility.maxSeasonalMinutes,
    } as const;

    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, library, periodForScope(scope, NOW), 's')) {
        if (generated.metric === 'REAL_MINUTES' || generated.metric === 'TIMELINE_MINUTES') {
          expect(generated.target, `${scope}/${generated.templateKey}`).toBeLessThanOrEqual(caps[scope]);
        }
      }
    }
  });

  it('always sets a positive target', () => {
    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, richLibrary(), periodForScope(scope, NOW), 's')) {
        expect(generated.target, generated.templateKey).toBeGreaterThan(0);
      }
    }
  });

  it('never offers a negative reward', () => {
    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, richLibrary(), periodForScope(scope, NOW), 's')) {
        expect(generated.xpReward).toBeGreaterThanOrEqual(0);
        expect(generated.seasonXpReward).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('generation is deterministic', () => {
  it('produces the same board for the same period', () => {
    const library = richLibrary();
    for (const scope of SCOPES) {
      const period = periodForScope(scope, NOW);
      const a = buildChallengesForScope(scope, library, period, period.key);
      const b = buildChallengesForScope(scope, library, period, period.key);
      expect(a.map((c) => `${c.templateKey}:${c.target}`)).toEqual(b.map((c) => `${c.templateKey}:${c.target}`));
    }
  });

  it('offers a different board in a different period', () => {
    const library = richLibrary();
    const boards = [1, 8, 15, 22].map((day) => {
      const period = periodForScope('DAILY', new Date(2026, 8, day));
      return buildChallengesForScope('DAILY', library, period, period.key)
        .map((c) => c.templateKey).join(',');
    });
    expect(new Set(boards).size).toBeGreaterThan(1);
  });

  it('does not reshuffle the board when a race is added', () => {
    // Adding a race must not change which challenges are already on the board,
    // or the board would feel unstable every time the library grew.
    const before = richLibrary();
    const after: LibrarySnapshot = {
      ...before,
      races: [...before.races, race({ id: 'brand-new', championshipId: 'c1' })],
    };

    const period = periodForScope('WEEKLY', NOW);
    const a = buildChallengesForScope('WEEKLY', before, period, period.key).map((c) => c.templateKey);
    const b = buildChallengesForScope('WEEKLY', after, period, period.key).map((c) => c.templateKey);
    expect(b).toEqual(a);
  });

  it('offers the configured number per scope when the library allows', () => {
    const library = richLibrary();
    for (const scope of SCOPES) {
      const generated = buildChallengesForScope(scope, library, periodForScope(scope, NOW), 's');
      expect(generated.length, scope).toBeLessThanOrEqual(CHALLENGE_CONFIG.counts[scope]);
      expect(generated.length, scope).toBeGreaterThan(0);
    }
  });

  it('never repeats a template within a board', () => {
    for (const scope of SCOPES) {
      const generated = buildChallengesForScope(scope, richLibrary(), periodForScope(scope, NOW), 's');
      expect(new Set(generated.map((c) => c.templateKey)).size).toBe(generated.length);
    }
  });
});

describe('challenge periods close on real calendar deadlines', () => {
  it('gives each scope the right window', () => {
    for (const scope of SCOPES) {
      for (const generated of buildChallengesForScope(scope, richLibrary(), periodForScope(scope, NOW), 's')) {
        const period = periodForScope(scope, NOW);
        expect(generated.periodStart.getTime()).toBe(period.start.getTime());
        expect(generated.periodEnd.getTime()).toBe(period.end.getTime());
      }
    }
  });
});

describe('challenge voice', () => {
  const FORBIDDEN = ['must', 'failed', 'penalty', 'you should', 'behind', 'overdue', 'don’t forget'];

  it('never phrases an objective as an obligation', () => {
    for (const scope of SCOPES) {
      for (const day of [1, 10, 20, 28]) {
        const now = new Date(2026, 8, day);
        for (const generated of buildChallengesForScope(scope, richLibrary(), periodForScope(scope, now), 's')) {
          const text = `${generated.title} ${generated.description}`.toLowerCase();
          for (const phrase of FORBIDDEN) {
            expect(text, `"${generated.title}"`).not.toContain(phrase);
          }
        }
      }
    }
  });
});
