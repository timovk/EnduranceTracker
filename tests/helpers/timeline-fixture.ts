/**
 * A compact way to write a viewing history for the pure replay tests.
 *
 *     const lm = race('le-mans', { hours: 24 });
 *     const timeline = career([lm], [
 *       stint(lm, '2026-12-31T23:30', { from: '0:00', to: '1:00' }),
 *       stint(lm, '2027-01-01T02:00', { from: '1:00', to: '3:00', speed: 1.5 }),
 *     ]);
 *
 * Times are LOCAL wall-clock times, parsed from their parts, so a test that
 * sets `process.env.TZ` means the clock of that zone. Timeline positions are
 * `H:MM` or `H:MM:SS` into the race. No database, no clock.
 */

import type { CareerTimeline, TimelineOptions, TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import { buildCareerTimeline } from '@/lib/domain/career-timeline';
import { editionYear } from '@/lib/domain/edition';
import { realSecondsFor } from '@/lib/domain/playback';

/** `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, in local time. */
export function localTime(text: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!match) throw new Error(`"${text}" is not a local date-time.`);
  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    Number(year), Number(month) - 1, Number(day),
    Number(hours ?? 0), Number(minutes ?? 0), Number(seconds ?? 0), 0,
  );
}

/** `H:MM` or `H:MM:SS` into a race, in seconds. */
export function position(text: string): number {
  const parts = text.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length === 2) return parts[0]! * 3600 + parts[1]! * 60;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  throw new Error(`"${text}" is not H:MM or H:MM:SS.`);
}

/** A race row. `hours` sets both the runtime and the scheduled length. */
export function race(id: string, overrides: Partial<TimelineRaceRow> & { hours?: number } = {}): TimelineRaceRow {
  const { hours, ...rest } = overrides;
  const runtimeSec = Math.round((hours ?? 6) * 3600);
  const base: TimelineRaceRow = {
    id,
    name: id,
    runtimeSec,
    scheduledDurationSec: runtimeSec,
    raceDate: null,
    seasonYear: null,
    editionYear: null,
    championshipId: null,
    championshipName: null,
    championshipAccent: null,
    eventId: null,
    eventKey: null,
    eventName: null,
    circuit: null,
    circuitSlug: null,
    country: null,
    raceType: 'CUSTOM',
    isMajorEvent: false,
    expeditionMode: null,
  };
  const row = { ...base, ...rest };
  if (rest.editionYear === undefined) row.editionYear = editionYear(row);
  return row;
}

let nextId = 1;

/** Stint ids restart from `s1`, for tests that name stints by number. */
export function resetStintIds(): void {
  nextId = 1;
}

/**
 * A stint of `race`, logged at `watchedAt`, over `[from, to]` of its timeline.
 * Real time follows from the speed, as the engine computes it, unless given.
 */
export function stint(
  of: TimelineRaceRow | string,
  watchedAt: string | Date,
  window: { from: string; to: string; speed?: number; id?: string; createdAt?: string | Date; realSeconds?: number },
): TimelineSessionRow {
  const start = position(window.from);
  const end = position(window.to);
  const speed = window.speed ?? 1;
  const timelineSeconds = Math.max(0, end - start);
  const at = typeof watchedAt === 'string' ? localTime(watchedAt) : watchedAt;
  const created = window.createdAt === undefined
    ? at
    : typeof window.createdAt === 'string' ? localTime(window.createdAt) : window.createdAt;
  const id = window.id ?? `s${nextId}`;
  nextId += 1;
  return {
    id,
    raceId: typeof of === 'string' ? of : of.id,
    startTimestampSec: start,
    endTimestampSec: end,
    playbackSpeed: speed,
    timelineSeconds,
    realSeconds: window.realSeconds ?? realSecondsFor(timelineSeconds, speed),
    watchedAt: at,
    createdAt: created,
  };
}

/** The replay of a whole written history. */
export function career(
  races: readonly TimelineRaceRow[],
  sessions: readonly TimelineSessionRow[],
  options?: TimelineOptions,
): CareerTimeline {
  return buildCareerTimeline(sessions, races, options);
}
