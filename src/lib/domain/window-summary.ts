/**
 * One window of a career, summarised (0.4.0).
 *
 * The core the Career Chronicle, Career Statistics and the year comparison
 * share: give it the replay and a window of local time — a year, a stretch of
 * a year, or the whole career — and it says what happened in it. Because all
 * three read the same fold, a chapter, the Statistics page filtered to that
 * year, and a comparison of that year can never disagree.
 *
 * Two kinds of thing are counted, in two ways:
 *
 *   - Time (credited hours, new coverage, re-watch, timeline) is spread over
 *     each stint's window and split at local midnights, and only the part
 *     inside the window counts. A stint logged at 00:30 on 1 January that
 *     began on 31 December gives most of its hours to the old year.
 *   - Facts (a session, a race started, experienced or completed, the longest
 *     session) happen at the stint's instant and count in the window that
 *     instant falls in.
 *
 * Pure. Nothing is invented: a figure with nothing behind it is null, never a
 * guess.
 */

import { CAREER_STATS_SHAPE, DURATION_CLASSES } from '@/lib/config';
import type { LocalWindow } from './calendar';
import { clipToWindow, dayKeyToLocalDate, localDayKey, splitAcrossLocalDays, weekKeyForDay } from './calendar';
import type { CareerTimeline, RaceHistory, StintEvent, TimelineRaceRow } from './career-timeline';
import { coverageAt } from './career-timeline';

export interface WindowOptions {
  weekStartsOn: number;
  /** Which races count, for the Statistics filters. Every race when absent. */
  include?: (race: TimelineRaceRow) => boolean;
  meaningfulSessionSeconds: number;
  rateMinimumRaces: number;
}

export interface Bucket {
  creditedSeconds: number;
  newCoverageSeconds: number;
  rewatchSeconds: number;
  sessions: number;
  storyCompletes: number;
}

export interface StintRef {
  sessionId: string;
  raceId: string;
  raceName: string;
  at: Date;
  creditedSeconds: number;
  playbackSpeed: number;
}

export interface RaceRef {
  raceId: string;
  name: string;
  runtimeSec: number;
}

export interface GroupRow {
  id: string | null;
  name: string;
  accent: string | null;
  creditedSeconds: number;
  racesExperienced: number;
  storyCompletes: number;
  /** Of the window's credited seconds; 0 when there are none. */
  share: number;
}

export interface WindowSummary {
  /** null = the whole career. */
  window: LocalWindow | null;
  /** The instant of the first stint inside the window. */
  activeFrom: Date | null;
  creditedSeconds: number;
  newCoverageSeconds: number;
  rewatchSeconds: number;
  timelineSeconds: number;
  sessions: number;
  activeDays: number;
  racesStarted: number;
  racesExperienced: number;
  storyCompletes: number;
  championshipsWatched: number;
  eventsWatched: number;
  longestSession: StintRef | null;
  shortestMeaningfulSession: StintRef | null;
  averageSessionSeconds: number | null;
  /** The longest runtime among the races experienced. */
  longestRace: RaceRef | null;
  /** Runtime-weighted, 0–100. */
  completionPercent: number | null;
  /** The plain mean of each race's completion, 0–100. */
  averageRaceCompletionPercent: number | null;
  /** Of the races started in the window, the share Story Complete by its end, 0–100; null below `rateMinimumRaces`. */
  storyCompleteRate: number | null;
  days: Map<string, Bucket>;
  weeks: Map<string, Bucket>;
  months: Map<string, Bucket>;
  years: Map<number, Bucket>;
  /** Index 0 = Sunday, as `Date.getDay()`. */
  weekdays: Bucket[];
  byChampionship: GroupRow[];
  byEvent: GroupRow[];
  byCircuit: GroupRow[];
  byDurationClass: GroupRow[];
  storyCompleteList: { raceId: string; name: string; at: Date; runtimeSec: number }[];
  /** Races with a stint whose instant is in the window, in the order first watched. */
  raceIdsWatched: string[];
}

/** The label every race-length breakdown shares: the first band whose top is above the runtime. */
export function durationClassOf(runtimeSec: number): { key: string; label: string } {
  const hours = runtimeSec / 3600;
  const band = DURATION_CLASSES.find((entry) => entry.maxHours > hours) ?? DURATION_CLASSES[DURATION_CLASSES.length - 1];
  return { key: band.key, label: band.label };
}

/**
 * The runtimes a length band holds, in seconds: from the top of the band
 * before it (included) to its own top (excluded; null for the last band, which
 * has none). The Statistics length filter asks the database for exactly this
 * range, so a race it finds is always a race `durationClassOf` puts in the
 * band. Null for a key no band has.
 */
export function durationClassRange(key: string): { minSec: number; maxSec: number | null } | null {
  const index = DURATION_CLASSES.findIndex((entry) => entry.key === key);
  if (index < 0) return null;
  const band = DURATION_CLASSES[index]!;
  const below = index === 0 ? null : DURATION_CLASSES[index - 1]!;
  return {
    minSec: below === null ? 0 : Math.round(below.maxHours * 3600),
    maxSec: Number.isFinite(band.maxHours) ? Math.round(band.maxHours * 3600) : null,
  };
}

function emptyBucket(): Bucket {
  return { creditedSeconds: 0, newCoverageSeconds: 0, rewatchSeconds: 0, sessions: 0, storyCompletes: 0 };
}

/** The five buckets one local day adds to. */
interface DayBuckets {
  day: Bucket;
  week: Bucket;
  month: Bucket;
  year: Bucket;
  weekday: Bucket;
}

function bucketIn<K>(map: Map<K, Bucket>, key: K): Bucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = emptyBucket();
    map.set(key, bucket);
  }
  return bucket;
}

interface RaceTally {
  race: TimelineRaceRow;
  creditedSeconds: number;
  storyCompletes: number;
  watched: boolean;
}

const WITHOUT_CHAMPIONSHIP = 'Without a championship';

export function summariseWindow(
  timeline: CareerTimeline,
  window: LocalWindow | null,
  options: WindowOptions,
): WindowSummary {
  const inWindow = (at: Date) => window === null || (at >= window.start && at < window.end);
  const beforeEnd = (at: Date) => window === null || at < window.end;

  const days = new Map<string, Bucket>();
  const weeks = new Map<string, Bucket>();
  const months = new Map<string, Bucket>();
  const years = new Map<number, Bucket>();
  const weekdays = Array.from({ length: 7 }, emptyBucket);
  const weekMemo = new Map<string, string>();
  const dayBuckets = new Map<string, DayBuckets>();

  const bucketsFor = (dayKey: string): DayBuckets => {
    let found = dayBuckets.get(dayKey);
    if (!found) {
      found = {
        day: bucketIn(days, dayKey),
        week: bucketIn(weeks, weekKeyForDay(dayKey, options.weekStartsOn, weekMemo)),
        month: bucketIn(months, dayKey.slice(0, 7)),
        year: bucketIn(years, Number.parseInt(dayKey.slice(0, 4), 10)),
        weekday: weekdays[dayKeyToLocalDate(dayKey).getDay()]!,
      };
      dayBuckets.set(dayKey, found);
    }
    return found;
  };

  let creditedTotal = 0;
  let coverageTotal = 0;
  let rewatchTotal = 0;
  let timelineTotal = 0;
  let sessions = 0;
  let sessionCredited = 0;
  let activeFrom: Date | null = null;
  let longestSession: StintEvent | null = null;
  let shortestMeaningful: StintEvent | null = null;
  const tallies = new Map<string, RaceTally>();
  const raceIdsWatched: string[] = [];
  const startedRaceIds: string[] = [];
  const storyCompleteList: WindowSummary['storyCompleteList'] = [];

  for (const stint of timeline.stints) {
    const race = timeline.racesById.get(stint.raceId);
    if (!race || (options.include && !options.include(race))) continue;

    let tally = tallies.get(race.id);
    if (!tally) {
      tally = { race, creditedSeconds: 0, storyCompletes: 0, watched: false };
      tallies.set(race.id, tally);
    }

    // -- Time, spread over the window and split at local midnights ----------
    const part = window === null
      ? { startsAt: stint.startsAt, endsAt: stint.watchedAt, fraction: 1 }
      : clipToWindow(stint.startsAt, stint.watchedAt, window);
    if (part) {
      const credited = stint.creditedSeconds * part.fraction;
      const added = stint.addedCoverageSeconds * part.fraction;
      const rewatch = stint.rewatchCreditedSeconds * part.fraction;
      creditedTotal += credited;
      coverageTotal += added;
      rewatchTotal += rewatch;
      timelineTotal += stint.timelineSeconds * part.fraction;
      tally.creditedSeconds += credited;

      for (const slice of splitAcrossLocalDays(part.startsAt, part.endsAt)) {
        const target = bucketsFor(slice.dayKey);
        for (const bucket of [target.day, target.week, target.month, target.year, target.weekday]) {
          bucket.creditedSeconds += credited * slice.fraction;
          bucket.newCoverageSeconds += added * slice.fraction;
          bucket.rewatchSeconds += rewatch * slice.fraction;
        }
      }
    }

    // -- Facts, at the stint's instant ---------------------------------------
    if (!inWindow(stint.watchedAt)) continue;
    const target = bucketsFor(localDayKey(stint.watchedAt));
    for (const bucket of [target.day, target.week, target.month, target.year, target.weekday]) {
      bucket.sessions += 1;
      if (stint.completesStory) bucket.storyCompletes += 1;
    }

    sessions += 1;
    sessionCredited += stint.creditedSeconds;
    activeFrom ??= stint.watchedAt;
    if (!tally.watched) {
      tally.watched = true;
      raceIdsWatched.push(race.id);
    }
    if (stint.startsRace) startedRaceIds.push(race.id);
    if (stint.completesStory) {
      tally.storyCompletes += 1;
      storyCompleteList.push({ raceId: race.id, name: race.name, at: stint.watchedAt, runtimeSec: race.runtimeSec });
    }
    // Ties stay with the earlier stint: a later one must be strictly longer.
    if (stint.creditedSeconds > 0 && (longestSession === null || stint.creditedSeconds > longestSession.creditedSeconds)) {
      longestSession = stint;
    }
    if (
      stint.creditedSeconds >= options.meaningfulSessionSeconds
      && (shortestMeaningful === null || stint.creditedSeconds < shortestMeaningful.creditedSeconds)
    ) {
      shortestMeaningful = stint;
    }
  }

  // -- Races ------------------------------------------------------------------
  const histories = raceIdsWatched.map((id) => timeline.races.get(id)!);
  const experienced = new Set(
    histories
      .filter((history) => history.experiencedAt !== null && beforeEnd(history.experiencedAt))
      .map((history) => history.race.id),
  );

  let longestRace: RaceRef | null = null;
  for (const history of histories) {
    if (!experienced.has(history.race.id)) continue;
    if (longestRace === null || history.race.runtimeSec > longestRace.runtimeSec) {
      longestRace = { raceId: history.race.id, name: history.race.name, runtimeSec: history.race.runtimeSec };
    }
  }

  const coverageAtEnd = (history: RaceHistory) => (
    window === null ? history.coverageSeconds : coverageAt(history, new Date(window.end.getTime() - 1))
  );
  let coveredWeighted = 0;
  let runtimeWeighted = 0;
  let percentSum = 0;
  let percentCount = 0;
  for (const history of histories) {
    const runtime = history.race.runtimeSec;
    if (!(runtime > 0)) continue;
    const covered = Math.min(coverageAtEnd(history), runtime);
    coveredWeighted += covered;
    runtimeWeighted += runtime;
    percentSum += (covered / runtime) * 100;
    percentCount += 1;
  }

  const startedComplete = startedRaceIds.filter((id) => {
    const completedAt = timeline.races.get(id)?.storyCompletedAt ?? null;
    return completedAt !== null && beforeEnd(completedAt);
  }).length;

  const championships = new Set<string>();
  const events = new Set<string>();
  for (const history of histories) {
    if (history.race.championshipId !== null) championships.add(history.race.championshipId);
    if (history.race.eventKey !== null) events.add(history.race.eventKey);
  }

  const stintRef = (stint: StintEvent | null): StintRef | null => {
    if (stint === null) return null;
    return {
      sessionId: stint.sessionId,
      raceId: stint.raceId,
      raceName: timeline.racesById.get(stint.raceId)?.name ?? '',
      at: stint.watchedAt,
      creditedSeconds: stint.creditedSeconds,
      playbackSpeed: stint.playbackSpeed,
    };
  };

  const activeDays = [...days.values()].filter((bucket) => bucket.creditedSeconds > 0).length;
  const tallied = [...tallies.values()];
  const groupsBy = (keyOf: (race: TimelineRaceRow) => { id: string | null; name: string; accent: string | null } | null) =>
    groupRows(tallied, experienced, creditedTotal, keyOf);

  return {
    window,
    activeFrom,
    creditedSeconds: creditedTotal,
    newCoverageSeconds: coverageTotal,
    rewatchSeconds: rewatchTotal,
    timelineSeconds: timelineTotal,
    sessions,
    activeDays,
    racesStarted: startedRaceIds.length,
    racesExperienced: experienced.size,
    storyCompletes: storyCompleteList.length,
    championshipsWatched: championships.size,
    eventsWatched: events.size,
    longestSession: stintRef(longestSession),
    shortestMeaningfulSession: stintRef(shortestMeaningful),
    averageSessionSeconds: sessions > 0 ? sessionCredited / sessions : null,
    longestRace,
    completionPercent: runtimeWeighted > 0 ? (100 * coveredWeighted) / runtimeWeighted : null,
    averageRaceCompletionPercent: percentCount > 0 ? percentSum / percentCount : null,
    storyCompleteRate: startedRaceIds.length >= options.rateMinimumRaces && startedRaceIds.length > 0
      ? (100 * startedComplete) / startedRaceIds.length
      : null,
    days,
    weeks,
    months,
    years,
    weekdays,
    byChampionship: groupsBy((race) => ({
      id: race.championshipId,
      name: race.championshipId === null ? WITHOUT_CHAMPIONSHIP : race.championshipName ?? WITHOUT_CHAMPIONSHIP,
      accent: race.championshipAccent,
    })),
    byEvent: groupsBy((race) => (
      race.eventKey === null ? null : { id: race.eventKey, name: race.eventName ?? race.eventKey, accent: null }
    )),
    byCircuit: groupsBy((race) => (
      race.circuitSlug === null ? null : { id: race.circuitSlug, name: race.circuit ?? race.circuitSlug, accent: null }
    )),
    byDurationClass: durationRows(tallied, experienced, creditedTotal),
    storyCompleteList,
    raceIdsWatched,
  };
}

function groupRows(
  tallies: readonly RaceTally[],
  experienced: ReadonlySet<string>,
  creditedTotal: number,
  keyOf: (race: TimelineRaceRow) => { id: string | null; name: string; accent: string | null } | null,
): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const tally of tallies) {
    const key = keyOf(tally.race);
    if (key === null) continue;
    const mapKey = key.id ?? '';
    let row = rows.get(mapKey);
    if (!row) {
      row = { id: key.id, name: key.name, accent: key.accent, creditedSeconds: 0, racesExperienced: 0, storyCompletes: 0, share: 0 };
      rows.set(mapKey, row);
    }
    row.creditedSeconds += tally.creditedSeconds;
    row.storyCompletes += tally.storyCompletes;
    if (experienced.has(tally.race.id)) row.racesExperienced += 1;
  }
  return [...rows.values()]
    .filter((row) => row.creditedSeconds > 0 || row.racesExperienced > 0 || row.storyCompletes > 0)
    .map((row) => ({ ...row, share: creditedTotal > 0 ? row.creditedSeconds / creditedTotal : 0 }))
    .sort((a, b) => {
      if (a.creditedSeconds !== b.creditedSeconds) return b.creditedSeconds - a.creditedSeconds;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0;
    });
}

/** Length bands in their own order, shortest first, so a chart of them reads as a scale. */
function durationRows(tallies: readonly RaceTally[], experienced: ReadonlySet<string>, creditedTotal: number): GroupRow[] {
  const order = new Map<string, number>(DURATION_CLASSES.map((entry, index) => [entry.key, index]));
  return groupRows(tallies, experienced, creditedTotal, (race) => {
    const band = durationClassOf(race.runtimeSec);
    return { id: band.key, name: band.label, accent: null };
  }).sort((a, b) => (order.get(a.id ?? '') ?? 0) - (order.get(b.id ?? '') ?? 0));
}

// ---------------------------------------------------------------------------
// Comparing two years
// ---------------------------------------------------------------------------

export type CompareRowKey =
  | 'hours' | 'newCoverage' | 'rewatch' | 'sessions' | 'activeDays' | 'averageSession' | 'longestSession'
  | 'racesExperienced' | 'racesStarted' | 'storyCompletes' | 'storyCompleteRate' | 'completion'
  | 'xp' | 'levelsGained' | 'championshipsWatched' | 'eventsWatched';

/** Every comparison row, in the order the table shows them. */
export const COMPARE_ROW_ORDER: readonly CompareRowKey[] = [
  'hours', 'newCoverage', 'rewatch', 'sessions', 'activeDays', 'averageSession', 'longestSession',
  'racesExperienced', 'racesStarted', 'storyCompletes', 'storyCompleteRate', 'completion',
  'xp', 'levelsGained', 'championshipsWatched', 'eventsWatched',
];

export interface CompareRow {
  key: CompareRowKey;
  label: string;
  unit: 'seconds' | 'count' | 'xp' | 'percent-points';
  a: number | null;
  b: number | null;
  /** `b − a`, whenever both sides have a value. */
  difference: number | null;
  /** Only when the base is large enough to make a percentage mean something. */
  percentChange: number | null;
  note: string | null;
}

/** A championship or event row: the same shape, named by the group rather than a fixed key. */
export type CompareGroupRow = Omit<CompareRow, 'key'> & { id: string | null };

export interface CompareSide extends WindowSummary {
  year: number;
  xpEarned: number;
  levelsGained: number;
  /** Set when the whole career's first stint falls after 1 January of this year. */
  careerBeganInYear: Date | null;
}

const ROW_DEFINITIONS: Record<CompareRowKey, { label: string; unit: CompareRow['unit']; value: (side: CompareSide) => number | null }> = {
  hours: { label: 'Hours watched', unit: 'seconds', value: (side) => side.creditedSeconds },
  newCoverage: { label: 'New race coverage', unit: 'seconds', value: (side) => side.newCoverageSeconds },
  rewatch: { label: 'Re-watch time', unit: 'seconds', value: (side) => side.rewatchSeconds },
  sessions: { label: 'Viewing sessions', unit: 'count', value: (side) => side.sessions },
  activeDays: { label: 'Active days', unit: 'count', value: (side) => side.activeDays },
  averageSession: { label: 'Average session', unit: 'seconds', value: (side) => side.averageSessionSeconds },
  longestSession: { label: 'Longest session', unit: 'seconds', value: (side) => side.longestSession?.creditedSeconds ?? null },
  racesExperienced: { label: 'Races experienced', unit: 'count', value: (side) => side.racesExperienced },
  racesStarted: { label: 'Races started', unit: 'count', value: (side) => side.racesStarted },
  storyCompletes: { label: 'Races completed (Story Complete)', unit: 'count', value: (side) => side.storyCompletes },
  storyCompleteRate: { label: 'Story Complete rate', unit: 'percent-points', value: (side) => side.storyCompleteRate },
  completion: { label: 'Completion', unit: 'percent-points', value: (side) => side.completionPercent },
  xp: { label: 'XP earned', unit: 'xp', value: (side) => side.xpEarned },
  levelsGained: { label: 'Levels gained', unit: 'count', value: (side) => side.levelsGained },
  championshipsWatched: { label: 'Championships watched', unit: 'count', value: (side) => side.championshipsWatched },
  eventsWatched: { label: 'Events watched', unit: 'count', value: (side) => side.eventsWatched },
};

/**
 * Rows whose value is one session rather than a total. Whether a percentage
 * means anything is judged on how many sessions there were, not on the length
 * of one: a two-hour average is never "too little", and no single session
 * reaches the ten-hour base a total needs.
 */
const PER_SESSION_ROWS = new Set<CompareRowKey>(['averageSession', 'longestSession']);

function chapterBeganNote(year: number, began: Date): string {
  return `Your ${year} chapter began on ${began.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
}

function differenceOf(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

/**
 * Two years side by side. `a` is the base: differences are `b − a`, and a
 * percentage change is measured against `a`.
 */
export function compareSummaries(
  a: CompareSide,
  b: CompareSide,
  rules: typeof CAREER_STATS_SHAPE = CAREER_STATS_SHAPE,
): {
  rows: CompareRow[];
  championships: CompareGroupRow[];
  events: CompareGroupRow[];
  months: { month: number; a: number; b: number }[];
  partialNote: string | null;
} {
  const partialNote = a.careerBeganInYear !== null
    ? chapterBeganNote(a.year, a.careerBeganInYear)
    : b.careerBeganInYear !== null ? chapterBeganNote(b.year, b.careerBeganInYear) : null;
  // A year the career began in is not a whole year of it, so no row gets a
  // percentage: the chapter-began note says why.
  const partial = partialNote !== null;
  const tooLittle = `Too little in ${a.year} for a percentage to mean much`;
  const minimumSeconds = rules.percentChangeMinimumBase.hours * 3600;

  const baseLargeEnough = (key: CompareRowKey, unit: CompareRow['unit'], base: number): boolean => {
    if (PER_SESSION_ROWS.has(key)) return a.sessions >= rules.percentChangeMinimumBase.count;
    if (unit === 'seconds') return base >= minimumSeconds;
    if (unit === 'count') return base >= rules.percentChangeMinimumBase.count;
    if (unit === 'xp') return base >= rules.percentChangeMinimumBase.xp;
    return false;
  };

  const rows = COMPARE_ROW_ORDER.map((key): CompareRow => {
    const definition = ROW_DEFINITIONS[key];
    let valueA = definition.value(a);
    let valueB = definition.value(b);
    let note: string | null = null;

    if (key === 'storyCompleteRate'
      && (a.racesStarted < rules.rateMinimumRaces || b.racesStarted < rules.rateMinimumRaces)) {
      valueA = null;
      valueB = null;
      note = `A rate needs at least ${rules.rateMinimumRaces} races started in each year`;
    }

    let percentChange: number | null = null;
    if (definition.unit !== 'percent-points' && valueA !== null && valueB !== null && !partial) {
      if (valueA > 0 && baseLargeEnough(key, definition.unit, valueA)) {
        percentChange = ((valueB - valueA) / valueA) * 100;
      } else {
        note = tooLittle;
      }
    }

    return {
      key,
      label: definition.label,
      unit: definition.unit,
      a: valueA,
      b: valueB,
      difference: differenceOf(valueA, valueB),
      percentChange,
      note,
    };
  });

  const compareGroups = (left: readonly GroupRow[], right: readonly GroupRow[]): CompareGroupRow[] => {
    const inShares = a.creditedSeconds >= minimumSeconds && b.creditedSeconds >= minimumSeconds;
    const ids = new Map<string, { id: string | null; name: string; a: GroupRow | null; b: GroupRow | null }>();
    for (const row of left) ids.set(row.id ?? '', { id: row.id, name: row.name, a: row, b: null });
    for (const row of right) {
      const entry = ids.get(row.id ?? '');
      if (entry) entry.b = row;
      else ids.set(row.id ?? '', { id: row.id, name: row.name, a: null, b: row });
    }
    return [...ids.values()]
      .sort((x, y) => {
        const byB = (y.b?.creditedSeconds ?? 0) - (x.b?.creditedSeconds ?? 0);
        if (byB !== 0) return byB;
        const byA = (y.a?.creditedSeconds ?? 0) - (x.a?.creditedSeconds ?? 0);
        if (byA !== 0) return byA;
        return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
      })
      .map((entry): CompareGroupRow => {
        // Shares in percentage points once both years are big enough for a
        // share to say something; below that, only the hours themselves.
        const valueA = inShares ? (entry.a?.share ?? 0) * 100 : entry.a?.creditedSeconds ?? 0;
        const valueB = inShares ? (entry.b?.share ?? 0) * 100 : entry.b?.creditedSeconds ?? 0;
        return {
          id: entry.id,
          label: entry.name,
          unit: inShares ? 'percent-points' : 'seconds',
          a: valueA,
          b: valueB,
          difference: valueB - valueA,
          percentChange: null,
          note: null,
        };
      });
  };

  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const suffix = `-${month.toString().padStart(2, '0')}`;
    return {
      month,
      a: a.months.get(`${a.year}${suffix}`)?.creditedSeconds ?? 0,
      b: b.months.get(`${b.year}${suffix}`)?.creditedSeconds ?? 0,
    };
  });

  return {
    rows,
    championships: compareGroups(a.byChampionship, b.byChampionship),
    events: compareGroups(a.byEvent, b.byEvent),
    months,
    partialNote,
  };
}
