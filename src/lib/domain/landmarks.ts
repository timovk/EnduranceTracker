/**
 * When a landmark happened (0.4.0).
 *
 * The engines recognise a milestone or an event step at the moment they
 * notice it; this module looks back through the career replay for the moment
 * it actually happened — the instant the 100th hour was crossed, the stint
 * that completed the tenth story. Those dates are written once and never move
 * again, whatever happens to the stints later: statistics change, landmarks do
 * not.
 *
 * Recognition and replay must agree about the threshold, or the replay could
 * date a rung the app recognised just before the real crossing to a later
 * stint. Hour rungs are recognised from rounded values — `round1(seconds /
 * 3600) ≥ T` in `engines/metrics.ts` and `engines/mastery-engine.ts` — and
 * `round1(x) ≥ T` already holds from `x ≥ T − 0.05` hours, three minutes
 * early. `recognitionThresholdSeconds` crosses that same point, so a rung the
 * app recorded in the last three minutes of a stint is still dated inside it.
 *
 * Pure.
 */

import { MASTERY_SHAPE } from '@/lib/config';
import { clipToWindow, yearWindow } from './calendar';
import type { CareerTimeline, InstantResult, StintEvent, TimelineRaceRow, TimelineSessionRow } from './career-timeline';
import {
  compareCanonical, creditedSeconds, cumulativeCrossing, DEFAULT_TIMELINE_OPTIONS, nthEvent, raceExperiencedEvents,
  raceStartEvents, storyCompleteEvents,
} from './career-timeline';
import { editionIdentityOf, longestConsecutiveRun } from './edition';

/**
 * Half of the last place `round1` keeps, in hours. `Math.round(x × 10) / 10 ≥ T`
 * exactly when `x ≥ T − 0.05`, so a rounded hour figure reaches `T` this much
 * before the real one does.
 */
const ROUND1_HALF_STEP_HOURS = 0.05;

/** The metrics recognised through `round1` of hours. */
const ROUNDED_HOUR_METRICS = new Set(['realHours', 'timelineHours']);

/** Count metrics whose instant is "the stint of the n-th race Story Complete over this length". */
const STORIES_BY_LENGTH: Record<string, keyof typeof MASTERY_SHAPE> = {
  stories6h: 'stories6hMinHours',
  stories8h: 'stories8hMinHours',
  stories10h: 'stories10hMinHours',
  stories12h: 'stories12hMinHours',
  stories24h: 'stories24hMinHours',
};

const YEAR_METRIC = /^realHoursYear:(\d{4})$/;

const REPLAYABLE = new Set([
  'realHours', 'timelineHours', 'sessions', 'storyCompletes', 'racesStarted', 'racesExperienced',
  'majorEventStories', 'eventEditions', ...Object.keys(STORIES_BY_LENGTH),
]);

/**
 * Whether history can say when a milestone metric crossed a threshold.
 *
 * Not replayable: `racesCompleted` (it counts races marked Completed by hand,
 * which carry no instant), championships, seasons, circuits and countries
 * (they depend on what else is in the library, not on one stint), and XP and
 * level (the ledger, not the viewing, decides those).
 */
export function isReplayableMilestoneMetric(metric: string): boolean {
  return REPLAYABLE.has(metric) || YEAR_METRIC.test(metric);
}

/**
 * The running total, in seconds, at which the app recognises an hour rung.
 *
 * `T × 3600 − 180` for the metrics recognised through `round1` of hours
 * (`realHours`, `timelineHours`, and an event's `realHours`); exactly
 * `T × 3600` for a calendar year's `realHoursYear:<Y>`, which is compared in
 * whole seconds. A count metric's threshold is a count, and is returned as it
 * is.
 */
export function recognitionThresholdSeconds(metric: string, threshold: number): number {
  if (ROUNDED_HOUR_METRICS.has(metric)) return threshold * 3600 - ROUND1_HALF_STEP_HOURS * 3600;
  if (YEAR_METRIC.test(metric)) return threshold * 3600;
  return threshold;
}

function raceName(timeline: CareerTimeline, raceId: string): string | undefined {
  return timeline.racesById.get(raceId)?.name;
}

function withSubject(
  timeline: CareerTimeline,
  instant: InstantResult | null,
): (InstantResult & { eventId?: string; subjectName?: string }) | null {
  if (!instant) return null;
  const subjectName = raceName(timeline, instant.raceId);
  return subjectName === undefined ? instant : { ...instant, subjectName };
}

/**
 * The stint at which some group of races first held `n` distinct edition
 * identities among those `counted` so far.
 */
function nthEditionStint(
  timeline: CareerTimeline,
  stints: readonly StintEvent[],
  n: number,
  counts: (stint: StintEvent) => boolean,
): StintEvent | null {
  const seen = new Set<string>();
  for (const stint of stints) {
    if (!counts(stint)) continue;
    const race = timeline.racesById.get(stint.raceId);
    if (!race) continue;
    seen.add(editionIdentityOf(race.id, race.editionYear));
    if (seen.size >= n) return stint;
  }
  return null;
}

/** `stintsByEvent`, once per replay. */
const eventStintCache = new WeakMap<CareerTimeline, Map<string, StintEvent[]>>();

/**
 * Every event's stints, canonical order, keyed by event key. Worked out once
 * per replay: an account's event steps are dated together, seventeen an
 * event, and filtering every stint of the career again for each one would be
 * nearly all the cost of dating them on a long career.
 */
function stintsByEvent(timeline: CareerTimeline): Map<string, StintEvent[]> {
  const cached = eventStintCache.get(timeline);
  if (cached !== undefined) return cached;
  const byEvent = new Map<string, StintEvent[]>();
  for (const stint of timeline.stints) {
    const key = timeline.racesById.get(stint.raceId)?.eventKey;
    if (key === null || key === undefined) continue;
    const list = byEvent.get(key);
    if (list) list.push(stint);
    else byEvent.set(key, [stint]);
  }
  eventStintCache.set(timeline, byEvent);
  return byEvent;
}

function stintInstant(stint: StintEvent): InstantResult {
  return { at: stint.watchedAt, precision: 'STINT', sessionId: stint.sessionId, raceId: stint.raceId };
}

/**
 * When a career milestone rung was reached, or null when history cannot say
 * (a metric that is not replayable, or a threshold the history no longer
 * reaches).
 */
export function milestoneInstant(
  timeline: CareerTimeline,
  metric: string,
  threshold: number,
  shapes: { masteryShape: typeof MASTERY_SHAPE } = { masteryShape: MASTERY_SHAPE },
): (InstantResult & { eventId?: string; subjectName?: string }) | null {
  const year = YEAR_METRIC.exec(metric);
  if (year) {
    const calendarYear = Number.parseInt(year[1]!, 10);
    return withSubject(timeline, cumulativeCrossing(
      timeline.stints,
      recognitionThresholdSeconds(metric, threshold),
      (stint) => stint.creditedSeconds,
      yearWindow(calendarYear),
    ));
  }

  switch (metric) {
    case 'realHours':
      return withSubject(timeline, cumulativeCrossing(
        timeline.stints, recognitionThresholdSeconds(metric, threshold), (stint) => stint.creditedSeconds,
      ));
    case 'timelineHours':
      return withSubject(timeline, cumulativeCrossing(
        timeline.stints, recognitionThresholdSeconds(metric, threshold), (stint) => stint.addedCoverageSeconds,
      ));
    case 'sessions': {
      const stint = Number.isInteger(threshold) && threshold >= 1 ? timeline.stints[threshold - 1] : undefined;
      return withSubject(timeline, stint ? stintInstant(stint) : null);
    }
    case 'storyCompletes':
      return withSubject(timeline, nthEvent(storyCompleteEvents(timeline), threshold));
    case 'racesStarted':
      return withSubject(timeline, nthEvent(raceStartEvents(timeline), threshold));
    case 'racesExperienced':
      return withSubject(timeline, nthEvent(raceExperiencedEvents(timeline), threshold));
    case 'majorEventStories':
      return withSubject(timeline, nthEvent(storyCompleteEvents(timeline, (race) => race.isMajorEvent), threshold));
    case 'eventEditions': {
      // For each event, the stint at which its n-th distinct experienced
      // edition was first reached; the earliest across events is the moment
      // the career first had an event with n editions.
      let best: { stint: StintEvent; race: TimelineRaceRow } | null = null;
      for (const stints of stintsByEvent(timeline).values()) {
        const stint = nthEditionStint(timeline, stints, threshold, (candidate) => candidate.experiencesRace);
        if (!stint) continue;
        if (best === null || stint.ordinal < best.stint.ordinal) {
          best = { stint, race: timeline.racesById.get(stint.raceId)! };
        }
      }
      if (!best) return null;
      const result: InstantResult & { eventId?: string; subjectName?: string } = stintInstant(best.stint);
      if (best.race.eventId !== null) result.eventId = best.race.eventId;
      const subjectName = best.race.eventName ?? best.race.name;
      return { ...result, subjectName };
    }
  }

  const band = STORIES_BY_LENGTH[metric];
  if (band !== undefined) {
    const minimumSeconds = shapes.masteryShape[band] * 3600;
    return withSubject(timeline, nthEvent(storyCompleteEvents(timeline, (race) => race.runtimeSec >= minimumSeconds), threshold));
  }
  return null;
}

/**
 * When an Event Legacy step was reached, inside that one event's races.
 *
 * `editionsStoryComplete` and `editionsExperienced` count distinct edition
 * identities; `consecutiveEditions` is the first Story Complete after which
 * the dated Story Complete years hold a run that long; `realHours` is the
 * event's credited time, crossed at the same point the app recognises it.
 */
export function eventStepInstant(
  timeline: CareerTimeline,
  eventKey: string,
  metric: string,
  threshold: number,
): InstantResult | null {
  const stints = stintsByEvent(timeline).get(eventKey) ?? [];
  switch (metric) {
    case 'editionsStoryComplete': {
      const stint = nthEditionStint(timeline, stints, threshold, (candidate) => candidate.completesStory);
      return stint ? stintInstant(stint) : null;
    }
    case 'editionsExperienced': {
      const stint = nthEditionStint(timeline, stints, threshold, (candidate) => candidate.experiencesRace);
      return stint ? stintInstant(stint) : null;
    }
    case 'consecutiveEditions': {
      const years: number[] = [];
      for (const stint of stints) {
        if (!stint.completesStory) continue;
        const year = timeline.racesById.get(stint.raceId)?.editionYear;
        if (year === null || year === undefined) continue;
        years.push(year);
        if ((longestConsecutiveRun(years)?.length ?? 0) >= threshold) return stintInstant(stint);
      }
      return null;
    }
    case 'realHours':
      return cumulativeCrossing(stints, recognitionThresholdSeconds(metric, threshold), (stint) => stint.creditedSeconds);
    default:
      return null;
  }
}

/**
 * Whether a replayed instant may date a landmark: it must not fall after the
 * moment the app recorded it (plus a little slack for the clock). A replay can
 * land later than that once stints have been deleted since, and a landmark is
 * never dated after the moment it was already known to have happened.
 */
export function acceptInstant(instant: { at: Date }, recognisedAt: Date, slackMinutes: number): boolean {
  return instant.at.getTime() <= recognisedAt.getTime() + slackMinutes * 60_000;
}

/**
 * Add one stint's credited seconds to the local calendar years its window
 * touches, in whole seconds: every part is rounded except the last, which
 * takes what is left, so a stint is never worth more or less than itself.
 */
function addToYears(totals: Map<number, number>, startsAt: Date, endsAt: Date, credited: number): void {
  if (credited <= 0) return;
  const firstYear = startsAt.getFullYear();
  const lastYear = endsAt.getFullYear();
  if (!(endsAt > startsAt) || firstYear === lastYear) {
    totals.set(lastYear, (totals.get(lastYear) ?? 0) + credited);
    return;
  }
  let assigned = 0;
  for (let year = firstYear; year <= lastYear; year += 1) {
    const part = year === lastYear
      ? credited - assigned
      : Math.round(credited * (clipToWindow(startsAt, endsAt, yearWindow(year))?.fraction ?? 0));
    assigned += part;
    if (part > 0) totals.set(year, (totals.get(year) ?? 0) + part);
  }
}

/** Credited seconds per local calendar year, split over the stint windows. */
export function creditedSecondsByLocalYear(timeline: CareerTimeline): Map<number, number> {
  const totals = new Map<number, number>();
  for (const stint of timeline.stints) addToYears(totals, stint.startsAt, stint.watchedAt, stint.creditedSeconds);
  return totals;
}

/**
 * The same figure from the raw stints, without the interval replay: the
 * windows need only each stint's credited time and the previous stint's
 * instant. `syncCareerMilestones` uses this on every stint.
 */
export function creditedSecondsByLocalYearOfSessions(
  sessions: readonly TimelineSessionRow[],
  xpMinSpeed: number = DEFAULT_TIMELINE_OPTIONS.xpMinSpeed,
): Map<number, number> {
  const totals = new Map<number, number>();
  let previous: Date | null = null;
  for (const session of [...sessions].sort(compareCanonical)) {
    const credited = creditedSeconds(session, xpMinSpeed);
    const nominal = new Date(session.watchedAt.getTime() - credited * 1000);
    const startsAt = previous !== null && previous > nominal ? previous : nominal;
    addToYears(totals, startsAt, session.watchedAt, credited);
    previous = session.watchedAt;
  }
  return totals;
}

/** Distinct experienced edition identities per event key, over the whole career. */
export function editionsExperiencedByEvent(timeline: CareerTimeline): Map<string, number> {
  const identities = new Map<string, Set<string>>();
  for (const history of timeline.races.values()) {
    const race = history.race;
    if (race.eventKey === null || history.experiencedAt === null) continue;
    const set = identities.get(race.eventKey) ?? new Set<string>();
    set.add(editionIdentityOf(race.id, race.editionYear));
    identities.set(race.eventKey, set);
  }
  return new Map([...identities].map(([key, set]) => [key, set.size]));
}
