/**
 * Career Milestones (0.4.0): the permanent moments of a career, and when each
 * happened.
 *
 * The catalogue (`config/career-milestones.ts`) is an upgrade of the lifetime
 * ladders, not a second system. Most of its rows are ladder rungs that
 * `syncMilestones` already reaches and pays; the rest — the rungs marked
 * `owner: 'career'` — are written here, once, and pay their modest XP once.
 * One moment has one payer, so a row that another system already pays is
 * recorded with 0 XP.
 *
 * Reaching and dating are two steps, on purpose:
 *
 *   1. `syncCareerMilestones` recognises what the current figures have
 *      reached, from the same rounded values the ladders use, and pays.
 *   2. `fillLandmarkDates` looks back through the career replay for the
 *      moment each undated landmark actually happened — the instant the
 *      250th hour was crossed inside a stint, the stint that completed the
 *      tenth story — and writes it.
 *
 * THE IMMUTABILITY RULE. A landmark's date is written once, while its
 * `achievedPrecision` is still null, and never again. Deleting, editing or
 * backdating stints changes statistics; it never moves a milestone's date and
 * never removes a milestone. Where history cannot say when something
 * happened, the row is marked RECOGNISED and shows when the app recorded it —
 * no precision is invented. (`db:recompute --rebuild-milestone-dates` is the
 * one, deliberate, developer's exception.)
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import {
  CAREER_MILESTONES, MILESTONES, TIMELINE_SHAPE,
  careerMilestoneDedupeKey, careerMilestoneMetricKey, careerMilestoneOfRow, careerMilestoneThreshold,
  careerMilestoneTitle,
  type CareerMilestoneDef, type CareerMilestoneGroup,
} from '@/lib/config';
import { buildCareerTimeline, type CareerTimeline } from '@/lib/domain/career-timeline';
import {
  acceptInstant, creditedSecondsByLocalYearOfSessions, eventStepInstant, isReplayableMilestoneMetric,
  milestoneInstant,
} from '@/lib/domain/landmarks';
import type { MilestonePrecision } from '@/lib/domain/types';
import { milestoneXpFor } from './achievement-engine';
import type { TimelineInputs } from './career-timeline-engine';
import type { CareerMilestoneUnlock } from './contracts';
import { computeCareerMetricsWithHistory, type CareerMetrics } from './metrics';
import { stintUnlockWindowFor } from './stint-unlocks';
import { awardXp } from './xp-ledger';

// ---------------------------------------------------------------------------
// Reaching
// ---------------------------------------------------------------------------

/** A career-owned milestone `syncCareerMilestones` has just written. */
export interface CareerMilestoneReached {
  id: string;
  title: string;
  metric: string;
  threshold: number;
  xpAwarded: number;
}

export interface CareerMilestoneSync {
  created: number;
  xpAwarded: number;
  /** What was written, in catalogue order, for the stint's XP breakdown. */
  reached: CareerMilestoneReached[];
}

/**
 * The figure each career-owned rung is measured by. Taken from the metrics,
 * so a rung is recognised from the same rounded value the ladders use; the
 * replay dates it at that same point (`recognitionThresholdSeconds`).
 */
function careerValue(metrics: CareerMetrics, def: CareerMilestoneDef): number {
  switch (def.metric) {
    case 'racesStarted': return metrics.racesStarted;
    case 'racesExperienced': return metrics.racesExperienced;
    case 'storyCompletes': return metrics.storyCompletes;
    case 'stories6h': return metrics.stories6h;
    case 'stories12h': return metrics.stories12h;
    case 'stories24h': return metrics.stories24h;
    case 'realHours': return metrics.realHours;
    // Distinct experienced editions of one event, from the race rows.
    case 'eventEditions': return metrics.maxEditionsExperiencedOfOneEvent;
    // Measured per calendar year, from the stints, in `syncCareerMilestones`.
    case 'realHoursYear': return 0;
  }
}

/**
 * Write and pay the career-owned milestones the career has reached.
 *
 * It creates and pays, and does not date: `fillLandmarkDates` does that. It
 * never touches a ladder-owned row — `syncMilestones` still owns those.
 *
 *   - A rung is reached once its value reaches its threshold and no row holds
 *     its `(metric, threshold)`.
 *   - A calendar year's rung is measured in credited seconds, split over the
 *     stints' windows at the year boundaries, and is reached once per year: a
 *     year counts as reached when ANY row has its metric, whatever threshold
 *     it was reached at, so re-balancing the annual hours never adds a second
 *     row for a year. Its dedupe key carries no number, so it cannot pay a
 *     year twice either.
 *   - A rung with XP is paid first, career XP only; a rung with 0 XP writes no
 *     ledger row at all.
 *   - The row is upserted with an empty update, so a concurrent writer can
 *     never duplicate it.
 */
export async function syncCareerMilestones(
  tx: Tx,
  userId: string,
  input: { metrics: CareerMetrics; history: TimelineInputs; now: Date },
): Promise<CareerMilestoneSync> {
  const rows = await tx.milestoneProgress.findMany({ where: { userId }, select: { metric: true, threshold: true } });
  const reachedPairs = new Set(rows.map((row) => `${row.metric}:${row.threshold}`));
  const reachedMetrics = new Set(rows.map((row) => row.metric));

  const result: CareerMilestoneSync = { created: 0, xpAwarded: 0, reached: [] };
  let byYear: Map<number, number> | null = null;

  const write = async (def: CareerMilestoneDef, value: number, year?: number): Promise<void> => {
    const metric = careerMilestoneMetricKey(def, year);
    const threshold = careerMilestoneThreshold(def);
    const title = careerMilestoneTitle(def, year);
    let xpAwarded = 0;
    if (def.xp > 0) {
      const award = await awardXp(tx, userId, {
        source: 'MILESTONE',
        amount: def.xp,
        description: `Career milestone — ${title}`,
        sourceRef: `${metric}:${threshold}`,
        dedupeKey: careerMilestoneDedupeKey(def, year),
      });
      xpAwarded = award.granted;
    }
    await tx.milestoneProgress.upsert({
      where: { userId_metric_threshold: { userId, metric, threshold } },
      create: { userId, metric, threshold, reachedAt: input.now, valueAtReach: value, xpAwarded },
      update: {},
    });
    reachedPairs.add(`${metric}:${threshold}`);
    reachedMetrics.add(metric);
    result.created += 1;
    result.xpAwarded += xpAwarded;
    result.reached.push({ id: def.id, title, metric, threshold, xpAwarded });
  };

  for (const def of CAREER_MILESTONES) {
    if (def.owner !== 'career') continue;
    const threshold = careerMilestoneThreshold(def);

    if (def.metric === 'realHoursYear') {
      byYear ??= creditedSecondsByLocalYearOfSessions(input.history.sessions);
      for (const [year, seconds] of [...byYear].sort(([a], [b]) => a - b)) {
        if (seconds < threshold * 3600) continue;
        if (reachedMetrics.has(careerMilestoneMetricKey(def, year))) continue;
        await write(def, Math.round((seconds / 3600) * 10) / 10, year);
      }
      continue;
    }

    const value = careerValue(input.metrics, def);
    if (value < threshold || reachedPairs.has(`${def.metric}:${threshold}`)) continue;
    await write(def, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dating
// ---------------------------------------------------------------------------

export interface LandmarkDating {
  /** Milestone rows given the moment history says they happened. */
  milestones: number;
  /** Event Legacy steps given the moment history says they happened. */
  eventSteps: number;
  /** Rows of either kind history cannot place, marked RECOGNISED. */
  recognised: number;
}

/**
 * Date every landmark that has no date yet, from the career replay.
 *
 * The undated rows are read first, and in the usual case — a stint that
 * reached nothing new — there are none and nothing else happens: the replay
 * stays off the hot path. It is built only when some undated row can be
 * replayed, from `history` unless the caller passes the timeline it already
 * holds.
 *
 * A replayed instant is used only if it is not after the moment the app
 * recorded the landmark (plus the recognition slack): once stints have been
 * deleted, the replay can place a crossing later than it really happened, and
 * a landmark is never dated after it was already known. Anything history
 * cannot place is marked RECOGNISED, with no date: the page then shows when
 * it was recorded. On the stint path `recognisedBySessionId` names the stint
 * being logged, and a recognised row recorded inside that stint's unlock
 * window is attached to it, so the stint's summary still lists it.
 *
 * Every write is guarded by `achievedPrecision: null`, so a date, once
 * written, is never written again (R11).
 */
export async function fillLandmarkDates(
  tx: Tx,
  userId: string,
  input: { history: TimelineInputs; now: Date; timeline?: CareerTimeline; recognisedBySessionId?: string },
): Promise<LandmarkDating> {
  const [milestoneRows, stepRows] = await Promise.all([
    tx.milestoneProgress.findMany({
      where: { userId, achievedPrecision: null, reachedAt: { not: null } },
      select: { id: true, metric: true, threshold: true, reachedAt: true },
    }),
    tx.masteryProgress.findMany({
      where: { userId, achievedPrecision: null, unlockedAt: { not: null }, node: { tree: { kind: 'RACE_EVENT' } } },
      select: {
        id: true, unlockedAt: true,
        node: { select: { metric: true, threshold: true, tree: { select: { iconicKey: true } } } },
      },
    }),
  ]);

  const dating: LandmarkDating = { milestones: 0, eventSteps: 0, recognised: 0 };
  if (milestoneRows.length === 0 && stepRows.length === 0) return dating;

  const needsReplay = stepRows.length > 0 || milestoneRows.some((row) => isReplayableMilestoneMetric(row.metric));
  const timeline = needsReplay
    ? (input.timeline ?? buildCareerTimeline(input.history.sessions, input.history.races))
    : null;
  const slack = TIMELINE_SHAPE.recognitionSlackMinutes;

  // The stint being logged, and the span its unlocks are stamped in: read
  // only when some row turns out to be recognised only.
  let window: { from: Date; to: Date } | null | undefined;
  const recordedByThisStint = async (recordedAt: Date): Promise<boolean> => {
    if (input.recognisedBySessionId === undefined) return false;
    if (window === undefined) {
      const session = await tx.raceViewingSession.findFirst({
        where: { id: input.recognisedBySessionId, userId },
        select: { watchedAt: true },
      });
      window = session === null ? null : await stintUnlockWindowFor(tx, userId, session);
    }
    return window !== null && recordedAt >= window.from && recordedAt <= window.to;
  };

  for (const row of milestoneRows) {
    if (row.reachedAt === null) continue;
    const instant = timeline !== null && isReplayableMilestoneMetric(row.metric)
      ? milestoneInstant(timeline, row.metric, row.threshold)
      : null;
    if (instant !== null && acceptInstant(instant, row.reachedAt, slack)) {
      const written = await tx.milestoneProgress.updateMany({
        where: { id: row.id, userId, achievedPrecision: null },
        data: {
          achievedAt: instant.at,
          achievedPrecision: instant.precision,
          sessionId: instant.sessionId,
          raceId: instant.raceId,
          eventId: instant.eventId ?? null,
          subjectName: instant.subjectName ?? null,
        },
      });
      dating.milestones += written.count;
    } else {
      const ours = await recordedByThisStint(row.reachedAt);
      const written = await tx.milestoneProgress.updateMany({
        where: { id: row.id, userId, achievedPrecision: null },
        data: { achievedPrecision: 'RECOGNISED', ...(ours ? { sessionId: input.recognisedBySessionId } : {}) },
      });
      dating.recognised += written.count;
    }
  }

  for (const row of stepRows) {
    if (row.unlockedAt === null) continue;
    const eventKey = row.node.tree.iconicKey;
    const instant = timeline !== null && eventKey !== null
      ? eventStepInstant(timeline, eventKey, row.node.metric, row.node.threshold)
      : null;
    if (instant !== null && acceptInstant(instant, row.unlockedAt, slack)) {
      const written = await tx.masteryProgress.updateMany({
        where: { id: row.id, userId, achievedPrecision: null },
        data: { achievedAt: instant.at, achievedPrecision: instant.precision, achievedSessionId: instant.sessionId },
      });
      dating.eventSteps += written.count;
    } else {
      const ours = await recordedByThisStint(row.unlockedAt);
      const written = await tx.masteryProgress.updateMany({
        where: { id: row.id, userId, achievedPrecision: null },
        data: { achievedPrecision: 'RECOGNISED', ...(ours ? { achievedSessionId: input.recognisedBySessionId } : {}) },
      });
      dating.recognised += written.count;
    }
  }

  return dating;
}

/**
 * Date every landmark again from the replay — the documented exception to
 * write-once, for developer repair only (`db:recompute
 * --rebuild-milestone-dates`).
 *
 * A row is rewritten only when its replayed instant passes the same test a
 * first dating does (not after the app recorded it); every other row, dated or
 * not, is left exactly as it is. Returns how many rows were rewritten.
 */
export async function rebuildLandmarkDates(tx: Tx, userId: string, timeline: CareerTimeline): Promise<number> {
  const [milestoneRows, stepRows] = await Promise.all([
    tx.milestoneProgress.findMany({
      where: { userId, reachedAt: { not: null } },
      select: { id: true, metric: true, threshold: true, reachedAt: true },
    }),
    tx.masteryProgress.findMany({
      where: { userId, unlockedAt: { not: null }, node: { tree: { kind: 'RACE_EVENT' } } },
      select: {
        id: true, unlockedAt: true,
        node: { select: { metric: true, threshold: true, tree: { select: { iconicKey: true } } } },
      },
    }),
  ]);
  const slack = TIMELINE_SHAPE.recognitionSlackMinutes;
  let rewritten = 0;

  for (const row of milestoneRows) {
    if (row.reachedAt === null || !isReplayableMilestoneMetric(row.metric)) continue;
    const instant = milestoneInstant(timeline, row.metric, row.threshold);
    if (instant === null || !acceptInstant(instant, row.reachedAt, slack)) continue;
    const written = await tx.milestoneProgress.updateMany({
      where: { id: row.id, userId },
      data: {
        achievedAt: instant.at,
        achievedPrecision: instant.precision,
        sessionId: instant.sessionId,
        raceId: instant.raceId,
        eventId: instant.eventId ?? null,
        subjectName: instant.subjectName ?? null,
      },
    });
    rewritten += written.count;
  }

  for (const row of stepRows) {
    const eventKey = row.node.tree.iconicKey;
    if (row.unlockedAt === null || eventKey === null) continue;
    const instant = eventStepInstant(timeline, eventKey, row.node.metric, row.node.threshold);
    if (instant === null || !acceptInstant(instant, row.unlockedAt, slack)) continue;
    const written = await tx.masteryProgress.updateMany({
      where: { id: row.id, userId },
      data: { achievedAt: instant.at, achievedPrecision: instant.precision, achievedSessionId: instant.sessionId },
    });
    rewritten += written.count;
  }

  return rewritten;
}

// ---------------------------------------------------------------------------
// A stint's milestones
// ---------------------------------------------------------------------------

const CATALOGUE_ORDER: ReadonlyMap<string, number> = new Map(CAREER_MILESTONES.map((def, index) => [def.id, index]));

interface StoredMilestone {
  metric: string;
  threshold: number;
  reachedAt: Date | null;
  achievedAt: Date | null;
  achievedPrecision: MilestonePrecision | null;
  subjectName: string | null;
  xpAwarded: number;
}

function toUnlock(row: StoredMilestone): CareerMilestoneUnlock | null {
  const match = careerMilestoneOfRow(row.metric, row.threshold);
  if (match === null) return null;
  return {
    id: match.def.id,
    title: careerMilestoneTitle(match.def, match.year),
    metric: row.metric,
    threshold: row.threshold,
    achievedAt: row.achievedAt?.toISOString() ?? null,
    precision: row.achievedPrecision,
    recordedAt: row.reachedAt?.toISOString() ?? null,
    subjectName: row.subjectName,
    xpAwarded: row.xpAwarded,
    celebration: match.def.celebration,
  };
}

/**
 * The Career Milestones whose moment was this stint: the catalogue rows dated
 * to it (or recognised by it), in catalogue order. Ladder rows that are not
 * in the catalogue stay with the lifetime ladders. The live stint and the
 * summary rebuilt later both read this, so they list the same milestones.
 */
export async function listStintCareerMilestones(
  db: Tx,
  userId: string,
  sessionId: string,
): Promise<CareerMilestoneUnlock[]> {
  const rows = await db.milestoneProgress.findMany({
    where: { userId, sessionId },
    select: {
      metric: true, threshold: true, reachedAt: true, achievedAt: true, achievedPrecision: true,
      subjectName: true, xpAwarded: true,
    },
  });
  return rows
    .map(toUnlock)
    .filter((unlock): unlock is CareerMilestoneUnlock => unlock !== null)
    .sort((a, b) => (CATALOGUE_ORDER.get(a.id) ?? 0) - (CATALOGUE_ORDER.get(b.id) ?? 0) || a.metric.localeCompare(b.metric));
}

/** Whether a lifetime-ladder rung is also a Career Milestone, and so shown with those instead. */
export function isCareerMilestoneRung(rung: { metric: string; threshold: number }): boolean {
  return careerMilestoneOfRow(rung.metric, rung.threshold) !== null;
}

/** A reached Career Milestone, for the lists that show only the latest few. */
export interface RecentCareerMilestone {
  /** Unique per row: the catalogue id, with the year for a year's rung. */
  key: string;
  title: string;
  /** `achievedAt`, or when it was recorded when history cannot place it. */
  date: Date;
  precision: MilestonePrecision | null;
  subjectName: string | null;
  celebration: CareerMilestoneDef['celebration'];
}

/** The most recently reached Career Milestones, newest first. */
export async function listRecentCareerMilestones(
  userId: string,
  limit: number,
  db: Tx = prisma,
): Promise<RecentCareerMilestone[]> {
  const rows = await db.milestoneProgress.findMany({
    where: { userId, reachedAt: { not: null } },
    select: { metric: true, threshold: true, reachedAt: true, achievedAt: true, achievedPrecision: true, subjectName: true },
  });
  const recent: RecentCareerMilestone[] = [];
  for (const row of rows) {
    const match = careerMilestoneOfRow(row.metric, row.threshold);
    const date = row.achievedAt ?? row.reachedAt;
    if (match === null || date === null) continue;
    recent.push({
      key: match.year === undefined ? match.def.id : `${match.def.id}:${match.year}`,
      title: careerMilestoneTitle(match.def, match.year),
      date,
      precision: row.achievedPrecision,
      subjectName: row.subjectName,
      celebration: match.def.celebration,
    });
  }
  return recent
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export interface CareerMilestoneItem {
  /** The catalogue id; a year's rung is `year-plan:<year>`. */
  id: string;
  group: CareerMilestoneGroup;
  title: string;
  description: string;
  celebration: CareerMilestoneDef['celebration'];
  reached: boolean;
  /** `achievedAt`, or when it was recorded when history cannot place it. */
  date: Date | null;
  precision: MilestonePrecision | null;
  /** When the app recorded it. */
  recognisedAt: Date | null;
  /** The race or event it happened in: a link while there is somewhere to go, else the name it had. */
  subject: { kind: 'race' | 'event'; href: string | null; name: string } | null;
  /** XP it paid, or will pay; 0 when another system pays the moment. */
  xp: number;
  /** Who pays the moment instead, for a milestone that pays 0 XP. */
  alsoPaidBy: readonly string[];
  hallOfFame: { title: string; href: string } | null;
  /** Unreached milestones only, and never for a year. */
  progress: { value: number; target: number; unit: 'hours' | 'count' } | null;
}

export interface CareerMilestonesView {
  groups: { group: CareerMilestoneGroup; title: string; items: CareerMilestoneItem[] }[];
  /** Every reached milestone, newest first. */
  timeline: CareerMilestoneItem[];
  /** The current year's hours: a fact, never a bar. */
  currentYear: { year: number; creditedSeconds: number; reached: boolean };
}

const GROUP_TITLES: Readonly<Record<CareerMilestoneGroup, string>> = {
  firsts: 'Firsts',
  stories: 'Complete race stories',
  hours: 'Career hours',
  races: 'Races experienced',
  years: 'Years',
  events: 'Recurring events',
};

const GROUP_ORDER: readonly CareerMilestoneGroup[] = ['firsts', 'stories', 'hours', 'races', 'years', 'events'];

/** What a ladder rung pays, for a ladder-owned milestone not reached yet. */
function ladderXp(def: CareerMilestoneDef): number {
  const ladder = MILESTONES.find((candidate) => candidate.metric === def.metric);
  const index = ladder?.thresholds.indexOf(careerMilestoneThreshold(def)) ?? -1;
  return ladder === undefined || index < 0 ? 0 : milestoneXpFor(ladder, index);
}

/**
 * The Career Milestones page: every catalogue milestone, reached or still
 * ahead, grouped, and the reached ones again as one timeline.
 *
 * Built from the milestone rows, the live metrics (progress is measured with
 * the same figures recognition uses), the career history those metrics were
 * read with (race and event names, and the current year's hours), and the Hall
 * of Fame plaques a milestone links to. No query is made per item.
 */
export async function getCareerMilestonesView(userId: string, now: Date): Promise<CareerMilestonesView> {
  const hallOfFameKeys = [...new Set(CAREER_MILESTONES.flatMap((def) => def.hallOfFameKeys))];
  const [rows, { metrics, history }, plaques] = await Promise.all([
    prisma.milestoneProgress.findMany({
      where: { userId, reachedAt: { not: null } },
      select: {
        metric: true, threshold: true, reachedAt: true, xpAwarded: true, achievedAt: true,
        achievedPrecision: true, raceId: true, eventId: true, subjectName: true,
      },
    }),
    computeCareerMetricsWithHistory(userId),
    prisma.hallOfFameEntry.findMany({
      where: { userId, key: { in: hallOfFameKeys } },
      select: { key: true, title: true },
    }),
  ]);

  const racesById = new Map(history.races.map((race) => [race.id, race]));
  const eventNames = new Map<string, string>();
  for (const race of history.races) {
    if (race.eventId !== null && race.eventName !== null) eventNames.set(race.eventId, race.eventName);
  }
  const plaqueByKey = new Map(plaques.map((plaque) => [plaque.key, plaque]));

  type Row = (typeof rows)[number];
  const byPair = new Map<string, Row>();
  const years: { year: number; row: Row }[] = [];
  for (const row of rows) {
    const match = careerMilestoneOfRow(row.metric, row.threshold);
    if (match === null) continue;
    if (match.year !== undefined) years.push({ year: match.year, row });
    else byPair.set(match.def.id, row);
  }

  const subjectOf = (def: CareerMilestoneDef, row: Row): CareerMilestoneItem['subject'] => {
    if (def.metric === 'eventEditions' || row.eventId !== null) {
      const name = (row.eventId !== null ? eventNames.get(row.eventId) : undefined) ?? row.subjectName;
      // Events get pages of their own with Event Legacy; until then the name is enough.
      return name === null ? null : { kind: 'event', href: null, name };
    }
    if (row.raceId === null) return row.subjectName === null ? null : { kind: 'race', href: null, name: row.subjectName };
    const race = racesById.get(row.raceId);
    if (race !== undefined) return { kind: 'race', href: `/races/${race.id}`, name: race.name };
    return row.subjectName === null ? null : { kind: 'race', href: null, name: row.subjectName };
  };

  const reachedItem = (def: CareerMilestoneDef, row: Row, id: string, year?: number): CareerMilestoneItem => {
    const plaque = def.hallOfFameKeys.map((key) => plaqueByKey.get(key)).find((entry) => entry !== undefined);
    return {
      id,
      group: def.group,
      title: careerMilestoneTitle(def, year),
      description: def.description,
      celebration: def.celebration,
      reached: true,
      date: row.achievedAt ?? row.reachedAt,
      precision: row.achievedPrecision,
      recognisedAt: row.reachedAt,
      subject: subjectOf(def, row),
      xp: row.xpAwarded,
      alsoPaidBy: def.alsoPaidBy,
      hallOfFame: plaque === undefined ? null : { title: plaque.title, href: `/hall-of-fame#${plaque.key}` },
      progress: null,
    };
  };

  const items: CareerMilestoneItem[] = [];
  for (const def of CAREER_MILESTONES) {
    if (def.metric === 'realHoursYear') {
      // Only the years that reached it are ever listed.
      for (const { year, row } of [...years].sort((a, b) => a.year - b.year)) {
        items.push(reachedItem(def, row, `${def.id}:${year}`, year));
      }
      continue;
    }
    const row = byPair.get(def.id);
    if (row !== undefined) {
      items.push(reachedItem(def, row, def.id));
      continue;
    }
    items.push({
      id: def.id,
      group: def.group,
      title: careerMilestoneTitle(def),
      description: def.description,
      celebration: def.celebration,
      reached: false,
      date: null,
      precision: null,
      recognisedAt: null,
      subject: null,
      xp: def.owner === 'career' ? def.xp : ladderXp(def),
      alsoPaidBy: def.alsoPaidBy,
      hallOfFame: null,
      progress: {
        value: careerValue(metrics, def),
        target: careerMilestoneThreshold(def),
        unit: def.kind === 'time' ? 'hours' : 'count',
      },
    });
  }

  const year = now.getFullYear();
  const creditedThisYear = creditedSecondsByLocalYearOfSessions(history.sessions).get(year) ?? 0;

  return {
    groups: GROUP_ORDER.map((group) => ({
      group,
      title: GROUP_TITLES[group],
      items: items.filter((item) => item.group === group),
    })),
    timeline: items
      .filter((item) => item.reached && item.date !== null)
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || a.id.localeCompare(b.id)),
    currentYear: {
      year,
      creditedSeconds: creditedThisYear,
      reached: years.some((entry) => entry.year === year),
    },
  };
}
