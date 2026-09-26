/**
 * The Race Strategist.
 *
 * The single most important assertion in this file is that the strategist does
 * NOT optimise XP. Everything else follows from that: it recommends the race
 * that is most worth finishing, not the one that pays best per hour.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRecommendations, getRecommendations, getStrategist, scoreCandidate, summariseStillToCome,
  type RaceCandidate, type StrategistContext, type StrategistObjective,
} from '@/lib/engines/strategist-engine';
import { STRATEGIST_CONFIG } from '@/lib/config';

const H = 3600;

function candidate(overrides: Partial<RaceCandidate> = {}): RaceCandidate {
  const runtimeSec = overrides.runtimeSec ?? 6 * H;
  const coverageSec = overrides.coverageSec ?? 0;
  return {
    id: 'race-1',
    name: '6 Hours of Somewhere',
    championshipId: 'champ-1',
    championshipName: 'Test Championship',
    championshipColor: '#c8a45c',
    seasonId: 'season-1',
    seasonLabel: '2026 Test',
    circuit: 'Test Circuit',
    runtimeSec,
    coverageSec,
    status: coverageSec > 0 ? 'WATCHING' : 'UNWATCHED',
    priority: 'NORMAL',
    excitement: 3,
    isMajorEvent: false,
    storyComplete: false,
    raceDate: null,
    sessionCount: coverageSec > 0 ? 1 : 0,
    lastWatchedAt: null,
    gaps: coverageSec > 0
      ? [{ start: coverageSec, end: runtimeSec }]
      : [{ start: 0, end: runtimeSec }],
    avgPlaybackSpeed: 1,
    seasonRaceCount: 8,
    seasonRacesRemaining: 8,
    ...overrides,
  };
}

function context(overrides: Partial<StrategistContext> = {}): StrategistContext {
  return {
    now: new Date(2026, 8, 22, 20, 0),
    windowSeconds: 120 * 60,
    defaultPlaybackSpeed: 1,
    objectives: [],
    alreadySuggestedChampionshipIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The rule that matters most
// ---------------------------------------------------------------------------

describe('the strategist does not optimise XP', () => {
  it('never imports the XP configuration or the XP ledger', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/engines/strategist-engine.ts'),
      'utf8',
    );
    // Comments are allowed to *discuss* XP — the file explains this very rule.
    // What matters is that no executable line can reach it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Structural, not stylistic: if the engine cannot reach XP, it cannot
    // optimise for it.
    expect(code).not.toMatch(/from\s+['"]@\/lib\/engines\/xp-ledger['"]/);
    expect(code).not.toMatch(/\bXP_CONFIG\b/);
    expect(code).not.toMatch(/\bxpForSession\b/);
    expect(code).not.toMatch(/\bstoryCompleteBonus\b/);
    expect(code).not.toMatch(/\bcareerXp\b/);
    expect(code).not.toMatch(/\bseasonXp\b/);
    expect(code).not.toMatch(/xpPerHour/i);
  });

  it('prefers a nearly-finished short race over an untouched long one', () => {
    // A 24-hour race is worth far more XP than finishing a 4-hour race that is
    // 90% done. Narrative continuity has to win anyway.
    const nearlyDone = candidate({
      id: 'nearly', name: '4 Hours', runtimeSec: 4 * H, coverageSec: 3.6 * H,
      lastWatchedAt: new Date(2026, 8, 20),
    });
    const bigUntouched = candidate({
      id: 'big', name: '24 Hours', runtimeSec: 24 * H, coverageSec: 0,
      championshipId: 'champ-1',
    });

    const a = scoreCandidate(nearlyDone, context());
    const b = scoreCandidate(bigUntouched, context());
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('does not rank a race higher merely because it is longer', () => {
    const short = candidate({ id: 'short', runtimeSec: 4 * H });
    const long = candidate({ id: 'long', runtimeSec: 24 * H });
    // With everything else equal, a longer race is not automatically better.
    expect(scoreCandidate(long, context()).score)
      .not.toBeGreaterThan(scoreCandidate(short, context()).score * 1.5);
  });

  it('knows an objective is open without knowing what it pays', () => {
    const objective: StrategistObjective = {
      key: 'challenge-1',
      label: 'Complete one race story',
      kind: 'CHALLENGE',
      raceIds: ['race-1'],
      championshipIds: [],
      seasonIds: [],
      minRuntimeSec: 0,
      requiresMajorEvent: false,
      favoursStoryComplete: true,
      remainingFraction: 1,
    };
    // The type itself carries no reward figure — this is a compile-time
    // guarantee as much as a runtime one.
    expect(Object.keys(objective)).not.toContain('xpReward');
    expect(Object.keys(objective)).not.toContain('reward');
  });
});

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

describe('continuity', () => {
  it('scores a partially watched race above an identical untouched one', () => {
    const started = candidate({ id: 'started', coverageSec: 3 * H, lastWatchedAt: new Date(2026, 8, 20) });
    const fresh = candidate({ id: 'fresh', coverageSec: 0 });

    expect(scoreCandidate(started, context()).score)
      .toBeGreaterThan(scoreCandidate(fresh, context()).score);
  });

  it('explains continuity in its reasons', () => {
    const started = candidate({ coverageSec: 4 * H, lastWatchedAt: new Date(2026, 8, 20) });
    const { reasons } = scoreCandidate(started, context());
    expect(reasons.join(' ').toLowerCase()).toMatch(/through|continue|progress|story/);
  });

  it('nudges gently for a race left alone a while, and does not escalate forever', () => {
    const base = { id: 'stale', coverageSec: 2 * H };
    const recent = scoreCandidate(candidate({ ...base, lastWatchedAt: new Date(2026, 8, 21) }), context());
    const old = scoreCandidate(candidate({ ...base, lastWatchedAt: new Date(2026, 7, 1) }), context());
    const ancient = scoreCandidate(candidate({ ...base, lastWatchedAt: new Date(2024, 0, 1) }), context());

    expect(old.score).toBeGreaterThan(recent.score);
    // Capped: two years away is not meaningfully more urgent than two months.
    expect(ancient.score).toBeCloseTo(old.score, 0);
  });
});

// ---------------------------------------------------------------------------
// Window fit
// ---------------------------------------------------------------------------

describe('window fit', () => {
  it('prefers a race that can be finished inside the available window', () => {
    const fits = candidate({ id: 'fits', runtimeSec: 6 * H, coverageSec: 5 * H });
    const doesNot = candidate({ id: 'doesnt', runtimeSec: 6 * H, coverageSec: 0 });

    const ctx = context({ windowSeconds: 75 * 60 });
    expect(scoreCandidate(fits, ctx).score).toBeGreaterThan(scoreCandidate(doesNot, ctx).score);
  });

  it('accounts for playback speed when judging the fit', () => {
    const race = candidate({ runtimeSec: 6 * H, coverageSec: 4 * H, avgPlaybackSpeed: 2 });
    const slowCtx = context({ windowSeconds: 70 * 60 });
    const { score } = scoreCandidate(race, slowCtx);
    // Two hours of timeline at 2x is one real hour, which fits comfortably.
    expect(score).toBeGreaterThan(0);
  });

  it('does not exclude a long race, it divides it', () => {
    const longHaul = candidate({ id: 'le-mans', runtimeSec: 24 * H, coverageSec: 6 * H, isMajorEvent: true });
    const recommendations = buildRecommendations([longHaul], context({ windowSeconds: 90 * 60 }));

    expect(recommendations.length).toBeGreaterThan(0);
    const pick = recommendations[0]!;
    expect(pick.suggestedStintSeconds).toBeGreaterThan(0);
    expect(pick.suggestedStintSeconds).toBeLessThan(pick.realSecondsToFinish);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('buildRecommendations', () => {
  const library = [
    candidate({ id: 'a', name: 'Continuing race', coverageSec: 4 * H, lastWatchedAt: new Date(2026, 8, 19) }),
    candidate({ id: 'b', name: 'Short unwatched', runtimeSec: 4 * H, coverageSec: 0, championshipId: 'champ-2', championshipName: 'Other' }),
    candidate({ id: 'c', name: 'Long unwatched', runtimeSec: 12 * H, coverageSec: 0, championshipId: 'champ-3', championshipName: 'Third', excitement: 5 }),
    candidate({ id: 'd', name: 'Another continuing', coverageSec: 2 * H, lastWatchedAt: new Date(2026, 7, 30) }),
  ];

  it('returns three suggestions of three distinct kinds', () => {
    const result = buildRecommendations(library, context());
    expect(result).toHaveLength(STRATEGIST_CONFIG.recommendationCount);
    expect(new Set(result.map((r) => r.kind)).size).toBe(3);
    expect(result.map((r) => r.kind)).toContain('CONTINUE');
    expect(result.map((r) => r.kind)).toContain('BEST_FIT');
    expect(result.map((r) => r.kind)).toContain('WILDCARD');
  });

  it('never recommends the same race twice', () => {
    const result = buildRecommendations(library, context());
    expect(new Set(result.map((r) => r.raceId)).size).toBe(result.length);
  });

  it('never recommends a finished story', () => {
    const done = candidate({ id: 'done', storyComplete: true, coverageSec: 6 * H });
    const result = buildRecommendations([...library, done], context());
    expect(result.map((r) => r.raceId)).not.toContain('done');
  });

  it('never recommends an archived or set-aside race', () => {
    const archived = candidate({ id: 'archived', status: 'ARCHIVED' });
    const abandoned = candidate({ id: 'abandoned', status: 'ABANDONED' });
    const result = buildRecommendations([archived, abandoned, ...library], context());
    expect(result.map((r) => r.raceId)).not.toContain('archived');
    expect(result.map((r) => r.raceId)).not.toContain('abandoned');
  });

  it('puts a partially watched race in the CONTINUE slot', () => {
    const result = buildRecommendations(library, context());
    const continuing = result.find((r) => r.kind === 'CONTINUE');
    expect(continuing).toBeDefined();
    expect(continuing!.coverageSec).toBeGreaterThan(0);
  });

  it('returns fewer suggestions rather than padding', () => {
    const result = buildRecommendations([library[0]!], context());
    expect(result).toHaveLength(1);
  });

  it('returns nothing for an empty library', () => {
    expect(buildRecommendations([], context())).toEqual([]);
  });

  it('is deterministic for a given day', () => {
    const ctx = context();
    const a = buildRecommendations(library, ctx);
    const b = buildRecommendations(library, ctx);
    expect(a.map((r) => `${r.kind}:${r.raceId}`)).toEqual(b.map((r) => `${r.kind}:${r.raceId}`));
  });

  it('can vary the wildcard from day to day', () => {
    const bigLibrary = Array.from({ length: 14 }, (_, i) =>
      candidate({
        id: `w${i}`, name: `Race ${i}`, coverageSec: 0,
        championshipId: `champ-${i % 5}`, championshipName: `Champ ${i % 5}`,
        excitement: (i % 5) + 1,
      }));

    const days = [1, 8, 15, 22, 29].map((day) =>
      buildRecommendations(bigLibrary, context({ now: new Date(2026, 8, day) }))
        .find((r) => r.kind === 'WILDCARD')?.raceId);

    // Not every day has to differ, but they must not all be identical.
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('prefers variety across the three slots', () => {
    const varied = [
      candidate({ id: 'v1', coverageSec: 3 * H, championshipId: 'c1', championshipName: 'One', lastWatchedAt: new Date(2026, 8, 20) }),
      candidate({ id: 'v2', coverageSec: 0, championshipId: 'c2', championshipName: 'Two' }),
      candidate({ id: 'v3', coverageSec: 0, championshipId: 'c3', championshipName: 'Three', excitement: 5 }),
      candidate({ id: 'v4', coverageSec: 0, championshipId: 'c1', championshipName: 'One' }),
    ];
    const result = buildRecommendations(varied, context());
    const championships = result.map((r) => r.championshipName);
    expect(new Set(championships).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Races still to come (0.3.2)
// ---------------------------------------------------------------------------

describe('races still to come', () => {
  /** A race date exactly as the date field stores it: the typed day at midnight UTC. */
  const typed = (isoDay: string): Date => new Date(isoDay);

  // The default context is the evening of 22 September 2026, local time.
  const library = [
    candidate({ id: 'past', name: 'Already run', raceDate: typed('2026-09-06'), championshipId: 'champ-2' }),
    candidate({ id: 'undated', name: 'No date', championshipId: 'champ-3' }),
    candidate({ id: 'future', name: 'Not run yet', raceDate: typed('2026-11-07'), excitement: 5, isMajorEvent: true, priority: 'MUST_WATCH' }),
    candidate({ id: 'later', name: 'Even later', raceDate: typed('2027-06-12'), excitement: 5, championshipId: 'champ-4' }),
  ];

  it('never suggests a race dated after today, in any slot', () => {
    const result = buildRecommendations(library, context());
    const ids = result.map((r) => r.raceId);
    expect(ids).not.toContain('future');
    expect(ids).not.toContain('later');
    expect(ids).toEqual(expect.arrayContaining(['past', 'undated']));
  });

  it('suggests nothing when every unfinished race is still to come', () => {
    expect(buildRecommendations([library[2]!, library[3]!], context())).toEqual([]);
  });

  it('leaves a race out until the end of the day before, and suggests it from its race day', () => {
    const race = candidate({ id: 'race-day', raceDate: typed('2026-11-07') });
    const lastMinuteBefore = context({ now: new Date(2026, 10, 6, 23, 59, 59) });
    const firstMinuteOf = context({ now: new Date(2026, 10, 7, 0, 0, 0) });
    const dayAfter = context({ now: new Date(2026, 10, 8, 12) });

    expect(buildRecommendations([race], lastMinuteBefore)).toEqual([]);
    expect(buildRecommendations([race], firstMinuteOf).map((r) => r.raceId)).toEqual(['race-day']);
    expect(buildRecommendations([race], dayAfter).map((r) => r.raceId)).toEqual(['race-day']);
  });

  it('keeps suggesting a dated race once a stint has been logged on it', () => {
    // An overnight race from the other side of the world begins the evening
    // before the day it is dated; a story under way is never put out of reach.
    const started = candidate({
      id: 'started', raceDate: typed('2026-09-23'), coverageSec: 2 * H, sessionCount: 1,
      lastWatchedAt: new Date(2026, 8, 22, 18),
    });
    const result = buildRecommendations([started], context());
    expect(result.map((r) => `${r.kind}:${r.raceId}`)).toEqual(['CONTINUE:started']);
  });

  it('still suggests races with no race date', () => {
    const result = buildRecommendations([candidate({ id: 'undated', raceDate: null })], context());
    expect(result.map((r) => r.raceId)).toEqual(['undated']);
  });

  it('counts the races it left out, and names the first day, not the races', () => {
    const summary = summariseStillToCome(library, context().now);
    expect(summary.count).toBe(2);
    expect(summary.nextRaceDay).toEqual(new Date(2026, 10, 7));
    expect(Object.keys(summary).sort()).toEqual(['count', 'nextRaceDay']);
  });

  it('names the earliest day whatever order the races come in', () => {
    const later = library[3]!;
    const first = library[2]!;
    for (const order of [[later, first], [first, later], [later, library[0]!, first]]) {
      expect(summariseStillToCome(order, context().now).nextRaceDay).toEqual(new Date(2026, 10, 7));
    }
  });

  it('counts only races the suggestions skipped for their date', () => {
    const finished = candidate({ id: 'finished', raceDate: typed('2026-12-01'), storyComplete: true });
    const archived = candidate({ id: 'archived', raceDate: typed('2026-10-01'), status: 'ARCHIVED' });
    const setAside = candidate({ id: 'set-aside', raceDate: typed('2026-10-02'), status: 'ABANDONED' });
    const started = candidate({ id: 'started', raceDate: typed('2026-10-03'), coverageSec: H, sessionCount: 1 });
    const duplicate = library[2]!;
    const summary = summariseStillToCome([finished, archived, setAside, started, ...[...library].reverse(), duplicate], context().now);
    expect(summary).toEqual({ count: 2, nextRaceDay: new Date(2026, 10, 7) });
  });

  it('reports nothing left out when nothing is still to come', () => {
    expect(summariseStillToCome([library[0]!, library[1]!], context().now)).toEqual({ count: 0, nextRaceDay: null });
    expect(summariseStillToCome([], context().now)).toEqual({ count: 0, nextRaceDay: null });
  });
});

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

describe('recommendations never sound mandatory', () => {
  const FORBIDDEN = ['you must', 'you should', 'you need to', 'required', 'don’t forget', 'catch up', 'behind'];

  it('avoids instruction language in every headline and reason', () => {
    const library = [
      candidate({ id: 'a', coverageSec: 4 * H, lastWatchedAt: new Date(2026, 8, 19) }),
      candidate({ id: 'b', runtimeSec: 24 * H, coverageSec: 6 * H, isMajorEvent: true, championshipId: 'c2', championshipName: 'Two' }),
      candidate({ id: 'c', runtimeSec: 4 * H, coverageSec: 0, championshipId: 'c3', championshipName: 'Three' }),
    ];

    for (const windowSeconds of [15 * 60, 60 * 60, 180 * 60, 600 * 60]) {
      for (const rec of buildRecommendations(library, context({ windowSeconds }))) {
        const text = `${rec.headline} ${rec.reasons.join(' ')}`.toLowerCase();
        for (const phrase of FORBIDDEN) {
          expect(text, `"${rec.headline}"`).not.toContain(phrase);
        }
      }
    }
  });

  it('writes a headline that names the race and what it would take', () => {
    const rec = buildRecommendations(
      [candidate({ name: '6 Hours of Fuji', coverageSec: 4.32 * H, lastWatchedAt: new Date(2026, 8, 20) })],
      context(),
    )[0]!;

    expect(rec.headline).toContain('6 Hours of Fuji');
    expect(rec.headline).toMatch(/\d/);
    expect(rec.completionPercent).toBeGreaterThan(70);
  });

  it('calls a long race a long race: an Expedition is something a race is followed as (0.4.0)', () => {
    for (const windowSeconds of [60 * 60, 600 * 60]) {
      const recs = buildRecommendations([candidate({ name: '24 Hours of Spa', runtimeSec: 24 * H })], context({ windowSeconds }));
      const bestFit = recs.find((rec) => rec.kind === 'BEST_FIT');
      expect(bestFit?.headline).toContain('the 24 Hours of Spa is a long race of about');
      for (const rec of recs) expect(rec.headline.toLowerCase()).not.toContain('expedition');
    }
  });
});

describe('getRecommendations', () => {
  it('is exported for the pages to call', () => {
    expect(typeof getRecommendations).toBe('function');
    expect(typeof getStrategist).toBe('function');
  });
});
