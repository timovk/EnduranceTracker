/**
 * Careers in the real test database, for the integration tests.
 *
 * Two kinds of history can be written:
 *
 *   - the ordinary kind, through the engine: an account with its profile,
 *     races as the library stores them, and stints logged by the real
 *     `logViewingSession` with an explicit `watchedAt` and `now`;
 *   - "0.3.2-shaped" rows, inserted directly the way 0.3.2 left them: no
 *     0.4.0 markers and every 0.4.0 column null — including a race whose
 *     runtime was shortened after it was watched, so its stored intervals run
 *     past its new end.
 *
 * `ledgerProblems` checks invariant I2 (career XP is the sum of the ledger,
 * and every row's running total is right) and says what is wrong in words.
 */

import { prisma } from '@/lib/db/client';
import { levelFromXp } from '@/lib/domain/progression';
import type { SessionOutcome } from '@/lib/engines/contracts';
import { logViewingSession } from '@/lib/engines/session-engine';
import { awardXp } from '@/lib/engines/xp-ledger';
import type { Tx } from '@/lib/db/client';

export const H = 3600;

/** An account with a career profile, as a new account has. Replaces any account with the same id. */
export async function createCareerUser(id: string, name: string): Promise<string> {
  await prisma.user.deleteMany({ where: { OR: [{ id }, { name }] } });
  await prisma.user.create({ data: { id, name, careerProfile: { create: {} } } });
  return id;
}

export interface RaceOptions {
  name?: string;
  /** Runtime in hours; 6 when not given. */
  hours?: number;
  isMajorEvent?: boolean;
  iconicKey?: string | null;
  championshipId?: string | null;
  seasonId?: string | null;
  /** The race day, stored the way the form stores it: UTC midnight. */
  raceDate?: Date | null;
}

/** A race in the library, the way the Add Race form writes one. */
export async function addRace(userId: string, options: RaceOptions = {}): Promise<string> {
  const runtimeSec = Math.round((options.hours ?? 6) * H);
  const race = await prisma.race.create({
    data: {
      userId,
      name: options.name ?? 'Test Race',
      scheduledDurationSec: runtimeSec,
      runtimeSec,
      raceType: 'H6',
      isMajorEvent: options.isMajorEvent ?? false,
      iconicKey: options.iconicKey ?? null,
      championshipId: options.championshipId ?? null,
      seasonId: options.seasonId ?? null,
      raceDate: options.raceDate ?? null,
    },
    select: { id: true },
  });
  return race.id;
}

export interface StintOptions {
  /** Timeline positions, in seconds. */
  from: number;
  to: number;
  speed?: number;
  /** When the stint was logged; the engine's `now` when not given. */
  watchedAt?: Date;
  now?: Date;
}

/** A stint, logged through the real engine. */
export async function logStint(userId: string, raceId: string, options: StintOptions): Promise<SessionOutcome> {
  return logViewingSession(userId, {
    raceId,
    mode: 'RANGE',
    startTimestamp: options.from,
    endTimestamp: options.to,
    playbackSpeed: options.speed ?? 1,
    watchedAt: options.watchedAt ?? null,
    note: undefined,
  }, options.now);
}

/**
 * What is wrong with an account's ledger, if anything (invariant I2): the
 * profile's career XP must be the sum of its ledger, and every row's
 * `careerXpAfter` and `levelAfter` the running total up to it in
 * `(createdAt, id)` order. An empty list means the ledger is settled.
 */
export async function ledgerProblems(userId: string): Promise<string[]> {
  const [rows, profile] = await Promise.all([
    prisma.xPTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amount: true, careerXpAfter: true, levelAfter: true },
    }),
    prisma.careerProfile.findUniqueOrThrow({ where: { userId } }),
  ]);

  const problems: string[] = [];
  let running = 0;
  for (const row of rows) {
    running += row.amount;
    if (Number(row.careerXpAfter) !== running) {
      problems.push(`row ${row.id} says ${Number(row.careerXpAfter)} XP after it, the ledger says ${running}`);
    }
    const level = levelFromXp(running).level;
    if (row.levelAfter !== level) problems.push(`row ${row.id} says level ${row.levelAfter}, the ledger says ${level}`);
  }
  if (Number(profile.careerXp) !== running) {
    problems.push(`the profile holds ${Number(profile.careerXp)} XP, the ledger sums to ${running}`);
  }
  if (profile.level !== levelFromXp(running).level) {
    problems.push(`the profile is level ${profile.level}, the ledger says ${levelFromXp(running).level}`);
  }
  return problems;
}

/** Move an account's ledger rows to a different `createdAt`, as if they had been written then. */
export async function backdateLedgerRows(userId: string, ids: readonly string[], createdAt: Date): Promise<void> {
  await prisma.xPTransaction.updateMany({ where: { userId, id: { in: [...ids] } }, data: { createdAt } });
}

export interface LegacyRace {
  raceId: string;
  sessionIds: string[];
}

/**
 * A race as 0.3.2 could leave it after its runtime was shortened.
 *
 * It was watched over `stints` (timeline positions in seconds, which may run
 * past the end it has now). Then its runtime was cut to `hours`, and 0.3.2
 * recomputed the aggregates without clamping: the stored intervals still run
 * past the new end, and coverage counted there can make the race read Story
 * Complete with a gap in it. `storyCompleted` records that 0.3.2 marked it complete, and
 * `bonusPaid` that a stint paid its Story Complete bonus on the strength of
 * it; `creditedViewingSec` is null, as it is on every 0.3.2 row.
 *
 * The XP it holds is written through `awardXp`, so the ledger is settled
 * before the test starts.
 */
export async function insertLegacyShortenedRace(
  userId: string,
  options: {
    name?: string;
    hours: number;
    stints: readonly { from: number; to: number; watchedAt: Date }[];
    storyCompleted: boolean;
    bonusPaid: boolean;
  },
): Promise<LegacyRace> {
  const runtimeSec = Math.round(options.hours * H);
  const race = await prisma.race.create({
    data: {
      userId,
      name: options.name ?? 'Legacy Race',
      scheduledDurationSec: runtimeSec,
      runtimeSec,
      raceType: 'H6',
    },
    select: { id: true, name: true },
  });

  return prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const sessionIds: string[] = [];
    let covered: { start: number; end: number }[] = [];
    let real = 0;
    let timeline = 0;
    for (const stint of options.stints) {
      const seconds = stint.to - stint.from;
      const session = await db.raceViewingSession.create({
        data: {
          raceId: race.id, userId,
          startTimestampSec: stint.from, endTimestampSec: stint.to,
          playbackSpeed: 1, timelineSeconds: seconds, realSeconds: seconds,
          newCoverageSeconds: seconds, watchedAt: stint.watchedAt, createdAt: stint.watchedAt,
        },
        select: { id: true },
      });
      sessionIds.push(session.id);
      real += seconds;
      timeline += seconds;
      covered = mergeLoosely([...covered, { start: stint.from, end: stint.to }]);
      await awardXp(db, userId, {
        source: 'VIEWING', amount: Math.round(seconds / 2), description: 'Viewing time',
        sourceRef: race.id, sessionId: session.id,
      });
    }

    // What 0.3.2 stored: the merged intervals, never clamped to the runtime.
    await db.watchedInterval.createMany({
      data: covered.map((interval) => ({ raceId: race.id, startSec: interval.start, endSec: interval.end })),
    });
    const coverage = covered.reduce((sum, interval) => sum + interval.end - interval.start, 0);
    const last = options.stints[options.stints.length - 1];
    const completedAt = options.storyCompleted ? (last?.watchedAt ?? null) : null;
    await db.race.update({
      where: { id: race.id },
      data: {
        coverageSec: Math.min(coverage, runtimeSec),
        realViewingSec: real,
        timelineWatchedSec: timeline,
        sessionCount: options.stints.length,
        furthestTimestampSec: Math.min(Math.max(0, ...covered.map((interval) => interval.end)), runtimeSec),
        startedAt: options.stints[0]?.watchedAt ?? null,
        lastWatchedAt: last?.watchedAt ?? null,
        storyCompletedAt: completedAt,
        completedAt,
        status: options.storyCompleted ? 'COMPLETED' : 'WATCHING',
      },
    });

    if (options.bonusPaid) {
      await awardXp(db, userId, {
        source: 'STORY_COMPLETE', amount: 1_500, seasonAmount: 0, description: `Story Complete — ${race.name}`,
        sourceRef: race.id, sessionId: sessionIds[sessionIds.length - 1], dedupeKey: `story-complete:${race.id}`,
      });
    }
    return { raceId: race.id, sessionIds };
  });
}

/** Merge touching or overlapping intervals, with no gap tolerance and no limit. */
function mergeLoosely(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}
