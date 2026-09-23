/**
 * The quarterly season pass.
 *
 * The tier curve has to be reachable by a dedicated quarter without being
 * trivial, rewards have to be deterministic per tier, and — the constraint
 * that makes a real deadline acceptable — nothing on the track may make future
 * progression objectively easier.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cumulativeXpForTier, nextPassAppearance, nextSeason, rewardForTier, tierCost, tierForXp,
} from '@/lib/engines/season-pass-engine';
import {
  SEASON_PASS_CONFIG, XP_CONFIG, BUDGET_CONFIG, MILESTONE_REWARDS, STANDARD_REWARDS, THEMES, THEME_REWARDS,
  DEFAULT_THEME_KEY,
} from '@/lib/config';

const TIERS = SEASON_PASS_CONFIG.tierCount;

describe('the tier curve', () => {
  it('gets more expensive as it goes', () => {
    for (let tier = 2; tier <= TIERS; tier += 1) {
      expect(tierCost(tier)).toBeGreaterThan(tierCost(tier - 1));
    }
  });

  it('starts at the configured base', () => {
    expect(tierCost(1)).toBe(SEASON_PASS_CONFIG.baseTierCost);
  });

  it('accumulates consistently', () => {
    let running = 0;
    for (let tier = 1; tier <= TIERS; tier += 1) {
      running += tierCost(tier);
      expect(cumulativeXpForTier(tier)).toBe(running);
    }
  });

  it('places tier 0 at zero XP', () => {
    expect(cumulativeXpForTier(0)).toBe(0);
  });

  it('resolves XP back to a tier', () => {
    for (const tier of [1, 5, 25, 50, 99]) {
      const state = tierForXp(cumulativeXpForTier(tier));
      expect(state.tier, `tier ${tier}`).toBe(tier);
      expect(state.intoTier).toBe(0);
    }
  });

  it('reports the top of the track as full rather than as a fresh tier', () => {
    // There is no tier 101 to be starting on, so the last tier reads as
    // complete rather than resetting to zero progress.
    const top = tierForXp(cumulativeXpForTier(TIERS));
    expect(top.tier).toBe(TIERS);
    expect(top.progress).toBe(1);
  });

  it('is one tier short with one XP missing', () => {
    for (const tier of [2, 20, 60, 100]) {
      expect(tierForXp(cumulativeXpForTier(tier) - 1).tier).toBe(tier - 1);
    }
  });

  it('starts a new pass at tier zero', () => {
    const start = tierForXp(0);
    expect(start.tier).toBe(0);
    expect(start.intoTier).toBe(0);
    expect(start.progress).toBe(0);
  });

  it('stops at the top of the track', () => {
    const beyond = tierForXp(cumulativeXpForTier(TIERS) * 10);
    expect(beyond.tier).toBe(TIERS);
  });

  it('reports coherent progress inside a tier', () => {
    const halfway = cumulativeXpForTier(30) + Math.floor(tierCost(31) / 2);
    const state = tierForXp(halfway);
    expect(state.tier).toBe(30);
    expect(state.progress).toBeGreaterThan(0.4);
    expect(state.progress).toBeLessThan(0.6);
  });

  it('handles nonsense input without breaking', () => {
    expect(tierForXp(-500).tier).toBe(0);
    expect(Number.isFinite(tierForXp(Number.NaN).tier)).toBe(true);
  });
});

describe('the curve is balanced for a quarter', () => {
  it('lands a dedicated quarter near the top of the track', () => {
    // A quarter of the annual plan, all of it new coverage, plus a plausible
    // contribution from challenges and story bonuses.
    const quarterHours = BUDGET_CONFIG.annualHours / 4;
    const fromWatching = quarterHours * 60 * XP_CONFIG.seasonXpPerRealMinute;
    // Roughly a dozen races completed in the quarter, and the challenges that
    // go with them. Deliberately conservative.
    const fromCompletions = 12 * 450;
    const fromChallenges = 13 * 900 + 3 * 2_800 + 5 * 7_500;
    const total = fromWatching + fromCompletions + fromChallenges;

    const reached = tierForXp(total).tier;

    // Reachable, but the top of the track is a genuine achievement.
    expect(reached).toBeGreaterThan(60);
    expect(reached).toBeLessThanOrEqual(TIERS);
  });

  it('does not hand out the whole track for a casual quarter', () => {
    // A third of the plan, no challenges at all.
    const casualHours = BUDGET_CONFIG.annualHours / 12;
    const seasonXp = casualHours * 60 * XP_CONFIG.seasonXpPerRealMinute;
    expect(tierForXp(seasonXp).tier).toBeLessThan(TIERS);
  });

  it('moves in the first session of a new quarter', () => {
    // An hour of watching should visibly move the bar, not leave it at zero.
    const oneHour = 60 * XP_CONFIG.seasonXpPerRealMinute;
    expect(tierForXp(oneHour).tier).toBeGreaterThanOrEqual(1);
  });
});

describe('rewards', () => {
  it('is deterministic — a tier always yields the same reward', () => {
    for (let tier = 1; tier <= TIERS; tier += 1) {
      expect(rewardForTier(tier).key).toBe(rewardForTier(tier).key);
    }
  });

  it('gives every tier a reward', () => {
    for (let tier = 1; tier <= TIERS; tier += 1) {
      const reward = rewardForTier(tier);
      expect(reward.key, `tier ${tier}`).toBeTruthy();
      expect(reward.name).toBeTruthy();
      expect(reward.type).toBeTruthy();
    }
  });

  it('draws milestone tiers from the milestone pool', () => {
    const milestoneKeys = new Set(MILESTONE_REWARDS.map((r) => r.key));
    for (let tier = SEASON_PASS_CONFIG.milestoneEvery; tier <= TIERS; tier += SEASON_PASS_CONFIG.milestoneEvery) {
      expect(milestoneKeys, `tier ${tier}`).toContain(rewardForTier(tier).key);
    }
  });

  it('draws ordinary tiers from the standard pool', () => {
    const standardKeys = new Set(STANDARD_REWARDS.map((r) => r.key));
    for (let tier = 1; tier <= TIERS; tier += 1) {
      if (tier % SEASON_PASS_CONFIG.milestoneEvery === 0) continue;
      expect(standardKeys, `tier ${tier}`).toContain(rewardForTier(tier).key);
    }
  });

  it('never makes future progression objectively easier', () => {
    // The whole reason a real quarterly deadline is acceptable: every reward is
    // cosmetic, statistical or collectible. An XP_BONUS is a one-off grant, not
    // a multiplier, and nothing is a permanent rate change.
    const allowed = new Set([
      'BADGE', 'TITLE', 'THEME', 'RACE_CARD', 'TROPHY_ITEM', 'PATCH',
      'EMBLEM', 'BANNER', 'POSTER', 'XP_BONUS', 'HALL_OF_FAME_COLLECTIBLE',
    ]);
    for (let tier = 1; tier <= TIERS; tier += 1) {
      expect(allowed, `tier ${tier}`).toContain(rewardForTier(tier).type);
    }

    // And no reward anywhere in the pools describes itself as a multiplier.
    // Comments are allowed to discuss the rule; executable code is not.
    const code = readFileSync(resolve(process.cwd(), 'src/lib/config/rewards.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .toLowerCase();
    expect(code).not.toMatch(/multiplier|\bboost\b|permanent bonus/);
  });

  it('keeps every XP bonus a modest one-off', () => {
    for (const reward of [...STANDARD_REWARDS, ...MILESTONE_REWARDS]) {
      if (reward.type !== 'XP_BONUS') continue;
      expect(reward.amount).toBeGreaterThan(0);
      // Small next to what ordinary watching pays across a quarter, so the
      // pass can never become the main source of career progression.
      const quarterFromWatching = (BUDGET_CONFIG.annualHours / 4) * XP_CONFIG.xpPerRealMinute * 60;
      expect(reward.amount!).toBeLessThan(quarterFromWatching * 0.05);
    }
  });
});

describe('themes rotate by quarter', () => {
  const Q3_2026 = { year: 2026, quarter: 3 };
  const Q4_2026 = { year: 2026, quarter: 4 };
  const Q1_2027 = { year: 2027, quarter: 1 };

  function themesIn(season: { year: number; quarter: number }): string[] {
    const keys: string[] = [];
    for (let tier = 1; tier <= TIERS; tier += 1) {
      const reward = rewardForTier(tier, SEASON_PASS_CONFIG, season);
      if (reward.type === 'THEME') keys.push(reward.key);
    }
    return keys;
  }

  it('offers two themes a quarter, in the same two slots', () => {
    expect(themesIn(Q4_2026)).toHaveLength(2);
    expect(themesIn(Q1_2027)).toHaveLength(2);
  });

  it('starts the rotation with Sarthe and Daytona in the Q4 2026 pass', () => {
    expect(themesIn(Q4_2026)).toEqual(['theme_sarthe', 'theme_daytona']);
    expect(themesIn(Q1_2027)).toEqual(['theme_nordschleife', 'theme_midnight']);
  });

  it('offers every earnable theme within any two consecutive quarters', () => {
    const earnable = THEMES.filter((theme) => theme.key !== DEFAULT_THEME_KEY).map((theme) => `theme_${theme.key}`);
    let season = Q3_2026;
    for (let i = 0; i < 8; i += 1) {
      const next = nextSeason(season);
      const offered = new Set([...themesIn(season), ...themesIn(next)]);
      for (const key of earnable) expect(offered, `${season.year} Q${season.quarter}`).toContain(key);
      season = next;
    }
  });

  it('never offers the theme every account already has', () => {
    let season = Q3_2026;
    for (let i = 0; i < 8; i += 1) {
      expect(themesIn(season)).not.toContain(`theme_${DEFAULT_THEME_KEY}`);
      season = nextSeason(season);
    }
    expect(Object.values(THEME_REWARDS).map((r) => r.key)).not.toContain(`theme_${DEFAULT_THEME_KEY}`);
  });

  it('changes nothing but the theme slots from one quarter to the next', () => {
    for (let tier = 1; tier <= TIERS; tier += 1) {
      const a = rewardForTier(tier, SEASON_PASS_CONFIG, Q4_2026);
      const b = rewardForTier(tier, SEASON_PASS_CONFIG, Q1_2027);
      if (a.type === 'THEME') expect(b.type).toBe('THEME');
      else expect(b.key, `tier ${tier}`).toBe(a.key);
    }
  });

  it('can say where each theme is next on offer', () => {
    for (const reward of Object.values(THEME_REWARDS)) {
      const found = nextPassAppearance(reward.key, Q4_2026);
      expect(found, reward.key).not.toBeNull();
      expect(rewardForTier(found!.tier, SEASON_PASS_CONFIG, found!.season).key).toBe(reward.key);
    }
    expect(nextPassAppearance('theme_does_not_exist', Q4_2026)).toBeNull();
  });

  it('rolls the year over after the fourth quarter', () => {
    expect(nextSeason(Q4_2026)).toEqual({ year: 2027, quarter: 1 });
    expect(nextSeason(Q3_2026)).toEqual(Q4_2026);
  });
});

