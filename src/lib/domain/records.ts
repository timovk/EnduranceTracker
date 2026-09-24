/**
 * Personal Records (0.4.0).
 *
 * The best a career has done at a handful of things — the longest session, the
 * biggest day, the fastest long race from start to finish — and, just as
 * importantly, how each best got there: every improvement is kept, in order,
 * so a record can say what it replaced and a chapter can say "since beaten".
 *
 * The rules that keep a record honest:
 *
 *   - Ties go to the earliest holder. A later value must be strictly better
 *     (strictly smaller, for "fastest") to take a record.
 *   - A record of nothing is not a record: a value has to be above zero.
 *   - Records built from when stints were logged (the time spread over their
 *     windows) are marked `logged-time`, so the page can say so once.
 *
 * Pure and deterministic.
 */

import type { LocalWindow } from './calendar';
import { clipToWindow, dayKeyToLocalDate, localDayKey, localMonthKey, splitAcrossLocalDays } from './calendar';
import type { CareerTimeline, StintEvent, TimelineRaceRow } from './career-timeline';
import { longestConsecutiveRun } from './edition';

export type RecordKind =
  | 'longest-session' | 'most-in-a-day' | 'most-in-seven-days' | 'most-in-a-month'
  | 'most-completions-in-a-month' | 'most-story-completes-in-a-year'
  | 'longest-race-story-completed' | 'fastest-long-race-completion' | 'longest-start-to-finish'
  | 'most-new-coverage-in-a-day' | 'longest-edition-streak';

/** Every record, in the order pages list them. Wrapped picks the first few set in a year. */
export const RECORD_ORDER: readonly RecordKind[] = [
  'longest-session', 'most-in-a-day', 'most-in-seven-days', 'most-in-a-month',
  'most-completions-in-a-month', 'most-story-completes-in-a-year',
  'longest-race-story-completed', 'fastest-long-race-completion', 'longest-start-to-finish',
  'most-new-coverage-in-a-day', 'longest-edition-streak',
];

export interface RecordEvent {
  kind: RecordKind;
  label: string;
  value: number;
  unit: 'seconds' | 'count' | 'editions';
  /** When the record was set: the stint, or the start of the day, month or year that set it. */
  at: Date;
  /** The day, month or year key of a period record; null otherwise. */
  periodKey: string | null;
  raceId: string | null;
  eventKey: string | null;
  /** What set it, in words: a race, an event, or the period. */
  detail: string;
  /** The value it replaced; null for the first. */
  previousValue: number | null;
  /** `logged-time` = depends on when stints were logged (their windows); `history` = on what was watched. */
  basis: 'logged-time' | 'history';
}

export interface RecordOptions {
  weekStartsOn: number;
  /** "Long race" for the fastest-completion record, by runtime alone. */
  longRaceThresholdSec: number;
  /** The span of the rolling record, in days. */
  rollingDays: number;
  include?: (race: TimelineRaceRow) => boolean;
  /** Only stints logged inside it count, and only their time inside it: "your best in 2027". */
  within?: LocalWindow;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

function labelFor(kind: RecordKind, rollingDays: number): string {
  switch (kind) {
    case 'longest-session': return 'Longest session';
    case 'most-in-a-day': return 'Most in a day';
    case 'most-in-seven-days': {
      const days = rollingDays < NUMBER_WORDS.length ? NUMBER_WORDS[rollingDays] : `${rollingDays}`;
      return `Most in ${days} days`;
    }
    case 'most-in-a-month': return 'Most in a month';
    case 'most-completions-in-a-month': return 'Most Story Completes in a month';
    case 'most-story-completes-in-a-year': return 'Most Story Completes in a year';
    case 'longest-race-story-completed': return 'Longest race completed';
    case 'fastest-long-race-completion': return 'Fastest long race, start to finish';
    case 'longest-start-to-finish': return 'Longest start to finish';
    case 'most-new-coverage-in-a-day': return 'Most new race coverage in a day';
    case 'longest-edition-streak': return 'Longest run of complete editions';
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function dayText(dayKey: string): string {
  const date = dayKeyToLocalDate(dayKey);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function monthText(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return `${MONTH_NAMES[Number.parseInt(month ?? '1', 10) - 1]} ${year}`;
}

/** A best-so-far that only a strictly better value replaces. */
class Best {
  private current: number | null = null;
  constructor(private readonly better: (candidate: number, best: number) => boolean) {}

  /** The value it replaces, or undefined when `value` is not a new record. */
  offer(value: number): { previous: number | null } | undefined {
    if (!(value > 0)) return undefined;
    if (this.current !== null && !this.better(value, this.current)) return undefined;
    const previous = this.current;
    this.current = value;
    return { previous };
  }
}

const higher = (candidate: number, best: number) => candidate > best;
const lower = (candidate: number, best: number) => candidate < best;

/** Local midnight starting the day after `date`. */
function nextDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

/** The length of a local day in seconds: 23, 24 or 25 hours. */
function dayLengthSeconds(dayKey: string): number {
  const start = dayKeyToLocalDate(dayKey);
  return (nextDay(start).getTime() - start.getTime()) / 1000;
}

/**
 * Every improvement of every record, in chronological order.
 *
 * A period record (a day, seven days, a month, a year) is set when that
 * period's total beats the best so far, and is dated at the period's start;
 * the latest period, still under way, is compared too.
 */
export function computeRecordProgression(timeline: CareerTimeline, options: RecordOptions): RecordEvent[] {
  const within = options.within;
  const counts = (stint: StintEvent, race: TimelineRaceRow | undefined): race is TimelineRaceRow => {
    if (!race || (options.include && !options.include(race))) return false;
    return within === undefined || (stint.watchedAt >= within.start && stint.watchedAt < within.end);
  };

  const events: RecordEvent[] = [];
  const emit = (event: Omit<RecordEvent, 'label'>) => events.push({ ...event, label: labelFor(event.kind, options.rollingDays) });

  const creditedByDay = new Map<string, number>();
  const coverageByDay = new Map<string, number>();
  const creditedByMonth = new Map<string, number>();
  const completesByMonth = new Map<string, number>();
  const completesByYear = new Map<string, number>();

  const longestSession = new Best(higher);
  const longestCompleted = new Best(higher);
  const fastestLong = new Best(lower);
  const longestElapsed = new Best(higher);
  const longestStreak = new Best(higher);
  const completedYearsByEvent = new Map<string, number[]>();

  for (const stint of timeline.stints) {
    const race = timeline.racesById.get(stint.raceId);
    if (!counts(stint, race)) continue;

    // -- Time, over the stint's window --------------------------------------
    const part = within === undefined
      ? { startsAt: stint.startsAt, endsAt: stint.watchedAt, fraction: 1 }
      : clipToWindow(stint.startsAt, stint.watchedAt, within);
    if (part) {
      for (const slice of splitAcrossLocalDays(part.startsAt, part.endsAt)) {
        const credited = stint.creditedSeconds * part.fraction * slice.fraction;
        creditedByDay.set(slice.dayKey, (creditedByDay.get(slice.dayKey) ?? 0) + credited);
        coverageByDay.set(slice.dayKey, (coverageByDay.get(slice.dayKey) ?? 0) + stint.addedCoverageSeconds * part.fraction * slice.fraction);
        const monthKey = slice.dayKey.slice(0, 7);
        creditedByMonth.set(monthKey, (creditedByMonth.get(monthKey) ?? 0) + credited);
      }
    }

    // -- Stint records --------------------------------------------------------
    const session = longestSession.offer(stint.creditedSeconds);
    if (session) {
      emit({
        kind: 'longest-session', value: stint.creditedSeconds, unit: 'seconds', at: stint.watchedAt,
        periodKey: null, raceId: race.id, eventKey: race.eventKey, detail: race.name,
        previousValue: session.previous, basis: 'logged-time',
      });
    }

    if (!stint.completesStory) continue;
    const monthKey = localMonthKey(stint.watchedAt);
    const yearKey = `${stint.watchedAt.getFullYear()}`;
    completesByMonth.set(monthKey, (completesByMonth.get(monthKey) ?? 0) + 1);
    completesByYear.set(yearKey, (completesByYear.get(yearKey) ?? 0) + 1);

    const completed = longestCompleted.offer(race.runtimeSec);
    if (completed) {
      emit({
        kind: 'longest-race-story-completed', value: race.runtimeSec, unit: 'seconds', at: stint.watchedAt,
        periodKey: null, raceId: race.id, eventKey: race.eventKey, detail: race.name,
        previousValue: completed.previous, basis: 'history',
      });
    }

    // Start to finish, never shorter than the time actually credited to it:
    // batch-logged stints can put the whole race inside a few minutes.
    const startedAt = timeline.races.get(race.id)?.startedAt ?? stint.startsAt;
    const elapsed = Math.round(Math.max(
      (stint.watchedAt.getTime() - startedAt.getTime()) / 1000,
      stint.raceCreditedAfterSeconds,
    ));
    if (race.runtimeSec >= options.longRaceThresholdSec) {
      const fastest = fastestLong.offer(elapsed);
      if (fastest) {
        emit({
          kind: 'fastest-long-race-completion', value: elapsed, unit: 'seconds', at: stint.watchedAt,
          periodKey: null, raceId: race.id, eventKey: race.eventKey, detail: race.name,
          previousValue: fastest.previous, basis: 'logged-time',
        });
      }
    }
    const longest = longestElapsed.offer(elapsed);
    if (longest) {
      emit({
        kind: 'longest-start-to-finish', value: elapsed, unit: 'seconds', at: stint.watchedAt,
        periodKey: null, raceId: race.id, eventKey: race.eventKey, detail: race.name,
        previousValue: longest.previous, basis: 'logged-time',
      });
    }

    // A run needs dated editions; an undated race cannot join one.
    if (race.eventKey !== null && race.editionYear !== null) {
      const years = completedYearsByEvent.get(race.eventKey) ?? [];
      years.push(race.editionYear);
      completedYearsByEvent.set(race.eventKey, years);
      const run = longestConsecutiveRun(years);
      // One edition is not yet a run of them.
      if (run !== null && run.length >= 2) {
        const streak = longestStreak.offer(run.length);
        if (streak) {
          emit({
            kind: 'longest-edition-streak', value: run.length, unit: 'editions', at: stint.watchedAt,
            periodKey: null, raceId: race.id, eventKey: race.eventKey,
            detail: `${race.eventName ?? race.name}, ${run.fromYear}–${run.toYear}`,
            previousValue: streak.previous, basis: 'history',
          });
        }
      }
    }
  }

  // -- Period records -----------------------------------------------------------
  const sortedDays = [...creditedByDay.keys()].sort();

  const dayBest = new Best(higher);
  const coverageBest = new Best(higher);
  for (const dayKey of sortedDays) {
    const at = dayKeyToLocalDate(dayKey);
    // More credited time than a day holds is batch logging, not a longer day.
    const credited = Math.min(creditedByDay.get(dayKey) ?? 0, dayLengthSeconds(dayKey));
    const day = dayBest.offer(credited);
    if (day) {
      emit({
        kind: 'most-in-a-day', value: credited, unit: 'seconds', at, periodKey: dayKey,
        raceId: null, eventKey: null, detail: dayText(dayKey), previousValue: day.previous, basis: 'logged-time',
      });
    }
    const coverage = coverageByDay.get(dayKey) ?? 0;
    const fresh = coverageBest.offer(coverage);
    if (fresh) {
      emit({
        kind: 'most-new-coverage-in-a-day', value: coverage, unit: 'seconds', at, periodKey: dayKey,
        raceId: null, eventKey: null, detail: dayText(dayKey), previousValue: fresh.previous, basis: 'logged-time',
      });
    }
  }

  // Rolling days: every calendar day from the first to the last, quiet days
  // counting as nothing, so a gap can never be skipped over.
  if (sortedDays.length > 0 && options.rollingDays > 0) {
    const rollingBest = new Best(higher);
    const recent: number[] = [];
    let total = 0;
    const last = dayKeyToLocalDate(sortedDays[sortedDays.length - 1]!);
    for (let cursor = dayKeyToLocalDate(sortedDays[0]!); cursor <= last; cursor = nextDay(cursor)) {
      const dayKey = localDayKey(cursor);
      const credited = Math.min(creditedByDay.get(dayKey) ?? 0, dayLengthSeconds(dayKey));
      recent.push(credited);
      total += credited;
      if (recent.length > options.rollingDays) total -= recent.shift()!;
      const rolling = rollingBest.offer(total);
      if (rolling) {
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - (options.rollingDays - 1));
        emit({
          kind: 'most-in-seven-days', value: total, unit: 'seconds', at: cursor, periodKey: dayKey,
          raceId: null, eventKey: null, detail: `${dayText(localDayKey(first))} to ${dayText(dayKey)}`,
          previousValue: rolling.previous, basis: 'logged-time',
        });
      }
    }
  }

  const monthBest = new Best(higher);
  for (const monthKey of [...creditedByMonth.keys()].sort()) {
    const credited = creditedByMonth.get(monthKey) ?? 0;
    const month = monthBest.offer(credited);
    if (month) {
      emit({
        kind: 'most-in-a-month', value: credited, unit: 'seconds', at: monthStart(monthKey), periodKey: monthKey,
        raceId: null, eventKey: null, detail: monthText(monthKey), previousValue: month.previous, basis: 'logged-time',
      });
    }
  }

  const monthCompletes = new Best(higher);
  for (const monthKey of [...completesByMonth.keys()].sort()) {
    const count = completesByMonth.get(monthKey) ?? 0;
    const month = monthCompletes.offer(count);
    if (month) {
      emit({
        kind: 'most-completions-in-a-month', value: count, unit: 'count', at: monthStart(monthKey), periodKey: monthKey,
        raceId: null, eventKey: null, detail: monthText(monthKey), previousValue: month.previous, basis: 'history',
      });
    }
  }

  const yearCompletes = new Best(higher);
  for (const yearKey of [...completesByYear.keys()].sort()) {
    const count = completesByYear.get(yearKey) ?? 0;
    const year = yearCompletes.offer(count);
    if (year) {
      emit({
        kind: 'most-story-completes-in-a-year', value: count, unit: 'count',
        at: new Date(Number.parseInt(yearKey, 10), 0, 1, 0, 0, 0, 0), periodKey: yearKey,
        raceId: null, eventKey: null, detail: yearKey, previousValue: year.previous, basis: 'history',
      });
    }
  }

  const order = new Map(RECORD_ORDER.map((kind, index) => [kind, index]));
  // A stable sort keeps each kind's own improvements in the order they happened.
  return events.sort((x, y) => x.at.getTime() - y.at.getTime() || order.get(x.kind)! - order.get(y.kind)!);
}

function monthStart(monthKey: string): Date {
  const [year, month] = monthKey.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, 1, 0, 0, 0, 0);
}

/** The record standing now for each kind that has one, in `RECORD_ORDER`. */
export function currentRecords(progression: readonly RecordEvent[]): RecordEvent[] {
  const latest = new Map<RecordKind, RecordEvent>();
  for (const event of progression) latest.set(event.kind, event);
  return RECORD_ORDER.flatMap((kind) => {
    const event = latest.get(kind);
    return event ? [event] : [];
  });
}

/** The improvements made inside a window, in order. */
export function recordsSetIn(progression: readonly RecordEvent[], window: LocalWindow): RecordEvent[] {
  return progression.filter((event) => event.at >= window.start && event.at < window.end);
}

/**
 * The record that later replaced this one, if any: the first later event of
 * the same kind with a better value. A frozen chapter asks this when it is
 * shown, so "since beaten" is always today's answer, never a stale one.
 */
export function beatenAfter(
  progression: readonly RecordEvent[],
  record: Pick<RecordEvent, 'kind' | 'at' | 'value'>,
): RecordEvent | null {
  const better = record.kind === 'fastest-long-race-completion' ? lower : higher;
  return progression.find(
    (event) => event.kind === record.kind && event.at > record.at && better(event.value, record.value),
  ) ?? null;
}
