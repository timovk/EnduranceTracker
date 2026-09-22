/**
 * Economy balance.
 *
 * One rule governs the whole progression economy, and it is the easiest one to
 * lose in a re-balance:
 *
 *     Ordinary watching is the main source of XP.
 *
 * Everything else — completions, achievements, milestones, mastery, the season
 * pass — celebrates the watching. If any of them ever out-earns it, the
 * application has started rewarding the scoreboard instead of the hobby.
 *
 * These tests model a plausible career at several stages and assert that the
 * relationship holds at every one of them.
 */

import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, MASTERY_CONFIG, MILESTONES, SEASON_PASS_CONFIG, XP_CONFIG } from '@/lib/config';
import { milestoneXpFor } from '@/lib/engines/achievement-engine';
import { storyCompleteBonus, totalXpForLevel, levelFromXp } from '@/lib/domain/progression';

/**
 * A career at `hours` of real viewing, with completions and breadth in broadly
 * the proportions a real one has: roughly one finished race per seven real
 * hours, a season every eight races, and so on.
 */
function career(hours: number) {
  const stories = Math.floor(hours / 7);
  const metrics: Record<string, number> = {
    realHours: hours,
    timelineHours: hours * 1.2,
    racesCompleted: stories,
    storyCompletes: stories,
    championshipsCompleted: Math.min(8, 1 + Math.floor(stories / 10)),
    seasonsCompleted: Math.floor(stories / 8),
    seasonsStoryComplete: Math.floor(stories / 10),
    circuits: Math.min(60, stories),
    countries: Math.min(30, Math.floor(stories * 0.7)),
    majorEventStories: Math.floor(stories / 6),
    stories8h: Math.floor(stories / 5),
    stories10h: Math.floor(stories / 8),
    stories12h: Math.floor(stories / 10),
    stories24h: Math.floor(stories / 20),
    sessions: Math.floor(hours / 2.2),
    longestSessionHours: 3,
    lifetimeActiveDays: Math.floor(hours / 1.6),
    distinctRaceTypesStoried: Math.min(6, Math.floor(stories / 4)),
    masteryTreesCompleted: 0,
    seasonPassesCompleted: Math.floor(hours / 336) * 2,
    longestConsecutiveEditions: Math.min(5, Math.floor(hours / 700)),
    maxEditionsOfOneEvent: Math.min(10, Math.floor(hours / 400)),
    puristStories: Math.floor(stories / 6),
    maxSessionsForOneStory: 6,
    longBreakReturns: Math.floor(hours / 500),
    level: 0,
    prestige: 0,
    careerXpMillions: 0,
  };

  const viewing = hours * 60 * XP_CONFIG.xpPerRealMinute;

  const storyBonuses = stories * storyCompleteBonus(6 * 3600).careerXp;

  let milestones = 0;
  for (const def of MILESTONES) {
    const value = metrics[def.metric] ?? 0;
    def.thresholds.forEach((threshold, index) => {
      if (value >= threshold) milestones += milestoneXpFor(def, index);
    });
  }

  let achievements = 0;
  for (const achievement of ACHIEVEMENTS) {
    if ((metrics[achievement.metric] ?? 0) >= achievement.threshold) {
      achievements += achievement.xpReward;
    }
  }

  // Mastery: every championship tree whose nodes the career has passed, plus
  // the global tree. Deliberately generous — this is an upper bound.
  let mastery = 0;
  for (const node of MASTERY_CONFIG.globalNodes) {
    if ((metrics[node.metric] ?? 0) >= node.threshold) mastery += node.xpReward;
  }
  const championships = metrics.championshipsCompleted ?? 1;
  for (const node of MASTERY_CONFIG.championshipNodes) {
    const perChampionship = (metrics[node.metric] ?? 0) / championships;
    if (perChampionship >= node.threshold) mastery += node.xpReward * championships;
  }

  // The season pass, assumed completed every quarter — again an upper bound.
  const quarters = Math.max(1, Math.floor(hours / (336 / 4)));
  const passXp = quarters * (SEASON_PASS_CONFIG.tierCount / 10) * 3_000;

  const other = storyBonuses + milestones + achievements + mastery + passXp;
  return { hours, viewing, storyBonuses, milestones, achievements, mastery, passXp, other, total: viewing + other };
}

/** Career stages: a first month, a first year, several years, a decade. */
const STAGES = [20, 58, 150, 336, 672, 1680, 3360];

describe('ordinary watching is the main source of XP', () => {
  it('out-earns every other source individually, at every stage', () => {
    for (const hours of STAGES) {
      const c = career(hours);
      for (const [name, amount] of Object.entries({
        'story bonuses': c.storyBonuses,
        milestones: c.milestones,
        achievements: c.achievements,
        mastery: c.mastery,
        'season pass': c.passXp,
      })) {
        expect(c.viewing, `at ${hours}h, ${name} out-earns watching`).toBeGreaterThan(amount);
      }
    }
  });

  it('is a clear plurality of all XP, at every stage', () => {
    for (const hours of STAGES) {
      const c = career(hours);
      expect(c.viewing / c.total, `at ${hours}h`).toBeGreaterThan(0.4);
    }
  });

  it('grows as a share of the career, rather than being crowded out', () => {
    const early = career(58);
    const late = career(3360);
    expect(late.viewing / late.total).toBeGreaterThanOrEqual(early.viewing / early.total);
  });

  it('does not front-load a new career with a milestone windfall', () => {
    // The first rung of fourteen ladders all falls in the opening weeks. That
    // opening lump must stay well under the watching that produced it.
    const openingWeeks = career(20);
    expect(openingWeeks.milestones).toBeLessThan(openingWeeks.viewing * 0.5);
  });
});

describe('the level curve sits sensibly against the viewing plan', () => {
  it('reaches the early levels within a few evenings', () => {
    const hoursToLevel = (level: number) =>
      totalXpForLevel(level) / (XP_CONFIG.xpPerRealMinute * 60);

    expect(hoursToLevel(5)).toBeLessThan(5);
    expect(hoursToLevel(10)).toBeLessThan(25);
  });

  it('puts the milestone titles at the intervals the specification describes', () => {
    const level = (hours: number) => levelFromXp(career(hours).total).level;

    // A first serious season of watching gets past the early levels.
    expect(level(336)).toBeGreaterThan(30);
    // Level 100 is a genuine long-haul achievement, not a first-year target.
    expect(level(336)).toBeLessThan(100);
    // A decade of watching is a real career, but not a finished one.
    expect(level(3360)).toBeGreaterThan(90);
    expect(level(3360)).toBeLessThan(400);
  });

  it('never lets a year of watching finish the curve', () => {
    // There is no maximum level, and a year must not feel like it found one.
    expect(levelFromXp(career(336).total).level).toBeLessThan(1000);
  });
});

describe('a quarter of viewing moves the season pass meaningfully', () => {
  it('earns enough season XP for a dedicated quarter to approach the track', () => {
    const quarterHours = 336 / 4;
    const seasonXp = quarterHours * 60 * XP_CONFIG.seasonXpPerRealMinute;
    // Watching alone should carry most of the way; challenges do the rest.
    expect(seasonXp).toBeGreaterThan(40_000);
  });
});
