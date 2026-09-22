/**
 * Momentum.
 *
 * The deliberately softer alternative to a streak. What matters here is what
 * it does NOT do: it never resets to nothing, it never goes negative, and it
 * never becomes a reason to watch something you did not want to watch.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildMomentumState, decayMomentum, gainForRealSeconds, tierForPoints,
} from '@/lib/engines/momentum-engine';
import { MOMENTUM_CONFIG } from '@/lib/config';

const H = 3600;

describe('decay', () => {
  it('settles gradually rather than resetting', () => {
    const after1 = decayMomentum(100, 1);
    const after3 = decayMomentum(100, 3);

    expect(after1).toBeLessThan(100);
    // A day away must not wipe it out.
    expect(after1).toBeGreaterThan(80);
    expect(after3).toBeLessThan(after1);
    expect(after3).toBeGreaterThan(50);
  });

  it('changes nothing on the same day', () => {
    expect(decayMomentum(64, 0)).toBe(64);
  });

  it('never falls below the configured floor', () => {
    expect(decayMomentum(160, 365)).toBeGreaterThanOrEqual(MOMENTUM_CONFIG.floor);
    expect(decayMomentum(160, 10_000)).toBeGreaterThanOrEqual(MOMENTUM_CONFIG.floor);
  });

  it('never goes negative, whatever it is handed', () => {
    for (const [points, days] of [[0, 30], [-50, 5], [10, -3], [Number.NaN, 2]] as const) {
      expect(decayMomentum(points, days)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is monotonic in the number of days away', () => {
    let previous = decayMomentum(120, 0);
    for (let days = 1; days <= 60; days += 1) {
      const current = decayMomentum(120, days);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('leaves something behind even after a very long break', () => {
    // A fortnight away should not feel like starting over.
    expect(decayMomentum(90, 14)).toBeGreaterThan(0);
  });
});

describe('gain', () => {
  it('rises with time watched', () => {
    expect(gainForRealSeconds(2 * H)).toBeGreaterThan(gainForRealSeconds(H));
  });

  it('caps what a single day can contribute', () => {
    expect(gainForRealSeconds(24 * H)).toBeLessThanOrEqual(MOMENTUM_CONFIG.maxDailyGain);
    expect(gainForRealSeconds(1000 * H)).toBeLessThanOrEqual(MOMENTUM_CONFIG.maxDailyGain);
  });

  it('gives a short stint something', () => {
    // Twenty-five minutes should still register. Every session matters.
    expect(gainForRealSeconds(25 * 60)).toBeGreaterThan(0);
  });

  it('never returns a negative gain', () => {
    for (const seconds of [0, -100, Number.NaN]) {
      expect(gainForRealSeconds(seconds)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('tiers', () => {
  it('starts at Cold Tyres', () => {
    expect(tierForPoints(0).name).toBe('Cold Tyres');
  });

  it('climbs through every configured tier', () => {
    for (const tier of MOMENTUM_CONFIG.tiers) {
      expect(tierForPoints(tier.min).key).toBe(tier.key);
    }
  });

  it('stays in the tier below until the threshold is crossed', () => {
    for (let i = 1; i < MOMENTUM_CONFIG.tiers.length; i += 1) {
      const tier = MOMENTUM_CONFIG.tiers[i]!;
      expect(tierForPoints(tier.min - 0.01).key).toBe(MOMENTUM_CONFIG.tiers[i - 1]!.key);
    }
  });

  it('holds at the top tier however high momentum goes', () => {
    const top = MOMENTUM_CONFIG.tiers[MOMENTUM_CONFIG.tiers.length - 1]!;
    expect(tierForPoints(99_999).key).toBe(top.key);
  });

  it('handles nonsense without breaking', () => {
    expect(tierForPoints(-100).key).toBe(MOMENTUM_CONFIG.tiers[0]!.key);
    expect(tierForPoints(Number.NaN).key).toBe(MOMENTUM_CONFIG.tiers[0]!.key);
  });
});

describe('the momentum state the UI renders', () => {
  it('describes progress towards the next tier', () => {
    const state = buildMomentumState(20);
    expect(state.tierName).toBe('Building Temperature');
    expect(state.nextTierName).toBe('In the Window');
    expect(state.progressToNext).toBeGreaterThan(0);
    expect(state.progressToNext).toBeLessThan(1);
    expect(state.pointsToNext).toBeGreaterThan(0);
  });

  it('reports the top tier as complete rather than as having more to do', () => {
    const state = buildMomentumState(MOMENTUM_CONFIG.ceiling);
    expect(state.nextTierName).toBeNull();
    expect(state.progressToNext).toBe(1);
    expect(state.pointsToNext).toBe(0);
  });

  it('always has a colour and a blurb to show', () => {
    for (const points of [0, 15, 40, 70, 100, 140, 500]) {
      const state = buildMomentumState(points);
      expect(state.tierColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(state.tierBlurb.length).toBeGreaterThan(0);
    }
  });

  it('keeps its bonus small and on the quarterly currency only', () => {
    const top = buildMomentumState(MOMENTUM_CONFIG.ceiling);
    expect(top.seasonXpBonus).toBeGreaterThanOrEqual(0);
    expect(top.seasonXpBonus).toBeLessThanOrEqual(0.12);
    expect(buildMomentumState(0).seasonXpBonus).toBe(0);
  });

  it('never reports a negative figure', () => {
    for (const points of [-100, 0, Number.NaN]) {
      const state = buildMomentumState(points);
      expect(state.points).toBeGreaterThanOrEqual(0);
      expect(state.progressToNext).toBeGreaterThanOrEqual(0);
      expect(state.pointsToNext).toBeGreaterThanOrEqual(0);
      expect(state.seasonXpBonus).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('momentum never becomes pressure', () => {
  it('says nothing about what happens if you stop', () => {
    // Comments are stripped first: the file's own header quotes the phrase it
    // refuses to say, which is documentation rather than an offence.
    const code = readFileSync(resolve(process.cwd(), 'src/lib/engines/momentum-engine.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const strings = [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
      .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase());

    for (const text of strings) {
      for (const phrase of ['lost', 'broken', 'you failed', 'keep it up or', 'don’t lose']) {
        expect(text, `"${text}"`).not.toContain(phrase);
      }
    }
  });

  it('cannot affect career XP', () => {
    // The bonus is on the quarterly currency alone, so momentum can never make
    // permanent progression objectively easier.
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/engines/momentum-engine.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(source).not.toMatch(/\bawardXp\b/);
    expect(source).not.toMatch(/careerXpBonus/);
  });

  it('recovers quickly once watching resumes', () => {
    // Two weeks away, then one good session: momentum should climb again
    // rather than needing the whole fortnight rebuilt.
    const afterBreak = decayMomentum(80, 14);
    const afterSession = Math.min(MOMENTUM_CONFIG.ceiling, afterBreak + gainForRealSeconds(2 * H));
    expect(afterSession).toBeGreaterThan(afterBreak);
  });
});
