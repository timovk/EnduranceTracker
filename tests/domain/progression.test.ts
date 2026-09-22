/**
 * XP, levels and prestige.
 *
 * The properties asserted here are the ones that would corrupt a career if
 * they broke: no negative XP, no speed exploit, no re-watch farm, and a level
 * curve that round-trips.
 */

import { describe, expect, it } from 'vitest';
import {
  levelForPrestige, levelFromXp, nextTitleAfter, prestigeForLevel, prestigeLabel,
  storyCompleteBonus, titleForLevel, totalXpForLevel, xpForNextLevel, xpForSession,
} from '@/lib/domain/progression';
import { XP_CONFIG } from '@/lib/config';

const H = 3600;

describe('level curve', () => {
  it('costs more for each successive level', () => {
    for (let level = 1; level < 500; level += 1) {
      expect(xpForNextLevel(level + 1)).toBeGreaterThan(xpForNextLevel(level));
    }
  });

  it('starts at level 1 with zero XP', () => {
    const state = levelFromXp(0);
    expect(state.level).toBe(1);
    expect(state.xpIntoLevel).toBe(0);
  });

  it('round-trips: the XP total for a level resolves back to that level', () => {
    for (const level of [1, 2, 3, 10, 25, 47, 50, 100, 250, 333, 500]) {
      const state = levelFromXp(totalXpForLevel(level));
      expect(state.level).toBe(level);
      expect(state.xpIntoLevel).toBe(0);
    }
  });

  it('one XP short of a level does not promote', () => {
    for (const level of [5, 20, 60, 120]) {
      expect(levelFromXp(totalXpForLevel(level) - 1).level).toBe(level - 1);
    }
  });

  it('reports consistent progress within a level', () => {
    const state = levelFromXp(totalXpForLevel(20) + 100);
    expect(state.level).toBe(20);
    expect(state.xpIntoLevel).toBe(100);
    expect(state.progress).toBeCloseTo(100 / state.xpForLevel, 6);
    expect(state.nextLevelXp - state.levelStartXp).toBe(state.xpForLevel);
  });

  it('is effectively endless — there is no maximum level', () => {
    // A number far beyond any plausible career still resolves, and higher.
    const enormous = levelFromXp(5_000_000_000);
    expect(enormous.level).toBeGreaterThan(1000);
    expect(levelFromXp(50_000_000_000).level).toBeGreaterThan(enormous.level);
  });

  it('handles negative or nonsense input without breaking', () => {
    expect(levelFromXp(-500).level).toBe(1);
  });

  it('brings early levels quickly and later levels slowly', () => {
    // Level 10 should be a handful of hours of watching; level 100 a career.
    const xpPerViewingHour = XP_CONFIG.xpPerRealMinute * 60;
    expect(totalXpForLevel(10) / xpPerViewingHour).toBeLessThan(25);
    expect(totalXpForLevel(100) / xpPerViewingHour).toBeGreaterThan(1000);
  });
});

describe('titles', () => {
  it('uses the highest threshold at or below the level', () => {
    expect(titleForLevel(1).title).toBe('Paddock Newcomer');
    expect(titleForLevel(10).title).toBe('Rookie Endurance Fan');
    expect(titleForLevel(24).title).toBe('Pit Wall Observer');
    expect(titleForLevel(25).title).toBe('Stint Specialist');
    expect(titleForLevel(50).title).toBe('Strategy Engineer');
    expect(titleForLevel(100).title).toBe('Endurance Veteran');
    expect(titleForLevel(250).title).toBe('Long-Haul Specialist');
    expect(titleForLevel(500).title).toBe('Endurance Master');
    expect(titleForLevel(1000).title).toBe('Living Timing Screen');
  });

  it('keeps the top title beyond the last threshold', () => {
    expect(titleForLevel(99_999).title).toBe(titleForLevel(2000).title);
  });

  it('reports the next title ahead', () => {
    expect(nextTitleAfter(10)?.level).toBe(15);
    expect(nextTitleAfter(99_999)).toBeNull();
  });
});

describe('prestige', () => {
  it('is zero before the first threshold', () => {
    expect(prestigeForLevel(99)).toBe(0);
  });

  it('increases at each configured threshold', () => {
    expect(prestigeForLevel(100)).toBe(1);
    expect(prestigeForLevel(150)).toBe(2);
    expect(prestigeForLevel(1000)).toBe(10);
  });

  it('keeps going beyond the explicit list', () => {
    expect(prestigeForLevel(1250)).toBe(11);
    expect(prestigeForLevel(1500)).toBe(12);
  });

  it('never decreases as level rises', () => {
    let previous = 0;
    for (let level = 1; level <= 3000; level += 7) {
      const rank = prestigeForLevel(level);
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it('maps ranks back to the level that unlocks them', () => {
    for (let rank = 1; rank <= 14; rank += 1) {
      expect(prestigeForLevel(levelForPrestige(rank))).toBe(rank);
    }
  });

  it('labels ranks in roman numerals', () => {
    expect(prestigeLabel(1)).toBe('Prestige I');
    expect(prestigeLabel(4)).toBe('Prestige IV');
    expect(prestigeLabel(9)).toBe('Prestige IX');
    expect(prestigeLabel(0)).toBe('');
  });
});

describe('xpForSession', () => {
  it('pays the configured rate for newly watched timeline', () => {
    const result = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    expect(result.careerXp).toBe(XP_CONFIG.xpPerRealMinute * 60);
  });

  it('never returns negative XP', () => {
    const cases = [
      { timelineSeconds: -100, newCoverageSeconds: -50, playbackSpeed: 1 },
      { timelineSeconds: 0, newCoverageSeconds: 0, playbackSpeed: 0 },
      { timelineSeconds: 100, newCoverageSeconds: 500, playbackSpeed: -3 },
    ];
    for (const input of cases) {
      const result = xpForSession(input);
      expect(result.careerXp).toBeGreaterThanOrEqual(0);
      expect(result.seasonXp).toBeGreaterThanOrEqual(0);
    }
  });

  it('cannot be farmed by playback speed: faster playback earns less', () => {
    const slow = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    const fast = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 2 });
    const faster = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 4 });

    expect(fast.careerXp).toBeLessThan(slow.careerXp);
    expect(faster.careerXp).toBeLessThan(fast.careerXp);
    // XP tracks real time, so 2x playback is worth half as much.
    expect(fast.careerXp).toBe(Math.round(slow.careerXp / 2));
  });

  it('bounds the slow-speed exploit', () => {
    // Claiming 0.1x playback must not manufacture ten times the real hours.
    const honest = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    const exploit = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 0.05 });

    expect(exploit.speedGuardApplied).toBe(true);
    // The ceiling is 1/xpMinSpeed, not unbounded.
    expect(exploit.careerXp).toBeLessThanOrEqual(Math.round(honest.careerXp / XP_CONFIG.xpMinSpeed));
    expect(exploit.careerXp / honest.careerXp).toBeLessThan(1.4);
  });

  it('pays only a fraction for re-watched timeline', () => {
    const fresh = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    const rewatch = xpForSession({ timelineSeconds: H, newCoverageSeconds: 0, playbackSpeed: 1 });

    expect(rewatch.careerXp).toBe(Math.round(fresh.careerXp * XP_CONFIG.rewatchXpMultiplier));
    expect(rewatch.careerXp).toBeGreaterThan(0); // a genuine re-watch still counts for something
  });

  it('cannot be farmed by logging the same interval repeatedly', () => {
    // Ten identical re-logs of an hour already watched must not approach the
    // value of watching ten fresh hours.
    const fresh = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    const tenRelogs = 10 * xpForSession({ timelineSeconds: H, newCoverageSeconds: 0, playbackSpeed: 1 }).careerXp;
    expect(tenRelogs).toBeLessThan(fresh.careerXp * 10 * XP_CONFIG.rewatchXpMultiplier + 1);
  });

  it('splits a partly-new stint proportionally', () => {
    const half = xpForSession({ timelineSeconds: H, newCoverageSeconds: H / 2, playbackSpeed: 1 });
    const allNew = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    const allOld = xpForSession({ timelineSeconds: H, newCoverageSeconds: 0, playbackSpeed: 1 });

    expect(half.careerXp).toBe(Math.round((allNew.careerXp + allOld.careerXp) / 2));
  });

  it('clamps new coverage that exceeds the timeline played', () => {
    const impossible = xpForSession({ timelineSeconds: 600, newCoverageSeconds: 99_999, playbackSpeed: 1 });
    const honest = xpForSession({ timelineSeconds: 600, newCoverageSeconds: 600, playbackSpeed: 1 });
    expect(impossible.careerXp).toBe(honest.careerXp);
  });

  it('awards season XP alongside career XP at its own rate', () => {
    const result = xpForSession({ timelineSeconds: H, newCoverageSeconds: H, playbackSpeed: 1 });
    expect(result.seasonXp).toBe(XP_CONFIG.seasonXpPerRealMinute * 60);
  });
});

describe('storyCompleteBonus', () => {
  it('scales with race length', () => {
    const four = storyCompleteBonus(4 * H).careerXp;
    const six = storyCompleteBonus(6 * H).careerXp;
    const twelve = storyCompleteBonus(12 * H).careerXp;
    const twentyFour = storyCompleteBonus(24 * H).careerXp;

    expect(four).toBe(1_000);
    expect(six).toBe(1_500);
    expect(twelve).toBe(3_000);
    expect(twentyFour).toBe(7_500);
    expect(four).toBeLessThan(six);
    expect(six).toBeLessThan(twelve);
    expect(twelve).toBeLessThan(twentyFour);
  });

  it('pays more for a major event', () => {
    const ordinary = storyCompleteBonus(24 * H, false).careerXp;
    const major = storyCompleteBonus(24 * H, true).careerXp;
    expect(major).toBeGreaterThan(ordinary);
    expect(major).toBe(Math.round(ordinary * XP_CONFIG.majorEventStoryMultiplier));
  });

  it('handles a race longer than every configured band', () => {
    expect(storyCompleteBonus(48 * H).careerXp).toBe(7_500);
  });

  it('handles a very short race', () => {
    expect(storyCompleteBonus(600).careerXp).toBe(500);
  });
});

describe('ordinary watching remains the main source of XP', () => {
  it('a 6-hour race earns more from watching it than from its completion bonus', () => {
    const viewing = xpForSession({ timelineSeconds: 6 * H, newCoverageSeconds: 6 * H, playbackSpeed: 1 }).careerXp;
    const bonus = storyCompleteBonus(6 * H).careerXp;
    expect(viewing).toBeGreaterThan(bonus);
  });

  it('holds even for a 24-hour race', () => {
    const viewing = xpForSession({ timelineSeconds: 24 * H, newCoverageSeconds: 24 * H, playbackSpeed: 1.5 }).careerXp;
    expect(viewing).toBeGreaterThan(storyCompleteBonus(24 * H, true).careerXp);
  });
});
