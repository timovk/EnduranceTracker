/**
 * Achievements and milestones.
 *
 * Pure evaluation only — the database-facing sync is covered by the
 * integration tests. What matters here is that a metric maps to the right
 * progress, that an achievement can never be lost, and that milestone rungs
 * are climbed in order.
 */

import { describe, expect, it } from 'vitest';
import { evaluateAchievement, milestoneXpFor, nextMilestoneFor } from '@/lib/engines/achievement-engine';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_KEY, MILESTONES, type AchievementDef } from '@/lib/config';
import { emptyMetrics, type CareerMetrics } from '@/lib/engines/metrics';

function metrics(overrides: Partial<CareerMetrics> = {}): CareerMetrics {
  return { ...emptyMetrics(), ...overrides };
}

function def(key: string): AchievementDef {
  const found = ACHIEVEMENTS_BY_KEY.get(key);
  if (!found) throw new Error(`No achievement named ${key}`);
  return found;
}

describe('achievement definitions', () => {
  it('has unique keys', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
  });

  it('measures every achievement against a real career metric', () => {
    const available = new Set(Object.keys(emptyMetrics()));
    for (const achievement of ACHIEVEMENTS) {
      expect(available, `${achievement.key} tracks "${achievement.metric}"`).toContain(achievement.metric);
    }
  });

  it('never has a negative or zero reward', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.xpReward).toBeGreaterThan(0);
      expect(achievement.threshold).toBeGreaterThan(0);
    }
  });

  it('pays more for rarer achievements on average', () => {
    const average = (rarity: string) => {
      const set = ACHIEVEMENTS.filter((a) => a.rarity === rarity);
      return set.reduce((sum, a) => sum + a.xpReward, 0) / Math.max(1, set.length);
    };
    expect(average('LEGENDARY')).toBeGreaterThan(average('COMMON'));
    expect(average('MYTHIC')).toBeGreaterThan(average('RARE'));
  });

  it('covers the achievements named in the specification', () => {
    for (const key of [
      'lights_out', 'double_stint', 'the_long_game', 'half_a_day',
      'twice_around_the_clock', 'globe_trotter', 'multiclass_addict',
      'season_sweep', 'centurion', 'ironman',
    ]) {
      expect(ACHIEVEMENTS_BY_KEY.has(key), key).toBe(true);
    }
  });
});

describe('evaluateAchievement', () => {
  it('reports progress before unlocking — the bar is always visible', () => {
    const result = evaluateAchievement(def('globe_trotter'), metrics({ circuits: 18 }));
    expect(result.unlocked).toBe(false);
    expect(result.value).toBe(18);
    expect(result.target).toBe(25);
  });

  it('unlocks exactly at the threshold', () => {
    expect(evaluateAchievement(def('globe_trotter'), metrics({ circuits: 24 })).unlocked).toBe(false);
    expect(evaluateAchievement(def('globe_trotter'), metrics({ circuits: 25 })).unlocked).toBe(true);
    expect(evaluateAchievement(def('globe_trotter'), metrics({ circuits: 26 })).unlocked).toBe(true);
  });

  it('reads the right metric for each achievement', () => {
    expect(evaluateAchievement(def('ironman'), metrics({ realHours: 1_000 })).unlocked).toBe(true);
    expect(evaluateAchievement(def('ironman'), metrics({ storyCompletes: 1_000 })).unlocked).toBe(false);

    expect(evaluateAchievement(def('twice_around_the_clock'), metrics({ stories24h: 1 })).unlocked).toBe(true);
    expect(evaluateAchievement(def('centurion'), metrics({ storyCompletes: 100 })).unlocked).toBe(true);
    expect(evaluateAchievement(def('level_50'), metrics({ level: 50 })).unlocked).toBe(true);
  });

  it('unlocks nothing for an untouched career', () => {
    for (const achievement of ACHIEVEMENTS) {
      const result = evaluateAchievement(achievement, metrics());
      expect(result.unlocked, achievement.key).toBe(false);
    }
  });

  it('starts every counted achievement at zero', () => {
    // `level` legitimately starts at 1, so level achievements are excluded.
    for (const achievement of ACHIEVEMENTS.filter((a) => a.metric !== 'level')) {
      expect(evaluateAchievement(achievement, metrics()).value, achievement.key).toBe(0);
    }
  });

  it('unlocks everything for an extraordinary career', () => {
    const enormous = metrics({
      realHours: 100_000, timelineHours: 100_000, racesCompleted: 10_000, storyCompletes: 10_000,
      stories8h: 999, stories10h: 999, stories12h: 999, stories24h: 999, majorEventStories: 999,
      championships: 99, championshipsCompleted: 99, seasonsCompleted: 99, seasonsStoryComplete: 99,
      circuits: 200, countries: 99, distinctRaceTypesStoried: 8, sessions: 99_999,
      longestSessionHours: 24, maxSessionsForOneStory: 99, puristStories: 50,
      level: 5_000, prestige: 20, careerXp: 9e9, careerXpMillions: 9_000,
      lifetimeActiveDays: 9_999, masteryTreesCompleted: 50, seasonPassesCompleted: 40,
      longestConsecutiveEditions: 30, maxEditionsOfOneEvent: 30, longBreakReturns: 10,
    });
    for (const achievement of ACHIEVEMENTS) {
      expect(evaluateAchievement(achievement, enormous).unlocked, achievement.key).toBe(true);
    }
  });

  it('never reports negative progress, whatever the metrics say', () => {
    const odd = metrics({ circuits: -5, realHours: -100, storyCompletes: -3 });
    for (const achievement of ACHIEVEMENTS) {
      expect(evaluateAchievement(achievement, odd).value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('milestones', () => {
  it('has ascending, unique thresholds', () => {
    for (const milestone of MILESTONES) {
      const sorted = [...milestone.thresholds].sort((a, b) => a - b);
      expect(milestone.thresholds, milestone.metric).toEqual(sorted);
      expect(new Set(milestone.thresholds).size).toBe(milestone.thresholds.length);
    }
  });

  it('tracks real career metrics', () => {
    const available = new Set(Object.keys(emptyMetrics()));
    for (const milestone of MILESTONES) {
      expect(available, milestone.metric).toContain(milestone.metric);
    }
  });

  it('extends far into the future', () => {
    const hours = MILESTONES.find((m) => m.metric === 'realHours')!;
    const top = hours.thresholds[hours.thresholds.length - 1]!;
    // Decades of watching, not a year of it.
    expect(top).toBeGreaterThan(336 * 20);
  });

  it('finds the next rung ahead', () => {
    const hours = MILESTONES.find((m) => m.metric === 'realHours')!;
    const next = nextMilestoneFor(hours, 60);
    expect(next).not.toBeNull();
    expect(next!.threshold).toBe(100);
    expect(next!.progress).toBeGreaterThan(0);
    expect(next!.progress).toBeLessThan(1);
  });

  it('returns null once every rung is climbed', () => {
    const hours = MILESTONES.find((m) => m.metric === 'realHours')!;
    expect(nextMilestoneFor(hours, 1e9)).toBeNull();
  });

  it('measures progress from the rung below, not from zero', () => {
    const hours = MILESTONES.find((m) => m.metric === 'realHours')!;
    // Halfway between 50 and 100.
    const next = nextMilestoneFor(hours, 75);
    expect(next!.threshold).toBe(100);
    expect(next!.progress).toBeCloseTo(0.5, 1);
  });

  it('starts at the very first rung', () => {
    const races = MILESTONES.find((m) => m.metric === 'racesCompleted')!;
    expect(nextMilestoneFor(races, 0)!.threshold).toBe(races.thresholds[0]);
  });

  it('is worth more the further up the ladder it is', () => {
    const hours = MILESTONES.find((m) => m.metric === 'realHours')!;
    const early = milestoneXpFor(hours, 0);
    const middle = milestoneXpFor(hours, 5);
    const late = milestoneXpFor(hours, hours.thresholds.length - 1);

    expect(middle).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(middle);
    expect(early).toBeGreaterThan(0);
  });

  it('never awards negative XP', () => {
    for (const milestone of MILESTONES) {
      for (let i = 0; i < milestone.thresholds.length; i += 1) {
        expect(milestoneXpFor(milestone, i)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
