/**
 * The 0.3.1 season closure, as pure functions.
 *
 * Every closure decision takes `now`, so the boundary — local midnight on
 * 1 October 2026 — is tested from both sides without touching the clock.
 */

import { describe, expect, it } from 'vitest';
import { isSeasonClosed, reopeningSeason, seasonReopensAt } from '@/lib/domain/season-closure';
import { SEASON_CLOSURE_CONFIG, SEASON_PASS_CONFIG } from '@/lib/config';
import { quarterBounds } from '@/lib/domain/periods';
import { rewardForTier, seasonClosureNotice, seasonPassClosure } from '@/lib/engines/season-pass-engine';

const REOPENS = new Date(2026, 9, 1);
const BEFORE = new Date(REOPENS.getTime() - 1);

describe('the reopening', () => {
  it('is local midnight on 1 October 2026, read from configuration', () => {
    expect(SEASON_CLOSURE_CONFIG.reopensOn).toEqual({ year: 2026, month: 10, day: 1 });
    expect(seasonReopensAt().getTime()).toBe(REOPENS.getTime());
    expect(seasonReopensAt().getHours()).toBe(0);
  });

  it('is the start of the quarter that reopens', () => {
    expect(reopeningSeason()).toEqual({ year: 2026, quarter: 4 });
    expect(quarterBounds(2026, 4).start.getTime()).toBe(seasonReopensAt().getTime());
  });

  it('follows the configuration it is given', () => {
    const config = { reopensOn: { year: 2027, month: 1, day: 1 } };
    expect(seasonReopensAt(config).getTime()).toBe(new Date(2027, 0, 1).getTime());
    expect(isSeasonClosed(new Date(2026, 11, 31, 23, 59), config)).toBe(true);
    expect(reopeningSeason(config)).toEqual({ year: 2027, quarter: 1 });
  });
});

describe('isSeasonClosed', () => {
  it('is closed up to the last millisecond before the reopening', () => {
    expect(isSeasonClosed(new Date(2026, 6, 1))).toBe(true);
    expect(isSeasonClosed(new Date(2026, 8, 23, 12))).toBe(true);
    expect(isSeasonClosed(BEFORE)).toBe(true);
  });

  it('is open from the reopening onwards', () => {
    expect(isSeasonClosed(REOPENS)).toBe(false);
    expect(isSeasonClosed(new Date(2026, 9, 1, 0, 0, 1))).toBe(false);
    expect(isSeasonClosed(new Date(2027, 2, 1))).toBe(false);
  });
});

describe('the closed-state preview', () => {
  it('describes the Q4 2026 pass while closed', () => {
    const closure = seasonPassClosure(BEFORE);
    expect(closure).not.toBeNull();
    expect(closure!.label).toBe('Q4 2026');
    expect(closure!.season).toEqual({ year: 2026, quarter: 4 });
    expect(closure!.reopensAt.getTime()).toBe(REOPENS.getTime());
    expect(closure!.tierCount).toBe(SEASON_PASS_CONFIG.tierCount);
  });

  it('offers the new track: Sarthe at tier 20, Daytona at tier 60', () => {
    const themes = seasonPassClosure(BEFORE)!.themes;
    expect(themes.map((theme) => [theme.tier, theme.rewardKey])).toEqual([
      [20, 'theme_sarthe'],
      [60, 'theme_daytona'],
    ]);
  });

  it('lists exactly the milestone tiers the Q4 pass will build', () => {
    const milestones = seasonPassClosure(BEFORE)!.milestones;
    expect(milestones).toHaveLength(SEASON_PASS_CONFIG.tierCount / SEASON_PASS_CONFIG.milestoneEvery);
    for (const milestone of milestones) {
      expect(milestone.rewardKey).toBe(rewardForTier(milestone.tier, SEASON_PASS_CONFIG, { year: 2026, quarter: 4 }).key);
    }
  });

  it('is null once the season is open', () => {
    expect(seasonPassClosure(REOPENS)).toBeNull();
  });
});

describe('the stint summary notice', () => {
  it('names the pass that opens and when, as JSON-safe values, while closed', () => {
    const notice = seasonClosureNotice(BEFORE);
    expect(notice).toEqual({ label: 'Q4 2026', reopensAt: REOPENS.toISOString() });
    // It has to survive the JSON route a summary is fetched through unchanged.
    expect(JSON.parse(JSON.stringify(notice))).toEqual(notice);
    expect(new Date(notice!.reopensAt).getTime()).toBe(REOPENS.getTime());
  });

  it('agrees with the closed-state preview', () => {
    const closure = seasonPassClosure(BEFORE)!;
    expect(seasonClosureNotice(BEFORE)).toEqual({ label: closure.label, reopensAt: closure.reopensAt.toISOString() });
  });

  it('is null from the reopening onwards', () => {
    expect(seasonClosureNotice(REOPENS)).toBeNull();
    expect(seasonClosureNotice(new Date(2027, 2, 1))).toBeNull();
  });
});
