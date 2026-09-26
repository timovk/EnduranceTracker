/**
 * Race Expeditions (0.4.0): the long races worth following as a journey.
 *
 * A race of 10 hours or more is an Expedition automatically, and any race can
 * be switched on or off by hand (owner decision 3). Being an Expedition is a
 * way of presenting a race — its checkpoints, its timeline, its summary — and
 * it works for a race of any length. Checkpoint XP is a separate question,
 * answered by the runtime alone: only races of six hours or more pay it.
 *
 * Checkpoints follow coverage, exactly as the Story Complete bonus does. Each
 * is keyed by race and percentage, with no amount in the key, so it is held at
 * most once however often it is crossed, and a re-balance can never pay one
 * twice.
 *
 * A completed Expedition is kept as a permanent summary: a snapshot of the
 * journey up to the stint that completed its story, written once and never
 * rewritten (`buildExpeditionSummarySnapshot`).
 *
 * Pure. The strategist never imports this module, so it still cannot see XP.
 */

import { z } from 'zod';
import { EXPEDITION_CONFIG, EXPEDITION_SHAPE } from '@/lib/config';
import { localDaysSpanned } from './calendar';
import type { CareerTimeline, RaceHistory, StintEvent } from './career-timeline';
import { coverageCrossing } from './career-timeline';
import { editionIdentityOf } from './edition';
import { furthestPoint, gapsIn, resumePoint } from './intervals';
import { estimateRemaining } from './playback';
import { storyCompleteBonus } from './progression';
import { RECORD_ORDER, type RecordEvent, type RecordKind } from './records';
import { formatCoveragePercent, formatElapsed } from './time';
import { RARITY_ORDER, type Interval, type Rarity } from './types';

/**
 * Whether a race is followed as an Expedition.
 *
 * Switched on is on and switched off is off, for any race. Otherwise it is
 * decided by the scheduled length, the race's advertised format, so a 10-hour
 * race shortened by a red flag is still one.
 */
export function isExpedition(race: { scheduledDurationSec: number; expeditionMode: boolean | null }): boolean {
  if (race.expeditionMode !== null) return race.expeditionMode;
  return race.scheduledDurationSec >= EXPEDITION_SHAPE.autoThresholdHours * 3600;
}

/** Whether a race's checkpoints pay XP: from six hours of runtime. */
export function checkpointsPayXp(runtimeSec: number): boolean {
  return runtimeSec >= EXPEDITION_SHAPE.checkpointXpMinimumHours * 3600;
}

/**
 * Each checkpoint and what it pays for a race of this runtime.
 *
 * The pool is a share of the race's non-major Story Complete bonus, split by
 * `EXPEDITION_CONFIG.checkpoints` and rounded to a clean step. Below six
 * hours every checkpoint is still listed, at 0 XP.
 */
export function checkpointSchedule(runtimeSec: number): { percent: number; xp: number }[] {
  const pays = checkpointsPayXp(runtimeSec);
  const pool = pays ? storyCompleteBonus(runtimeSec, false).careerXp * EXPEDITION_CONFIG.checkpointPoolShare : 0;
  const step = EXPEDITION_CONFIG.roundingStep;
  return EXPEDITION_CONFIG.checkpoints.map((checkpoint) => ({
    percent: checkpoint.percent,
    xp: pays ? Math.round((pool * checkpoint.poolShare) / step) * step : 0,
  }));
}

/**
 * Whether a coverage figure reaches a percentage of the runtime. Compared in
 * integers, the same way `coverageCrossing` dates a checkpoint, so the two
 * always agree. It takes any percentage, not only the configured ones: a
 * checkpoint held under an earlier list is still judged by its own.
 */
export function coverageReaches(coverageSec: number, runtimeSec: number, percent: number): boolean {
  return runtimeSec > 0 && coverageSec * 100 >= percent * runtimeSec;
}

/** The configured checkpoints a coverage figure has reached. */
export function checkpointsSatisfied(coverageSec: number, runtimeSec: number): number[] {
  return EXPEDITION_CONFIG.checkpoints
    .map((checkpoint) => checkpoint.percent)
    .filter((percent) => coverageReaches(coverageSec, runtimeSec, percent));
}

/** The ledger key of one checkpoint of one race. No amount in it, on purpose. */
export function expeditionDedupeKey(raceId: string, percent: number): string {
  return `expedition:${raceId}:${percent}`;
}

/**
 * The checkpoint a ledger key names, when it is a checkpoint of this race;
 * null for any other key.
 */
export function checkpointOfKey(raceId: string, dedupeKey: string | null): number | null {
  const prefix = expeditionDedupeKey(raceId, 0).slice(0, -1);
  if (dedupeKey === null || !dedupeKey.startsWith(prefix)) return null;
  const percent = Number(dedupeKey.slice(prefix.length));
  return Number.isInteger(percent) && percent > 0 ? percent : null;
}

/**
 * The checkpoints one stint took the race past: its race's coverage was below
 * them before it and at or above them after it, compared as `coverageCrossing`
 * compares. Re-watching crosses nothing.
 */
export function checkpointsCrossedBy(history: RaceHistory, sessionId: string): number[] {
  const stint = history.stints.find((candidate) => candidate.sessionId === sessionId);
  const runtime = history.race.runtimeSec;
  if (stint === undefined || !(runtime > 0)) return [];
  return EXPEDITION_CONFIG.checkpoints
    .map((checkpoint) => checkpoint.percent)
    .filter((percent) =>
      stint.coverageBeforeSeconds * 100 < percent * runtime && stint.coverageAfterSeconds * 100 >= percent * runtime);
}

/** Every checkpoint in order, and whether a coverage figure reaches it: the ticks of a coverage meter. */
export function checkpointTicks(coverageSec: number, runtimeSec: number): { percent: number; reached: boolean }[] {
  const reached = new Set(checkpointsSatisfied(coverageSec, runtimeSec));
  return EXPEDITION_CONFIG.checkpoints.map((checkpoint) => ({ percent: checkpoint.percent, reached: reached.has(checkpoint.percent) }));
}

/** The first checkpoint a coverage figure has not reached, and what it pays; null once all are reached. */
export function nextCheckpoint(coverageSec: number, runtimeSec: number): { percent: number; xp: number } | null {
  const reached = new Set(checkpointsSatisfied(coverageSec, runtimeSec));
  return checkpointSchedule(runtimeSec).find((checkpoint) => !reached.has(checkpoint.percent)) ?? null;
}

export interface ExpeditionFigures {
  runtimeSec: number;
  coverageSec: number;
  /** `formatCoveragePercent`: never "100%" while any second is uncovered. */
  completionPercentText: string;
  remainingTimelineSec: number;
  /** The remaining timeline at the race's average speed so far. */
  remainingRealSec: number;
  resumeAtSec: number;
  creditedSeconds: number;
  rewatchSeconds: number;
  sessions: number;
  /** The window start of the first stint. */
  startedAt: Date | null;
  /** From the start to completion (or to now), never less than the time credited. */
  elapsedSeconds: number | null;
  storyCompletedAt: Date | null;
  /** `xp` is what the ledger holds for a held checkpoint, and what the schedule pays for any other. */
  checkpoints: { percent: number; xp: number; reachedAt: Date | null; sessionId: string | null; held: boolean }[];
  fragments: { watched: Interval[]; gaps: Interval[]; furthestSec: number };
}

/**
 * The live figures of an Expedition, from one race's replay.
 *
 * `held` maps each checkpoint whose XP the ledger holds for this race to the
 * amount it holds. The replay alone cannot know either: a checkpoint reached
 * while Expedition Mode was off is reached without being held, and one paid
 * under an earlier schedule keeps the amount it was paid, which is the figure
 * shown for it.
 */
export function expeditionFigures(
  history: RaceHistory,
  avgSpeed: number,
  now: Date,
  held: ReadonlyMap<number, number> = new Map(),
): ExpeditionFigures {
  const runtimeSec = history.race.runtimeSec;
  const coverageSec = history.coverageSeconds;
  const remaining = estimateRemaining(coverageSec, runtimeSec, avgSpeed);

  let elapsedSeconds: number | null = null;
  if (history.startedAt !== null) {
    const completing = history.completingSessionId === null
      ? null
      : history.stints.find((stint) => stint.sessionId === history.completingSessionId) ?? null;
    const end = history.storyCompletedAt ?? now;
    const credited = completing?.raceCreditedAfterSeconds ?? history.creditedSeconds;
    elapsedSeconds = Math.round(Math.max(0, (end.getTime() - history.startedAt.getTime()) / 1000, credited));
  }

  return {
    runtimeSec,
    coverageSec,
    completionPercentText: formatCoveragePercent(coverageSec, runtimeSec),
    remainingTimelineSec: remaining.timelineRemainingSec,
    remainingRealSec: remaining.realRemainingSec,
    resumeAtSec: resumePoint(history.intervals, runtimeSec),
    creditedSeconds: history.creditedSeconds,
    rewatchSeconds: history.rewatchCreditedSeconds,
    sessions: history.sessionCount,
    startedAt: history.startedAt,
    elapsedSeconds,
    storyCompletedAt: history.storyCompletedAt,
    checkpoints: checkpointSchedule(runtimeSec).map((checkpoint) => {
      const crossing = coverageCrossing(history, checkpoint.percent);
      return {
        percent: checkpoint.percent,
        xp: held.get(checkpoint.percent) ?? checkpoint.xp,
        reachedAt: crossing?.at ?? null,
        sessionId: crossing?.sessionId ?? null,
        held: held.has(checkpoint.percent),
      };
    }),
    fragments: {
      watched: history.intervals,
      gaps: gapsIn(history.intervals, runtimeSec),
      furthestSec: furthestPoint(history.intervals),
    },
  };
}

// ---------------------------------------------------------------------------
// The Expedition Summary (permanent)
// ---------------------------------------------------------------------------

export const EXPEDITION_SUMMARY_SCHEMA_VERSION = 1;

const rarityEnum = z.enum(RARITY_ORDER);
const recordKindEnum = z.enum(RECORD_ORDER);

/**
 * The frozen record of a completed Expedition, as it is stored in
 * `ExpeditionSummary.snapshot`. Dates are ISO strings: this is JSON, where a
 * `Date` would not survive the round trip. Everything is as it stood when the
 * story was completed, and nothing in it is ever recomputed.
 */
export const expeditionSummarySnapshotSchema = z.object({
  schemaVersion: z.literal(EXPEDITION_SUMMARY_SCHEMA_VERSION),
  race: z.object({
    id: z.string(), name: z.string(), championshipName: z.string().nullable(), eventKey: z.string().nullable(),
    eventName: z.string().nullable(), editionYear: z.number().nullable(), circuit: z.string().nullable(), runtimeSec: z.number(),
  }),
  startedAt: z.string(),
  completedAt: z.string(),
  completingSessionId: z.string(),
  /** Up to and including the completing stint. */
  creditedSeconds: z.number(),
  uniqueCoverageSeconds: z.number(),
  rewatchSeconds: z.number(),
  sessions: z.number(),
  /** Local days from the start to the completion, both counted. */
  calendarDays: z.number(),
  /** From the start to the completion, never less than the time credited. */
  elapsedSeconds: z.number(),
  averageSessionSeconds: z.number(),
  longestSessionSeconds: z.number(),
  /** `formatCoveragePercent` at the completion: never "100%" with a second uncovered. */
  finalCompletionText: z.string(),
  xp: z.object({
    viewing: z.number(), rewatch: z.number(), storyComplete: z.number(), checkpoints: z.number(), total: z.number(),
  }),
  checkpoints: z.array(z.object({ percent: z.number(), reachedAt: z.string(), xp: z.number() })),
  mastery: z.object({
    /** Null for a retrospective summary: today's percentage is not a fact about then. */
    championship: z.object({ name: z.string(), percent: z.number() }).nullable(),
    event: z.object({ name: z.string(), editionsExperienced: z.number(), editionsStoryComplete: z.number() }).nullable(),
    nodes: z.array(z.object({ treeName: z.string(), nodeName: z.string(), xp: z.number() })),
  }),
  milestones: z.array(z.object({ title: z.string(), xp: z.number() })),
  achievements: z.array(z.object({ name: z.string(), rarity: rarityEnum, xp: z.number() })),
  records: z.array(z.object({ kind: recordKindEnum, label: z.string(), valueText: z.string() })),
  unlocks: z.enum(['live', 'reconstructed']),
});
export type ExpeditionSummarySnapshotV1 = z.infer<typeof expeditionSummarySnapshotSchema>;

/** A stored snapshot, or null when it is not one this build can read. */
export function parseExpeditionSummarySnapshot(value: unknown): ExpeditionSummarySnapshotV1 | null {
  const parsed = expeditionSummarySnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What the unlocks of the completing stint were, live or rebuilt from their dates. */
export interface ExpeditionSummaryUnlocks {
  source: 'live' | 'reconstructed';
  nodes: { treeName: string; nodeName: string; xp: number }[];
  milestones: { title: string; xp: number }[];
  achievements: { name: string; rarity: Rarity; xp: number }[];
}

/** Everything a summary is built from besides the race's own replay, gathered by the engine that writes it. */
export interface ExpeditionSummaryInput {
  /** The race's replay; the summary stops at its completing stint. */
  history: RaceHistory;
  /** The whole career's replay, for where the race's event stood at the completion. */
  timeline: CareerTimeline;
  /** The career's record progression (`computeRecordProgression`). */
  progression: readonly RecordEvent[];
  /** Ledger sums: the viewing and re-watch XP of the stints up to the completion, and the Story Complete bonus. */
  xp: { viewing: number; rewatch: number; storyComplete: number };
  /** What each checkpoint's ledger row holds, by percent. */
  checkpointXp: ReadonlyMap<number, number>;
  /** The championship's mastery at the moment, for a live summary; null for a retrospective one. */
  championshipMastery: { name: string; percent: number } | null;
  unlocks: ExpeditionSummaryUnlocks;
}

/** A career replay's races, by event, built once per replay. */
const racesByEvent = new WeakMap<CareerTimeline, Map<string, RaceHistory[]>>();

function historiesOfEvent(timeline: CareerTimeline, eventKey: string): readonly RaceHistory[] {
  let byEvent = racesByEvent.get(timeline);
  if (byEvent === undefined) {
    byEvent = new Map();
    for (const history of timeline.races.values()) {
      const key = history.race.eventKey;
      if (key === null) continue;
      const list = byEvent.get(key);
      if (list) list.push(history);
      else byEvent.set(key, [history]);
    }
    racesByEvent.set(timeline, byEvent);
  }
  return byEvent.get(eventKey) ?? [];
}

/**
 * Where an event stood at an instant: its distinct editions experienced and
 * Story Complete by then, from the replay, so a summary written long after the
 * completion still says what was true at it.
 */
export function eventStandingAt(
  timeline: CareerTimeline,
  eventKey: string,
  at: Date,
): { editionsExperienced: number; editionsStoryComplete: number } {
  const experienced = new Set<string>();
  const complete = new Set<string>();
  for (const history of historiesOfEvent(timeline, eventKey)) {
    const identity = editionIdentityOf(history.race.id, history.race.editionYear);
    if (history.experiencedAt !== null && history.experiencedAt <= at) experienced.add(identity);
    if (history.storyCompletedAt !== null && history.storyCompletedAt <= at) complete.add(identity);
  }
  return { editionsExperienced: experienced.size, editionsStoryComplete: complete.size };
}

/** A record's value in words: a duration, a count, or a run of editions. */
function recordValueText(record: RecordEvent): string {
  if (record.unit === 'seconds') return formatElapsed(record.value);
  const value = Math.round(record.value).toLocaleString('en-GB');
  if (record.unit === 'editions') return `${value} ${record.value === 1 ? 'edition' : 'editions'}`;
  return value;
}

/**
 * The records this race set by the time its story was completed: the best it
 * held of each kind at that moment, in the order records are listed.
 */
function recordsSetBy(progression: readonly RecordEvent[], raceId: string, completedAt: Date): RecordEvent[] {
  const latest = new Map<RecordKind, RecordEvent>();
  for (const event of progression) {
    if (event.raceId === raceId && event.at <= completedAt) latest.set(event.kind, event);
  }
  return RECORD_ORDER.flatMap((kind) => {
    const event = latest.get(kind);
    return event ? [event] : [];
  });
}

/**
 * The permanent summary of a completed Expedition.
 *
 * Every time figure comes from the race's replay stopped at the stint that
 * completed its story, so stints logged after it (a re-watch of the podium)
 * change nothing. The start is the first stint's own window start, which does
 * not depend on the stints of other races. XP is what the ledger holds for
 * those stints, the Story Complete bonus and the checkpoints: sums of real
 * rows, so they are exact. The event's standing is read from the career
 * replay at the completion; records are those the race held by then.
 *
 * PRECONDITION: the race is Story Complete in `history`.
 */
export function buildExpeditionSummarySnapshot(input: ExpeditionSummaryInput): ExpeditionSummarySnapshotV1 {
  const { history } = input;
  const race = history.race;
  const completingIndex = history.stints.findIndex((stint) => stint.sessionId === history.completingSessionId);
  const completing = history.stints[completingIndex];
  const first = history.stints[0];
  if (history.storyCompletedAt === null || completing === undefined || first === undefined) {
    throw new Error('An Expedition Summary needs a race whose story is complete.');
  }

  const stints: readonly StintEvent[] = history.stints.slice(0, completingIndex + 1);
  const completedAt = history.storyCompletedAt;
  const startedAt = first.nominalStartsAt;
  const creditedSeconds = completing.raceCreditedAfterSeconds;
  const uniqueCoverageSeconds = completing.coverageAfterSeconds;
  const rewatchSeconds = Math.round(stints.reduce((sum, stint) => sum + stint.rewatchCreditedSeconds, 0));
  const longestSessionSeconds = stints.reduce((max, stint) => Math.max(max, stint.creditedSeconds), 0);

  const checkpoints = checkpointSchedule(race.runtimeSec).flatMap((checkpoint) => {
    const crossing = coverageCrossing(history, checkpoint.percent);
    if (crossing === null || crossing.at > completedAt) return [];
    return [{ percent: checkpoint.percent, reachedAt: crossing.at.toISOString(), xp: input.checkpointXp.get(checkpoint.percent) ?? 0 }];
  });
  const checkpointXp = [...input.checkpointXp.values()].reduce((sum, xp) => sum + xp, 0);
  const xp = { ...input.xp, checkpoints: checkpointXp };

  const event = race.eventKey === null
    ? null
    : { name: race.eventName ?? race.eventKey, ...eventStandingAt(input.timeline, race.eventKey, completedAt) };

  return {
    schemaVersion: EXPEDITION_SUMMARY_SCHEMA_VERSION,
    race: {
      id: race.id, name: race.name, championshipName: race.championshipName, eventKey: race.eventKey,
      eventName: race.eventName, editionYear: race.editionYear, circuit: race.circuit, runtimeSec: race.runtimeSec,
    },
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    completingSessionId: completing.sessionId,
    creditedSeconds,
    uniqueCoverageSeconds,
    rewatchSeconds,
    sessions: stints.length,
    calendarDays: localDaysSpanned(startedAt, completedAt),
    elapsedSeconds: Math.round(Math.max((completedAt.getTime() - startedAt.getTime()) / 1000, creditedSeconds)),
    averageSessionSeconds: Math.round(creditedSeconds / stints.length),
    longestSessionSeconds,
    finalCompletionText: formatCoveragePercent(uniqueCoverageSeconds, race.runtimeSec),
    xp: { ...xp, total: xp.viewing + xp.rewatch + xp.storyComplete + xp.checkpoints },
    checkpoints,
    mastery: { championship: input.championshipMastery, event, nodes: input.unlocks.nodes },
    milestones: input.unlocks.milestones,
    achievements: input.unlocks.achievements,
    records: recordsSetBy(input.progression, race.id, completedAt).map((record) => ({
      kind: record.kind, label: record.label, valueText: recordValueText(record),
    })),
    unlocks: input.unlocks.source,
  };
}
