/**
 * Championship collections.
 *
 * A season is a set of cards, and the user owns the definition of what the set
 * contains. The rules that matter: a partial season is a legitimate state, a
 * declared season cannot be complete before its races exist, and a Season
 * Sweep needs every card watched end to end rather than merely finished.
 */

import { describe, expect, it } from 'vitest';
import { evaluateSeasonCompletion, type SeasonRaceInput } from '@/lib/engines/collection-engine';

const finished = (id: string): SeasonRaceInput => ({ id, completed: true, storyComplete: true });
const completedByHand = (id: string): SeasonRaceInput => ({ id, completed: true, storyComplete: false });
const unfinished = (id: string): SeasonRaceInput => ({ id, completed: false, storyComplete: false });

describe('evaluateSeasonCompletion', () => {
  it('measures an undeclared season against what is actually in it', () => {
    const state = evaluateSeasonCompletion([finished('a'), finished('b'), unfinished('c')], null);
    expect(state.declaredTarget).toBeNull();
    expect(state.target).toBe(3);
    expect(state.filledCount).toBe(2);
    expect(state.isComplete).toBe(false);
    expect(state.percent).toBeCloseTo(66.7, 1);
  });

  it('completes an undeclared season once every race in it is finished', () => {
    const state = evaluateSeasonCompletion([finished('a'), finished('b')], null);
    expect(state.isComplete).toBe(true);
    expect(state.percent).toBe(100);
    expect(state.remaining).toBe(0);
  });

  it('respects the user’s own declaration of the season length', () => {
    // Both races finished, but the user says the season has eight.
    const state = evaluateSeasonCompletion([finished('a'), finished('b')], 8);
    expect(state.target).toBe(8);
    expect(state.isComplete).toBe(false);
    expect(state.notYetAdded).toBe(6);
    expect(state.remaining).toBe(6);
  });

  it('completes a declared season when its declared count is met', () => {
    const races = Array.from({ length: 8 }, (_, i) => finished(`r${i}`));
    const state = evaluateSeasonCompletion(races, 8);
    expect(state.isComplete).toBe(true);
    expect(state.notYetAdded).toBe(0);
  });

  it('treats a race finished by hand as filling its card', () => {
    // Watched it live, never logged a stint — the card still fills.
    const state = evaluateSeasonCompletion([completedByHand('a'), finished('b')], null);
    expect(state.filledCount).toBe(2);
    expect(state.isComplete).toBe(true);
  });

  it('requires every card watched end to end for a Season Sweep', () => {
    const swept = evaluateSeasonCompletion([finished('a'), finished('b')], null);
    const merelyComplete = evaluateSeasonCompletion([finished('a'), completedByHand('b')], null);

    expect(swept.isSeasonSweep).toBe(true);
    expect(merelyComplete.isComplete).toBe(true);
    expect(merelyComplete.isSeasonSweep).toBe(false);
  });

  it('counts Story Complete cards separately from filled ones', () => {
    const state = evaluateSeasonCompletion(
      [finished('a'), completedByHand('b'), unfinished('c')],
      null,
    );
    expect(state.filledCount).toBe(2);
    expect(state.storyCompleteCount).toBe(1);
  });

  it('handles an empty season without claiming it is complete', () => {
    const state = evaluateSeasonCompletion([], null);
    expect(state.target).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.isSeasonSweep).toBe(false);
    expect(state.percent).toBe(0);
  });

  it('handles a declared season with nothing added yet', () => {
    const state = evaluateSeasonCompletion([], 8);
    expect(state.target).toBe(8);
    expect(state.notYetAdded).toBe(8);
    expect(state.isComplete).toBe(false);
    expect(state.percent).toBe(0);
  });

  it('never reports a negative figure', () => {
    // More races filed than declared: an over-full set is not a negative one.
    const races = Array.from({ length: 10 }, (_, i) => finished(`r${i}`));
    const state = evaluateSeasonCompletion(races, 8);
    expect(state.remaining).toBeGreaterThanOrEqual(0);
    expect(state.notYetAdded).toBeGreaterThanOrEqual(0);
    expect(state.percent).toBeGreaterThanOrEqual(0);
  });

  it('never reports more than one hundred per cent', () => {
    const races = Array.from({ length: 12 }, (_, i) => finished(`r${i}`));
    expect(evaluateSeasonCompletion(races, 8).percent).toBeLessThanOrEqual(100);
  });

  it('ignores a nonsensical declared count', () => {
    for (const declared of [0, -4, Number.NaN]) {
      const state = evaluateSeasonCompletion([finished('a')], declared);
      expect(state.declaredTarget, String(declared)).toBeNull();
      expect(state.target).toBe(1);
    }
  });

  it('treats a story-complete race as finished even if the flag disagrees', () => {
    const state = evaluateSeasonCompletion([{ id: 'a', completed: false, storyComplete: true }], null);
    expect(state.filledCount).toBe(1);
    expect(state.isComplete).toBe(true);
  });

  it('is monotonic: finishing a race never lowers the percentage', () => {
    const races: SeasonRaceInput[] = Array.from({ length: 8 }, (_, i) => unfinished(`r${i}`));
    let previous = 0;
    for (let i = 0; i < races.length; i += 1) {
      races[i] = finished(`r${i}`);
      const percent = evaluateSeasonCompletion(races, 8).percent;
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
    expect(previous).toBe(100);
  });
});
