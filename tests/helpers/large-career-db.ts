/**
 * The synthetic careers of SPEC §1.3, in a database of their own, for the
 * performance tests' database paths.
 *
 * A fresh SQLite file is migrated with the desktop's own runner and filled
 * with `createMany`: the "Large" career (ten years, 5,000 races, 60,000 stints
 * and 180,000 ledger rows) and, in a second account, the "Real" one (its first
 * 3,000 stints). Each account also has one race from its first year watched
 * in 200 stints, the race `deleteRace` is timed on.
 *
 * Everything written is what the engines would have written: race aggregates,
 * merged intervals and the ledger's running totals come from the replay and
 * the XP rules, so the timed paths work on a career that is consistent with
 * itself. `DATABASE_URL` points at the file until `cleanup`; build it before
 * the test file's first query.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrations } from '../../desktop/src/migrate';
import { prisma } from '@/lib/db/client';
import { buildCareerTimeline, type TimelineRaceRow, type TimelineSessionRow } from '@/lib/domain/career-timeline';
import { averagePlaybackSpeed } from '@/lib/domain/playback';
import { levelFromXp, storyCompleteBonus } from '@/lib/domain/progression';
import { XP_CONFIG } from '@/lib/config';
import { syntheticCareer } from './synthetic-career';
import { race as raceRow } from './timeline-fixture';

const H = 3600;
const MINUTE = 60_000;
const CHUNK = 2_000;

export interface SeededCareer {
  userId: string;
  races: number;
  stints: number;
  ledgerRows: number;
  /** An instant after the last stint: the `now` for timed writes. */
  now: Date;
  /** The first stint of the career, in canonical order. */
  firstStintId: string;
  /** The last stint of the career, in canonical order, and its race. */
  lastStintId: string;
  lastRaceId: string;
  /** The first-year race watched in 200 stints. */
  bigRaceId: string;
  /** A race with most of its story still to watch, for logging stints. */
  openRaceId: string;
}

export interface LargeCareerDatabase {
  file: string;
  large: SeededCareer;
  real: SeededCareer;
  cleanup: () => void;
}

/** Build the file, point `DATABASE_URL` at it, and write both careers. */
export async function createLargeCareerDatabase(): Promise<LargeCareerDatabase> {
  if ((globalThis as { prisma?: unknown }).prisma !== undefined) {
    throw new Error('The Prisma client already exists; build the large database before the first query.');
  }
  const directory = mkdtempSync(join(tmpdir(), 'endurance-large-'));
  const file = join(directory, 'large.db');
  runMigrations(file, join(resolve(process.cwd()), 'prisma', 'migrations'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${file}`;

  const synthetic = syntheticCareer();
  const large = await seedCareer('large', 'Large Career', synthetic.races, synthetic.sessions);
  const realSessions = synthetic.sessions.slice(0, 3_000);
  const realRaceIds = new Set(realSessions.map((session) => session.raceId));
  const real = await seedCareer('real', 'Real Career', synthetic.races.filter((race) => realRaceIds.has(race.id)), realSessions);

  return {
    file,
    large,
    real,
    cleanup: () => {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** One account: its races, stints, intervals and ledger, with ids prefixed so two accounts can share the file. */
async function seedCareer(
  prefix: string,
  name: string,
  syntheticRaces: readonly TimelineRaceRow[],
  syntheticSessions: readonly TimelineSessionRow[],
): Promise<SeededCareer> {
  const userId = `${prefix}-user`;
  const races = syntheticRaces.map((race) => ({
    ...race,
    id: `${prefix}-${race.id}`,
    championshipId: race.championshipId === null ? null : `${prefix}-${race.championshipId}`,
  }));

  // The 200-stint race: a 24-hour race watched in seven-minute stints, one
  // every half hour over the four days before the rest of the career begins,
  // so its stints and their XP are the first in the account's history.
  const first = syntheticSessions[0]!;
  const big = raceRow(`${prefix}-race-big`, {
    hours: 24, name: 'The Long One', raceDate: new Date(Date.UTC(2016, 11, 1)), championshipId: races[0]!.championshipId,
  });
  races.push(big);
  const sessions: TimelineSessionRow[] = [];
  for (let index = 0; index < 200; index += 1) {
    const at = new Date(first.watchedAt.getTime() - (200 - index) * 30 * MINUTE);
    const start = index * 420;
    sessions.push({
      id: `${prefix}-big-${index.toString().padStart(3, '0')}`, raceId: big.id,
      startTimestampSec: start, endTimestampSec: start + 420, playbackSpeed: 1,
      timelineSeconds: 420, realSeconds: 420, watchedAt: at, createdAt: at,
    });
  }
  for (const session of syntheticSessions) {
    sessions.push({ ...session, id: `${prefix}-${session.id}`, raceId: `${prefix}-${session.raceId}` });
  }

  const timeline = buildCareerTimeline(sessions, races);
  const now = new Date(timeline.stints[timeline.stints.length - 1]!.watchedAt.getTime() + 24 * 3_600_000);

  await prisma.user.create({ data: { id: userId, name } });
  const championshipIds = [...new Set(races.map((race) => race.championshipId).filter((id): id is string => id !== null))];
  await prisma.championship.createMany({
    data: championshipIds.map((id, index) => ({ id, userId, slug: id, name: `Championship ${index}` })),
  });

  // Races, with the aggregates the engine keeps on them.
  const sessionsByRace = new Map<string, TimelineSessionRow[]>();
  for (const session of sessions) {
    const list = sessionsByRace.get(session.raceId) ?? [];
    list.push(session);
    sessionsByRace.set(session.raceId, list);
  }
  const raceData = races.map((race) => {
    const history = timeline.races.get(race.id)!;
    const own = sessionsByRace.get(race.id) ?? [];
    return {
      id: race.id, userId, name: race.name, championshipId: race.championshipId,
      circuit: race.circuit, circuitSlug: race.circuitSlug, raceDate: race.raceDate,
      scheduledDurationSec: race.runtimeSec, runtimeSec: race.runtimeSec, raceType: 'CUSTOM' as const,
      isMajorEvent: race.isMajorEvent, iconicKey: race.eventKey,
      coverageSec: history.coverageSeconds,
      realViewingSec: own.reduce((sum, session) => sum + session.realSeconds, 0),
      creditedViewingSec: history.creditedSeconds,
      timelineWatchedSec: history.timelineSeconds,
      sessionCount: history.sessionCount,
      furthestTimestampSec: history.intervals.reduce((max, interval) => Math.max(max, interval.end), 0),
      avgPlaybackSpeed: averagePlaybackSpeed(own),
      startedAt: history.firstStintAt,
      lastWatchedAt: history.lastStintAt,
      storyCompletedAt: history.storyCompletedAt,
      completedAt: history.storyCompletedAt,
      status: history.storyCompletedAt !== null ? 'COMPLETED' as const : history.sessionCount > 0 ? 'WATCHING' as const : 'UNWATCHED' as const,
    };
  });
  for (let index = 0; index < raceData.length; index += CHUNK) {
    await prisma.race.createMany({ data: raceData.slice(index, index + CHUNK) });
  }

  // Written in canonical order, each with the coverage snapshot the stint
  // path records.
  const bySessionId = new Map(sessions.map((session) => [session.id, session]));
  const sessionRows = timeline.stints.map((stint) => {
    const session = bySessionId.get(stint.sessionId)!;
    return {
      id: session.id, raceId: session.raceId, userId,
      startTimestampSec: session.startTimestampSec, endTimestampSec: session.endTimestampSec,
      playbackSpeed: session.playbackSpeed, timelineSeconds: session.timelineSeconds, realSeconds: session.realSeconds,
      newCoverageSeconds: stint.addedCoverageSeconds, coverageBeforeSec: stint.coverageBeforeSeconds,
      coverageAfterSec: stint.coverageAfterSeconds, watchedAt: session.watchedAt, createdAt: session.createdAt,
    };
  });
  for (let index = 0; index < sessionRows.length; index += CHUNK) {
    await prisma.raceViewingSession.createMany({ data: sessionRows.slice(index, index + CHUNK) });
  }

  const intervalRows = races.flatMap((race) =>
    timeline.races.get(race.id)!.intervals.map((interval) => ({ raceId: race.id, startSec: interval.start, endSec: interval.end })));
  for (let index = 0; index < intervalRows.length; index += CHUNK) {
    await prisma.watchedInterval.createMany({ data: intervalRows.slice(index, index + CHUNK) });
  }

  // The ledger: three rows a stint — its viewing XP and two awards it
  // triggered — and a Story Complete bonus on each completing stint, in the
  // career's order, with the running totals an award stamps.
  const ledgerRows: {
    userId: string; source: 'VIEWING' | 'REWATCH' | 'CHALLENGE' | 'MILESTONE' | 'STORY_COMPLETE';
    amount: number; description: string; sourceRef: string | null; sessionId: string | null;
    dedupeKey: string | null; careerXpAfter: bigint; levelAfter: number; createdAt: Date;
  }[] = [];
  let running = 0;
  const push = (row: Omit<(typeof ledgerRows)[number], 'userId' | 'careerXpAfter' | 'levelAfter'>) => {
    running += row.amount;
    ledgerRows.push({ ...row, userId, careerXpAfter: BigInt(running), levelAfter: levelFromXp(running).level });
  };
  for (const stint of timeline.stints) {
    const at = stint.watchedAt.getTime();
    const minutes = stint.creditedSeconds / 60;
    const fresh = stint.addedCoverageSeconds > 0;
    push({
      source: fresh ? 'VIEWING' : 'REWATCH',
      amount: Math.max(1, Math.round(minutes * XP_CONFIG.xpPerRealMinute * (fresh ? 1 : XP_CONFIG.rewatchXpMultiplier))),
      description: fresh ? 'Viewing time' : 'Re-watched section', sourceRef: stint.raceId, sessionId: stint.sessionId,
      dedupeKey: null, createdAt: new Date(at),
    });
    push({ source: 'CHALLENGE', amount: 40, description: 'Challenge', sourceRef: null, sessionId: null, dedupeKey: null, createdAt: new Date(at + 1) });
    push({ source: 'MILESTONE', amount: 20, description: 'Milestone', sourceRef: null, sessionId: null, dedupeKey: null, createdAt: new Date(at + 2) });
    if (stint.completesStory) {
      const race = timeline.racesById.get(stint.raceId)!;
      push({
        source: 'STORY_COMPLETE', amount: storyCompleteBonus(race.runtimeSec, race.isMajorEvent).careerXp,
        description: `Story Complete — ${race.name}`, sourceRef: race.id, sessionId: stint.sessionId,
        dedupeKey: `story-complete:${race.id}`, createdAt: new Date(at + 3),
      });
    }
  }
  for (let index = 0; index < ledgerRows.length; index += CHUNK) {
    await prisma.xPTransaction.createMany({ data: ledgerRows.slice(index, index + CHUNK) });
  }
  const state = levelFromXp(running);
  await prisma.careerProfile.create({ data: { userId, careerXp: BigInt(running), level: state.level } });

  const lastStint = timeline.stints[timeline.stints.length - 1]!;
  const open = races.find((race) => {
    const history = timeline.races.get(race.id)!;
    return history.sessionCount > 0 && history.storyCompletedAt === null && history.coverageSeconds < race.runtimeSec - H;
  })!;

  return {
    userId,
    races: races.length,
    stints: sessions.length,
    ledgerRows: ledgerRows.length,
    now,
    firstStintId: timeline.stints[0]!.sessionId,
    lastStintId: lastStint.sessionId,
    lastRaceId: lastStint.raceId,
    bigRaceId: big.id,
    openRaceId: open.id,
  };
}
