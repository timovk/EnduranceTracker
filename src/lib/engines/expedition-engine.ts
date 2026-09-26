/**
 * Race Expeditions (0.4.0): checkpoints, the permanent summary and the
 * Expedition page.
 *
 * Checkpoint XP follows the data, exactly as the Story Complete bonus does:
 * the rows held for a race are always a subset of the checkpoints its replayed
 * coverage reaches under its current runtime (invariant I3). They are paid when
 * the coverage reaches them while the race is an Expedition of six hours or
 * more, and taken back only when the viewing that reached them — or the race
 * itself, or the runtime they were measured against — no longer supports them.
 *
 * Switching Expedition Mode off is a preference, not a change to the data, so
 * it never takes a checkpoint back: it only stops new ones. Switching it on
 * again pays only what is not held already, and the dedupe key (race and
 * percentage, never an amount) makes on/off/on pay nothing twice.
 *
 * The summary is a landmark. It is written once, the first time a stint, the
 * mode switch, the upgrade or recompute finds the race an Expedition whose
 * story is complete and which has no summary yet, and it is never rewritten —
 * not when stints are deleted, not when the mode is switched off, and not when
 * the race itself is deleted (the row keeps its snapshot with the race link
 * cleared). A race edit never writes one: a mistyped runtime could otherwise
 * leave a permanent summary behind (§4.0).
 *
 * Every function here takes the caller's transaction client, except the page
 * reads at the end, and reads the race inside the account.
 */

import { XP_CONFIG } from '@/lib/config';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { expeditionBudgetNote, milestoneLabel } from '@/lib/copy/tone';
import {
  buildCareerTimeline, isRaceExperienced, replayRace,
  type CareerTimeline, type RaceHistory, type StintEvent,
} from '@/lib/domain/career-timeline';
import { editionIdentity } from '@/lib/domain/edition';
import {
  buildExpeditionSummarySnapshot, checkpointOfKey, checkpointSchedule, checkpointsCrossedBy, checkpointsPayXp,
  checkpointsSatisfied, coverageReaches, expeditionDedupeKey, expeditionFigures, isExpedition, nextCheckpoint,
  parseExpeditionSummarySnapshot, EXPEDITION_SUMMARY_SCHEMA_VERSION,
  type ExpeditionFigures, type ExpeditionSummarySnapshotV1, type ExpeditionSummaryUnlocks,
} from '@/lib/domain/expedition';
import { storyCompleteBonus } from '@/lib/domain/progression';
import { careerRecordOptions, computeRecordProgression, type RecordEvent } from '@/lib/domain/records';
import { formatCoveragePercent } from '@/lib/domain/time';
import type {
  AchievementUnlock, CareerMilestoneUnlock, ExpeditionOutcome, MasteryUnlock, MilestoneUnlock,
} from './contracts';
import { getBudgetSnapshot } from './budget-engine';
import { isCareerMilestoneRung, listStintCareerMilestones } from './career-milestone-engine';
import { loadRaceTimelineInputs, loadTimelineInputs, type TimelineInputs } from './career-timeline-engine';
import { eventHref, getMasteryForChampionship } from './mastery-engine';
import { storyBonusKey } from './progression-resync';
import { reconstructStintUnlocks } from './stint-unlocks';
import { awardXp, revokeXpByDedupeKeys, settleLedger, type XpRevocation } from './xp-ledger';

const NOTHING_REVOKED: XpRevocation = { transactions: 0, careerXp: 0, seasonXp: 0, earliest: null };

/** Ids per `IN (…)` list, well inside SQLite's limit on bound parameters. */
const ID_CHUNK = 500;

/** Expedition Mode as the user sets it: following the race's length, or switched on or off by hand. */
export type ExpeditionModeSetting = 'auto' | 'on' | 'off';

/** The setting a race's `expeditionMode` column holds. */
export function expeditionModeOf(expeditionMode: boolean | null): ExpeditionModeSetting {
  if (expeditionMode === null) return 'auto';
  return expeditionMode ? 'on' : 'off';
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export interface ExpeditionReconcile {
  /** Whether the race is an Expedition now. */
  isExpedition: boolean;
  /** The replay's coverage, clamped to the runtime, and the runtime it was measured against. */
  coverageSec: number;
  runtimeSec: number;
  /** Checkpoints paid now; `sessionId` is the stint being logged, or null for a retroactive one. */
  awarded: { percent: number; xp: number; sessionId: string | null }[];
  /** Checkpoints taken back because the coverage no longer reaches them. */
  revoked: { percent: number; xp: number }[];
  /** Held checkpoints re-sized to the schedule of a changed runtime (`resize` only). */
  resized: { percent: number; fromXp: number; toXp: number }[];
  /** Everything removed from the ledger, the old rows of re-sized checkpoints included. Settle with it. */
  revocation: XpRevocation;
  /** Story Complete by the replay. */
  storyCompleted: boolean;
  /** The race is an Expedition and the crossing stint is its first. */
  began: boolean;
  /** The first checkpoint still ahead, and what it pays; null when every one is reached. */
  nextCheckpoint: { percent: number; xp: number } | null;
  /** The replay this was decided from; null when the race is not in the account. */
  history: RaceHistory | null;
}

function nothingToReconcile(): ExpeditionReconcile {
  return {
    isExpedition: false, coverageSec: 0, runtimeSec: 0, awarded: [], revoked: [], resized: [],
    revocation: NOTHING_REVOKED, storyCompleted: false, began: false, nextCheckpoint: null, history: null,
  };
}

/** The ledger's description of a checkpoint. */
function checkpointDescription(raceName: string, percent: number): string {
  return `Expedition — ${raceName}: ${percent}% of the story`;
}

/**
 * Make a race's checkpoint XP match its data (§4.3.3).
 *
 *   1. The race is replayed from its stints, clamped to its current runtime,
 *      unless the caller passes its `RaceHistory` (the upgrade and recompute
 *      pass the one from the career replay they built once). The cached
 *      `race.coverageSec` is never read.
 *   2. Every held checkpoint the coverage no longer reaches is taken back,
 *      which frees its key. That is the only reason one ever comes off. Each
 *      is judged by the percentage in its own key, so a checkpoint an earlier
 *      configuration listed stays held while the coverage reaches it.
 *   3. With `resize` (a runtime edit, and recompute's repair), a held
 *      checkpoint that is still reached but whose amount is not what the
 *      current runtime's schedule pays is re-created with the same key and
 *      stint at the new amount — or only removed when the race is now too
 *      short to pay any. Never on the stint path, so a re-balance of the
 *      configuration leaves amounts already paid exactly as they were; and a
 *      checkpoint the schedule no longer lists has no amount to be re-sized
 *      to, so it keeps its own.
 *   4. While the race is an Expedition of six hours or more, every reached
 *      checkpoint not held is paid, career XP only. On the stint path it names
 *      the stint being logged (`crossingSessionId`), which is the stint that
 *      paid it, so its summary shows the XP the same live and reopened; every
 *      other award is retroactive and names no stint, so an older stint's
 *      summary never shows XP granted since. `award: false` skips this step:
 *      deleting a stint reaches nothing new, and a checkpoint an unfinished
 *      upgrade has not paid yet is the upgrade's to pay, not the deletion's.
 *
 * Switching the mode off changes neither the coverage nor the runtime, so it
 * revokes nothing; it only stops step 4. The caller settles the ledger with
 * `revocation` after its last award (R13).
 */
export async function reconcileExpedition(
  tx: Tx,
  userId: string,
  raceId: string,
  options: { crossingSessionId?: string; resize?: boolean; history?: RaceHistory; award?: boolean } = {},
): Promise<ExpeditionReconcile> {
  let history = options.history;
  if (history === undefined) {
    const inputs = await loadRaceTimelineInputs(tx, userId, raceId);
    if (inputs === null) return nothingToReconcile();
    history = replayRace(inputs.race, inputs.sessions);
  }

  const race = history.race;
  const runtimeSec = race.runtimeSec;
  const coverageSec = history.coverageSeconds;
  const satisfied = new Set(checkpointsSatisfied(coverageSec, runtimeSec));
  const schedule = new Map(checkpointSchedule(runtimeSec).map((checkpoint) => [checkpoint.percent, checkpoint.xp]));

  // Served by the `(userId, source)` index: no key pattern to match.
  const rows = await tx.xPTransaction.findMany({
    where: { userId, source: 'EXPEDITION', sourceRef: raceId },
    select: { dedupeKey: true, amount: true, sessionId: true },
  });
  const held = rows.flatMap((row) => {
    const percent = checkpointOfKey(raceId, row.dedupeKey);
    return percent === null || row.dedupeKey === null ? [] : [{ ...row, percent, dedupeKey: row.dedupeKey }];
  });

  const supported = (row: { percent: number }) => coverageReaches(coverageSec, runtimeSec, row.percent);
  const unsupported = held.filter((row) => !supported(row));
  const toResize = options.resize
    ? held.filter((row) => {
      const amount = schedule.get(row.percent);
      return supported(row) && amount !== undefined && row.amount !== amount;
    })
    : [];
  const revocation = await revokeXpByDedupeKeys(tx, userId, [...unsupported, ...toResize].map((row) => row.dedupeKey));

  const holding = new Set(held.filter(supported).map((row) => row.percent));
  const resized: ExpeditionReconcile['resized'] = [];
  for (const row of toResize) {
    const amount = schedule.get(row.percent) ?? 0;
    resized.push({ percent: row.percent, fromXp: row.amount, toXp: amount });
    if (amount <= 0) {
      holding.delete(row.percent);
      continue;
    }
    await awardXp(tx, userId, {
      source: 'EXPEDITION',
      amount,
      description: checkpointDescription(race.name, row.percent),
      sourceRef: raceId,
      sessionId: row.sessionId ?? undefined,
      dedupeKey: row.dedupeKey,
    });
  }

  const expedition = isExpedition(race);
  const awarded: ExpeditionReconcile['awarded'] = [];
  if (options.award !== false && expedition && checkpointsPayXp(runtimeSec)) {
    for (const percent of [...satisfied].sort((a, b) => a - b)) {
      const xp = schedule.get(percent) ?? 0;
      if (holding.has(percent) || xp <= 0) continue;
      const sessionId = options.crossingSessionId ?? null;
      const award = await awardXp(tx, userId, {
        source: 'EXPEDITION',
        amount: xp,
        description: checkpointDescription(race.name, percent),
        sourceRef: raceId,
        sessionId: sessionId ?? undefined,
        dedupeKey: expeditionDedupeKey(raceId, percent),
      });
      if (award.granted > 0) awarded.push({ percent, xp: award.granted, sessionId });
    }
  }

  return {
    isExpedition: expedition,
    coverageSec,
    runtimeSec,
    awarded,
    revoked: unsupported.map((row) => ({ percent: row.percent, xp: row.amount })).sort((a, b) => a.percent - b.percent),
    resized,
    revocation,
    storyCompleted: history.storyCompletedAt !== null,
    began: expedition && options.crossingSessionId !== undefined && history.stints[0]?.sessionId === options.crossingSessionId,
    nextCheckpoint: expedition ? nextCheckpoint(coverageSec, runtimeSec) : null,
    history,
  };
}

/** The ledger keys of every checkpoint a race holds, for taking them all back with the race. */
export async function heldExpeditionKeys(tx: Tx, userId: string, raceId: string): Promise<string[]> {
  const rows = await tx.xPTransaction.findMany({
    where: { userId, source: 'EXPEDITION', sourceRef: raceId },
    select: { dedupeKey: true },
  });
  return rows.flatMap((row) => (row.dedupeKey === null ? [] : [row.dedupeKey]));
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/** What a stint unlocked, as the stint path holds it. */
export interface LiveStintUnlocks {
  achievements: readonly AchievementUnlock[];
  /** Lifetime-ladder rungs, the Career Milestone rungs already left out. */
  milestones: readonly MilestoneUnlock[];
  careerMilestones: readonly CareerMilestoneUnlock[];
  mastery: readonly MasteryUnlock[];
}

/** A stint's unlock lists in the summary's words. */
function summaryUnlocks(unlocks: LiveStintUnlocks, source: 'live' | 'reconstructed'): ExpeditionSummaryUnlocks {
  return {
    source,
    nodes: unlocks.mastery.map((node) => ({ treeName: node.treeName, nodeName: node.nodeName, xp: node.xpAwarded })),
    milestones: [
      ...unlocks.careerMilestones.map((milestone) => ({ title: milestone.title, xp: milestone.xpAwarded })),
      ...unlocks.milestones.map((rung) => ({ title: milestoneLabel(rung.threshold, rung.label), xp: rung.xpAwarded })),
    ],
    achievements: unlocks.achievements.map((achievement) => ({
      name: achievement.name, rarity: achievement.rarity, xp: achievement.xpAwarded,
    })),
  };
}

/**
 * The career's record progression, kept by the account's week start. The
 * backfill and recompute build it once per account and hand it to every
 * summary they write.
 */
export async function careerRecordProgression(db: Tx, userId: string, timeline: CareerTimeline): Promise<RecordEvent[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { weekStart: true } });
  return computeRecordProgression(timeline, careerRecordOptions(user?.weekStart ?? 1));
}

/**
 * The XP the ledger holds for the journey: the viewing and re-watch rows of
 * its stints up to the completion (found by stint, through the `sessionId`
 * index, and checked against the account), the Story Complete bonus, and each
 * checkpoint's row.
 */
async function journeyXp(
  tx: Tx,
  userId: string,
  raceId: string,
  sessionIds: readonly string[],
): Promise<{ viewing: number; rewatch: number; storyComplete: number; checkpointXp: Map<number, number> }> {
  let viewing = 0;
  let rewatch = 0;
  for (let index = 0; index < sessionIds.length; index += ID_CHUNK) {
    const rows = await tx.xPTransaction.findMany({
      where: { sessionId: { in: sessionIds.slice(index, index + ID_CHUNK) }, source: { in: ['VIEWING', 'REWATCH'] } },
      select: { userId: true, source: true, amount: true },
    });
    for (const row of rows) {
      if (row.userId !== userId) continue;
      if (row.source === 'VIEWING') viewing += row.amount;
      else rewatch += row.amount;
    }
  }
  const [bonus, checkpoints] = await Promise.all([
    tx.xPTransaction.findFirst({ where: { userId, dedupeKey: storyBonusKey(raceId) }, select: { amount: true } }),
    tx.xPTransaction.findMany({
      where: { userId, source: 'EXPEDITION', sourceRef: raceId },
      select: { dedupeKey: true, amount: true },
    }),
  ]);
  const checkpointXp = new Map<number, number>();
  for (const row of checkpoints) {
    const percent = checkpointOfKey(raceId, row.dedupeKey);
    if (percent !== null) checkpointXp.set(percent, row.amount);
  }
  return { viewing, rewatch, storyComplete: bonus?.amount ?? 0, checkpointXp };
}

export interface ExpeditionSummaryWrite {
  id: string;
  snapshot: ExpeditionSummarySnapshotV1;
}

/**
 * Write a race's Expedition Summary, if it is due (§4.3.6): the race is an
 * Expedition, its story is complete in the replay, and it has no summary. Null
 * when any of those does not hold — a summary that exists is never rewritten.
 *
 *   - `retrospective` — written after the fact (the mode switched on later,
 *     the upgrade, recompute, or a stint that did not itself complete the
 *     story). The championship's mastery is then left out: today's figure is
 *     not a fact about the completion.
 *   - `unlocks` — what the completing stint unlocked, when the stint path is
 *     logging it; otherwise they are rebuilt from the dates of the unlocks
 *     (`reconstructStintUnlocks`) and marked so.
 *   - `timeline` / `progression` — the career replay and its records, when
 *     the caller built them once for many summaries; otherwise they are built
 *     here, from `inputs` when the caller already loaded them.
 */
export async function writeExpeditionSummary(
  tx: Tx,
  userId: string,
  raceId: string,
  now: Date,
  options: {
    retrospective: boolean;
    history?: RaceHistory;
    unlocks?: LiveStintUnlocks;
    timeline?: CareerTimeline;
    progression?: readonly RecordEvent[];
    inputs?: TimelineInputs;
    championshipMastery?: { name: string; percent: number } | null;
  },
): Promise<ExpeditionSummaryWrite | null> {
  let history = options.history;
  if (history === undefined) {
    const inputs = await loadRaceTimelineInputs(tx, userId, raceId);
    if (inputs === null) return null;
    history = replayRace(inputs.race, inputs.sessions);
  }
  if (!isExpedition(history.race) || history.storyCompletedAt === null) return null;
  const completingIndex = history.stints.findIndex((stint) => stint.sessionId === history.completingSessionId);
  const completing = history.stints[completingIndex];
  if (completing === undefined) return null;

  const existing = await tx.expeditionSummary.findFirst({ where: { userId, raceId }, select: { id: true } });
  if (existing !== null) return null;

  let timeline = options.timeline;
  if (timeline === undefined) {
    const inputs = options.inputs ?? await loadTimelineInputs(tx, userId);
    timeline = buildCareerTimeline(inputs.sessions, inputs.races);
  }
  const progression = options.progression ?? await careerRecordProgression(tx, userId, timeline);

  const journey = history.stints.slice(0, completingIndex + 1).map((stint) => stint.sessionId);
  const xp = await journeyXp(tx, userId, raceId, journey);

  let unlocks: ExpeditionSummaryUnlocks;
  if (options.unlocks !== undefined) {
    unlocks = summaryUnlocks(options.unlocks, 'live');
  } else {
    const [rebuilt, careerMilestones] = await Promise.all([
      reconstructStintUnlocks(tx, userId, { id: completing.sessionId, watchedAt: completing.watchedAt }),
      listStintCareerMilestones(tx, userId, completing.sessionId),
    ]);
    unlocks = summaryUnlocks({
      achievements: rebuilt.achievements,
      milestones: rebuilt.milestones.filter((rung) => !isCareerMilestoneRung(rung)),
      careerMilestones,
      mastery: rebuilt.mastery,
    }, 'reconstructed');
  }

  const snapshot = buildExpeditionSummarySnapshot({
    history,
    timeline,
    progression,
    xp: { viewing: xp.viewing, rewatch: xp.rewatch, storyComplete: xp.storyComplete },
    checkpointXp: xp.checkpointXp,
    championshipMastery: options.retrospective ? null : options.championshipMastery ?? null,
    unlocks,
  });

  const row = await tx.expeditionSummary.create({
    data: {
      userId,
      raceId,
      raceName: history.race.name,
      startedAt: new Date(snapshot.startedAt),
      completedAt: new Date(snapshot.completedAt),
      retrospective: options.retrospective,
      schemaVersion: EXPEDITION_SUMMARY_SCHEMA_VERSION,
      snapshot,
      createdAt: now,
    },
    select: { id: true },
  });
  return { id: row.id, snapshot };
}

// ---------------------------------------------------------------------------
// Expedition Mode
// ---------------------------------------------------------------------------

export interface ExpeditionModeChange {
  mode: ExpeditionModeSetting;
  isExpedition: boolean;
  /** The race's checkpoints pay XP (a runtime of six hours or more). */
  paysXp: boolean;
  /** Checkpoints the switch paid: those already behind the race. */
  awarded: { percent: number; xp: number }[];
  summaryWritten: boolean;
  hasSummary: boolean;
}

/**
 * Switch a race's Expedition Mode, inside the caller's transaction (§4.3.4):
 * write the setting, reconcile the checkpoints (switching off revokes nothing,
 * switching on pays the reached checkpoints not held), write the summary of a
 * race that is now an Expedition with a complete story and none yet, and
 * settle the ledger. Null when the race is not this account's.
 */
export async function setExpeditionMode(
  tx: Tx,
  userId: string,
  raceId: string,
  mode: ExpeditionModeSetting,
  now: Date,
): Promise<ExpeditionModeChange | null> {
  const owned = await tx.race.findFirst({ where: { id: raceId, userId }, select: { id: true } });
  if (owned === null) return null;

  await tx.race.updateMany({
    where: { id: raceId, userId },
    data: { expeditionMode: mode === 'auto' ? null : mode === 'on' },
  });

  const reconcile = await reconcileExpedition(tx, userId, raceId);
  const summary = reconcile.isExpedition && reconcile.storyCompleted && reconcile.history !== null
    ? await writeExpeditionSummary(tx, userId, raceId, now, { retrospective: true, history: reconcile.history })
    : null;
  // Nothing can have come off — the switch changes no coverage and no
  // runtime — but the rule has no exceptions (R13).
  await settleLedger(tx, userId, [reconcile.revocation]);

  const hasSummary = summary !== null
    || (await tx.expeditionSummary.count({ where: { userId, raceId } })) > 0;
  return {
    mode,
    isExpedition: reconcile.isExpedition,
    paysXp: checkpointsPayXp(reconcile.runtimeSec),
    awarded: reconcile.awarded.map(({ percent, xp }) => ({ percent, xp })),
    summaryWritten: summary !== null,
    hasSummary,
  };
}

// ---------------------------------------------------------------------------
// A stint's Expedition, for its summary
// ---------------------------------------------------------------------------

/**
 * What one stint did for its race's Expedition, from the race's replay, the
 * checkpoint XP the stint's own ledger rows hold, and the race's summary.
 *
 * The checkpoints it reached are those it took the coverage past while the
 * race is an Expedition — at 0 XP on a race too short to pay them — and any
 * its own rows paid. Null for a stint of a race that is not an Expedition and
 * paid it no checkpoint. The live stint and the summary reopened later both
 * build it here, so they say the same.
 */
export function expeditionOutcomeOf(input: {
  history: RaceHistory;
  sessionId: string;
  /** The checkpoint XP the stint's own rows hold, by percent. */
  paid: ReadonlyMap<number, number>;
  summary: { id: string; completingSessionId: string } | null;
}): ExpeditionOutcome | null {
  const { history, sessionId } = input;
  const stint = history.stints.find((candidate) => candidate.sessionId === sessionId);
  if (stint === undefined) return null;
  const race = history.race;
  const expedition = isExpedition(race);
  const percents = new Set<number>(input.paid.keys());
  if (expedition) for (const percent of checkpointsCrossedBy(history, sessionId)) percents.add(percent);
  if (!expedition && percents.size === 0) return null;

  const completed = input.summary !== null && input.summary.completingSessionId === sessionId;
  return {
    coveragePercentText: formatCoveragePercent(stint.coverageAfterSeconds, race.runtimeSec),
    began: expedition && history.stints[0]?.sessionId === sessionId,
    checkpointsReached: [...percents].sort((a, b) => a - b).map((percent) => ({
      percent, xpAwarded: input.paid.get(percent) ?? 0,
    })),
    nextCheckpoint: expedition ? nextCheckpoint(stint.coverageAfterSeconds, race.runtimeSec) : null,
    completed,
    summaryId: completed ? input.summary?.id ?? null : null,
  };
}

/** A logged stint's Expedition, rebuilt from committed data for a reopened stint summary. */
export async function stintExpeditionOutcome(
  db: Tx,
  userId: string,
  session: { id: string; raceId: string },
): Promise<ExpeditionOutcome | null> {
  const [inputs, rows, summary] = await Promise.all([
    loadRaceTimelineInputs(db, userId, session.raceId),
    // By stint, through the `sessionId` index; the account is checked on each row.
    db.xPTransaction.findMany({
      where: { sessionId: session.id, source: 'EXPEDITION' },
      select: { userId: true, dedupeKey: true, amount: true },
    }),
    db.expeditionSummary.findFirst({ where: { userId, raceId: session.raceId }, select: { id: true, snapshot: true } }),
  ]);
  if (inputs === null) return null;

  const paid = new Map<number, number>();
  for (const row of rows) {
    const percent = row.userId === userId ? checkpointOfKey(session.raceId, row.dedupeKey) : null;
    if (percent !== null) paid.set(percent, row.amount);
  }
  const snapshot = summary === null ? null : parseExpeditionSummarySnapshot(summary.snapshot);
  return expeditionOutcomeOf({
    history: replayRace(inputs.race, inputs.sessions),
    sessionId: session.id,
    paid,
    summary: summary === null || snapshot === null ? null : { id: summary.id, completingSessionId: snapshot.completingSessionId },
  });
}

// ---------------------------------------------------------------------------
// Summaries, for the pages
// ---------------------------------------------------------------------------

export interface ExpeditionSummaryView {
  id: string;
  raceId: string | null;
  retrospective: boolean;
  createdAt: Date;
  snapshot: ExpeditionSummarySnapshotV1;
}

/** A race's Expedition Summary, read inside the account; null when it has none (or none this build can read). */
export async function getExpeditionSummaryForRace(
  userId: string,
  raceId: string,
  db: Tx = prisma,
): Promise<ExpeditionSummaryView | null> {
  const row = await db.expeditionSummary.findFirst({
    where: { userId, raceId },
    select: { id: true, raceId: true, retrospective: true, createdAt: true, snapshot: true },
  });
  if (row === null) return null;
  const snapshot = parseExpeditionSummarySnapshot(row.snapshot);
  return snapshot === null ? null : { ...row, snapshot };
}

/** One summary by its id, read inside the account, whether or not its race still exists. */
export async function getExpeditionSummary(userId: string, summaryId: string): Promise<ExpeditionSummaryView | null> {
  const row = await prisma.expeditionSummary.findFirst({
    where: { id: summaryId, userId },
    select: { id: true, raceId: true, retrospective: true, createdAt: true, snapshot: true },
  });
  if (row === null) return null;
  const snapshot = parseExpeditionSummarySnapshot(row.snapshot);
  return snapshot === null ? null : { ...row, snapshot };
}

// ---------------------------------------------------------------------------
// The Expedition page
// ---------------------------------------------------------------------------

export interface ExpeditionView {
  race: {
    id: string;
    name: string;
    runtimeSec: number;
    scheduledDurationSec: number;
    championship: { id: string; name: string; accentColor: string } | null;
    event: { key: string; name: string; href: string; editionYear: number | null } | null;
    circuit: string | null;
    raceDate: Date | null;
    isMajorEvent: boolean;
    /** The race's average playback speed so far; 1 before the first stint. */
    speed: number;
  };
  mode: ExpeditionModeSetting;
  isExpedition: boolean;
  checkpointsPayXp: boolean;
  figures: ExpeditionFigures;
  /** Every stint, in canonical order, from the replay: new coverage is right after a delete. */
  stints: StintEvent[];
  /** What the rest of the race asks of the viewing plan; null when the plan could not be read. */
  budget: {
    realRemainingSec: number;
    yearRemainingHours: number;
    weekRemainingHours: number;
    recommendedPaceHours: number;
    note: string;
  } | null;
  championship: { name: string; percent: number } | null;
  event: {
    key: string;
    name: string;
    href: string;
    editionYear: number | null;
    editionsExperienced: number;
    nextStep: { name: string; description: string } | null;
  } | null;
  /** The Story Complete bonus the race pays: the sixth checkpoint, paid only by the bonus. */
  storyBonus: { careerXp: number; label: string };
  summary: ExpeditionSummaryView | null;
}

/**
 * The next step an event has not reached, in tree order, and how many
 * editions of it have been experienced — read from the event's race rows,
 * the way its steps count them.
 */
async function eventStanding(
  userId: string,
  key: string,
): Promise<{ editionsExperienced: number; nextStep: { name: string; description: string } | null }> {
  const [races, tree] = await Promise.all([
    prisma.race.findMany({
      where: { userId, iconicKey: key },
      select: {
        id: true, runtimeSec: true, coverageSec: true, creditedViewingSec: true, realViewingSec: true, raceDate: true,
        season: { select: { year: true } },
      },
    }),
    prisma.masteryTree.findFirst({
      where: { userId, key: `event:${key}` },
      select: {
        nodes: {
          select: {
            key: true, name: true, description: true, tier: true, sortOrder: true,
            progress: { where: { userId }, select: { unlockedAt: true } },
          },
        },
      },
    }),
  ]);
  const editions = new Set<string>();
  for (const race of races) {
    const experienced = isRaceExperienced({
      coverageSec: race.coverageSec, runtimeSec: race.runtimeSec, creditedSec: race.creditedViewingSec ?? race.realViewingSec,
    });
    if (experienced) editions.add(editionIdentity({ id: race.id, raceDate: race.raceDate, seasonYear: race.season?.year ?? null }));
  }
  const next = (tree?.nodes ?? [])
    .filter((node) => (node.progress[0]?.unlockedAt ?? null) === null)
    .sort((a, b) => a.tier - b.tier || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))[0];
  return {
    editionsExperienced: editions.size,
    nextStep: next === undefined ? null : { name: next.name, description: next.description },
  };
}

/**
 * Everything the Expedition page shows, for one race of this account; null
 * for a race the account does not have. Built from the race and its own
 * stints (`replayRace`), the checkpoint rows the ledger holds for it, its
 * summary and the viewing plan — never the whole career's replay.
 */
export async function getExpeditionView(userId: string, raceId: string, now: Date): Promise<ExpeditionView | null> {
  const [inputs, extra, heldRows, summary] = await Promise.all([
    loadRaceTimelineInputs(prisma, userId, raceId),
    prisma.race.findFirst({
      where: { id: raceId, userId },
      select: { avgPlaybackSpeed: true, championship: { select: { id: true, name: true, accentColor: true } } },
    }),
    prisma.xPTransaction.findMany({
      where: { userId, source: 'EXPEDITION', sourceRef: raceId },
      select: { dedupeKey: true, amount: true },
    }),
    getExpeditionSummaryForRace(userId, raceId),
  ]);
  if (inputs === null || extra === null) return null;

  const history = replayRace(inputs.race, inputs.sessions);
  const race = history.race;
  const speed = extra.avgPlaybackSpeed > 0 ? extra.avgPlaybackSpeed : 1;
  // What each held checkpoint was paid, which is what the page shows for it:
  // one paid under an earlier schedule keeps its amount (§6 row 22).
  const held = new Map(heldRows.flatMap((row): [number, number][] => {
    const percent = checkpointOfKey(raceId, row.dedupeKey);
    return percent === null ? [] : [[percent, row.amount]];
  }));
  const figures = expeditionFigures(history, speed, now, held);

  const [budget, mastery, event] = await Promise.all([
    getBudgetSnapshot(userId, now).catch(() => null),
    extra.championship === null
      ? Promise.resolve(null)
      : getMasteryForChampionship(userId, extra.championship.id).catch(() => null),
    race.eventKey === null ? Promise.resolve(null) : eventStanding(userId, race.eventKey),
  ]);

  return {
    race: {
      id: race.id,
      name: race.name,
      runtimeSec: race.runtimeSec,
      scheduledDurationSec: race.scheduledDurationSec,
      championship: extra.championship,
      event: race.eventKey === null
        ? null
        : { key: race.eventKey, name: race.eventName ?? race.eventKey, href: eventHref(race.eventKey), editionYear: race.editionYear },
      circuit: race.circuit,
      raceDate: race.raceDate,
      isMajorEvent: race.isMajorEvent,
      speed,
    },
    mode: expeditionModeOf(race.expeditionMode),
    isExpedition: isExpedition(race),
    checkpointsPayXp: checkpointsPayXp(race.runtimeSec),
    figures,
    stints: [...history.stints],
    budget: budget === null
      ? null
      : {
        realRemainingSec: figures.remainingRealSec,
        yearRemainingHours: budget.remainingHours,
        weekRemainingHours: budget.weekRemainingHours,
        recommendedPaceHours: budget.recommendedPaceHours,
        note: expeditionBudgetNote({
          realRemainingSec: figures.remainingRealSec,
          speed,
          year: budget.year,
          yearRemainingHours: budget.remainingHours,
          weekRemainingHours: budget.weekRemainingHours,
          recommendedPaceHours: budget.recommendedPaceHours,
        }),
      },
    championship: mastery === null ? null : { name: mastery.name, percent: mastery.completionPercent },
    event: race.eventKey === null || event === null
      ? null
      : {
        key: race.eventKey,
        name: race.eventName ?? race.eventKey,
        href: eventHref(race.eventKey),
        editionYear: race.editionYear,
        editionsExperienced: event.editionsExperienced,
        nextStep: event.nextStep,
      },
    storyBonus: (({ careerXp, label }) => ({ careerXp, label }))(storyCompleteBonus(race.runtimeSec, race.isMajorEvent, XP_CONFIG)),
    summary,
  };
}
