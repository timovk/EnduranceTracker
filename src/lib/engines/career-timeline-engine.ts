/**
 * The career replay's loader and cache (0.4.0).
 *
 * `domain/career-timeline` replays a career from its stints and races; this
 * module reads those two sources out of the database and keeps the result for
 * the pages that ask for it again and again.
 *
 * Loading is exactly two queries, whatever the size of the career: every stint
 * in canonical order, and every race with the names the history pages group
 * by. The replay is then cached in memory per account, keyed by a fingerprint
 * of the account's data — four cheap aggregates, every one scoped to the
 * account. Any change to the history changes the fingerprint, so a stale
 * replay is never served; clearing the cache after a write only frees the
 * memory sooner.
 *
 * Inside a transaction the cache is never used: a write path calls
 * `loadTimelineInputs` with its transaction client and replays what it sees.
 */

import type { Prisma } from '@/generated/prisma/client';
import { CAREER_STATS_SHAPE } from '@/lib/config';
import { prisma, type Tx } from '@/lib/db/client';
import {
  buildCareerTimeline,
  type CareerTimeline,
  type TimelineRaceRow,
  type TimelineSessionRow,
} from '@/lib/domain/career-timeline';
import { editionYear } from '@/lib/domain/edition';
import type { RaceType } from '@/lib/domain/types';
import { eventDisplayName } from './mastery-engine';

export interface TimelineInputs {
  sessions: TimelineSessionRow[];
  races: TimelineRaceRow[];
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** What the replay reads of a stint. */
export const TIMELINE_SESSION_SELECT = {
  id: true, raceId: true, startTimestampSec: true, endTimestampSec: true, playbackSpeed: true,
  timelineSeconds: true, realSeconds: true, watchedAt: true, createdAt: true,
} satisfies Prisma.RaceViewingSessionSelect;

/** Canonical order, in the database's words. Served by the `(userId, watchedAt)` index. */
const CANONICAL_ORDER = [
  { watchedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' },
] satisfies Prisma.RaceViewingSessionOrderByWithRelationInput[];

/**
 * What the replay reads of a race. Exported so a caller that needs other race
 * fields as well (`computeCareerMetricsWithHistory`) can read both in one
 * query and hand the row to `toTimelineRaceRow`.
 */
export const TIMELINE_RACE_SELECT = {
  id: true, name: true, runtimeSec: true, scheduledDurationSec: true, raceDate: true,
  championshipId: true, raceMasteryId: true, iconicKey: true, circuit: true, circuitSlug: true,
  country: true, raceType: true, isMajorEvent: true, expeditionMode: true,
  season: { select: { year: true } },
  championship: { select: { name: true, accentColor: true } },
  raceMastery: { select: { key: true, name: true, displayName: true } },
} satisfies Prisma.RaceSelect;

export type TimelineRaceSource = Prisma.RaceGetPayload<{ select: typeof TIMELINE_RACE_SELECT }>;

/**
 * One race row as the replay sees it.
 *
 * The race's event is its `iconicKey`: that is what the user set, and what
 * `recomputeRaceMasteries` links the `RaceMastery` row from. The link supplies
 * the event's id and the name the user gave it. On the rare read between a
 * key being typed and the next recompute there is no link yet, and the name is
 * the one the recompute will give the event, so a race is always grouped with
 * the other editions carrying its key.
 */
export function toTimelineRaceRow(row: TimelineRaceSource): TimelineRaceRow {
  const seasonYear = row.season?.year ?? null;
  const linked = row.raceMastery !== null && row.iconicKey !== null && row.raceMastery.key === row.iconicKey;
  return {
    id: row.id,
    name: row.name,
    runtimeSec: row.runtimeSec,
    scheduledDurationSec: row.scheduledDurationSec,
    raceDate: row.raceDate,
    seasonYear,
    editionYear: editionYear({ raceDate: row.raceDate, seasonYear }),
    championshipId: row.championshipId,
    championshipName: row.championship?.name ?? null,
    championshipAccent: row.championship?.accentColor ?? null,
    eventId: linked ? row.raceMasteryId : null,
    eventKey: row.iconicKey,
    eventName: row.iconicKey === null
      ? null
      : linked && row.raceMastery !== null
        ? (row.raceMastery.displayName ?? row.raceMastery.name)
        : eventDisplayName(row.iconicKey),
    circuit: row.circuit,
    circuitSlug: row.circuitSlug,
    country: row.country,
    raceType: row.raceType as RaceType,
    isMajorEvent: row.isMajorEvent,
    expeditionMode: row.expeditionMode,
  };
}

/** Every stint of an account, in canonical order. */
export async function loadTimelineSessions(db: Tx, userId: string): Promise<TimelineSessionRow[]> {
  return db.raceViewingSession.findMany({
    where: { userId },
    orderBy: CANONICAL_ORDER,
    select: TIMELINE_SESSION_SELECT,
  });
}

/**
 * Everything the replay needs, in two queries.
 *
 * `db` MUST be the transaction client when a write path calls this, so the
 * replay includes what the transaction has written.
 */
export async function loadTimelineInputs(db: Tx, userId: string): Promise<TimelineInputs> {
  const [sessions, races] = await Promise.all([
    loadTimelineSessions(db, userId),
    db.race.findMany({ where: { userId }, select: TIMELINE_RACE_SELECT }),
  ]);
  return { sessions, races: races.map(toTimelineRaceRow) };
}

/**
 * One race and its stints, for the paths that replay a single race (the
 * Story Complete bonus, Expeditions). Null when the race is not this
 * account's.
 */
export async function loadRaceTimelineInputs(
  db: Tx,
  userId: string,
  raceId: string,
): Promise<{ race: TimelineRaceRow; sessions: TimelineSessionRow[] } | null> {
  const race = await db.race.findFirst({ where: { id: raceId, userId }, select: TIMELINE_RACE_SELECT });
  if (race === null) return null;
  const sessions = await db.raceViewingSession.findMany({
    where: { raceId, userId },
    orderBy: CANONICAL_ORDER,
    select: TIMELINE_SESSION_SELECT,
  });
  return { race: toTimelineRaceRow(race), sessions };
}

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

/**
 * A summary of everything the replay reads, which changes whenever any of it
 * does.
 *
 * Stints are never edited, only added and deleted, so their count, their
 * newest `createdAt` and three sums catch every change to them. Races, events
 * and championships are edited in place, and every edit bumps `updatedAt`
 * (Prisma's `@updatedAt` also applies to `updateMany`), so a count and the
 * newest `updatedAt` catch those.
 *
 * A season's year feeds the edition year but is not watched here: it is part
 * of the season's identity (`@@unique([championshipId, year])`, upserted,
 * never edited in place), and moving a race to another season updates the
 * race's own row.
 *
 * Every aggregate is scoped to the account, the championship one included, so
 * one account's writes never invalidate another's replay.
 */
export async function timelineFingerprint(userId: string, db: Tx = prisma): Promise<string> {
  const [sessions, races, events, championships] = await Promise.all([
    db.raceViewingSession.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
      _sum: { realSeconds: true, timelineSeconds: true, startTimestampSec: true },
    }),
    db.race.aggregate({ where: { userId }, _count: true, _max: { updatedAt: true } }),
    db.raceMastery.aggregate({ where: { userId }, _count: true, _max: { updatedAt: true } }),
    db.championship.aggregate({ where: { userId }, _count: true, _max: { updatedAt: true } }),
  ]);
  return JSON.stringify([
    sessions._count,
    sessions._max.createdAt?.getTime() ?? null,
    sessions._sum.realSeconds ?? 0,
    sessions._sum.timelineSeconds ?? 0,
    sessions._sum.startTimestampSec ?? 0,
    races._count,
    races._max.updatedAt?.getTime() ?? null,
    events._count,
    events._max.updatedAt?.getTime() ?? null,
    championships._count,
    championships._max.updatedAt?.getTime() ?? null,
  ]);
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

interface CachedTimeline {
  fingerprint: string;
  timeline: CareerTimeline;
}

interface PendingTimeline {
  fingerprint: string;
  promise: Promise<CareerTimeline>;
}

/**
 * On `globalThis`, like the Prisma client: Next compiles server actions and
 * server components into separate layers, and a module-level map could exist
 * once in each, so a write clearing one would leave the other stale in memory.
 */
const globalForTimeline = globalThis as unknown as {
  careerTimelines?: Map<string, CachedTimeline>;
  careerTimelineBuilds?: Map<string, PendingTimeline>;
};

function cache(): Map<string, CachedTimeline> {
  globalForTimeline.careerTimelines ??= new Map();
  return globalForTimeline.careerTimelines;
}

function builds(): Map<string, PendingTimeline> {
  globalForTimeline.careerTimelineBuilds ??= new Map();
  return globalForTimeline.careerTimelineBuilds;
}

/** Keep an entry, as the most recently used, and drop the least recently used past the limit. */
function remember(userId: string, entry: CachedTimeline): void {
  const entries = cache();
  entries.delete(userId);
  entries.set(userId, entry);
  while (entries.size > CAREER_STATS_SHAPE.timelineCacheEntries) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/**
 * The account's career replay, through the global client.
 *
 * A hit costs the four fingerprint aggregates. A miss costs both loads and the
 * replay; concurrent misses for the same data share one build.
 *
 * Never call it inside a transaction. It cannot see the transaction's writes,
 * and worse: Prisma runs the race load's relation selects over a large library
 * as several statements inside a transaction of its own, which waits for the
 * open one to finish — so a call from inside it waits until that transaction
 * times out. Inside a transaction, replay `loadTimelineInputs(tx, userId)`.
 */
export async function getCareerTimeline(userId: string): Promise<CareerTimeline> {
  const fingerprint = await timelineFingerprint(userId);

  const hit = cache().get(userId);
  if (hit !== undefined && hit.fingerprint === fingerprint) {
    remember(userId, hit);
    return hit.timeline;
  }

  const pending = builds().get(userId);
  if (pending !== undefined && pending.fingerprint === fingerprint) return pending.promise;

  const promise = loadTimelineInputs(prisma, userId).then((inputs) => {
    const timeline = buildCareerTimeline(inputs.sessions, inputs.races);
    remember(userId, { fingerprint, timeline });
    return timeline;
  });
  const build = { fingerprint, promise };
  builds().set(userId, build);
  try {
    return await promise;
  } finally {
    if (builds().get(userId) === build) builds().delete(userId);
  }
}

/**
 * Forget an account's replay, or every account's. Server actions call this
 * after a write commits; correctness never depends on it.
 */
export function clearCareerTimelineCache(userId?: string): void {
  if (userId === undefined) {
    cache().clear();
    builds().clear();
    return;
  }
  cache().delete(userId);
  builds().delete(userId);
}
