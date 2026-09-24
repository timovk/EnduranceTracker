/**
 * Run a block of tests in another time zone.
 *
 * Node applies a change to `process.env.TZ` at runtime, and every test file
 * runs in its own process, so a block can live in Auckland while the next one
 * lives in Los Angeles. The zone is checked before any test runs, by its
 * offsets in January and in July: a platform that ignored the change would
 * otherwise pass on a UTC machine by accident and prove nothing.
 */

import { afterAll, beforeAll } from 'vitest';

export function inTimeZone(zone: string, offsets: { january: number; july: number }): void {
  let previous: string | undefined;

  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
    const january = new Date(2026, 0, 1).getTimezoneOffset();
    const july = new Date(2026, 6, 1).getTimezoneOffset();
    if (january !== offsets.january || july !== offsets.july) {
      throw new Error(
        `The time zone did not change to ${zone}: offsets ${january}/${july}, expected ${offsets.january}/${offsets.july}.`,
      );
    }
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}

/** `getTimezoneOffset()` values, in minutes (positive west of Greenwich). */
export const ZONES = {
  london: { zone: 'Europe/London', offsets: { january: 0, july: -60 } },
  auckland: { zone: 'Pacific/Auckland', offsets: { january: -780, july: -720 } },
  losAngeles: { zone: 'America/Los_Angeles', offsets: { january: 480, july: 420 } },
} as const;
