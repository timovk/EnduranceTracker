/**
 * The Career Chronicle and Endurance Wrapped (0.4.0): a chapter for every
 * calendar year of a career, and the cards that celebrate it.
 *
 * A chapter is built from the canonical sources and nothing else: the career
 * replay for everything watched (`summariseWindow`, the same fold Career
 * Statistics reads, so a chapter and the Statistics page filtered to its year
 * can never disagree), the record progression for the records set in it, and
 * the rows the engines wrote for what the year paid and reached — the ledger,
 * achievements, milestones, mastery steps and Expedition Summaries.
 *
 * A finished year is frozen as a `ChronicleChapterV1` snapshot (§4.5.2), so a
 * later edit, a deleted race or a change of time zone never rewrites it. The
 * snapshot is JSON: dates are ISO strings, and names are the ones things had
 * when the chapter was written, with their ids kept for links. Anything that
 * depends on today — the career-year number, whether a record has since been
 * beaten, the full Expedition Summary cards — is not in it; the page works
 * those out when it is shown.
 *
 * Wrapped is a fixed sequence of cards drawn from a chapter. A card with
 * nothing behind it is left out, and nothing is ever invented to fill one.
 *
 * Pure and deterministic.
 */

import { z } from 'zod';
import { CAREER_STATS_SHAPE, CHRONICLE_SHAPE } from '@/lib/config';
import type { LocalWindow } from './calendar';
import { clipToWindow, localDaysSpanned, weekLabel, yearWindow } from './calendar';
import type { CareerTimeline, RaceHistory } from './career-timeline';
import { coverageAt } from './career-timeline';
import { editionIdentityOf } from './edition';
import { titleForLevel } from './progression';
import { currentRecords, RECORD_ORDER, recordsSetIn, recordValueText, type RecordEvent } from './records';
import { formatDuration, formatElapsed } from './time';
import { RARITY_ORDER, type MilestonePrecision, type Rarity } from './types';
import type { GroupRow, WindowSummary } from './window-summary';
import { summariseWindow } from './window-summary';

// ---------------------------------------------------------------------------
// The frozen chapter
// ---------------------------------------------------------------------------

const rarityEnum = z.enum(RARITY_ORDER);
const recordKindEnum = z.enum(RECORD_ORDER);
const precisionEnum = z.enum(['INTERPOLATED', 'STINT', 'RECOGNISED']);

/** Why a race is among a chapter's notable races. */
export const NOTABLE_REASONS = [
  'longest-story', 'most-watched', 'expedition', 'most-stints', 'first-edition', 'longest-journey',
] as const;
export type NotableReason = (typeof NOTABLE_REASONS)[number];
const notableReasonEnum = z.enum(NOTABLE_REASONS);

/** A championship, event or circuit row of a chapter. */
const groupRowJson = z.object({
  id: z.string().nullable(),
  name: z.string(),
  accent: z.string().nullable(),
  creditedSeconds: z.number(),
  racesExperienced: z.number(),
  storyCompletes: z.number(),
  share: z.number(),
});

/**
 * One calendar year of a career, as it is frozen in `ChronicleYear.snapshot`.
 *
 * Every list is stored in full — a heavy year is a few hundred races — so a
 * frozen year's "Show all" is as honest as a live one's.
 */
export const chronicleChapterSchema = z.object({
  schemaVersion: z.literal(CHRONICLE_SHAPE.snapshotSchemaVersion),
  year: z.number(),
  /** The year is over. A year still under way is a chapter being written. */
  complete: z.boolean(),
  generatedAt: z.string(),
  /** The calendar the chapter was counted in: the computer's time zone, and the week start. */
  timeZone: z.string(),
  weekStartsOn: z.number(),
  /** `activeFrom`: the first stint's instant in the year. */
  window: z.object({ start: z.string(), end: z.string(), activeFrom: z.string().nullable() }),
  /** Filled only in the career's first year: how it began. */
  beginnings: z.object({
    firstStint: z.object({ at: z.string(), raceId: z.string(), raceName: z.string() }).nullable(),
    firstStoryComplete: z.object({ at: z.string(), raceId: z.string(), raceName: z.string() }).nullable(),
    firstEventEdition: z.object({ at: z.string(), eventKey: z.string(), eventName: z.string(), raceName: z.string() }).nullable(),
  }).nullable(),
  summary: z.object({
    creditedSeconds: z.number(), newCoverageSeconds: z.number(), rewatchSeconds: z.number(), sessions: z.number(),
    activeDays: z.number(), racesExperienced: z.number(), racesStarted: z.number(), storyCompletes: z.number(),
    championshipsWatched: z.number(), eventsWatched: z.number(), completionPercent: z.number().nullable(),
    xpEarned: z.number(), levelStart: z.number(), levelEnd: z.number(), levelsGained: z.number(),
    achievementsUnlocked: z.number(), milestonesReached: z.number(), masteryStepsUnlocked: z.number(), masteryXp: z.number(),
    expeditionsCompleted: z.number(),
  }),
  viewing: z.object({
    /** The longest race experienced in the year, and how much of it had been seen by the year's end. */
    longestRace: z.object({
      raceId: z.string(), name: z.string(), runtimeSec: z.number(), storyComplete: z.boolean(), coverageSeconds: z.number(),
    }).nullable(),
    longestSession: z.object({ raceId: z.string(), raceName: z.string(), at: z.string(), creditedSeconds: z.number() }).nullable(),
    averageSessionSeconds: z.number().nullable(),
    mostActiveDay: z.object({ dayKey: z.string(), seconds: z.number() }).nullable(),
    mostActiveWeek: z.object({
      weekKey: z.string(), label: z.string(), start: z.string(), end: z.string(), clipped: z.boolean(), seconds: z.number(),
    }).nullable(),
    mostActiveMonth: z.object({ month: z.number(), label: z.string(), seconds: z.number() }).nullable(),
    /** Index 0 = Sunday, as `Date.getDay()`. */
    weekdaySeconds: z.array(z.number()),
  }),
  /** Always twelve. */
  monthly: z.array(z.object({
    month: z.number(), label: z.string(), creditedSeconds: z.number(), newCoverageSeconds: z.number(),
    sessions: z.number(), activeDays: z.number(), storyCompletes: z.number(), xpEarned: z.number(),
  })),
  championships: z.array(groupRowJson),
  /** `id` is the event's own id, `key` its permanent key, which is what links use. */
  events: z.array(groupRowJson.extend({ key: z.string().nullable(), editionsExperienced: z.number() })),
  circuits: z.array(groupRowJson),
  storyComplete: z.object({
    count: z.number(),
    byDurationClass: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
    byChampionship: z.array(z.object({ name: z.string(), count: z.number() })),
    averageStintsPerStory: z.number().nullable(),
    averageDaysToComplete: z.number().nullable(),
    /** Of the races started in the year, the share complete by its end, 0–100; null below `rateMinimumRaces`. */
    rate: z.number().nullable(),
    list: z.array(z.object({ raceId: z.string(), name: z.string(), at: z.string(), runtimeSec: z.number() })),
  }),
  mastery: z.object({
    steps: z.array(z.object({
      treeKey: z.string(), treeName: z.string(), nodeKey: z.string(), nodeName: z.string(), at: z.string(), xp: z.number(),
    })),
    xp: z.number(),
  }),
  achievements: z.array(z.object({ key: z.string(), name: z.string(), rarity: rarityEnum, at: z.string(), xp: z.number() })),
  milestones: z.object({
    /** `subjectId` is the race's id, or the event's key. */
    career: z.array(z.object({
      id: z.string(), title: z.string(), at: z.string(), precision: precisionEnum, xp: z.number(),
      celebration: z.enum(['none', 'notable', 'spectacular']), subjectName: z.string().nullable(),
      subjectId: z.string().nullable(), subjectKind: z.enum(['race', 'event']).nullable(),
    })),
    ladder: z.array(z.object({ metric: z.string(), label: z.string(), threshold: z.number(), at: z.string() })),
    eventLegacy: z.array(z.object({
      eventKey: z.string(), eventName: z.string(), nodeKey: z.string(), nodeName: z.string(), at: z.string(),
    })),
  }),
  /** The best set of each kind in the year, in `RECORD_ORDER`. */
  records: z.array(z.object({
    kind: recordKindEnum, label: z.string(), value: z.number(), valueText: z.string(), at: z.string(), raceId: z.string().nullable(),
  })),
  notableRaces: z.array(z.object({ raceId: z.string(), name: z.string(), reason: notableReasonEnum, detail: z.string() })),
  expeditions: z.array(z.object({
    summaryId: z.string(), raceId: z.string().nullable(), raceName: z.string(), completedAt: z.string(),
    creditedSeconds: z.number(), calendarDays: z.number(),
  })),
  progression: z.object({
    xpBySource: z.array(z.object({ source: z.string(), amount: z.number() })),
    levelsReached: z.array(z.object({ level: z.number(), at: z.string() })),
    titlesReached: z.array(z.string()),
  }),
  previousYear: z.object({
    year: z.number(), activeFrom: z.string().nullable(), careerBeganInYear: z.boolean(),
    creditedSeconds: z.number(), racesExperienced: z.number(), storyCompletes: z.number(), xpEarned: z.number(),
    averageSessionSeconds: z.number().nullable(),
  }).nullable(),
});
export type ChronicleChapterV1 = z.infer<typeof chronicleChapterSchema>;

/** A stored chapter this build cannot read: saved by a newer version, or damaged. */
export class UnreadableChapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableChapterError';
  }
}

/**
 * A stored snapshot as the current chapter shape. Version 1 is read as it is;
 * a future version adds its upgrade branch here. Anything else throws
 * `UnreadableChapterError`, and the page says the chapter was saved by a newer
 * version rather than showing half of it.
 */
export function upgradeChapterSnapshot(raw: unknown): ChronicleChapterV1 {
  const parsed = chronicleChapterSchema.safeParse(raw);
  if (!parsed.success) throw new UnreadableChapterError('This chapter was saved by a newer version.');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// What a chapter is built from
// ---------------------------------------------------------------------------

/** A ledger row inside the year, in the ledger's own `(createdAt, id)` order. */
export interface ChapterLedgerRow {
  createdAt: Date;
  amount: number;
  source: string;
  levelAfter: number;
}

export interface ChapterAchievementRow {
  key: string;
  name: string;
  rarity: Rarity;
  unlockedAt: Date;
  xp: number;
}

/** A milestone row as it is stored: the chapter picks the ones reached in its year. */
export interface ChapterMilestoneRow {
  metric: string;
  threshold: number;
  reachedAt: Date | null;
  achievedAt: Date | null;
  achievedPrecision: MilestonePrecision | null;
  xpAwarded: number;
  raceId: string | null;
  eventId: string | null;
  subjectName: string | null;
}

/** A catalogue milestone, as the chapter needs it: resolved by the engine from its row. */
export interface ChapterCareerMilestone {
  id: string;
  title: string;
  celebration: 'none' | 'notable' | 'spectacular';
  row: ChapterMilestoneRow;
}

/** A lifetime-ladder rung, with the label its ladder reads with. */
export interface ChapterLadderRung {
  metric: string;
  label: string;
  row: ChapterMilestoneRow;
}

/** A mastery step unlocked in the year, dated `achievedAt ?? unlockedAt`, merge copies already left out. */
export interface ChapterMasteryStep {
  treeKey: string;
  treeName: string;
  /** The event's key, for a step of an event's tree. */
  eventKey: string | null;
  nodeKey: string;
  nodeName: string;
  at: Date;
  /** What the step actually paid: an event step reached on editions that had paid it elsewhere paid nothing. */
  xp: number;
}

export interface ChapterExpeditionRow {
  summaryId: string;
  raceId: string | null;
  raceName: string;
  completedAt: Date;
  creditedSeconds: number;
  calendarDays: number;
}

export interface ChapterInput {
  year: number;
  /** The year is over (`now` is past its end). */
  complete: boolean;
  generatedAt: Date;
  timeZone: string;
  weekStartsOn: number;
  timeline: CareerTimeline;
  /** The career's record progression, kept by `weekStartsOn`. */
  progression: readonly RecordEvent[];
  ledger: readonly ChapterLedgerRow[];
  /** The level after the last award before the year, or 1. */
  levelAtStart: number;
  achievements: readonly ChapterAchievementRow[];
  careerMilestones: readonly ChapterCareerMilestone[];
  ladderRungs: readonly ChapterLadderRung[];
  masterySteps: readonly ChapterMasteryStep[];
  expeditions: readonly ChapterExpeditionRow[];
  /** An event's key by its id, for a milestone that happened in an event. */
  eventKeyById: ReadonlyMap<string, string>;
  /** The chapter of the year before, when it is frozen: its figures are the ones compared with. */
  previousYearFrozen: ChronicleChapterV1 | null;
  /** XP the ledger dates in the year before, for when that year is not frozen. */
  previousYearXp: number;
}

// ---------------------------------------------------------------------------
// Building a chapter
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** The options every chapter summarises its year with. */
export function chapterWindowOptions(weekStartsOn: number) {
  return {
    weekStartsOn,
    meaningfulSessionSeconds: CAREER_STATS_SHAPE.meaningfulSessionMinutes * 60,
    rateMinimumRaces: CAREER_STATS_SHAPE.rateMinimumRaces,
  };
}

/** The local year of the career's first stint: Career Year 1. Null for a career with no stints. */
export function firstActivityYear(timeline: CareerTimeline): number | null {
  return timeline.stints[0]?.watchedAt.getFullYear() ?? null;
}

/**
 * Every year something happened in: a stint's instant, or any of the time its
 * window spreads over. A stint logged at 00:30 on 1 January that began on
 * 31 December is activity in both years.
 */
export function activeYears(timeline: CareerTimeline): Set<number> {
  const years = new Set<number>();
  for (const stint of timeline.stints) {
    for (let year = stint.startsAt.getFullYear(); year <= stint.watchedAt.getFullYear(); year += 1) years.add(year);
  }
  return years;
}

/** Whether the career began inside a year rather than on its first moment: its first year is not a whole one. */
export function careerBeganInYear(timeline: CareerTimeline, year: number): Date | null {
  const first = timeline.stints[0]?.watchedAt ?? null;
  if (first === null || first.getFullYear() !== year) return null;
  return first > yearWindow(year).start ? first : null;
}

const iso = (at: Date) => at.toISOString();
const byDate = (a: { at: Date }, b: { at: Date }) => a.at.getTime() - b.at.getTime();

/** The largest entry of a map by value; ties go to the smallest key, so the earliest period wins. */
function largest<K extends string | number>(entries: Iterable<[K, number]>): [K, number] | null {
  let best: [K, number] | null = null;
  for (const [key, value] of entries) {
    if (!(value > 0)) continue;
    if (best === null || value > best[1] || (value === best[1] && key < best[0])) best = [key, value];
  }
  return best;
}

/** Per race, what the year holds of it: its credited time inside the year, and its stints logged in it. */
interface RaceTally {
  history: RaceHistory;
  creditedSeconds: number;
  stints: number;
}

function raceTallies(timeline: CareerTimeline, window: LocalWindow): Map<string, RaceTally> {
  const tallies = new Map<string, RaceTally>();
  for (const stint of timeline.stints) {
    const history = timeline.races.get(stint.raceId);
    if (history === undefined) continue;
    const part = clipToWindow(stint.startsAt, stint.watchedAt, window);
    const inWindow = stint.watchedAt >= window.start && stint.watchedAt < window.end;
    if (part === null && !inWindow) continue;
    let tally = tallies.get(stint.raceId);
    if (tally === undefined) {
      tally = { history, creditedSeconds: 0, stints: 0 };
      tallies.set(stint.raceId, tally);
    }
    if (part !== null) tally.creditedSeconds += stint.creditedSeconds * part.fraction;
    if (inWindow) tally.stints += 1;
  }
  return tallies;
}

/** From a race's first stint to the stint that completed its story, never shorter than the time credited to it. */
function startToFinishSeconds(history: RaceHistory): number | null {
  if (history.storyCompletedAt === null || history.startedAt === null) return null;
  const completing = history.stints.find((stint) => stint.sessionId === history.completingSessionId);
  if (completing === undefined) return null;
  return Math.round(Math.max(
    (history.storyCompletedAt.getTime() - history.startedAt.getTime()) / 1000,
    completing.raceCreditedAfterSeconds,
  ));
}

function groupRow(row: GroupRow): z.infer<typeof groupRowJson> {
  return {
    id: row.id, name: row.name, accent: row.accent, creditedSeconds: row.creditedSeconds,
    racesExperienced: row.racesExperienced, storyCompletes: row.storyCompletes, share: row.share,
  };
}

function inYear(at: Date, window: LocalWindow): boolean {
  return at >= window.start && at < window.end;
}

/**
 * Build one year's chapter (§4.5.3). `input` holds what the engine loaded for
 * the year; everything watched comes from the replay.
 */
export function buildChapter(input: ChapterInput): ChronicleChapterV1 {
  const { year, timeline } = input;
  const window = yearWindow(year);
  const summary = summariseWindow(timeline, window, chapterWindowOptions(input.weekStartsOn));
  const lastInstant = new Date(window.end.getTime() - 1);
  const firstYear = firstActivityYear(timeline);

  // -- Races experienced in the year, as §3.1 counts them -------------------
  const experienced = summary.raceIdsWatched.filter((id) => {
    const at = timeline.races.get(id)?.experiencedAt ?? null;
    return at !== null && at < window.end;
  });

  // -- Viewing ----------------------------------------------------------------
  const longestRaceHistory = summary.longestRace === null ? undefined : timeline.races.get(summary.longestRace.raceId);
  const longestRace = summary.longestRace === null || longestRaceHistory === undefined
    ? null
    : {
        raceId: summary.longestRace.raceId,
        name: summary.longestRace.name,
        runtimeSec: summary.longestRace.runtimeSec,
        storyComplete: longestRaceHistory.storyCompletedAt !== null && longestRaceHistory.storyCompletedAt < window.end,
        coverageSeconds: Math.min(coverageAt(longestRaceHistory, lastInstant), summary.longestRace.runtimeSec),
      };

  const day = largest([...summary.days].map(([key, bucket]) => [key, bucket.creditedSeconds] as [string, number]));
  const week = largest([...summary.weeks].map(([key, bucket]) => [key, bucket.creditedSeconds] as [string, number]));
  const month = largest([...summary.months].map(([key, bucket]) => [key, bucket.creditedSeconds] as [string, number]));
  const weekShape = week === null ? null : weekLabel(week[0], input.weekStartsOn, window);

  // -- Months -------------------------------------------------------------------
  const xpByMonth = new Array<number>(12).fill(0);
  for (const row of input.ledger) {
    if (inYear(row.createdAt, window)) xpByMonth[row.createdAt.getMonth()]! += row.amount;
  }
  const activeDaysByMonth = new Array<number>(12).fill(0);
  for (const [key, bucket] of summary.days) {
    if (bucket.creditedSeconds > 0) activeDaysByMonth[Number.parseInt(key.slice(5, 7), 10) - 1]! += 1;
  }
  const monthly = MONTHS_SHORT.map((label, index) => {
    const bucket = summary.months.get(`${year}-${String(index + 1).padStart(2, '0')}`);
    return {
      month: index + 1,
      label,
      creditedSeconds: bucket?.creditedSeconds ?? 0,
      newCoverageSeconds: bucket?.newCoverageSeconds ?? 0,
      sessions: bucket?.sessions ?? 0,
      activeDays: activeDaysByMonth[index]!,
      storyCompletes: bucket?.storyCompletes ?? 0,
      xpEarned: xpByMonth[index]!,
    };
  });

  // -- Events -------------------------------------------------------------------
  const eventIdByKey = new Map<string, string>();
  for (const race of timeline.racesById.values()) {
    if (race.eventKey !== null && race.eventId !== null && !eventIdByKey.has(race.eventKey)) eventIdByKey.set(race.eventKey, race.eventId);
  }
  const editionsByEvent = new Map<string, Set<string>>();
  for (const id of experienced) {
    const race = timeline.racesById.get(id);
    if (race === undefined || race.eventKey === null) continue;
    const editions = editionsByEvent.get(race.eventKey) ?? new Set<string>();
    editions.add(editionIdentityOf(race.id, race.editionYear));
    editionsByEvent.set(race.eventKey, editions);
  }

  // -- Story Complete -------------------------------------------------------------
  const completed = summary.storyCompleteList
    .map((entry) => timeline.races.get(entry.raceId))
    .filter((history): history is RaceHistory => history !== undefined);
  const stintsToComplete = completed.flatMap((history) => {
    const index = history.stints.findIndex((stint) => stint.sessionId === history.completingSessionId);
    return index < 0 ? [] : [index + 1];
  });
  const daysToComplete = completed.flatMap((history) => (
    history.startedAt === null || history.storyCompletedAt === null
      ? []
      : [localDaysSpanned(history.startedAt, history.storyCompletedAt)]
  ));
  const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

  // -- XP and levels ------------------------------------------------------------
  const xpEarned = input.ledger.reduce((sum, row) => sum + row.amount, 0);
  const levelEnd = input.ledger.length === 0 ? input.levelAtStart : input.ledger[input.ledger.length - 1]!.levelAfter;
  const levelsReached: { level: number; at: string }[] = [];
  let highest = input.levelAtStart;
  for (const row of input.ledger) {
    // A single large award can carry a career through several levels at once;
    // each is reached at that award.
    for (let level = highest + 1; level <= row.levelAfter; level += 1) levelsReached.push({ level, at: iso(row.createdAt) });
    highest = Math.max(highest, row.levelAfter);
  }
  const titlesReached = levelsReached.flatMap(({ level }) => {
    const title = titleForLevel(level);
    return title.level === level ? [title.title] : [];
  });
  const bySource = new Map<string, number>();
  for (const row of input.ledger) bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.amount);
  const xpBySource = [...bySource]
    .filter(([, amount]) => amount !== 0)
    .map(([source, amount]) => ({ source, amount }))
    .sort((a, b) => b.amount - a.amount || (a.source < b.source ? -1 : 1));

  // -- Landmarks ------------------------------------------------------------------
  const landmarkDate = (row: ChapterMilestoneRow) => row.achievedAt ?? row.reachedAt;
  const careerMilestones = input.careerMilestones
    .flatMap((milestone) => {
      const at = landmarkDate(milestone.row);
      if (at === null || !inYear(at, window)) return [];
      const { row } = milestone;
      const eventKey = row.eventId === null ? null : input.eventKeyById.get(row.eventId) ?? null;
      const subjectKind: 'race' | 'event' | null = eventKey !== null ? 'event' : row.raceId !== null ? 'race' : null;
      return [{
        at,
        entry: {
          id: milestone.id,
          title: milestone.title,
          at: iso(at),
          // A row the upgrade has yet to date is known only by when it was recorded.
          precision: row.achievedPrecision ?? 'RECOGNISED',
          xp: row.xpAwarded,
          celebration: milestone.celebration,
          subjectName: row.subjectName,
          subjectId: subjectKind === 'event' ? eventKey : subjectKind === 'race' ? row.raceId : null,
          subjectKind,
        },
      }];
    })
    .sort((a, b) => byDate(a, b) || (a.entry.id < b.entry.id ? -1 : 1))
    .map(({ entry }) => entry);

  const ladder = input.ladderRungs
    .flatMap((rung) => {
      const at = landmarkDate(rung.row);
      return at === null || !inYear(at, window)
        ? []
        : [{ at, entry: { metric: rung.metric, label: rung.label, threshold: rung.row.threshold, at: iso(at) } }];
    })
    .sort((a, b) => byDate(a, b) || a.entry.metric.localeCompare(b.entry.metric) || a.entry.threshold - b.entry.threshold)
    .map(({ entry }) => entry);

  const steps = [...input.masterySteps]
    .filter((step) => inYear(step.at, window))
    .sort((a, b) => byDate(a, b) || a.treeKey.localeCompare(b.treeKey) || a.nodeKey.localeCompare(b.nodeKey));
  const masteryXp = steps.reduce((sum, step) => sum + step.xp, 0);

  const achievements = [...input.achievements]
    .filter((row) => inYear(row.unlockedAt, window))
    .sort((a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime() || a.key.localeCompare(b.key))
    .map((row) => ({ key: row.key, name: row.name, rarity: row.rarity, at: iso(row.unlockedAt), xp: row.xp }));

  const expeditions = [...input.expeditions]
    .filter((row) => inYear(row.completedAt, window))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.summaryId.localeCompare(b.summaryId));

  // -- Records: the best of each kind set in the year -------------------------------
  const records = currentRecords(recordsSetIn(input.progression, window)).map((record) => ({
    kind: record.kind,
    label: record.label,
    value: record.value,
    valueText: recordValueText(record),
    at: iso(record.at),
    raceId: record.raceId,
  }));

  return {
    schemaVersion: CHRONICLE_SHAPE.snapshotSchemaVersion,
    year,
    complete: input.complete,
    generatedAt: iso(input.generatedAt),
    timeZone: input.timeZone,
    weekStartsOn: input.weekStartsOn,
    window: {
      start: iso(window.start),
      end: iso(window.end),
      activeFrom: summary.activeFrom === null ? null : iso(summary.activeFrom),
    },
    beginnings: firstYear === year ? beginningsOf(timeline, window) : null,
    summary: {
      creditedSeconds: summary.creditedSeconds,
      newCoverageSeconds: summary.newCoverageSeconds,
      rewatchSeconds: summary.rewatchSeconds,
      sessions: summary.sessions,
      activeDays: summary.activeDays,
      racesExperienced: summary.racesExperienced,
      racesStarted: summary.racesStarted,
      storyCompletes: summary.storyCompletes,
      championshipsWatched: summary.championshipsWatched,
      eventsWatched: summary.eventsWatched,
      completionPercent: summary.completionPercent,
      xpEarned,
      levelStart: input.levelAtStart,
      levelEnd,
      levelsGained: Math.max(0, levelEnd - input.levelAtStart),
      achievementsUnlocked: achievements.length,
      milestonesReached: careerMilestones.length,
      masteryStepsUnlocked: steps.length,
      masteryXp,
      expeditionsCompleted: expeditions.length,
    },
    viewing: {
      longestRace,
      longestSession: summary.longestSession === null
        ? null
        : {
            raceId: summary.longestSession.raceId,
            raceName: summary.longestSession.raceName,
            at: iso(summary.longestSession.at),
            creditedSeconds: summary.longestSession.creditedSeconds,
          },
      averageSessionSeconds: summary.averageSessionSeconds,
      mostActiveDay: day === null ? null : { dayKey: day[0], seconds: day[1] },
      mostActiveWeek: week === null || weekShape === null
        ? null
        : {
            weekKey: week[0], label: weekShape.label, start: iso(weekShape.start), end: iso(weekShape.end),
            clipped: weekShape.clipped, seconds: week[1],
          },
      mostActiveMonth: month === null
        ? null
        : { month: Number.parseInt(month[0].slice(5, 7), 10), label: MONTHS_LONG[Number.parseInt(month[0].slice(5, 7), 10) - 1]!, seconds: month[1] },
      weekdaySeconds: summary.weekdays.map((bucket) => bucket.creditedSeconds),
    },
    monthly,
    championships: summary.byChampionship.map(groupRow),
    events: summary.byEvent.map((row) => ({
      ...groupRow(row),
      id: row.id === null ? null : eventIdByKey.get(row.id) ?? null,
      key: row.id,
      editionsExperienced: row.id === null ? 0 : editionsByEvent.get(row.id)?.size ?? 0,
    })),
    circuits: summary.byCircuit.map(groupRow),
    storyComplete: {
      count: summary.storyCompletes,
      byDurationClass: summary.byDurationClass
        .filter((row) => row.storyCompletes > 0)
        .map((row) => ({ key: row.id ?? '', label: row.name, count: row.storyCompletes })),
      byChampionship: summary.byChampionship
        .filter((row) => row.storyCompletes > 0)
        .map((row) => ({ name: row.name, count: row.storyCompletes }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      averageStintsPerStory: mean(stintsToComplete),
      averageDaysToComplete: mean(daysToComplete),
      rate: summary.storyCompleteRate,
      list: summary.storyCompleteList.map((entry) => ({
        raceId: entry.raceId, name: entry.name, at: iso(entry.at), runtimeSec: entry.runtimeSec,
      })),
    },
    mastery: {
      steps: steps.map((step) => ({
        treeKey: step.treeKey, treeName: step.treeName, nodeKey: step.nodeKey, nodeName: step.nodeName, at: iso(step.at), xp: step.xp,
      })),
      xp: masteryXp,
    },
    achievements,
    milestones: {
      career: careerMilestones,
      ladder,
      eventLegacy: steps.flatMap((step) => (
        step.eventKey === null
          ? []
          : [{ eventKey: step.eventKey, eventName: step.treeName, nodeKey: step.nodeKey, nodeName: step.nodeName, at: iso(step.at) }]
      )),
    },
    records,
    notableRaces: notableRaces(timeline, window, summary, expeditions),
    expeditions: expeditions.map((row) => ({
      summaryId: row.summaryId, raceId: row.raceId, raceName: row.raceName, completedAt: iso(row.completedAt),
      creditedSeconds: row.creditedSeconds, calendarDays: row.calendarDays,
    })),
    progression: { xpBySource, levelsReached, titlesReached },
    previousYear: previousYearOf(input, firstYear),
  };
}

/** How the career began, told in its first year: the first stint, the first complete story, the first edition. */
function beginningsOf(timeline: CareerTimeline, window: LocalWindow): ChronicleChapterV1['beginnings'] {
  const nameOf = (raceId: string) => timeline.racesById.get(raceId)?.name ?? '';
  const first = timeline.stints[0];
  const firstStory = timeline.stints.find((stint) => stint.completesStory);
  const firstEdition = timeline.stints.find((stint) => (
    stint.experiencesRace && (timeline.racesById.get(stint.raceId)?.eventKey ?? null) !== null
  ));
  const editionRace = firstEdition === undefined ? undefined : timeline.racesById.get(firstEdition.raceId);
  return {
    firstStint: first === undefined ? null : { at: iso(first.watchedAt), raceId: first.raceId, raceName: nameOf(first.raceId) },
    firstStoryComplete: firstStory === undefined || !inYear(firstStory.watchedAt, window)
      ? null
      : { at: iso(firstStory.watchedAt), raceId: firstStory.raceId, raceName: nameOf(firstStory.raceId) },
    firstEventEdition: firstEdition === undefined || editionRace === undefined || editionRace.eventKey === null
      || !inYear(firstEdition.watchedAt, window)
      ? null
      : {
          at: iso(firstEdition.watchedAt),
          eventKey: editionRace.eventKey,
          eventName: editionRace.eventName ?? editionRace.eventKey,
          raceName: editionRace.name,
        },
  };
}

/**
 * The year's notable races (§4.5.3): at most `notableRacesCount`, no race
 * twice, chosen in a fixed order so the same history always gives the same
 * list. Ties go to the race whose moment came first, then to the lower id.
 */
function notableRaces(
  timeline: CareerTimeline,
  window: LocalWindow,
  summary: WindowSummary,
  expeditions: readonly ChapterExpeditionRow[],
): ChronicleChapterV1['notableRaces'] {
  const limit = CHRONICLE_SHAPE.notableRacesCount;
  const year = window.start.getFullYear();
  const picked: ChronicleChapterV1['notableRaces'] = [];
  const used = new Set<string>();
  const add = (raceId: string, reason: NotableReason, detail: string) => {
    if (used.has(raceId) || picked.length >= limit) return;
    const race = timeline.racesById.get(raceId);
    if (race === undefined) return;
    used.add(raceId);
    picked.push({ raceId, name: race.name, reason, detail });
  };
  /** The best candidate by `value` (higher wins), ties to the earlier moment, then the lower id. */
  const best = <T extends { raceId: string; value: number; at: Date }>(candidates: readonly T[]): T | null => {
    let chosen: T | null = null;
    for (const candidate of candidates) {
      if (used.has(candidate.raceId)) continue;
      if (
        chosen === null
        || candidate.value > chosen.value
        || (candidate.value === chosen.value && (candidate.at < chosen.at || (candidate.at.getTime() === chosen.at.getTime() && candidate.raceId < chosen.raceId)))
      ) chosen = candidate;
    }
    return chosen;
  };

  const completed = summary.storyCompleteList.map((entry) => ({ raceId: entry.raceId, value: entry.runtimeSec, at: entry.at }));
  const tallies = raceTallies(timeline, window);

  // 1. The longest race completed in the year.
  const longest = best(completed);
  if (longest !== null) add(longest.raceId, 'longest-story', `The longest race you completed in ${year}: ${formatDuration(longest.value)}`);

  // 2. The most watched, by credited time inside the year.
  const watched = best([...tallies.values()]
    .filter((tally) => tally.creditedSeconds > 0)
    .map((tally) => ({ raceId: tally.history.race.id, value: tally.creditedSeconds, at: tally.history.firstStintAt ?? window.start })));
  if (watched !== null) add(watched.raceId, 'most-watched', `Your most-watched race of ${year}: ${formatDuration(watched.value)}`);

  // 3. Every Expedition completed, at most two.
  let expeditionsAdded = 0;
  for (const expedition of expeditions) {
    if (expeditionsAdded >= 2 || expedition.raceId === null || used.has(expedition.raceId)) continue;
    const days = expedition.calendarDays === 1 ? 'one day' : `${expedition.calendarDays.toLocaleString('en-GB')} calendar days`;
    const before = picked.length;
    add(expedition.raceId, 'expedition', `An Expedition completed over ${days}`);
    if (picked.length > before) expeditionsAdded += 1;
  }

  // 4. The race with the most stints in the year, from three.
  const stints = best([...tallies.values()]
    .filter((tally) => tally.stints >= 3)
    .map((tally) => ({ raceId: tally.history.race.id, value: tally.stints, at: tally.history.firstStintAt ?? window.start })));
  if (stints !== null) add(stints.raceId, 'most-stints', `${stints.value.toLocaleString('en-GB')} stints in ${year}`);

  // 5. The earliest first edition of an event experienced in the year.
  const firstEditions = new Map<string, RaceHistory>();
  for (const history of timeline.races.values()) {
    const key = history.race.eventKey;
    if (key === null || history.experiencedAt === null) continue;
    const known = firstEditions.get(key);
    if (known === undefined || history.experiencedAt < known.experiencedAt! || (
      history.experiencedAt.getTime() === known.experiencedAt!.getTime() && history.race.id < known.race.id
    )) firstEditions.set(key, history);
  }
  const edition = [...firstEditions.values()]
    .filter((history) => inYear(history.experiencedAt!, window) && !used.has(history.race.id))
    .sort((a, b) => a.experiencedAt!.getTime() - b.experiencedAt!.getTime() || (a.race.id < b.race.id ? -1 : 1))[0];
  if (edition !== undefined) {
    add(edition.race.id, 'first-edition', `Your first edition of ${edition.race.eventName ?? edition.race.eventKey} experienced`);
  }

  // 6. The completed race that took longest from its first stint to its complete story.
  const journey = best(summary.storyCompleteList.flatMap((entry) => {
    const history = timeline.races.get(entry.raceId);
    const elapsed = history === undefined ? null : startToFinishSeconds(history);
    return elapsed === null ? [] : [{ raceId: entry.raceId, value: elapsed, at: entry.at }];
  }));
  if (journey !== null) add(journey.raceId, 'longest-journey', `From first stint to complete story in ${formatElapsed(journey.value)}`);

  return picked;
}

/** The year before, for the comparison strip and Wrapped's last figures: from its frozen chapter, or live. */
function previousYearOf(input: ChapterInput, firstYear: number | null): ChronicleChapterV1['previousYear'] {
  const year = input.year - 1;
  if (firstYear === null || year < firstYear) return null;
  const began = careerBeganInYear(input.timeline, year) !== null;

  const frozen = input.previousYearFrozen;
  if (frozen !== null && frozen.year === year) {
    if (frozen.summary.sessions === 0 && frozen.summary.creditedSeconds === 0) return null;
    return {
      year,
      activeFrom: frozen.window.activeFrom,
      careerBeganInYear: began,
      creditedSeconds: frozen.summary.creditedSeconds,
      racesExperienced: frozen.summary.racesExperienced,
      storyCompletes: frozen.summary.storyCompletes,
      xpEarned: frozen.summary.xpEarned,
      averageSessionSeconds: frozen.viewing.averageSessionSeconds,
    };
  }

  // A year with nothing in it is only ever a quiet line in the Chronicle; there is nothing to compare with.
  const summary = summariseWindow(input.timeline, yearWindow(year), chapterWindowOptions(input.weekStartsOn));
  if (summary.sessions === 0 && summary.creditedSeconds === 0) return null;
  return {
    year,
    activeFrom: summary.activeFrom === null ? null : iso(summary.activeFrom),
    careerBeganInYear: began,
    creditedSeconds: summary.creditedSeconds,
    racesExperienced: summary.racesExperienced,
    storyCompletes: summary.storyCompletes,
    xpEarned: input.previousYearXp,
    averageSessionSeconds: summary.averageSessionSeconds,
  };
}

// ---------------------------------------------------------------------------
// Endurance Wrapped
// ---------------------------------------------------------------------------

/** How a chapter stands: still being written, finished but inside its grace period, or frozen. */
export type ChapterState = 'year-to-date' | 'finalising' | 'frozen';

interface CardBase {
  /** Set on every card of a year-to-date preview: when it was worked out. Null for a finished year. */
  asOf: string | null;
}

/** One figure compared with the year before. */
export interface WrappedComparison {
  /** As it reads mid-sentence: "hours watched", "XP earned". */
  label: string;
  unit: 'seconds' | 'count' | 'xp';
  a: number;
  b: number;
  difference: number;
  /** Only when the year before is big enough, and whole, for a percentage to mean something. */
  percentChange: number | null;
}

/**
 * One Wrapped card. The order is fixed (§4.5.4) and every card carries what
 * `wrappedCardLine` needs to say its one sentence about it.
 */
export type WrappedCard = CardBase & (
  | { kind: 'opening'; year: number; careerYear: number; complete: boolean; beginning: { at: string; raceName: string } | null }
  | { kind: 'hours'; creditedSeconds: number; activeDays: number; equivalentDays: number }
  | { kind: 'races'; racesExperienced: number; storyCompletes: number }
  | { kind: 'championship'; name: string; accent: string | null; creditedSeconds: number; share: number }
  | { kind: 'event'; name: string; key: string | null; creditedSeconds: number; editionsExperienced: number }
  | { kind: 'longest-race'; name: string; runtimeSec: number; storyComplete: boolean; coverageSeconds: number; year: number }
  | { kind: 'longest-session'; raceName: string; creditedSeconds: number; at: string }
  | { kind: 'circuit'; name: string; creditedSeconds: number; share: number }
  | {
      kind: 'active';
      month: { label: string; seconds: number } | null;
      week: { label: string; seconds: number; clipped: boolean } | null;
      year: number;
    }
  | { kind: 'xp'; xpEarned: number; levelStart: number; levelEnd: number; levelsGained: number }
  | { kind: 'landmarks'; achievements: number; milestones: number; masterySteps: number; highlights: string[] }
  | { kind: 'expeditions'; count: number; names: string[]; creditedSeconds: number }
  | { kind: 'records'; records: { label: string; valueText: string }[] }
  | { kind: 'compared'; year: number; previousYear: number; beganOn: string | null; rows: WrappedComparison[] }
  | { kind: 'closing'; year: number }
);
export type WrappedCardKind = WrappedCard['kind'];

const CELEBRATION_RANK = { spectacular: 0, notable: 1, none: 2 } as const;

/** Achievement rarity, rarest first. */
function rarityRank(rarity: Rarity): number {
  return RARITY_ORDER.length - RARITY_ORDER.indexOf(rarity);
}

/** A percentage change, only on a base large enough to carry one, and never against a year that was not whole. */
function percentChange(a: number, b: number, unit: WrappedComparison['unit'], partial: boolean): number | null {
  if (partial || !(a > 0)) return null;
  const base = CAREER_STATS_SHAPE.percentChangeMinimumBase;
  const enough = unit === 'seconds' ? a >= base.hours * 3600 : unit === 'xp' ? a >= base.xp : a >= base.count;
  return enough ? ((b - a) / a) * 100 : null;
}

/**
 * The cards of a year's Wrapped, in their fixed order (§4.5.4), each left out
 * when it has nothing behind it. In a year-to-date preview every card carries
 * the moment it was worked out, so no single card can be taken for the
 * finished year.
 */
export function buildWrappedCards(
  chapter: ChronicleChapterV1,
  options: { careerYear: number; state: ChapterState },
): WrappedCard[] {
  const asOf = options.state === 'year-to-date' ? chapter.generatedAt : null;
  const cards: WrappedCard[] = [];
  const { summary, viewing } = chapter;

  // 1. Opening.
  const first = chapter.beginnings?.firstStint ?? null;
  cards.push({
    asOf, kind: 'opening', year: chapter.year, careerYear: options.careerYear, complete: chapter.complete,
    beginning: options.careerYear === 1 && first !== null ? { at: first.at, raceName: first.raceName } : null,
  });

  // 2. Hours.
  if (summary.creditedSeconds > 0) {
    cards.push({
      asOf, kind: 'hours', creditedSeconds: summary.creditedSeconds, activeDays: summary.activeDays,
      equivalentDays: summary.creditedSeconds / 86_400,
    });
  }

  // 3. Races, always.
  cards.push({ asOf, kind: 'races', racesExperienced: summary.racesExperienced, storyCompletes: summary.storyCompletes });

  // 4. The most-watched championship: a real one, not the races without one.
  const championship = chapter.championships.find((row) => row.id !== null && row.creditedSeconds > 0);
  if (championship !== undefined) {
    cards.push({
      asOf, kind: 'championship', name: championship.name, accent: championship.accent,
      creditedSeconds: championship.creditedSeconds, share: championship.share,
    });
  }

  // 5. The most-watched recurring event.
  const event = chapter.events.find((row) => row.creditedSeconds > 0);
  if (event !== undefined) {
    cards.push({
      asOf, kind: 'event', name: event.name, key: event.key, creditedSeconds: event.creditedSeconds,
      editionsExperienced: event.editionsExperienced,
    });
  }

  // 6. The longest race.
  if (viewing.longestRace !== null) {
    cards.push({
      asOf, kind: 'longest-race', name: viewing.longestRace.name, runtimeSec: viewing.longestRace.runtimeSec,
      storyComplete: viewing.longestRace.storyComplete, coverageSeconds: viewing.longestRace.coverageSeconds, year: chapter.year,
    });
  }

  // 7. The longest session.
  if (viewing.longestSession !== null) {
    cards.push({
      asOf, kind: 'longest-session', raceName: viewing.longestSession.raceName,
      creditedSeconds: viewing.longestSession.creditedSeconds, at: viewing.longestSession.at,
    });
  }

  // 8. The favourite circuit, only when races with a circuit hold enough of the year to say so.
  const circuitShare = chapter.circuits.reduce((sum, row) => sum + row.share, 0);
  const circuit = chapter.circuits.find((row) => row.creditedSeconds > 0);
  if (circuit !== undefined && circuitShare >= CHRONICLE_SHAPE.favouriteCircuitMinimumShare) {
    cards.push({ asOf, kind: 'circuit', name: circuit.name, creditedSeconds: circuit.creditedSeconds, share: circuit.share });
  }

  // 9. The most active month and week.
  if (summary.sessions > 0 && (viewing.mostActiveMonth !== null || viewing.mostActiveWeek !== null)) {
    cards.push({
      asOf, kind: 'active', year: chapter.year,
      month: viewing.mostActiveMonth === null ? null : { label: viewing.mostActiveMonth.label, seconds: viewing.mostActiveMonth.seconds },
      week: viewing.mostActiveWeek === null
        ? null
        : { label: viewing.mostActiveWeek.label, seconds: viewing.mostActiveWeek.seconds, clipped: viewing.mostActiveWeek.clipped },
    });
  }

  // 10. XP and levels, always.
  cards.push({
    asOf, kind: 'xp', xpEarned: summary.xpEarned, levelStart: summary.levelStart, levelEnd: summary.levelEnd,
    levelsGained: summary.levelsGained,
  });

  // 11. Landmarks, with the loudest few named.
  if (summary.achievementsUnlocked > 0 || summary.milestonesReached > 0 || summary.masteryStepsUnlocked > 0) {
    const milestones = [...chapter.milestones.career]
      .sort((a, b) => CELEBRATION_RANK[a.celebration] - CELEBRATION_RANK[b.celebration] || a.at.localeCompare(b.at))
      .map((milestone) => milestone.title);
    const achievements = [...chapter.achievements]
      .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.at.localeCompare(b.at))
      .map((achievement) => achievement.name);
    cards.push({
      asOf, kind: 'landmarks', achievements: summary.achievementsUnlocked, milestones: summary.milestonesReached,
      masterySteps: summary.masteryStepsUnlocked, highlights: [...milestones, ...achievements].slice(0, 3),
    });
  }

  // 12. Expeditions completed.
  if (chapter.expeditions.length > 0) {
    cards.push({
      asOf, kind: 'expeditions', count: chapter.expeditions.length,
      names: chapter.expeditions.map((expedition) => expedition.raceName),
      creditedSeconds: chapter.expeditions.reduce((sum, expedition) => sum + expedition.creditedSeconds, 0),
    });
  }

  // 13. Personal records set, the first few in the order records are listed.
  if (chapter.records.length > 0) {
    cards.push({
      asOf, kind: 'records',
      records: chapter.records.slice(0, CHRONICLE_SHAPE.wrappedRecordsShown).map((record) => ({ label: record.label, valueText: record.valueText })),
    });
  }

  // 14. Compared with the year before.
  const previous = chapter.previousYear;
  if (previous !== null) {
    const partial = previous.careerBeganInYear;
    const row = (label: string, unit: WrappedComparison['unit'], a: number, b: number): WrappedComparison => ({
      label, unit, a, b, difference: b - a, percentChange: percentChange(a, b, unit, partial),
    });
    cards.push({
      asOf, kind: 'compared', year: chapter.year, previousYear: previous.year,
      beganOn: partial ? previous.activeFrom : null,
      rows: [
        row('hours watched', 'seconds', previous.creditedSeconds, summary.creditedSeconds),
        row('races experienced', 'count', previous.racesExperienced, summary.racesExperienced),
        row('complete race stories', 'count', previous.storyCompletes, summary.storyCompletes),
        row('XP earned', 'xp', previous.xpEarned, summary.xpEarned),
      ],
    });
  }

  // 15. Closing, always.
  cards.push({ asOf, kind: 'closing', year: chapter.year });
  return cards;
}
