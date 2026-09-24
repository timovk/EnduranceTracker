/**
 * The synthetic "Large" career of SPEC §1.3, generated in memory.
 *
 * Ten years from January 2017: 5,000 races watched a few at a time, each in
 * about a dozen stints, with the odd re-watch and the odd stint batch-logged a
 * minute after the one before. A seeded generator makes it the same career on
 * every run, so a slow result can be repeated exactly. The performance tests
 * replay it in memory, and insert it into a database of their own for the
 * database paths.
 */

import type { TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import { race } from './timeline-fixture';

const MINUTE = 60_000;

/** A deterministic generator: the same career on every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export interface SyntheticCareer {
  races: TimelineRaceRow[];
  sessions: TimelineSessionRow[];
}

/** `raceCount` races of about `stintsPerRace` stints each; 60,000 stints by default. */
export function syntheticCareer(raceCount = 5_000, stintsPerRace = 12): SyntheticCareer {
  const next = generator(20170101);
  const lengths = [3, 4, 6, 6, 6, 8, 10, 12, 24];
  const races: TimelineRaceRow[] = [];
  for (let index = 0; index < raceCount; index += 1) {
    const year = 2017 + Math.floor((index / raceCount) * 10);
    const event = index % 3 === 0 ? `event-${index % 40}` : null;
    races.push(race(`race-${index}`, {
      hours: lengths[Math.floor(next() * lengths.length)]!,
      name: `Race ${index}`,
      raceDate: new Date(Date.UTC(year, Math.floor(next() * 12), 1 + Math.floor(next() * 28))),
      championshipId: `championship-${index % 12}`,
      championshipName: `Championship ${index % 12}`,
      eventKey: event,
      eventId: event,
      eventName: event,
      circuitSlug: `circuit-${index % 60}`,
      circuit: `Circuit ${index % 60}`,
      isMajorEvent: index % 25 === 0,
    }));
  }

  const sessions: TimelineSessionRow[] = [];
  let clock = new Date(2017, 0, 1, 19, 0).getTime();
  let id = 0;
  // Three races under way at once, picked at random: stints interleave.
  const underWay: { race: TimelineRaceRow; stint: number; position: number }[] = [];
  let nextRace = 0;
  while (nextRace < races.length || underWay.length > 0) {
    while (underWay.length < 3 && nextRace < races.length) {
      underWay.push({ race: races[nextRace]!, stint: 0, position: 0 });
      nextRace += 1;
    }
    const slot = Math.floor(next() * underWay.length);
    const current = underWay[slot]!;
    const runtime = current.race.runtimeSec;
    const piece = Math.ceil(runtime / stintsPerRace);
    // One stint in ten goes back over something already seen.
    const start = next() < 0.1 ? Math.floor(next() * Math.max(1, current.position)) : current.position;
    const end = Math.min(runtime, start + piece);
    const speed = [1, 1, 1, 1.25, 1.5, 2][Math.floor(next() * 6)]!;
    const timelineSeconds = end - start;
    const realSeconds = Math.round(timelineSeconds / speed);
    clock += next() < 0.05 ? MINUTE : realSeconds * 1000 + Math.floor(next() * 100) * MINUTE;
    const at = new Date(clock);
    sessions.push({
      id: `stint-${id.toString().padStart(6, '0')}`,
      raceId: current.race.id,
      startTimestampSec: start,
      endTimestampSec: end,
      playbackSpeed: speed,
      timelineSeconds,
      realSeconds,
      watchedAt: at,
      createdAt: at,
    });
    id += 1;
    current.position = Math.max(current.position, end);
    current.stint += 1;
    if (current.stint >= stintsPerRace) underWay.splice(slot, 1);
  }
  return { races, sessions };
}

