/**
 * The Career Chronicle (0.4.0): chapters, their freezing, Wrapped and its
 * prompt.
 *
 * A chapter is one calendar year of a career in the computer's local time
 * (`domain/chronicle.ts` builds it; this module gathers what it is built
 * from). The year in progress, and a finished year still inside its grace
 * period, are built live from the history whenever they are shown. Once a
 * finished year's grace period is over — 72 hours into the new year, which
 * covers the longest time a stint logged on 1 January can reach back — it is
 * frozen: its chapter is written to `ChronicleYear` once, and read from there
 * ever after, so a later edit, a deleted race or a change of time zone never
 * rewrites a year that is over. The only way to rewrite one is to ask
 * (`rebuildChronicleYear`, from the chapter page or `db:recompute`).
 *
 * Nothing is frozen until the account's 0.4.0 backfill is complete: a
 * chapter must never be written before the upgrade has dated the landmarks
 * and written the Expedition Summaries it would contain. Until then a finished
 * year reads "finalising", and the backfill's own last phase freezes it.
 *
 * Every read and write is scoped to the account; a year from the address is
 * only ever looked up inside it.
 */

import { careerMilestoneOfRow, careerMilestoneTitle, CHRONICLE_SHAPE, MILESTONES } from '@/lib/config';
import { prisma, type Tx } from '@/lib/db/client';
import { localTimeZoneName, yearWindow } from '@/lib/domain/calendar';
import { creditedSeconds, type CareerTimeline } from '@/lib/domain/career-timeline';
import {
  activeYears, buildChapter, chapterWindowOptions, firstActivityYear, upgradeChapterSnapshot,
  UnreadableChapterError,
  type ChapterCareerMilestone, type ChapterExpeditionRow, type ChapterLadderRung, type ChapterMasteryStep,
  type ChapterState, type ChronicleChapterV1,
} from '@/lib/domain/chronicle';
import { parseExpeditionSummarySnapshot, type ExpeditionSummarySnapshotV1 } from '@/lib/domain/expedition';
import { beatenAfter, careerRecordOptions, computeRecordProgression, type RecordEvent } from '@/lib/domain/records';
import { summariseWindow, type GroupRow } from '@/lib/domain/window-summary';
import { isCareerBackfillApplied } from '@/lib/server/upgrades/career-backfill';
import { getCareerTimeline } from './career-timeline-engine';
import { carriedEventStepCopies, eventHref } from './mastery-engine';

/** A year being frozen, or rebuilt, in one transaction: as generous as logging a stint. */
const FREEZE_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/** Ids per `IN (…)` list, well inside SQLite's limit on bound parameters. */
const ID_CHUNK = 500;

const CANONICAL_ORDER = [{ watchedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

/** When a finished year may be frozen: local midnight on 1 January after it, plus the grace period. */
export function freezeDueAt(year: number): Date {
  return new Date(yearWindow(year).end.getTime() + CHRONICLE_SHAPE.freezeGraceHours * 3_600_000);
}

// ---------------------------------------------------------------------------
// Record progression, once per replay
// ---------------------------------------------------------------------------

/**
 * The career's record progression, kept beside the replay it came from: a
 * cached replay is the same object until the history changes, so a chapter
 * shown again does not fold every stint again to say which records stand.
 */
const progressions = new WeakMap<CareerTimeline, { weekStartsOn: number; progression: RecordEvent[] }>();

function progressionOf(timeline: CareerTimeline, weekStartsOn: number): RecordEvent[] {
  const known = progressions.get(timeline);
  if (known !== undefined && known.weekStartsOn === weekStartsOn) return known.progression;
  const progression = computeRecordProgression(timeline, careerRecordOptions(weekStartsOn));
  progressions.set(timeline, { weekStartsOn, progression });
  return progression;
}

async function weekStartOf(db: Tx, userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { weekStart: true } });
  return user?.weekStart ?? 1;
}

// ---------------------------------------------------------------------------
// Which years
// ---------------------------------------------------------------------------

/**
 * Career Year 1: the local year of the earliest stint, or of the earliest
 * frozen chapter if its stints have since been deleted — a frozen year stays
 * part of the Chronicle whatever happens to the history after it. Null for a
 * career with neither.
 */
async function chronicleFirstYear(db: Tx, userId: string): Promise<number | null> {
  const [first, earliest] = await Promise.all([
    db.raceViewingSession.findFirst({ where: { userId }, orderBy: [...CANONICAL_ORDER], select: { watchedAt: true } }),
    db.chronicleYear.findFirst({ where: { userId }, orderBy: { year: 'asc' }, select: { year: true } }),
  ]);
  const years = [first?.watchedAt.getFullYear(), earliest?.year].filter((year): year is number => year !== undefined);
  return years.length === 0 ? null : Math.min(...years);
}

/**
 * Whether anything happened in a year: a stint logged in it, or time a stint
 * logged after it reaches back into it (a stint at 00:30 on 1 January that
 * began on 31 December). With nothing logged in the year, only the first stint
 * logged after it can reach back, because every later stint's window is cut
 * at that one's instant (R6).
 */
async function yearHasActivity(db: Tx, userId: string, year: number): Promise<boolean> {
  const window = yearWindow(year);
  const inside = await db.raceViewingSession.findFirst({
    where: { userId, watchedAt: { gte: window.start, lt: window.end } },
    select: { id: true },
  });
  if (inside !== null) return true;
  const next = await db.raceViewingSession.findFirst({
    where: { userId, watchedAt: { gte: window.end } },
    orderBy: [...CANONICAL_ORDER],
    select: { watchedAt: true, realSeconds: true, timelineSeconds: true },
  });
  if (next === null) return false;
  return next.watchedAt.getTime() - creditedSeconds(next) * 1000 < window.end.getTime();
}

/**
 * The finished years that are due and not frozen yet, oldest first: past
 * their grace period, with something in them, and with no chapter. Cheap when
 * there is nothing to do — the first stint, the chapters there are, and a
 * look at any year between them without one.
 */
export async function yearsToFreeze(db: Tx, userId: string, now: Date): Promise<number[]> {
  const [firstYear, frozen] = await Promise.all([
    chronicleFirstYear(db, userId),
    db.chronicleYear.findMany({ where: { userId }, select: { year: true } }),
  ]);
  if (firstYear === null) return [];
  const done = new Set(frozen.map((row) => row.year));
  const due: number[] = [];
  for (let year = firstYear; now >= freezeDueAt(year); year += 1) {
    if (!done.has(year) && await yearHasActivity(db, userId, year)) due.push(year);
  }
  return due;
}

// ---------------------------------------------------------------------------
// Building a chapter
// ---------------------------------------------------------------------------

/** The label every ladder's rungs read with, by metric. */
const LADDER_LABELS: ReadonlyMap<string, string> = new Map(MILESTONES.map((def) => [def.metric, def.label]));

/**
 * One year's chapter, from the history as it stands (§4.5.3).
 *
 * `prebuilt` hands over a replay and record progression the caller already
 * has — the freeze pass and the backfill build them once per account, never
 * once per year — and the client to read with, which inside a freeze is the
 * transaction's. Otherwise the cached replay is used.
 */
export async function buildChapterData(
  userId: string,
  year: number,
  now: Date,
  prebuilt?: { db: Tx; timeline: CareerTimeline; progression: readonly RecordEvent[] },
): Promise<ChronicleChapterV1> {
  const db = prebuilt?.db ?? prisma;
  const window = yearWindow(year);
  const within = { gte: window.start, lt: window.end };
  const previousWindow = yearWindow(year - 1);

  const [timeline, weekStartsOn, ledger, before, achievements, milestones, steps, summaries, previous] = await Promise.all([
    prebuilt?.timeline ?? getCareerTimeline(userId),
    weekStartOf(db, userId),
    db.xPTransaction.findMany({
      where: { userId, createdAt: within },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true, amount: true, source: true, levelAfter: true },
    }),
    db.xPTransaction.findFirst({
      where: { userId, createdAt: { lt: window.start } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { levelAfter: true },
    }),
    db.achievementProgress.findMany({
      where: { userId, unlockedAt: within },
      select: { unlockedAt: true, achievement: { select: { key: true, name: true, rarity: true, xpReward: true } } },
    }),
    // Dated by when they happened, or by when they were recorded where history cannot say.
    db.milestoneProgress.findMany({
      where: { userId, OR: [{ achievedAt: within }, { achievedAt: null, reachedAt: within }] },
      select: {
        metric: true, threshold: true, reachedAt: true, achievedAt: true, achievedPrecision: true, xpAwarded: true,
        raceId: true, eventId: true, subjectName: true,
      },
    }),
    db.masteryProgress.findMany({
      where: { userId, unlockedAt: { not: null }, OR: [{ achievedAt: within }, { achievedAt: null, unlockedAt: within }] },
      select: {
        unlockedAt: true, achievedAt: true,
        node: { select: { key: true, name: true, tree: { select: { key: true, name: true, kind: true, iconicKey: true } } } },
      },
    }),
    db.expeditionSummary.findMany({
      where: { userId, completedAt: within },
      select: { id: true, raceId: true, raceName: true, completedAt: true, snapshot: true },
    }),
    db.chronicleYear.findUnique({ where: { userId_year: { userId, year: year - 1 } }, select: { snapshot: true } }),
  ]);

  // -- Milestones: the catalogue's, and the lifetime ladders' ----------------
  const careerMilestones: ChapterCareerMilestone[] = [];
  const ladderRungs: ChapterLadderRung[] = [];
  for (const row of milestones) {
    const match = careerMilestoneOfRow(row.metric, row.threshold);
    if (match !== null) {
      careerMilestones.push({
        id: match.year === undefined ? match.def.id : `${match.def.id}:${match.year}`,
        title: careerMilestoneTitle(match.def, match.year),
        celebration: match.def.celebration,
        row,
      });
      continue;
    }
    const label = LADDER_LABELS.get(row.metric);
    if (label !== undefined) ladderRungs.push({ metric: row.metric, label, row });
  }
  const eventIds = [...new Set(careerMilestones.flatMap((milestone) => (milestone.row.eventId === null ? [] : [milestone.row.eventId])))];
  const eventKeyById = new Map(eventIds.length === 0
    ? []
    : (await db.raceMastery.findMany({ where: { userId, id: { in: eventIds } }, select: { id: true, key: true } }))
        .map((event) => [event.id, event.key] as const));

  // -- Mastery steps: the originals only, with what each actually paid -------
  const unlocked = steps.flatMap((step) => (step.unlockedAt === null ? [] : [{ ...step, unlockedAt: step.unlockedAt }]));
  const carried = await carriedEventStepCopies(db, userId, unlocked.map((step) => ({
    treeKey: step.node.tree.key, nodeKey: step.node.key, unlockedAt: step.unlockedAt,
  })));
  const reached = unlocked.filter((step) => !carried.has(`${step.node.tree.key}:${step.node.key}`));
  const paid = await masteryPaid(db, userId, reached.map((step) => `mastery:${step.node.tree.key}:${step.node.key}`));
  const masterySteps: ChapterMasteryStep[] = reached.map((step) => ({
    treeKey: step.node.tree.key,
    treeName: step.node.tree.name,
    eventKey: step.node.tree.kind === 'RACE_EVENT' ? step.node.tree.iconicKey : null,
    nodeKey: step.node.key,
    nodeName: step.node.name,
    at: step.achievedAt ?? step.unlockedAt,
    xp: paid.get(`mastery:${step.node.tree.key}:${step.node.key}`) ?? 0,
  }));

  // -- Expeditions: the figures from each summary's own snapshot ---------------
  const expeditions: ChapterExpeditionRow[] = summaries.flatMap((row) => {
    const snapshot = parseExpeditionSummarySnapshot(row.snapshot);
    return snapshot === null
      ? []
      : [{
          summaryId: row.id, raceId: row.raceId, raceName: row.raceName, completedAt: row.completedAt,
          creditedSeconds: snapshot.creditedSeconds, calendarDays: snapshot.calendarDays,
        }];
  });

  // -- The year before -------------------------------------------------------------
  let previousYearFrozen: ChronicleChapterV1 | null = null;
  if (previous !== null) {
    try {
      previousYearFrozen = upgradeChapterSnapshot(previous.snapshot);
    } catch (error) {
      // A chapter this build cannot read is compared live instead.
      if (!(error instanceof UnreadableChapterError)) throw error;
    }
  }
  const previousYearXp = previousYearFrozen !== null
    ? 0
    : (await db.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: previousWindow.start, lt: previousWindow.end } },
        _sum: { amount: true },
      }))._sum.amount ?? 0;

  return buildChapter({
    year,
    complete: now >= window.end,
    generatedAt: now,
    timeZone: localTimeZoneName(),
    weekStartsOn,
    timeline,
    progression: prebuilt?.progression ?? progressionOf(timeline, weekStartsOn),
    ledger,
    levelAtStart: before?.levelAfter ?? 1,
    achievements: achievements.flatMap((row) => (row.unlockedAt === null ? [] : [{
      key: row.achievement.key, name: row.achievement.name, rarity: row.achievement.rarity,
      unlockedAt: row.unlockedAt, xp: row.achievement.xpReward,
    }])),
    careerMilestones,
    ladderRungs,
    masterySteps,
    expeditions,
    eventKeyById,
    previousYearFrozen,
    previousYearXp,
  });
}

/** What each mastery step's ledger row paid, by dedupe key; a step recorded XP-free has none. */
async function masteryPaid(db: Tx, userId: string, keys: readonly string[]): Promise<Map<string, number>> {
  const paid = new Map<string, number>();
  for (let index = 0; index < keys.length; index += ID_CHUNK) {
    const rows = await db.xPTransaction.findMany({
      where: { userId, dedupeKey: { in: keys.slice(index, index + ID_CHUNK) } },
      select: { dedupeKey: true, amount: true },
    });
    for (const row of rows) if (row.dedupeKey !== null) paid.set(row.dedupeKey, row.amount);
  }
  return paid;
}

// ---------------------------------------------------------------------------
// Freezing
// ---------------------------------------------------------------------------

/**
 * Freeze one finished year, inside the caller's transaction: its chapter is
 * built from the history as it stands and written once. True when this call
 * wrote it; a year already frozen is left exactly as it is, and a writer that
 * got there first is never an error (`update: {}`).
 */
export async function freezeYear(
  tx: Tx,
  userId: string,
  year: number,
  now: Date,
  prebuilt: { timeline: CareerTimeline; progression: readonly RecordEvent[] },
): Promise<boolean> {
  const existing = await tx.chronicleYear.findUnique({ where: { userId_year: { userId, year } }, select: { id: true } });
  if (existing !== null) return false;
  const chapter = await buildChapterData(userId, year, now, { db: tx, ...prebuilt });
  await tx.chronicleYear.upsert({
    where: { userId_year: { userId, year } },
    create: { userId, year, schemaVersion: chapter.schemaVersion, snapshot: chapter, frozenAt: now },
    update: {},
  });
  return true;
}

/**
 * Freeze every finished year of an account that is due (§4.5.2), oldest
 * first, each in its own transaction, and say which were frozen.
 *
 * Nothing happens until the account's 0.4.0 backfill is complete. The replay
 * and record progression are built once, and only when a year is actually
 * due, so the call every page and every write makes first is three small
 * reads when there is nothing to do.
 */
export async function ensureChroniclesFrozen(userId: string, now: Date): Promise<number[]> {
  if (!(await isCareerBackfillApplied(userId))) return [];
  const due = await yearsToFreeze(prisma, userId, now);
  if (due.length === 0) return [];

  const timeline = await getCareerTimeline(userId);
  const progression = progressionOf(timeline, await weekStartOf(prisma, userId));
  const frozen: number[] = [];
  for (const year of due) {
    const written = await prisma.$transaction(
      (tx) => freezeYear(tx as Tx, userId, year, now, { timeline, progression }),
      FREEZE_TRANSACTION,
    );
    if (written) frozen.push(year);
  }
  return frozen;
}

/**
 * Rewrite a frozen chapter from today's history — the only way a frozen year
 * changes, and only ever on request (the chapter page, `db:recompute
 * --rebuild-chronicle`). It keeps when the year was frozen and whether its
 * Wrapped was seen, and records when it was rebuilt. False when the year is
 * not frozen, so there is nothing to rebuild.
 */
export async function rebuildChronicleYear(userId: string, year: number, now: Date): Promise<boolean> {
  const row = await prisma.chronicleYear.findUnique({ where: { userId_year: { userId, year } }, select: { id: true } });
  if (row === null) return false;
  const timeline = await getCareerTimeline(userId);
  const progression = progressionOf(timeline, await weekStartOf(prisma, userId));
  return prisma.$transaction(async (tx) => {
    const chapter = await buildChapterData(userId, year, now, { db: tx as Tx, timeline, progression });
    const { count } = await tx.chronicleYear.updateMany({
      where: { userId, year },
      data: { snapshot: chapter, schemaVersion: chapter.schemaVersion, rebuiltAt: now },
    });
    return count > 0;
  }, FREEZE_TRANSACTION);
}

// ---------------------------------------------------------------------------
// Wrapped and its prompt
// ---------------------------------------------------------------------------

/**
 * A frozen year's Wrapped was clicked through to its last card, or hidden
 * from the prompt. Only a frozen year is marked: a preview of the year in
 * progress, or of a year still finalising, never is. True when this call
 * marked it.
 */
export async function markWrappedSeen(userId: string, year: number, now: Date): Promise<boolean> {
  const { count } = await prisma.chronicleYear.updateMany({
    where: { userId, year, wrappedSeenAt: null },
    data: { wrappedSeenAt: now },
  });
  return count > 0;
}

/**
 * The year whose Wrapped is ready and not yet seen: last year, once it is
 * frozen. Finished years are frozen first, so the dashboard's prompt never
 * waits for a visit to the Chronicle. A year that cannot be frozen now stays
 * live and is simply not announced yet; the next Chronicle page or write
 * freezes it, and logs why if it cannot.
 */
export async function pendingWrapped(userId: string, now: Date): Promise<{ year: number } | null> {
  await ensureChroniclesFrozen(userId, now).catch(() => []);
  const row = await prisma.chronicleYear.findFirst({
    where: { userId, year: now.getFullYear() - 1, wrappedSeenAt: null },
    select: { year: true },
  });
  return row === null ? null : { year: row.year };
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/** What a year's card leads with: its most-watched championship or event, whichever held more of it. */
export interface ChronicleTop {
  kind: 'championship' | 'event';
  name: string;
}

export interface ChronicleIndexChapter {
  kind: 'chapter';
  year: number;
  careerYear: number;
  state: ChapterState;
  /** While a finished year is inside its grace period: when it is settled. */
  settlesOn: Date | null;
  creditedSeconds: number;
  racesExperienced: number;
  storyCompletes: number;
  top: ChronicleTop | null;
  /** Nothing logged in it yet: the year in progress before its first stint. */
  empty: boolean;
  wrappedSeen: boolean;
  /** A frozen chapter saved by a newer version, which this build cannot read. */
  unreadable: boolean;
}

/** A year between active ones with nothing in it: a quiet line, with no chapter and no Wrapped. */
export interface ChronicleIndexQuietYear {
  kind: 'quiet';
  year: number;
  careerYear: number;
}

export interface ChronicleIndexView {
  currentYear: number;
  /** Newest first. Empty for a career with no stints yet. */
  years: (ChronicleIndexChapter | ChronicleIndexQuietYear)[];
  /** Last year's Wrapped, frozen and not yet seen. */
  pendingWrapped: { year: number } | null;
}

function topOf(championships: readonly Pick<GroupRow, 'id' | 'name' | 'creditedSeconds'>[], events: readonly Pick<GroupRow, 'name' | 'creditedSeconds'>[]): ChronicleTop | null {
  const championship = championships.find((row) => row.id !== null && row.creditedSeconds > 0);
  const event = events.find((row) => row.creditedSeconds > 0);
  if (event !== undefined && (championship === undefined || event.creditedSeconds > championship.creditedSeconds)) {
    return { kind: 'event', name: event.name };
  }
  return championship === undefined ? null : { kind: 'championship', name: championship.name };
}

/**
 * Every year of the Chronicle, newest first (§4.5.1). A frozen year is read
 * from its chapter; the year in progress, and a finished year still
 * finalising, are summarised live from the replay; a quiet year between
 * active ones is a line of its own. The career-year number is worked out now,
 * never stored. Freeze what is due before calling this.
 */
export async function getChronicleIndex(userId: string, now: Date): Promise<ChronicleIndexView> {
  const currentYear = now.getFullYear();
  const [rows, timeline, weekStartsOn] = await Promise.all([
    prisma.chronicleYear.findMany({ where: { userId }, select: { year: true, snapshot: true, wrappedSeenAt: true } }),
    getCareerTimeline(userId),
    weekStartOf(prisma, userId),
  ]);
  const frozenYears = rows.map((row) => row.year);
  const firstYears = [firstActivityYear(timeline), ...frozenYears].filter((year): year is number => year !== null);
  const pending = rows.find((row) => row.year === currentYear - 1 && row.wrappedSeenAt === null);
  if (firstYears.length === 0) return { currentYear, years: [], pendingWrapped: null };

  const firstYear = Math.min(...firstYears);
  const active = activeYears(timeline);
  const frozen = new Map(rows.map((row) => [row.year, row]));
  const years: ChronicleIndexView['years'] = [];

  for (let year = Math.max(currentYear, firstYear); year >= firstYear; year -= 1) {
    const careerYear = year - firstYear + 1;
    const row = frozen.get(year);
    if (row !== undefined) {
      let chapter: ChronicleChapterV1 | null = null;
      try {
        chapter = upgradeChapterSnapshot(row.snapshot);
      } catch (error) {
        if (!(error instanceof UnreadableChapterError)) throw error;
      }
      years.push({
        kind: 'chapter', year, careerYear, state: 'frozen', settlesOn: null,
        creditedSeconds: chapter?.summary.creditedSeconds ?? 0,
        racesExperienced: chapter?.summary.racesExperienced ?? 0,
        storyCompletes: chapter?.summary.storyCompletes ?? 0,
        top: chapter === null ? null : topOf(chapter.championships, chapter.events),
        empty: false,
        wrappedSeen: row.wrappedSeenAt !== null,
        unreadable: chapter === null,
      });
      continue;
    }

    const inProgress = year === currentYear;
    if (!inProgress && !active.has(year)) {
      years.push({ kind: 'quiet', year, careerYear });
      continue;
    }
    const summary = summariseWindow(timeline, yearWindow(year), chapterWindowOptions(weekStartsOn));
    const due = freezeDueAt(year);
    years.push({
      kind: 'chapter', year, careerYear,
      state: inProgress ? 'year-to-date' : 'finalising',
      settlesOn: !inProgress && now < due ? due : null,
      creditedSeconds: summary.creditedSeconds,
      racesExperienced: summary.racesExperienced,
      storyCompletes: summary.storyCompletes,
      top: topOf(summary.byChampionship, summary.byEvent),
      empty: !active.has(year),
      wrappedSeen: false,
      unreadable: false,
    });
  }

  return { currentYear, years, pendingWrapped: pending === undefined ? null : { year: pending.year } };
}

// ---------------------------------------------------------------------------
// One chapter
// ---------------------------------------------------------------------------

/** An Expedition completed in the year, read from its immutable row for the chapter's full card. */
export interface ChapterExpeditionSummary {
  id: string;
  raceId: string | null;
  retrospective: boolean;
  snapshot: ExpeditionSummarySnapshotV1;
  /** The championship's colour, while the race is still in the library. */
  accent: string | null;
}

export interface ChronicleChapterView {
  chapter: ChronicleChapterV1;
  careerYear: number;
  state: ChapterState;
  frozen: { frozenAt: Date; rebuiltAt: Date | null } | null;
  wrappedSeen: boolean;
  /** The chapters either side, skipping quiet years; null where there is none. */
  neighbours: { previous: number | null; next: number | null };
  /** While a finished year is inside its grace period: when it is settled. */
  settlesOn: Date | null;
  /** For each of `chapter.records`, when a later record beat it (ISO); null while it still stands. */
  recordsBeaten: (string | null)[];
  expeditionSummaries: ChapterExpeditionSummary[];
  /** The races the chapter names that are still in the library, so only they are links. */
  raceIdsInLibrary: string[];
  /** Each event the chapter names, by key, and where its page is. */
  eventHrefs: Record<string, string>;
}

/** Every event key a chapter names. */
function eventKeysNamedIn(chapter: ChronicleChapterV1): string[] {
  const keys = new Set<string>();
  for (const event of chapter.events) if (event.key !== null) keys.add(event.key);
  for (const step of chapter.milestones.eventLegacy) keys.add(step.eventKey);
  for (const milestone of chapter.milestones.career) {
    if (milestone.subjectKind === 'event' && milestone.subjectId !== null) keys.add(milestone.subjectId);
  }
  if (chapter.beginnings?.firstEventEdition) keys.add(chapter.beginnings.firstEventEdition.eventKey);
  return [...keys];
}

/** Every race id a chapter names. */
function raceIdsNamedIn(chapter: ChronicleChapterV1): string[] {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id !== null && id !== undefined) ids.add(id);
  };
  add(chapter.viewing.longestRace?.raceId);
  add(chapter.viewing.longestSession?.raceId);
  add(chapter.beginnings?.firstStint?.raceId);
  add(chapter.beginnings?.firstStoryComplete?.raceId);
  for (const race of chapter.notableRaces) add(race.raceId);
  for (const race of chapter.storyComplete.list) add(race.raceId);
  for (const record of chapter.records) add(record.raceId);
  for (const expedition of chapter.expeditions) add(expedition.raceId);
  for (const milestone of chapter.milestones.career) if (milestone.subjectKind === 'race') add(milestone.subjectId);
  return [...ids];
}

/**
 * One year's chapter, for its page and its Wrapped (§4.5.1): frozen, or built
 * live, with what depends on today worked out now. Null for a year that is
 * not a whole number, is after this one, or is before the career's first.
 * A frozen chapter this build cannot read throws `UnreadableChapterError`.
 * Freeze what is due before calling this.
 */
export async function getChronicleChapter(userId: string, year: number, now: Date): Promise<ChronicleChapterView | null> {
  const currentYear = now.getFullYear();
  if (!Number.isInteger(year) || year > currentYear) return null;

  const [timeline, weekStartsOn, row, frozenRows] = await Promise.all([
    getCareerTimeline(userId),
    weekStartOf(prisma, userId),
    prisma.chronicleYear.findUnique({
      where: { userId_year: { userId, year } },
      select: { snapshot: true, frozenAt: true, rebuiltAt: true, wrappedSeenAt: true },
    }),
    prisma.chronicleYear.findMany({ where: { userId }, select: { year: true } }),
  ]);
  const firstYears = [firstActivityYear(timeline), ...frozenRows.map((frozen) => frozen.year)]
    .filter((candidate): candidate is number => candidate !== null);
  if (firstYears.length === 0) return null;
  const firstYear = Math.min(...firstYears);
  if (year < firstYear) return null;

  const progression = progressionOf(timeline, weekStartsOn);
  const chapter = row !== null
    ? upgradeChapterSnapshot(row.snapshot)
    : await buildChapterData(userId, year, now, { db: prisma, timeline, progression });
  const state: ChapterState = row !== null ? 'frozen' : year === currentYear ? 'year-to-date' : 'finalising';

  // The chapters either side: frozen years, years with something in them, and the year in progress.
  const chapters = new Set<number>([...activeYears(timeline), ...frozenRows.map((frozen) => frozen.year), currentYear]);
  let previous: number | null = null;
  for (let candidate = year - 1; candidate >= firstYear; candidate -= 1) {
    if (chapters.has(candidate)) {
      previous = candidate;
      break;
    }
  }
  let next: number | null = null;
  for (let candidate = year + 1; candidate <= currentYear; candidate += 1) {
    if (chapters.has(candidate)) {
      next = candidate;
      break;
    }
  }

  const summaryIds = chapter.expeditions.map((expedition) => expedition.summaryId);
  const [summaryRows, raceIdsInLibrary] = await Promise.all([
    summaryIds.length === 0
      ? Promise.resolve([])
      : prisma.expeditionSummary.findMany({
          where: { userId, id: { in: summaryIds } },
          select: {
            id: true, raceId: true, retrospective: true, snapshot: true,
            race: { select: { championship: { select: { accentColor: true } } } },
          },
        }),
    racesInLibrary(userId, raceIdsNamedIn(chapter)),
  ]);
  const byId = new Map(summaryRows.map((summary) => [summary.id, summary]));
  const expeditionSummaries = summaryIds.flatMap((id): ChapterExpeditionSummary[] => {
    const summary = byId.get(id);
    const snapshot = summary === undefined ? null : parseExpeditionSummarySnapshot(summary.snapshot);
    return summary === undefined || snapshot === null
      ? []
      : [{
          id, raceId: summary.raceId, retrospective: summary.retrospective, snapshot,
          accent: summary.race?.championship?.accentColor ?? null,
        }];
  });

  const due = freezeDueAt(year);
  return {
    chapter,
    careerYear: year - firstYear + 1,
    state,
    frozen: row === null ? null : { frozenAt: row.frozenAt, rebuiltAt: row.rebuiltAt },
    wrappedSeen: row !== null && row.wrappedSeenAt !== null,
    neighbours: { previous, next },
    settlesOn: state === 'finalising' && now < due ? due : null,
    recordsBeaten: chapter.records.map((record) => (
      beatenAfter(progression, { kind: record.kind, at: new Date(record.at), value: record.value })?.at.toISOString() ?? null
    )),
    expeditionSummaries,
    raceIdsInLibrary,
    eventHrefs: Object.fromEntries(eventKeysNamedIn(chapter).map((key) => [key, eventHref(key)])),
  };
}

/** Which of these races are still in the account's library. */
async function racesInLibrary(userId: string, ids: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const rows = await prisma.race.findMany({
      where: { userId, id: { in: ids.slice(index, index + ID_CHUNK) } },
      select: { id: true },
    });
    for (const row of rows) found.push(row.id);
  }
  return found;
}
