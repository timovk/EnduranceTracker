/**
 * How loudly a stint is celebrated, and what its summary draws (0.4.0).
 *
 * The engine picks the level (`chooseCelebration`); the summary then decides,
 * through the pure `celebrationView`, which Career Milestones are drawn as
 * highlighted blocks and what the heading says. Celebration stays graded: most
 * milestones are simply listed, a `notable` one lifts an ordinary stint to
 * NOTABLE, and only a `spectacular` one earns the full treatment.
 *
 * Also here: the span a stint's unlocks must be stamped in to belong to it
 * (`stintUnlockWindow`), which keeps two stints logged minutes apart from
 * claiming each other's unlocks.
 */

import { describe, expect, it } from 'vitest';
import { TIMELINE_SHAPE, TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import {
  celebrationView, highestMilestoneCelebration, levelForMilestone, louderLevel,
} from '@/lib/domain/celebration';
import type { CareerMilestoneUnlock } from '@/lib/engines/contracts';
import { chooseCelebration } from '@/lib/engines/session-engine';
import { stintUnlockWindow } from '@/lib/engines/stint-unlocks';

const H = 3600;
const MINUTE = 60_000;

function milestone(id: string, celebration: CareerMilestoneUnlock['celebration']): CareerMilestoneUnlock {
  return {
    id, title: `Title of ${id}`, metric: id, threshold: 1, achievedAt: null, precision: null,
    recordedAt: null, subjectName: null, xpAwarded: 0, celebration,
  };
}

const ORDINARY = {
  storyCompleted: false,
  runtimeSec: 6 * H,
  seasonCompleted: false,
  masteryTreeCompleted: false,
  prestigeGained: 0,
  rareUnlock: false,
  levelsGained: 0,
  careerMilestoneCelebration: 'none' as const,
  expeditionCompleted: false,
};

describe('choosing how loudly to celebrate', () => {
  it('keeps an ordinary stint quiet, whatever milestones it lists', () => {
    expect(chooseCelebration(ORDINARY)).toBe('QUIET');
  });

  it('makes a stint with a notable milestone at least NOTABLE', () => {
    expect(chooseCelebration({ ...ORDINARY, careerMilestoneCelebration: 'notable' })).toBe('NOTABLE');
    expect(chooseCelebration({ ...ORDINARY, storyCompleted: true, careerMilestoneCelebration: 'notable' })).toBe('NOTABLE');
  });

  it('makes a stint with a spectacular milestone SPECTACULAR', () => {
    expect(chooseCelebration({ ...ORDINARY, careerMilestoneCelebration: 'spectacular' })).toBe('SPECTACULAR');
    expect(chooseCelebration({ ...ORDINARY, levelsGained: 1, careerMilestoneCelebration: 'spectacular' })).toBe('SPECTACULAR');
  });

  it('celebrates a completed Expedition spectacularly, whatever the race’s length', () => {
    expect(chooseCelebration({ ...ORDINARY, storyCompleted: true, expeditionCompleted: true })).toBe('SPECTACULAR');
    expect(chooseCelebration({ ...ORDINARY, runtimeSec: 2 * H, storyCompleted: true, expeditionCompleted: true })).toBe('SPECTACULAR');
    // The same completion of a race that is not an Expedition stays NOTABLE below the long-haul length.
    expect(chooseCelebration({ ...ORDINARY, runtimeSec: 2 * H, storyCompleted: true })).toBe('NOTABLE');
  });

  it('never lowers what the stint earned without the milestones', () => {
    const longHaul = { ...ORDINARY, storyCompleted: true, runtimeSec: TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec };
    expect(chooseCelebration(longHaul)).toBe('SPECTACULAR');
    expect(chooseCelebration({ ...longHaul, careerMilestoneCelebration: 'notable' })).toBe('SPECTACULAR');
    expect(chooseCelebration({ ...ORDINARY, storyCompleted: true })).toBe('NOTABLE');
  });

  it('ranks the celebrations it combines', () => {
    expect(highestMilestoneCelebration([])).toBe('none');
    expect(highestMilestoneCelebration([milestone('a', 'none'), milestone('b', 'notable')])).toBe('notable');
    expect(highestMilestoneCelebration([milestone('a', 'spectacular'), milestone('b', 'notable')])).toBe('spectacular');
    expect(levelForMilestone('none')).toBe('QUIET');
    expect(levelForMilestone('notable')).toBe('NOTABLE');
    expect(levelForMilestone('spectacular')).toBe('SPECTACULAR');
    expect(louderLevel('QUIET', 'NOTABLE')).toBe('NOTABLE');
    expect(louderLevel('SPECTACULAR', 'NOTABLE')).toBe('SPECTACULAR');
  });
});

describe('what the stint summary draws', () => {
  const outcome = {
    celebrate: 'QUIET' as const,
    storyCompleted: false,
    heading: 'STINT COMPLETE',
    careerMilestones: [] as CareerMilestoneUnlock[],
  };

  it('lists ordinary milestones and highlights none', () => {
    const view = celebrationView({ ...outcome, careerMilestones: [milestone('first-race-started', 'none')] });
    expect(view).toEqual({ level: 'QUIET', highlighted: [], headline: 'STINT COMPLETE' });
  });

  it('highlights every milestone that celebrates, the loudest first, and heads the summary with it', () => {
    const listed = milestone('hours-250', 'none');
    const notable = milestone('hours-500', 'notable');
    const spectacular = milestone('hours-1000', 'spectacular');
    const view = celebrationView({ ...outcome, celebrate: 'SPECTACULAR', careerMilestones: [listed, notable, spectacular] });
    expect(view.highlighted).toEqual([spectacular, notable]);
    // The very objects of the outcome, so the summary can tell them from the listed ones.
    expect(view.highlighted[0]).toBe(spectacular);
    expect(view.headline).toBe('Title of hours-1000');
    expect(view.level).toBe('SPECTACULAR');
  });

  it('keeps the order of the catalogue among equally loud milestones', () => {
    const first = milestone('first-race-completed', 'notable');
    const second = milestone('first-24h', 'notable');
    expect(celebrationView({ ...outcome, celebrate: 'NOTABLE', careerMilestones: [first, second] }).highlighted)
      .toEqual([first, second]);
  });

  it('heads a stint that finished a story with the story, not the milestone', () => {
    const view = celebrationView({
      ...outcome, celebrate: 'NOTABLE', storyCompleted: true, careerMilestones: [milestone('first-race-completed', 'notable')],
    });
    expect(view.headline).toBe('Story Complete');
    expect(view.highlighted).toHaveLength(1);
  });

  it('raises a summary to what its milestones ask for, and never lowers one', () => {
    expect(celebrationView({ ...outcome, careerMilestones: [milestone('hours-500', 'notable')] }).level).toBe('NOTABLE');
    expect(celebrationView({ ...outcome, celebrate: 'SPECTACULAR' }).level).toBe('SPECTACULAR');
  });
});

describe('the span a stint claims its unlocks in', () => {
  const at = new Date(2026, 8, 24, 20, 0);
  const slack = TIMELINE_SHAPE.recognitionSlackMinutes * MINUTE;

  it('reaches the recognition slack either side of the stint when nothing is near it', () => {
    const window = stintUnlockWindow(at, { previousWatchedAt: null, nextWatchedAt: null });
    expect(window).toEqual({ from: new Date(at.getTime() - slack), to: new Date(at.getTime() + slack) });
  });

  it('stops short of the stints logged just before and just after it', () => {
    const previous = new Date(at.getTime() - 2 * MINUTE);
    const next = new Date(at.getTime() + 3 * MINUTE);
    const window = stintUnlockWindow(at, { previousWatchedAt: previous, nextWatchedAt: next });
    expect(window).toEqual({ from: new Date(previous.getTime() + 1), to: new Date(next.getTime() - 1) });
    // Unlocks are stamped with the instant of the stint that reached them, so
    // each stint's own instant is inside its window and outside its
    // neighbours'.
    const theirs = stintUnlockWindow(next, { previousWatchedAt: at, nextWatchedAt: null });
    expect(at >= window.from && at <= window.to).toBe(true);
    expect(next >= window.from && next <= window.to).toBe(false);
    expect(next >= theirs.from && next <= theirs.to).toBe(true);
    expect(at >= theirs.from && at <= theirs.to).toBe(false);
  });

  it('keeps the slack when the neighbours are further away than it', () => {
    const window = stintUnlockWindow(at, {
      previousWatchedAt: new Date(at.getTime() - 60 * MINUTE), nextWatchedAt: new Date(at.getTime() + 60 * MINUTE),
    });
    expect(window).toEqual({ from: new Date(at.getTime() - slack), to: new Date(at.getTime() + slack) });
  });
});
