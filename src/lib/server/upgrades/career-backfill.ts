/**
 * The 0.4.0 career backfill: bringing a career recorded by an earlier version
 * up to what 0.4.0 knows about it.
 *
 * It follows the 0.3.1 season reset's pattern (`season-reset.ts`) — a
 * per-account marker in `ConfigOverride`, one account's failure never holding
 * back another's, and every line of what it did in the server log — with three
 * differences, because a long career can take longer than one start-up
 * allows:
 *
 *   - The marker is compared BY VALUE: it records which phases are done, and
 *     how far the race phase got, not merely that something ran.
 *   - Progress is recorded per phase and per CHUNK, in the same transaction
 *     as the chunk's work, so progress and work always commit together and a
 *     start cut short loses nothing.
 *   - Every chunk asks the start-up deadline BEFORE it starts
 *     (`BackfillClock`). An account that runs out of time stops cleanly and
 *     carries on from its recorded phase and cursor on the next start; the
 *     accounts served least recently go first, so one large career can never
 *     starve another.
 *
 * The phases this build runs:
 *
 *   P1  races       Credited time written where it differs, a race whose
 *                   stored coverage runs past a runtime shortened under 0.3.x
 *                   rebuilt (its status kept), and the Story Complete bonus
 *                   made to exist exactly when the replay says the race is
 *                   complete — a bonus a 0.3.x runtime edit skipped is paid,
 *                   career XP only. Chunks of races, in id order.
 *   P3  milestones  The ladders synced, the new Career Milestone rungs a
 *                   career had already passed written and paid once, and
 *                   every undated milestone and event step dated from the
 *                   replay. One chunk.
 *
 * Later work appends its own phases to `CAREER_BACKFILL_PHASES`; an account
 * completed by an earlier build simply runs the new ones.
 *
 * Every chunk is idempotent: derived values are written only when they
 * differ, bonuses and rungs are guarded by dedupe keys, and a date is written
 * only while none is set. A chunk repeated after a crash, or a forced second
 * run, changes nothing. What 0.3.x left behind in the ledger — viewing XP
 * whose stint is gone, a Story Complete bonus whose race was deleted — is
 * counted and logged, never removed here: `db:recompute` removes it.
 */

import { z } from 'zod';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { buildCareerTimeline, type CareerTimeline } from '@/lib/domain/career-timeline';
import { syncMilestones } from '@/lib/engines/achievement-engine';
import { fillLandmarkDates, syncCareerMilestones } from '@/lib/engines/career-milestone-engine';
import { loadTimelineInputs } from '@/lib/engines/career-timeline-engine';
import { computeCareerMetricsWithHistory } from '@/lib/engines/metrics';
import { reconcileStoryBonus, storyBonusKey } from '@/lib/engines/progression-resync';
import { rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { settleLedger, type XpRevocation } from '@/lib/engines/xp-ledger';

/** The per-account `ConfigOverride` key holding the backfill's progress. */
export const CAREER_BACKFILL_KEY = 'careerBackfill';

/** The release whose backfill the marker describes. A marker of another version is not this one's progress. */
export const CAREER_BACKFILL_VERSION = '0.4.0';

/** The phases this build runs, in order. */
export const CAREER_BACKFILL_PHASES = ['P1', 'P3'] as const;
export type PhaseKey = (typeof CAREER_BACKFILL_PHASES)[number];

/**
 * The start-up budget, shared by everything `register()` runs and measured
 * from its start. Far inside the desktop shell's 60-second health gate, with
 * room for the rest of the server's boot.
 */
export const STARTUP_BUDGET_MS = 30_000;

/** One chunk's transaction: as generous as logging a stint. */
const CHUNK_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/** Races per P1 chunk. */
const RACE_CHUNK = 500;

/** The least a chunk is assumed to take before one has been measured. */
const MINIMUM_CHUNK_ESTIMATE_MS = 1_000;

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

const markerSchema = z.object({
  version: z.string(),
  done: z.array(z.string()),
  cursors: z.object({ P1: z.string().optional() }).default({}),
  lastRunAt: z.string().nullable().default(null),
});

/**
 * An account's backfill progress: the phases done, how far the race phase
 * got (the last race id a chunk finished), and when a chunk last ran for it.
 * A type alias rather than an interface, so it is a Prisma `Json` value as it
 * stands.
 */
export type CareerBackfillMarker = {
  version: string;
  done: PhaseKey[];
  cursors: { P1?: string };
  lastRunAt: string | null;
};

function isPhaseKey(value: string): value is PhaseKey {
  return (CAREER_BACKFILL_PHASES as readonly string[]).includes(value);
}

/** A stored marker, or null when there is none or it is not one this build can read. */
function parseMarker(value: unknown): CareerBackfillMarker | null {
  const parsed = markerSchema.safeParse(value);
  if (!parsed.success) return null;
  const cursors: CareerBackfillMarker['cursors'] = {};
  if (parsed.data.cursors.P1 !== undefined) cursors.P1 = parsed.data.cursors.P1;
  return {
    version: parsed.data.version,
    done: parsed.data.done.filter(isPhaseKey),
    cursors,
    lastRunAt: parsed.data.lastRunAt,
  };
}

/** Whether a marker says this build has nothing left to do. */
function isComplete(marker: CareerBackfillMarker | null): boolean {
  return marker !== null
    && marker.version === CAREER_BACKFILL_VERSION
    && CAREER_BACKFILL_PHASES.every((phase) => marker.done.includes(phase));
}

export async function readCareerBackfillMarker(userId: string, db: Tx = prisma): Promise<CareerBackfillMarker | null> {
  const row = await db.configOverride.findUnique({
    where: { userId_key: { userId, key: CAREER_BACKFILL_KEY } },
    select: { value: true },
  });
  return row === null ? null : parseMarker(row.value);
}

/** Whether the account's marker is this version's and every phase this build knows is done. */
export async function isCareerBackfillApplied(userId: string, db: Tx = prisma): Promise<boolean> {
  return isComplete(await readCareerBackfillMarker(userId, db));
}

async function writeMarker(db: Tx, userId: string, marker: CareerBackfillMarker): Promise<void> {
  await db.configOverride.upsert({
    where: { userId_key: { userId, key: CAREER_BACKFILL_KEY } },
    update: { value: marker },
    create: { userId, key: CAREER_BACKFILL_KEY, value: marker },
  });
}

/**
 * Record every phase as done. For an account that has nothing to backfill —
 * one created by this version — and for `db:recompute`, which does all of it.
 */
export async function markCareerBackfillApplied(userId: string, db: Tx = prisma): Promise<void> {
  const previous = await readCareerBackfillMarker(userId, db);
  await writeMarker(db, userId, {
    version: CAREER_BACKFILL_VERSION,
    done: [...CAREER_BACKFILL_PHASES],
    cursors: {},
    lastRunAt: previous?.lastRunAt ?? null,
  });
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Whether there is time to start another chunk. The only thing the backfill
 * asks about time, so a test can make the deadline as tight as it likes.
 */
export interface BackfillClock {
  shouldStartChunk(estimatedMs: number): boolean;
}

/**
 * A clock with a deadline, in the milliseconds `now` returns: a chunk may
 * start while it would finish by then. `now` reads the system clock unless a
 * test passes its own.
 */
export function deadlineClock(deadline: number, now: () => number = Date.now): BackfillClock {
  return { shouldStartChunk: (estimatedMs) => now() + estimatedMs <= deadline };
}

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

/**
 * What one account's run builds once, outside the chunk transactions: the
 * career replay every phase reads. At start-up nothing else writes while it
 * is in use — `register()` finishes before the server answers a request — and
 * every chunk re-checks what it writes anyway, so a stale context can never
 * pay anything twice.
 */
export interface PhaseContext {
  userId: string;
  now: Date;
  timeline: CareerTimeline;
}

export async function buildPhaseContext(userId: string, now: Date): Promise<PhaseContext> {
  const inputs = await loadTimelineInputs(prisma, userId);
  return { userId, now, timeline: buildCareerTimeline(inputs.sessions, inputs.races) };
}

export interface RaceChunkResult {
  /** Races whose credited time was written. */
  racesCredited: number;
  /** Races whose coverage ran past a runtime shortened under 0.3.x, rebuilt. */
  legacyRacesRepaired: number;
  storyBonusesAwarded: number;
  storyBonusesRevoked: number;
}

/**
 * P1 for one chunk of races, inside the chunk's transaction.
 *
 *   - `creditedViewingSec` is written where it differs from the replay's.
 *   - A race whose stored intervals end past its runtime — a runtime
 *     shortened under 0.3.x, which 0.3.x never clamped — has its intervals
 *     rebuilt and its aggregates recomputed with its status kept
 *     (`preserveStatus`), so coverage past the new end stops counting and a
 *     status the user chose is not overruled.
 *   - The Story Complete bonus is reconciled with the replay wherever the two
 *     disagree: a complete race without it is paid it, career XP only, and a
 *     bonus the race does not support is revoked.
 *
 * The ledger is settled once at the end, for whatever came off. The races are
 * re-read inside the account, so an id that is not this account's is ignored.
 */
export async function backfillRaces(tx: Tx, ctx: PhaseContext, chunk: readonly string[]): Promise<RaceChunkResult> {
  const result: RaceChunkResult = { racesCredited: 0, legacyRacesRepaired: 0, storyBonusesAwarded: 0, storyBonusesRevoked: 0 };
  if (chunk.length === 0) return result;
  const { userId, now, timeline } = ctx;

  const [races, furthest, held] = await Promise.all([
    tx.race.findMany({
      where: { userId, id: { in: [...chunk] } },
      select: { id: true, runtimeSec: true, creditedViewingSec: true },
      orderBy: { id: 'asc' },
    }),
    tx.watchedInterval.groupBy({ by: ['raceId'], where: { raceId: { in: [...chunk] } }, _max: { endSec: true } }),
    tx.xPTransaction.findMany({
      where: { userId, dedupeKey: { in: chunk.map(storyBonusKey) } },
      select: { dedupeKey: true },
    }),
  ]);
  const furthestByRace = new Map(furthest.map((row) => [row.raceId, row._max.endSec ?? 0]));
  const heldKeys = new Set(held.map((row) => row.dedupeKey));
  const revocations: XpRevocation[] = [];

  for (const race of races) {
    const history = timeline.races.get(race.id);

    if ((furthestByRace.get(race.id) ?? 0) > race.runtimeSec) {
      await rebuildRaceIntervals(tx, race.id);
      await recomputeRaceAggregates(tx, race.id, now, { preserveStatus: true });
      result.legacyRacesRepaired += 1;
      if (race.creditedViewingSec !== (history?.creditedSeconds ?? 0)) result.racesCredited += 1;
    } else {
      const credited = history?.creditedSeconds ?? 0;
      if (race.creditedViewingSec !== credited) {
        await tx.race.updateMany({ where: { id: race.id, userId }, data: { creditedViewingSec: credited } });
        result.racesCredited += 1;
      }
    }

    const complete = history !== undefined && history.storyCompletedAt !== null;
    if (complete === heldKeys.has(storyBonusKey(race.id))) continue;
    const story = await reconcileStoryBonus(tx, userId, race.id, history === undefined ? {} : { history });
    if (story.awarded > 0) result.storyBonusesAwarded += 1;
    if (story.revocation.transactions > 0) result.storyBonusesRevoked += 1;
    revocations.push(story.revocation);
  }

  await settleLedger(tx, userId, revocations);
  return result;
}

/**
 * P3, inside its transaction: the ladders, the new Career Milestone rungs a
 * career had already passed (written and paid once), and a date for every
 * milestone and event step without one — rows reached since the history
 * began get their historical instants, and what history cannot place is
 * marked RECOGNISED.
 */
export async function backfillMilestones(
  tx: Tx,
  userId: string,
  now: Date,
  timeline: CareerTimeline,
): Promise<{ created: number; xp: number; filled: number; recognised: number }> {
  const { metrics, history } = await computeCareerMetricsWithHistory(userId, tx);
  const ladders = await syncMilestones(tx, userId, metrics, now);
  const career = await syncCareerMilestones(tx, userId, { metrics, history, now });
  const dates = await fillLandmarkDates(tx, userId, { history, now, timeline });
  return {
    created: ladders.length + career.created,
    xp: ladders.reduce((sum, rung) => sum + rung.xpAwarded, 0) + career.xpAwarded,
    filled: dates.milestones + dates.eventSteps,
    recognised: dates.recognised,
  };
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

export interface CareerBackfillSummary {
  userId: string;
  /** Every phase this build knows is done. */
  completed: boolean;
  /** The account was already complete; nothing ran. */
  skipped: boolean;
  /** Where the account stopped for want of time, to carry on from next start. */
  pausedBefore: { phase: PhaseKey; cursor: string | null } | null;
  racesCredited: number;
  legacyRacesRepaired: number;
  storyBonusesAwarded: number;
  storyBonusesRevoked: number;
  milestonesCreated: number;
  milestoneXp: number;
  datesFilled: number;
  datesRecognised: number;
  /** What 0.3.x left in the ledger: counted when the account completes, never removed here (R11). */
  leftovers: { orphanedViewingRows: number; storyBonusesOfDeletedRaces: number };
}

function emptySummary(userId: string): CareerBackfillSummary {
  return {
    userId, completed: false, skipped: false, pausedBefore: null,
    racesCredited: 0, legacyRacesRepaired: 0, storyBonusesAwarded: 0, storyBonusesRevoked: 0,
    milestonesCreated: 0, milestoneXp: 0, datesFilled: 0, datesRecognised: 0,
    leftovers: { orphanedViewingRows: 0, storyBonusesOfDeletedRaces: 0 },
  };
}

/** Viewing XP whose stint is gone, and Story Complete bonuses whose race is gone. */
async function countLeftovers(userId: string): Promise<CareerBackfillSummary['leftovers']> {
  const [orphanedViewingRows, bonuses, races] = await Promise.all([
    prisma.xPTransaction.count({ where: { userId, sessionId: null, source: { in: ['VIEWING', 'REWATCH'] } } }),
    prisma.xPTransaction.findMany({
      where: { userId, source: 'STORY_COMPLETE', dedupeKey: { startsWith: storyBonusKey('') } },
      select: { dedupeKey: true },
    }),
    prisma.race.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const keys = new Set(races.map((race) => storyBonusKey(race.id)));
  return {
    orphanedViewingRows,
    storyBonusesOfDeletedRaces: bonuses.filter((bonus) => bonus.dedupeKey !== null && !keys.has(bonus.dedupeKey)).length,
  };
}

function withPhaseDone(marker: CareerBackfillMarker, phase: PhaseKey, now: Date): CareerBackfillMarker {
  const cursors = { ...marker.cursors };
  if (phase === 'P1') delete cursors.P1;
  return {
    ...marker,
    done: CAREER_BACKFILL_PHASES.filter((known) => known === phase || marker.done.includes(known)),
    cursors,
    lastRunAt: now.toISOString(),
  };
}

/**
 * Backfill one account, as far as the clock allows.
 *
 * Phases run in order, each chunk in its own transaction together with the
 * marker that records it. Before every chunk the clock is asked whether one
 * as long as the longest seen so far (at least a second) still fits; if not,
 * the account stops with `pausedBefore` set, and the next start carries on
 * from the recorded phase and cursor. A chunk that has started always
 * finishes.
 *
 * `force` ignores the marker and runs every phase again from the start. For
 * tests and deliberate maintenance: every chunk is idempotent, so a forced
 * run pays nothing twice.
 */
export async function runCareerBackfillFor(
  userId: string,
  options: { now: Date; clock: BackfillClock; force?: boolean },
): Promise<CareerBackfillSummary> {
  const { now, clock } = options;
  const summary = emptySummary(userId);
  const stored = await readCareerBackfillMarker(userId);
  if (!options.force && isComplete(stored)) return { ...summary, completed: true, skipped: true };

  let marker: CareerBackfillMarker = !options.force && stored !== null && stored.version === CAREER_BACKFILL_VERSION
    ? stored
    : { version: CAREER_BACKFILL_VERSION, done: [], cursors: {}, lastRunAt: stored?.lastRunAt ?? null };

  let context: PhaseContext | null = null;
  const contextFor = async (): Promise<PhaseContext> => (context ??= await buildPhaseContext(userId, now));
  let estimate = MINIMUM_CHUNK_ESTIMATE_MS;

  /** One chunk and its marker, in one transaction, timed for the next estimate. */
  const chunk = async <T>(next: CareerBackfillMarker, work: (tx: Tx) => Promise<T>): Promise<T> => {
    const started = performance.now();
    const result = await prisma.$transaction(async (tx) => {
      const value = await work(tx as Tx);
      await writeMarker(tx as Tx, userId, next);
      return value;
    }, CHUNK_TRANSACTION);
    estimate = Math.max(estimate, performance.now() - started);
    marker = next;
    return result;
  };

  for (const phase of CAREER_BACKFILL_PHASES) {
    if (marker.done.includes(phase)) continue;

    if (phase === 'P1') {
      for (;;) {
        if (!clock.shouldStartChunk(estimate)) {
          summary.pausedBefore = { phase, cursor: marker.cursors.P1 ?? null };
          return summary;
        }
        const ctx = await contextFor();
        const cursor = marker.cursors.P1;
        const remaining = [...ctx.timeline.racesById.keys()]
          .filter((id) => cursor === undefined || id > cursor)
          .sort();
        const ids = remaining.slice(0, RACE_CHUNK);
        const last = remaining.length <= RACE_CHUNK;
        const next = last
          ? withPhaseDone(marker, phase, now)
          : { ...marker, cursors: { ...marker.cursors, P1: ids[ids.length - 1] }, lastRunAt: now.toISOString() };
        const result = await chunk(next, (tx) => backfillRaces(tx, ctx, ids));
        summary.racesCredited += result.racesCredited;
        summary.legacyRacesRepaired += result.legacyRacesRepaired;
        summary.storyBonusesAwarded += result.storyBonusesAwarded;
        summary.storyBonusesRevoked += result.storyBonusesRevoked;
        if (last) break;
      }
    }

    if (phase === 'P3') {
      if (!clock.shouldStartChunk(estimate)) {
        summary.pausedBefore = { phase, cursor: null };
        return summary;
      }
      const ctx = await contextFor();
      const result = await chunk(withPhaseDone(marker, phase, now), (tx) => backfillMilestones(tx, userId, now, ctx.timeline));
      summary.milestonesCreated += result.created;
      summary.milestoneXp += result.xp;
      summary.datesFilled += result.filled;
      summary.datesRecognised += result.recognised;
    }
  }

  summary.completed = isComplete(marker);
  if (summary.completed) summary.leftovers = await countLeftovers(userId);
  return summary;
}

/** Where the backfill writes what it did: the server log, which the desktop shell keeps. */
export interface Logger {
  info: (line: string) => void;
  error: (line: string, error: unknown) => void;
}

const CONSOLE: Logger = {
  info: (line) => console.log(line),
  error: (line, error) => console.error(line, error),
};

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

/** One line per account, for the server log. */
export function describeCareerBackfill(summary: CareerBackfillSummary, name?: string): string {
  const who = name ? `${name} (${summary.userId})` : summary.userId;
  if (summary.skipped) return `[career-backfill] ${who}: already complete, nothing to do`;
  const work =
    `credited ${count(summary.racesCredited)} races, ${count(summary.legacyRacesRepaired)} legacy races repaired, ` +
    `story bonuses +${count(summary.storyBonusesAwarded)}/−${count(summary.storyBonusesRevoked)}; ` +
    `${count(summary.milestonesCreated)} new milestones (+${count(summary.milestoneXp)} XP), ` +
    `${count(summary.datesFilled)} dates filled, ${count(summary.datesRecognised)} recorded only`;
  if (summary.pausedBefore === null) return `[career-backfill] ${who}: ${work}`;
  const where = summary.pausedBefore.cursor === null ? '' : ` (after race ${summary.pausedBefore.cursor})`;
  return `[career-backfill] ${who}: ${work}; paused before ${summary.pausedBefore.phase}${where}; continues on the next start`;
}

/** The leftovers line, or null when 0.3.x left nothing behind. */
export function describeLeftovers(summary: CareerBackfillSummary, name?: string): string | null {
  const { orphanedViewingRows, storyBonusesOfDeletedRaces } = summary.leftovers;
  if (orphanedViewingRows === 0 && storyBonusesOfDeletedRaces === 0) return null;
  const who = name ? `${name} (${summary.userId})` : summary.userId;
  return (
    `[career-backfill] ${who}: ${count(orphanedViewingRows)} viewing XP rows whose stint was deleted and ` +
    `${count(storyBonusesOfDeletedRaces)} Story Complete bonuses of races deleted before 0.4.0 were left as they were ` +
    '(db:recompute removes them)'
  );
}

/**
 * Backfill every account on this machine that is not complete, as far as the
 * clock allows.
 *
 * Accounts go in order of when a chunk last ran for them, never-run first, so
 * an account that got no time on one start goes first on the next. Each
 * account is guarded on its own: a failure is logged, the account keeps the
 * progress it had recorded, and it is tried again on the next start. The
 * accounts are chosen in JavaScript, because equality on JSON is not portable
 * on SQLite.
 */
export async function runCareerBackfill(options: {
  now: Date;
  clock: BackfillClock;
  log?: Logger;
}): Promise<CareerBackfillSummary[]> {
  const log = options.log ?? CONSOLE;
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true,
      configOverrides: { where: { key: CAREER_BACKFILL_KEY }, select: { value: true } },
    },
  });

  const pending = users
    .map((user) => ({ id: user.id, name: user.name, marker: parseMarker(user.configOverrides[0]?.value) }))
    .filter((user) => !isComplete(user.marker))
    .sort((a, b) =>
      (a.marker?.lastRunAt ?? '').localeCompare(b.marker?.lastRunAt ?? '') || a.id.localeCompare(b.id));

  const summaries: CareerBackfillSummary[] = [];
  for (const user of pending) {
    try {
      const summary = await runCareerBackfillFor(user.id, { now: options.now, clock: options.clock });
      summaries.push(summary);
      log.info(describeCareerBackfill(summary, user.name));
      const leftovers = describeLeftovers(summary, user.name);
      if (leftovers !== null) log.info(leftovers);
    } catch (error) {
      log.error(`[career-backfill] ${user.name} (${user.id}): failed, will retry on the next start`, error);
    }
  }
  return summaries;
}
