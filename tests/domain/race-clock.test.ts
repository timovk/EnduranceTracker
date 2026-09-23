/**
 * The broadcast clock. Everything the "Time left" option logs goes through
 * these two functions, so a mistake here is a stint logged against the wrong
 * part of the race — silently, because the numbers would still look plausible.
 */

import { describe, expect, it } from 'vitest';
import {
  elapsedToRemaining, isStintEntryMode, remainingToElapsed, STINT_ENTRY_MODES,
} from '@/lib/domain/race-clock';

const H = 3600;
const IMOLA = { scheduledSec: 6 * H, runtimeSec: 6 * H };

describe('reading the countdown clock', () => {
  it('turns 05:30:00 left at Imola into half an hour watched', () => {
    expect(remainingToElapsed(5.5 * H, IMOLA)).toBe(0.5 * H);
  });

  it('reads the full clock as the green flag', () => {
    expect(remainingToElapsed(6 * H, IMOLA)).toBe(0);
  });

  it('reads zero as the chequered flag, final lap included', () => {
    // The clock ran out at 6h, but the leader finished the lap at 6h 03m 12s.
    // Typing the clock you finished on must cover that last lap, or a race
    // watched to the flag would miss Story Complete by three minutes.
    const overran = { scheduledSec: 6 * H, runtimeSec: 6 * H + 192 };
    expect(remainingToElapsed(0, overran)).toBe(6 * H + 192);
    expect(remainingToElapsed(0, IMOLA)).toBe(6 * H);
  });

  it('refuses a reading the clock never showed', () => {
    expect(remainingToElapsed(6 * H + 1, IMOLA)).toBeNull();
    expect(remainingToElapsed(-1, IMOLA)).toBeNull();
    expect(remainingToElapsed(Number.NaN, IMOLA)).toBeNull();
  });

  it('never points past the end of a race that was cut short', () => {
    const shortened = { scheduledSec: 6 * H, runtimeSec: 4 * H };
    expect(remainingToElapsed(1 * H, shortened)).toBe(4 * H);
  });

  it('counts from the scheduled length, not the runtime', () => {
    // A 24-hour race whose runtime is 24h 04m still counts down from 24:00:00.
    const lemans = { scheduledSec: 24 * H, runtimeSec: 24 * H + 240 };
    expect(remainingToElapsed(12 * H, lemans)).toBe(12 * H);
  });

  it('goes back the other way exactly', () => {
    for (let remaining = 1; remaining <= 6 * H; remaining += 997) {
      const elapsed = remainingToElapsed(remaining, IMOLA);
      expect(elapsed).not.toBeNull();
      expect(elapsedToRemaining(elapsed!, IMOLA)).toBe(remaining);
    }
  });

  it('shows zero left once the clock has run out', () => {
    expect(elapsedToRemaining(6 * H + 100, IMOLA)).toBe(0);
    expect(elapsedToRemaining(-5, IMOLA)).toBe(6 * H);
  });
});

describe('entry modes', () => {
  it('recognises exactly the three ways a stint can be entered', () => {
    for (const mode of STINT_ENTRY_MODES) expect(isStintEntryMode(mode)).toBe(true);
    expect(isStintEntryMode('range')).toBe(false);
    expect(isStintEntryMode(undefined)).toBe(false);
    expect(isStintEntryMode(3)).toBe(false);
  });
});
