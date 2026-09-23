/**
 * The race clock as a broadcast shows it.
 *
 * Endurance coverage counts DOWN: the timing tower at Imola reads 05:30:00 half
 * an hour in, not 00:30:00. Everything in this application stores the other
 * direction — seconds since the green flag — because that is what intervals
 * are made of. These two functions are the only place the directions meet, so
 * a stint can be typed exactly as it appeared on screen without anyone doing
 * subtraction in their head.
 *
 * The clock counts down from the SCHEDULED length, because that is the number
 * a broadcast starts from. It is not the same as the runtime: when the clock
 * hits zero the leader still has to finish the lap, so a six-hour race can run
 * to 06:03:12. That tail cannot be expressed as time remaining, so zero means
 * the chequered flag — the end of the runtime — rather than the moment the
 * clock ran out. Without that rule, typing the clock you actually finished on
 * would leave the last lap uncovered, and a race you watched to the flag would
 * silently miss Story Complete.
 */

export interface RaceClock {
  /** The length the clock counts down from. */
  scheduledSec: number;
  /** The race as it actually ran; may be longer or shorter than scheduled. */
  runtimeSec: number;
}

/**
 * Seconds since the green flag, from the clock's time remaining.
 *
 * Returns null for a clock reading the race never showed — more time remaining
 * than the race was scheduled for.
 */
export function remainingToElapsed(remainingSec: number, clock: RaceClock): number | null {
  if (!Number.isFinite(remainingSec) || remainingSec < 0) return null;
  if (remainingSec > clock.scheduledSec) return null;
  if (remainingSec === 0) return clock.runtimeSec;
  return Math.min(clock.runtimeSec, Math.max(0, clock.scheduledSec - remainingSec));
}

/**
 * The clock's time remaining at a point in the race.
 *
 * Anything at or beyond the scheduled length reads zero — the clock has run out
 * even if the leader is still on the last lap.
 */
export function elapsedToRemaining(elapsedSec: number, clock: Pick<RaceClock, 'scheduledSec'>): number {
  return Math.max(0, clock.scheduledSec - Math.max(0, elapsedSec));
}

/**
 * How a stint was entered.
 *
 *   RANGE      where it started and stopped, as elapsed race time
 *   REMAINING  the same, read off the countdown clock
 *   DURATION   where it started and how long was spent watching
 *
 * REMAINING is converted to RANGE before it leaves the form, so the session
 * engine only ever sees the two it has always known. The distinction exists to
 * remember which one a person prefers.
 */
export const STINT_ENTRY_MODES = ['RANGE', 'REMAINING', 'DURATION'] as const;
export type StintEntryMode = (typeof STINT_ENTRY_MODES)[number];

export function isStintEntryMode(value: unknown): value is StintEntryMode {
  return typeof value === 'string' && (STINT_ENTRY_MODES as readonly string[]).includes(value);
}
