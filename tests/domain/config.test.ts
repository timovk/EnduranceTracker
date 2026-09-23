/**
 * Configuration sanity.
 *
 * The economy is data, and data can be wrong in ways that type-checking will
 * not catch: a threshold out of order, a reward worth nothing, a curve that
 * makes ordinary watching pointless. These are the checks that keep a
 * re-balance honest.
 */

import { describe, expect, it } from 'vitest';
import { milestoneLabel } from '@/components/races/stint-summary';
import { MILESTONES } from '@/lib/config/milestones';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACHIEVEMENT_BOARD_CONFIG, AWARDS_CONFIG, BUDGET_CONFIG, BUDGET_SHAPE, CHALLENGE_CONFIG, CHALLENGE_SHAPE,
  CHAMPIONSHIP_PRESETS, DEFAULT_CONFIG, LEVEL_CONFIG, LEVEL_TITLES, MAJOR_EVENT_SUGGESTIONS,
  MASTERY_CONFIG, MASTERY_SHAPE, MILESTONE_CONFIG, MILESTONE_REWARDS, MOMENTUM_CONFIG,
  MOMENTUM_SHAPE, PRESTIGE_CONFIG, RACE_CARD_STYLES, RACE_TYPE_PRESETS, SEASON_PASS_CONFIG,
  SEASON_PASS_SHAPE, STANDARD_REWARDS, STATS_CONFIG, STORY_CONFIG, STRATEGIST_CONFIG, STRATEGIST_SHAPE, THEMES,
  THEME_ROTATION, DEFAULT_THEME_KEY, DEFAULT_RACE_CARD_KEY,
  TWENTY_FOUR_HOUR_CONFIG, XP_CONFIG,
} from '@/lib/config';

describe('XP', () => {
  it('keeps ordinary watching worthwhile', () => {
    expect(XP_CONFIG.xpPerRealMinute).toBeGreaterThan(0);
    expect(XP_CONFIG.seasonXpPerRealMinute).toBeGreaterThan(0);
  });

  it('pays a re-watch less than a first watch, but not nothing', () => {
    expect(XP_CONFIG.rewatchXpMultiplier).toBeGreaterThan(0);
    expect(XP_CONFIG.rewatchXpMultiplier).toBeLessThan(1);
  });

  it('bounds the slow-speed guard sensibly', () => {
    expect(XP_CONFIG.xpMinSpeed).toBeGreaterThan(0);
    expect(XP_CONFIG.xpMinSpeed).toBeLessThanOrEqual(1);
    // A guard looser than half speed would let a claimed 0.5x double an award.
    expect(1 / XP_CONFIG.xpMinSpeed).toBeLessThanOrEqual(1.5);
  });

  it('orders the Story Complete bands by length and by value', () => {
    const bands = XP_CONFIG.storyCompleteBonuses;
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]!.maxHours).toBeGreaterThan(bands[i - 1]!.maxHours);
      expect(bands[i]!.careerXp).toBeGreaterThan(bands[i - 1]!.careerXp);
      expect(bands[i]!.seasonXp).toBeGreaterThan(bands[i - 1]!.seasonXp);
    }
    // The last band must be open-ended, or a 48-hour race falls off the end.
    expect(bands[bands.length - 1]!.maxHours).toBe(Infinity);
  });

  it('never configures a negative award', () => {
    expect(XP_CONFIG.raceCompleteBonus).toBeGreaterThanOrEqual(0);
    expect(XP_CONFIG.seasonCompleteBonus).toBeGreaterThan(0);
    expect(XP_CONFIG.prestigeBonus).toBeGreaterThan(0);
    for (const band of XP_CONFIG.storyCompleteBonuses) {
      expect(band.careerXp).toBeGreaterThan(0);
    }
  });

  it('rewards a major event more than an ordinary one', () => {
    expect(XP_CONFIG.majorEventStoryMultiplier).toBeGreaterThan(1);
  });
});

describe('the level curve', () => {
  it('is superlinear, so later levels are harder', () => {
    expect(LEVEL_CONFIG.exponent).toBeGreaterThan(1);
    expect(LEVEL_CONFIG.base).toBeGreaterThan(0);
  });

  it('bounds the solver without bounding the career', () => {
    // The cap exists so iteration terminates, not so levels run out.
    expect(LEVEL_CONFIG.maxSolvableLevel).toBeGreaterThan(10_000);
  });
});

describe('titles', () => {
  it('is ordered and starts at level one', () => {
    expect(LEVEL_TITLES[0]!.level).toBe(1);
    for (let i = 1; i < LEVEL_TITLES.length; i += 1) {
      expect(LEVEL_TITLES[i]!.level).toBeGreaterThan(LEVEL_TITLES[i - 1]!.level);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(LEVEL_TITLES.map((t) => t.title)).size).toBe(LEVEL_TITLES.length);
  });

  it('includes the titles named in the specification at their levels', () => {
    const at = (level: number) => LEVEL_TITLES.find((t) => t.level === level)?.title;
    expect(at(10)).toBe('Rookie Endurance Fan');
    expect(at(25)).toBe('Stint Specialist');
    expect(at(50)).toBe('Strategy Engineer');
    expect(at(100)).toBe('Endurance Veteran');
    expect(at(250)).toBe('Long-Haul Specialist');
    expect(at(500)).toBe('Endurance Master');
    expect(at(1000)).toBe('Living Timing Screen');
  });
});

describe('prestige', () => {
  it('is ordered and starts high', () => {
    for (let i = 1; i < PRESTIGE_CONFIG.thresholds.length; i += 1) {
      expect(PRESTIGE_CONFIG.thresholds[i]!).toBeGreaterThan(PRESTIGE_CONFIG.thresholds[i - 1]!);
    }
    expect(PRESTIGE_CONFIG.thresholds[0]!).toBeGreaterThanOrEqual(50);
  });

  it('keeps going beyond the explicit list', () => {
    expect(PRESTIGE_CONFIG.repeatEveryLevels).toBeGreaterThan(0);
  });
});

describe('Story Complete', () => {
  it('demands very nearly the whole race', () => {
    expect(STORY_CONFIG.coverageRatio).toBeGreaterThan(0.98);
    expect(STORY_CONFIG.coverageRatio).toBeLessThanOrEqual(1);
  });

  it('caps what may be missing in absolute terms as well as proportionally', () => {
    // The reason a 24-hour race cannot hide a six-minute skip behind a ratio.
    expect(STORY_CONFIG.maxUncoveredSeconds).toBeGreaterThan(0);
    expect(STORY_CONFIG.maxUncoveredSeconds).toBeLessThanOrEqual(5 * 60);
  });

  it('tolerates only trivial gaps', () => {
    expect(STORY_CONFIG.gapToleranceSeconds).toBeGreaterThanOrEqual(0);
    expect(STORY_CONFIG.gapToleranceSeconds).toBeLessThanOrEqual(60);
  });
});

describe('the viewing budget', () => {
  it('matches the figures the application is built around', () => {
    expect(BUDGET_CONFIG.annualHours).toBe(336);
    expect(BUDGET_CONFIG.weeklyTargetHours).toBe(8);
  });

  it('deliberately does not multiply out', () => {
    // 8 x 52 is 416, not 336. The gap is the whole reason the budget engine
    // allocates adaptively instead of dividing evenly.
    expect(BUDGET_CONFIG.weeklyTargetHours * 52).not.toBe(BUDGET_CONFIG.annualHours);
  });

  it('orders its weekly bounds sensibly', () => {
    expect(BUDGET_CONFIG.minWeeklyHours).toBeLessThan(BUDGET_CONFIG.weeklyTargetHours);
    expect(BUDGET_CONFIG.maxWeeklyHours).toBeGreaterThan(BUDGET_CONFIG.weeklyTargetHours);
    expect(BUDGET_CONFIG.maxMajorEventWeeklyHours).toBeGreaterThan(BUDGET_CONFIG.maxWeeklyHours);
  });

  it('allows a major-event week to exceed eight hours', () => {
    expect(BUDGET_CONFIG.maxMajorEventWeeklyHours).toBeGreaterThanOrEqual(12);
  });

  it('never lets the plan drop a week to nothing by accident', () => {
    expect(BUDGET_CONFIG.minWeeklyHours).toBeGreaterThan(0);
  });

  it('bounds the demand factor either side of one', () => {
    expect(BUDGET_CONFIG.minDemandFactor).toBeLessThan(1);
    expect(BUDGET_CONFIG.maxDemandFactor).toBeGreaterThan(1);
  });
});

describe('momentum', () => {
  it('has ordered, non-overlapping tiers starting at zero', () => {
    expect(MOMENTUM_CONFIG.tiers[0]!.min).toBe(0);
    for (let i = 1; i < MOMENTUM_CONFIG.tiers.length; i += 1) {
      expect(MOMENTUM_CONFIG.tiers[i]!.min).toBeGreaterThan(MOMENTUM_CONFIG.tiers[i - 1]!.min);
    }
  });

  it('names the tiers the specification asks for', () => {
    const names = MOMENTUM_CONFIG.tiers.map((t) => t.name);
    expect(names).toEqual([
      'Cold Tyres', 'Building Temperature', 'In the Window',
      'Double Stint', 'Flat Out', 'Ironman',
    ]);
  });

  it('settles gently rather than resetting', () => {
    expect(MOMENTUM_CONFIG.dailyDecay).toBeGreaterThan(0.5);
    expect(MOMENTUM_CONFIG.dailyDecay).toBeLessThan(1);
  });

  it('never drops below zero', () => {
    expect(MOMENTUM_CONFIG.floor).toBeGreaterThanOrEqual(0);
  });

  it('keeps its bonus small, and on the quarterly currency only', () => {
    const topTierBonus = MOMENTUM_CONFIG.seasonXpBonusPerTier * (MOMENTUM_CONFIG.tiers.length - 1);
    expect(topTierBonus).toBeLessThanOrEqual(0.12);
  });

  it('can reach its top tier within its ceiling', () => {
    const top = MOMENTUM_CONFIG.tiers[MOMENTUM_CONFIG.tiers.length - 1]!;
    expect(MOMENTUM_CONFIG.ceiling).toBeGreaterThan(top.min);
  });
});

describe('the season pass', () => {
  it('has a hundred tiers', () => {
    expect(SEASON_PASS_CONFIG.tierCount).toBe(100);
  });

  it('gets more expensive as it goes', () => {
    expect(SEASON_PASS_CONFIG.tierCostGrowth).toBeGreaterThan(0);
  });

  it('has a milestone cadence that divides the track', () => {
    expect(SEASON_PASS_CONFIG.tierCount % SEASON_PASS_CONFIG.milestoneEvery).toBe(0);
  });

  it('has enough rewards to fill the track without obvious repetition', () => {
    const milestoneTiers = SEASON_PASS_CONFIG.tierCount / SEASON_PASS_CONFIG.milestoneEvery;
    expect(MILESTONE_REWARDS.length).toBeGreaterThanOrEqual(milestoneTiers);
    expect(STANDARD_REWARDS.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique reward keys', () => {
    const all = [...STANDARD_REWARDS, ...MILESTONE_REWARDS];
    expect(new Set(all.map((r) => r.key)).size).toBe(all.length);
  });

  it('offers only real themes, and never the one every account has', () => {
    const themeKeys = new Set(THEMES.map((theme) => theme.key));
    const offered = [...MILESTONE_REWARDS, ...THEME_ROTATION.flat()].filter((r) => r.type === 'THEME');
    for (const reward of offered) {
      expect(themeKeys, reward.key).toContain(reward.key.replace(/^theme_/, ''));
      expect(reward.key).not.toBe(`theme_${DEFAULT_THEME_KEY}`);
    }
    expect(themeKeys).toContain(DEFAULT_THEME_KEY);
    expect(new Set(RACE_CARD_STYLES.map((c) => c.key))).toContain(DEFAULT_RACE_CARD_KEY);
  });
});

describe('challenges', () => {
  it('offers several per scope', () => {
    for (const count of Object.values(CHALLENGE_CONFIG.counts)) {
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it('rewards a longer window more than a shorter one', () => {
    const { DAILY, WEEKLY, MONTHLY, SEASONAL } = CHALLENGE_CONFIG.rewards;
    expect(WEEKLY.careerXp).toBeGreaterThan(DAILY.careerXp);
    expect(MONTHLY.careerXp).toBeGreaterThan(WEEKLY.careerXp);
    expect(SEASONAL.careerXp).toBeGreaterThan(MONTHLY.careerXp);
  });

  it('keeps feasibility caps inside the time a window actually contains', () => {
    const { feasibility } = CHALLENGE_CONFIG;
    expect(feasibility.maxDailyMinutes).toBeLessThanOrEqual(24 * 60);
    expect(feasibility.maxWeeklyMinutes).toBeLessThanOrEqual(7 * 24 * 60);
    expect(feasibility.maxMonthlyMinutes).toBeLessThanOrEqual(31 * 24 * 60);
    expect(feasibility.maxSeasonalMinutes).toBeLessThanOrEqual(92 * 24 * 60);
  });

  it('keeps them achievable next to the viewing plan', () => {
    // A weekly challenge must not need more than a very heavy week.
    expect(CHALLENGE_CONFIG.feasibility.maxWeeklyMinutes / 60)
      .toBeLessThanOrEqual(BUDGET_CONFIG.maxMajorEventWeeklyHours);
  });
});

describe('the strategist', () => {
  it('weights continuity above everything else', () => {
    const { weights } = STRATEGIST_CONFIG;
    const positives = Object.entries(weights).filter(([, value]) => value > 0);
    const largest = positives.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    expect(largest[0]).toBe('continuity');
  });

  it('has no weight named after XP', () => {
    for (const key of Object.keys(STRATEGIST_CONFIG.weights)) {
      expect(key.toLowerCase()).not.toContain('xp');
    }
  });

  it('keeps variety and freshness as penalties', () => {
    expect(STRATEGIST_CONFIG.weights.varietyPenalty).toBeLessThan(0);
    expect(STRATEGIST_CONFIG.weights.freshnessPenalty).toBeLessThan(0);
  });

  it('caps the staleness nudge at a few weeks', () => {
    expect(STRATEGIST_CONFIG.stalenessFullDays).toBeGreaterThan(7);
    expect(STRATEGIST_CONFIG.stalenessFullDays).toBeLessThanOrEqual(90);
  });

  it('offers three suggestions', () => {
    expect(STRATEGIST_CONFIG.recommendationCount).toBe(3);
  });
});

describe('long races', () => {
  it('marks the quarters of a 24-hour race', () => {
    expect(TWENTY_FOUR_HOUR_CONFIG.segmentHours).toEqual([6, 12, 18, 24]);
    expect(TWENTY_FOUR_HOUR_CONFIG.segmentLabels).toHaveLength(4);
  });

  it('suggests a stint that is a sitting, not an ordeal', () => {
    expect(TWENTY_FOUR_HOUR_CONFIG.suggestedStintMinutes).toBeGreaterThan(30);
    expect(TWENTY_FOUR_HOUR_CONFIG.suggestedStintMinutes).toBeLessThanOrEqual(4 * 60);
  });
});

describe('presets', () => {
  it('covers the championships the user watches', () => {
    const names = CHAMPIONSHIP_PRESETS.map((c) => c.shortName);
    for (const expected of ['WEC', 'IMSA', 'ELMS', 'AsLMS', 'GTWC', '24H']) {
      expect(names).toContain(expected);
    }
  });

  it('has unique slugs and valid colours', () => {
    expect(new Set(CHAMPIONSHIP_PRESETS.map((c) => c.slug)).size).toBe(CHAMPIONSHIP_PRESETS.length);
    for (const preset of CHAMPIONSHIP_PRESETS) {
      expect(preset.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('suggests major events without hard-coding them as the only ones', () => {
    // These are suggestions in a datalist, not a closed set anywhere in the
    // engines — `design-rules.test.ts` covers that side of it.
    expect(MAJOR_EVENT_SUGGESTIONS.length).toBeGreaterThanOrEqual(7);
    const keys = MAJOR_EVENT_SUGGESTIONS.map((s) => s.key);
    expect(keys).toContain('le-mans-24');
    expect(keys).toContain('daytona-24');
    expect(keys).toContain('sebring-12');
    expect(keys).toContain('nurburgring-24');
    expect(keys).toContain('spa-24');
    expect(keys).toContain('petit-le-mans');
    expect(keys).toContain('bathurst-12');
  });

  it('covers every race length the specification lists', () => {
    const types = RACE_TYPE_PRESETS.map((p) => p.type);
    expect(types).toEqual([
      'SPRINT_ENDURANCE', 'H4', 'H6', 'H8', 'H10', 'H12', 'H24', 'CUSTOM',
    ]);
  });

  it('gives every race type a sensible default length', () => {
    for (const preset of RACE_TYPE_PRESETS) {
      expect(preset.defaultHours).toBeGreaterThan(0);
      expect(preset.defaultHours).toBeLessThanOrEqual(24);
    }
  });

  it('has unique cosmetic keys', () => {
    expect(new Set(THEMES.map((t) => t.key)).size).toBe(THEMES.length);
    expect(new Set(RACE_CARD_STYLES.map((c) => c.key)).size).toBe(RACE_CARD_STYLES.length);
  });
});

describe('the configuration barrel', () => {
  it('exposes every subsystem in one object', () => {
    for (const key of [
      'xp', 'level', 'budget', 'story', 'momentum', 'seasonPass', 'challenge',
      'strategist', 'prestige', 'longHaul', 'mastery', 'milestone', 'achievementBoard', 'awards', 'stats',
    ]) {
      expect(DEFAULT_CONFIG).toHaveProperty(key);
    }
  });

  it('exposes the curve shapes too, not only the weights', () => {
    // A weight is only half of a tunable: the shape says what full strength
    // means. A re-balance that could reach one but not the other would be a
    // re-balance with a blind spot.
    for (const key of [
      'budgetShape', 'strategistShape', 'challengeShape',
      'masteryShape', 'seasonPassShape', 'momentumShape',
    ]) {
      expect(DEFAULT_CONFIG).toHaveProperty(key);
    }
  });

  it('leaves no balance block stranded outside the barrel', () => {
    // Every exported *_CONFIG / *_SHAPE block in economy.ts must be reachable
    // through DEFAULT_CONFIG, or a re-balance would silently miss it.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/config/economy.ts'), 'utf8');
    const blocks = [...source.matchAll(/^export const ([A-Z_]+(?:_CONFIG|_SHAPE)) =/gm)]
      .map((match) => match[1]!);

    const reachable = new Set(Object.values(DEFAULT_CONFIG as Record<string, unknown>));
    const imported = new Map<string, unknown>([
      ['XP_CONFIG', XP_CONFIG], ['LEVEL_CONFIG', LEVEL_CONFIG], ['BUDGET_CONFIG', BUDGET_CONFIG],
      ['STORY_CONFIG', STORY_CONFIG], ['MOMENTUM_CONFIG', MOMENTUM_CONFIG],
      ['SEASON_PASS_CONFIG', SEASON_PASS_CONFIG], ['CHALLENGE_CONFIG', CHALLENGE_CONFIG],
      ['STRATEGIST_CONFIG', STRATEGIST_CONFIG], ['PRESTIGE_CONFIG', PRESTIGE_CONFIG],
      ['TWENTY_FOUR_HOUR_CONFIG', TWENTY_FOUR_HOUR_CONFIG], ['MASTERY_CONFIG', MASTERY_CONFIG],
      ['MILESTONE_CONFIG', MILESTONE_CONFIG], ['ACHIEVEMENT_BOARD_CONFIG', ACHIEVEMENT_BOARD_CONFIG], ['AWARDS_CONFIG', AWARDS_CONFIG], ['STATS_CONFIG', STATS_CONFIG],
      ['BUDGET_SHAPE', BUDGET_SHAPE], ['STRATEGIST_SHAPE', STRATEGIST_SHAPE],
      ['CHALLENGE_SHAPE', CHALLENGE_SHAPE], ['MASTERY_SHAPE', MASTERY_SHAPE],
      ['SEASON_PASS_SHAPE', SEASON_PASS_SHAPE], ['MOMENTUM_SHAPE', MOMENTUM_SHAPE],
    ]);

    for (const name of blocks) {
      const block = imported.get(name);
      expect(block, `${name} is not imported by this test`).toBeDefined();
      expect(reachable.has(block), `${name} is not reachable from DEFAULT_CONFIG`).toBe(true);
    }
  });
});

describe('milestone labels read correctly at any count', () => {
  it('singularises the first rung of every ladder', () => {
    for (const def of MILESTONES) {
      const one = milestoneLabel(1, def.label);
      expect(one, def.metric).not.toMatch(/\bcountrie\b/);
      expect(one, def.metric).not.toMatch(/\b\w+ies\b/);
      // "1 races completed" is the shape this is guarding against: the noun
      // must be the final word so singularising it works.
      expect(one, def.metric).not.toMatch(/\b(races|hours|seasons|circuits|sessions|championships|events)\b/);
    }
  });

  it('leaves higher rungs plural', () => {
    for (const def of MILESTONES) {
      expect(milestoneLabel(25, def.label), def.metric).toContain(def.label.toLowerCase());
    }
  });

  it('formats the count alongside the label', () => {
    expect(milestoneLabel(1, 'Real viewing hours')).toBe('1 real viewing hour');
    expect(milestoneLabel(1_000, 'Real viewing hours')).toBe('1,000 real viewing hours');
    expect(milestoneLabel(1, 'Countries')).toBe('1 country');
  });
});
