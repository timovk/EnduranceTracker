/**
 * The Race Strategist.
 *
 * Answers exactly one question — "what should I watch next?" — with at most
 * three suggestions:
 *
 *   CONTINUE  a partially watched race, so an existing story gets finished
 *   BEST_FIT  a race that fits the viewing window the user actually has
 *   WILDCARD  something deliberately unlike the other two
 *
 * A race whose race date is still to come is never one of them (0.3.2): it
 * cannot be watched yet. It stays in the library and is suggested from its
 * race day on. See `isStillToCome` in `@/lib/domain/race-day`.
 *
 * ===========================================================================
 * THE STRATEGIST DOES NOT OPTIMISE XP.
 *
 * There is no term in the scoring function derived from XP, XP rate, XP per
 * hour, season XP, tier cost or level progress, and no import of `XP_CONFIG`
 * or the XP ledger anywhere in this file. That is deliberate and structural,
 * not an oversight: the moment a recommender optimises XP per hour it stops
 * recommending races and starts recommending grinding, and the application
 * would quietly become the chore it is designed not to be. `scoreCandidate`
 * measures enjoyment, narrative continuity and completion — nothing else.
 * `tests/engines/strategist.test.ts` asserts this stays true.
 * ===========================================================================
 *
 * Two further rules this module keeps:
 *
 *   * Real viewing time and race-timeline time are different quantities. Every
 *     "how long will this take" figure here is REAL seconds, converted from
 *     timeline seconds through the user's own playback speed.
 *   * Nothing is ever phrased as an obligation. A headline states what a race
 *     is and how long it would take, in the indicative and never the
 *     imperative; the UI pairs the panel with `RECOMMENDATION_FOOTNOTE` from
 *     `@/lib/copy/tone`. No suggestion instructs, and no race is ever late.
 *
 * `getRecommendations` reads; it never writes, so it takes no transaction
 * client. `scoreCandidate` and `buildRecommendations` are pure, so the rules
 * above are testable without a database.
 */

import { differenceInCalendarDays, isSameDay } from 'date-fns';

import { STRATEGIST_CONFIG, STRATEGIST_SHAPE, TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { RECOMMENDATION_PREFIXES } from '@/lib/copy/tone';
import { prisma } from '@/lib/db/client';
import { fromRows, gapsIn } from '@/lib/domain/intervals';
import { dayPeriod } from '@/lib/domain/periods';
import { averagePlaybackSpeed, clampSpeed, realSecondsFor, suggestStints } from '@/lib/domain/playback';
import { isStillToCome, raceDayStart } from '@/lib/domain/race-day';
import { formatDuration } from '@/lib/domain/time';
import type { Interval, RacePriority, RaceStatus } from '@/lib/domain/types';
import type { Recommendation, RecommendationKind, StillToCome, StrategistView } from '@/lib/engines/contracts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One race, reduced to everything the strategist is allowed to know about it.
 *
 * Deliberately a plain value type with no Prisma types in it: the scoring rules
 * are the interesting part of this engine, and they must be exercisable from a
 * test that never opens a connection.
 *
 * `coverageSec` is the single source of truth for "how much is left"; `gaps`
 * describes only WHERE the unwatched timeline is, and is used to divide a long
 * race into stints. The two come from the same intervals, so they agree.
 */
export interface RaceCandidate {
  id: string;
  name: string;
  championshipId: string | null;
  championshipName: string | null;
  championshipColor: string | null;
  seasonId: string | null;
  /** Display label for the season, e.g. "2027 WEC". Null when unfiled. */
  seasonLabel: string | null;
  circuit: string | null;
  runtimeSec: number;
  /** Unique timeline seconds covered. Re-watching does not increase this. */
  coverageSec: number;
  status: RaceStatus;
  priority: RacePriority;
  /** Personal excitement rating, 1-5. */
  excitement: number;
  isMajorEvent: boolean;
  storyComplete: boolean;
  /**
   * The day the race is run, as stored: the typed calendar day at midnight
   * UTC. Null when the user gave none.
   */
  raceDate: Date | null;
  /** Stints logged on this race. One is enough to make a dated race watchable. */
  sessionCount: number;
  lastWatchedAt: Date | null;
  /** Unwatched holes in the timeline, merged and ordered. */
  gaps: readonly Interval[];
  /** This race's own weighted playback speed; null when never watched. */
  avgPlaybackSpeed: number | null;
  /** Races the user counts as this season. Zero when the race has no season. */
  seasonRaceCount: number;
  /** How many of those, including this one, are not yet Story Complete. */
  seasonRacesRemaining: number;
}

/**
 * An open objective a race could contribute to — an active challenge, or a
 * running season pass.
 *
 * Note what this type does NOT carry: any reward figure. The strategist knows
 * that an objective is open and how much of it is left, never what it pays.
 */
export interface StrategistObjective {
  key: string;
  /** Shown verbatim in a reason chip, so it reads as a name, not an id. */
  label: string;
  kind: 'CHALLENGE' | 'SEASON_PASS';
  /** Races named explicitly by the objective. Empty means "not race-specific". */
  raceIds: readonly string[];
  championshipIds: readonly string[];
  seasonIds: readonly string[];
  /** Minimum race runtime the objective asks for, in timeline seconds. */
  minRuntimeSec: number;
  requiresMajorEvent: boolean;
  /** True when the objective advances by finishing a story rather than by time. */
  favoursStoryComplete: boolean;
  /** How much of the objective is still open, 0-1. */
  remainingFraction: number;
}

/** Everything the scorer needs that is not a property of the race itself. */
export interface StrategistContext {
  now: Date;
  /** The viewing window the user has, in REAL seconds. */
  windowSeconds: number;
  /** Career-wide playback speed, used when a race has none of its own. */
  defaultPlaybackSpeed?: number;
  objectives?: readonly StrategistObjective[];
  /**
   * Championships already represented in this set of suggestions. Feeding this
   * back in is what makes `varietyPenalty` work without the scorer keeping
   * state of its own.
   */
  alreadySuggestedChampionshipIds?: readonly string[];
  /**
   * Stable per-day seed for the wildcard draw. Defaults to the local calendar
   * day, so refreshing the page never reshuffles the suggestion.
   */
  daySeed?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The speed this user actually watches this race at, never zero. */
function speedFor(candidate: RaceCandidate, context: StrategistContext): number {
  const raceSpeed = candidate.avgPlaybackSpeed;
  if (raceSpeed !== null && Number.isFinite(raceSpeed) && raceSpeed > 0) return clampSpeed(raceSpeed);
  const careerSpeed = context.defaultPlaybackSpeed;
  if (careerSpeed !== undefined && Number.isFinite(careerSpeed) && careerSpeed > 0) return clampSpeed(careerSpeed);
  return 1;
}

/**
 * Everything derived from a candidate and the window, computed once.
 *
 * Kept in one place because the scorer, the headline and the recommendation
 * itself must all quote the same numbers — a suggestion that scores on "fits
 * your window" and then prints a different duration would be worse than no
 * suggestion at all.
 */
interface CandidateEstimate {
  speed: number;
  /** Coverage as a fraction of runtime, 0-1. */
  progress: number;
  completionPercent: number;
  timelineRemainingSec: number;
  realSecondsToFinish: number;
  suggestedStintSeconds: number;
  isLongHaul: boolean;
  started: boolean;
  canFinishInWindow: boolean;
}

function estimateCandidate(candidate: RaceCandidate, context: StrategistContext): CandidateEstimate {
  const runtimeSec = Math.max(0, candidate.runtimeSec);
  const covered = Math.min(Math.max(0, candidate.coverageSec), runtimeSec);
  const progress = runtimeSec === 0 ? 0 : covered / runtimeSec;
  const timelineRemainingSec = Math.max(0, runtimeSec - covered);

  const speed = speedFor(candidate, context);
  const realSecondsToFinish = realSecondsFor(timelineRemainingSec, speed);

  // A long race is an expedition, never a single sitting. Its next stint — not
  // its whole remainder — is what the user is actually being offered, so that
  // is also what the window-fit term is measured against further down.
  const isLongHaul = runtimeSec >= TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec;
  const stints = isLongHaul
    ? suggestStints(candidate.gaps, TWENTY_FOUR_HOUR_CONFIG.suggestedStintMinutes, speed)
    : [];
  const firstStint = stints[0];
  const suggestedStintSeconds = isLongHaul && firstStint !== undefined
    ? firstStint.realSeconds
    : realSecondsToFinish;

  return {
    speed,
    progress,
    completionPercent: round(progress * 100, 1),
    timelineRemainingSec,
    realSecondsToFinish,
    suggestedStintSeconds,
    isLongHaul,
    started: progress >= STRATEGIST_SHAPE.startedThreshold,
    canFinishInWindow:
      context.windowSeconds > 0 && realSecondsToFinish > 0 && realSecondsToFinish <= context.windowSeconds,
  };
}

/**
 * Whether a race is one the user might still want to watch: not deliberately
 * put away, and not already seen in full.
 */
function isUnfinished(candidate: RaceCandidate): boolean {
  if (candidate.runtimeSec <= 0) return false;
  if (candidate.storyComplete) return false;
  return candidate.status !== 'ARCHIVED' && candidate.status !== 'ABANDONED';
}

/**
 * A race is a candidate unless the user has deliberately put it away, has
 * already seen the whole story, or it has not been run yet. Nothing else is
 * filtered out — a library is a set of future experiences, and the strategist
 * does not curate it.
 */
function isEligible(candidate: RaceCandidate, now: Date): boolean {
  return isUnfinished(candidate) && !isStillToCome(candidate, now);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score one race.
 *
 * Every weight comes from `STRATEGIST_CONFIG.weights` and every curve shape
 * from `STRATEGIST_SHAPE`; there is not a single tuned number inline. Each term
 * is normalised to 0-1 before its weight is applied, so the weights can be read
 * as "how many points is this consideration worth at its strongest", and a
 * re-balance is a config change rather than a rewrite.
 *
 * Reminder, because it is the whole point of this engine: no term below is
 * derived from XP.
 */
export function scoreCandidate(
  candidate: RaceCandidate,
  context: StrategistContext,
): { score: number; reasons: string[] } {
  const weights = STRATEGIST_CONFIG.weights;
  const shape = STRATEGIST_SHAPE;
  const estimate = estimateCandidate(candidate, context);

  let score = 0;
  const reasons: string[] = [];

  /**
   * Apply one term. Only positive contributions earn a chip: a chip explains
   * why a race was suggested, and the two negative terms exist to shape the
   * set of three, not to say anything about the race itself.
   */
  const add = (weight: number, value: number, reason: string | null): void => {
    const contribution = weight * clamp01(value);
    score += contribution;
    if (reason !== null && contribution >= shape.reasonThreshold) reasons.push(reason);
  };

  // -- Continuity: finishing an existing story beats starting a new one -----
  // The large floor is the point. Any race already under way carries most of
  // this weight immediately, and progress scales the remainder, so a race at
  // 8% still reads as "you started this" rather than "practically untouched".
  if (estimate.started) {
    const continuity = shape.continuityBase + (1 - shape.continuityBase) * estimate.progress;
    add(weights.continuity, continuity, `${Math.round(estimate.completionPercent)}% through already`);
  }

  // -- Progress depth: peaks mid-race --------------------------------------
  // A triangle that is 1 at the peak and exactly 0 at both ends: barely-started
  // races are covered by continuity, and nearly-finished races are covered by
  // the window fit of their short remainder.
  if (estimate.started) {
    const peak = clamp01(shape.progressDepthPeak);
    const span = estimate.progress > peak ? 1 - peak : peak;
    const depth = span <= 0 ? 0 : 1 - Math.abs(estimate.progress - peak) / span;
    add(weights.progressDepth, depth, 'Deep into this one');
  }

  // -- Staleness: a gentle, capped nudge ------------------------------------
  // Capped at full strength and never scaled beyond it, so a race left alone
  // for a year is nudged exactly as softly as one left alone for three weeks.
  // Nothing here is a reminder, and nothing is ever late.
  if (estimate.started && candidate.lastWatchedAt !== null) {
    const days = Math.max(0, differenceInCalendarDays(context.now, candidate.lastWatchedAt));
    const staleness = STRATEGIST_CONFIG.stalenessFullDays <= 0
      ? 0
      : Math.min(1, days / STRATEGIST_CONFIG.stalenessFullDays);
    add(weights.staleness, staleness, 'Waiting quietly since your last stint');
  }

  // -- Priority: what the user told us ---------------------------------------
  // NORMAL and LOW still contribute their share, but they earn no chip: the
  // absence of a stated preference is not a reason to watch something.
  const priorityReason = candidate.priority === 'MUST_WATCH'
    ? 'Must-watch in your library'
    : candidate.priority === 'HIGH'
      ? 'High on your list'
      : null;
  add(weights.priority, shape.priorityAffinity[candidate.priority], priorityReason);

  // -- Excitement: the user's own 1-5 rating ---------------------------------
  // Only an above-midpoint rating is worth saying out loud. Quoting a neutral
  // 3 out of 5 back at the user reads as filler rather than as a reason.
  const excitementSpan = shape.excitementScale.max - shape.excitementScale.min;
  const excitement = excitementSpan <= 0
    ? 0
    : (candidate.excitement - shape.excitementScale.min) / excitementSpan;
  const excitementMidpoint = (shape.excitementScale.min + shape.excitementScale.max) / 2;
  add(
    weights.excitement,
    excitement,
    candidate.excitement > excitementMidpoint ? `You rated this ${candidate.excitement} out of 5` : null,
  );

  // -- Window fit ------------------------------------------------------------
  // A partial fit still scores; it just does not boast about it. A chip that
  // claims the race fits the window has to be literally true, or the panel
  // starts telling small lies about the clock.
  const stintFitsWindow = context.windowSeconds > 0 && estimate.suggestedStintSeconds <= context.windowSeconds;
  const windowReason = estimate.canFinishInWindow
    ? 'Finishes inside your window'
    : estimate.isLongHaul && stintFitsWindow
      ? 'The next stint fits your window'
      : null;
  add(weights.windowFit, windowFitTerm(estimate, context), windowReason);

  // -- Completion proximity: one race from a complete season -----------------
  add(
    weights.completionProximity,
    completionProximityTerm(candidate),
    completionProximityReason(candidate),
  );

  // -- Objective support -----------------------------------------------------
  const objective = bestObjective(candidate, estimate, context);
  if (objective !== null) {
    add(weights.objectiveSupport, objective.strength, `Counts towards ${objective.objective.label}`);
  }

  // -- Major event -----------------------------------------------------------
  add(weights.majorEvent, candidate.isMajorEvent ? 1 : 0, 'One of the big ones');

  // -- Variety: negative, so three picks are not three of the same thing -----
  const sameChampionship =
    candidate.championshipId !== null &&
    (context.alreadySuggestedChampionshipIds ?? []).includes(candidate.championshipId);
  add(weights.varietyPenalty, sameChampionship ? 1 : 0, null);

  // -- Freshness: negative, and neutral ---------------------------------------
  // A race watched earlier today is simply less likely to be the answer to
  // "what next". It is not discouraged, and nothing is taken away for it.
  const watchedToday = candidate.lastWatchedAt !== null && isSameDay(candidate.lastWatchedAt, context.now);
  add(weights.freshnessPenalty, watchedToday ? 1 : 0, null);

  return { score: round(score, 3), reasons };
}

/**
 * How well the race fits the available window.
 *
 * Best inside `windowFitIdeal`, tailing off on both sides — a five-minute
 * remainder under-uses two free hours, and a race three times the window is a
 * different kind of commitment. A separate share of the term is reserved for
 * "and this can actually be finished in the time you have", which is the single
 * most satisfying thing a suggestion can offer.
 *
 * For a long-haul race the demand measured is the next STINT rather than the
 * whole remainder, because a stint is what is actually being suggested. Without
 * this a 24-hour race could never fit any realistic window and would quietly
 * become unrecommendable.
 */
function windowFitTerm(estimate: CandidateEstimate, context: StrategistContext): number {
  if (context.windowSeconds <= 0) return 0;

  const demandSec = estimate.isLongHaul ? estimate.suggestedStintSeconds : estimate.realSecondsToFinish;
  if (demandSec <= 0) return 0;

  const ideal = STRATEGIST_CONFIG.windowFitIdeal;
  const ratio = demandSec / context.windowSeconds;

  let closeness: number;
  if (ratio < ideal.min) closeness = ideal.min <= 0 ? 1 : ratio / ideal.min;
  else if (ratio > ideal.max) closeness = ideal.max / ratio;
  else closeness = 1;

  const finishShare = clamp01(STRATEGIST_SHAPE.windowFitFinishShare);
  const finishable = estimate.isLongHaul ? demandSec <= context.windowSeconds : estimate.canFinishInWindow;
  return clamp01(clamp01(closeness) * (1 - finishShare) + (finishable ? finishShare : 0));
}

/**
 * How close this race is to completing its season.
 *
 * Scarcity does the work — the last outstanding race of a season scores full
 * marks — and the fraction of the season already finished scales it, so "one of
 * eight left" reads as a bigger occasion than "one of one, nothing else done".
 */
function completionProximityTerm(candidate: RaceCandidate): number {
  if (candidate.seasonId === null) return 0;
  const total = Math.max(candidate.seasonRaceCount, candidate.seasonRacesRemaining);
  if (total <= 0) return 0;

  const remaining = Math.max(1, candidate.seasonRacesRemaining);
  const scarcity = 1 / remaining;
  const seasonProgress = clamp01((total - remaining) / total);
  const floor = clamp01(STRATEGIST_SHAPE.completionProximityFloor);
  return clamp01(scarcity * (floor + (1 - floor) * seasonProgress));
}

function completionProximityReason(candidate: RaceCandidate): string | null {
  if (candidate.seasonId === null || candidate.seasonLabel === null) return null;
  const remaining = Math.max(1, candidate.seasonRacesRemaining);
  return remaining === 1
    ? `One race from completing ${candidate.seasonLabel}`
    : `${remaining} races from completing ${candidate.seasonLabel}`;
}

/**
 * The open objective this race serves best, if any.
 *
 * Matching runs most-specific first: a challenge that names this race is worth
 * more than one that merely asks for a long race. The strength is scaled by how
 * much of the objective is still open, so an objective that is all but finished
 * stops steering the suggestions.
 */
function bestObjective(
  candidate: RaceCandidate,
  estimate: CandidateEstimate,
  context: StrategistContext,
): { objective: StrategistObjective; strength: number } | null {
  let best: { objective: StrategistObjective; strength: number } | null = null;

  for (const objective of context.objectives ?? []) {
    const match = objectiveMatch(candidate, objective, estimate);
    if (match <= 0) continue;
    const strength = clamp01(match * clamp01(objective.remainingFraction));
    if (strength <= 0) continue;
    if (best === null || strength > best.strength) best = { objective, strength };
  }

  return best;
}

function objectiveMatch(
  candidate: RaceCandidate,
  objective: StrategistObjective,
  estimate: CandidateEstimate,
): number {
  const match = STRATEGIST_SHAPE.objectiveMatch;

  if (objective.raceIds.includes(candidate.id)) return match.namedRace;
  if (candidate.seasonId !== null && objective.seasonIds.includes(candidate.seasonId)) return match.season;
  if (candidate.championshipId !== null && objective.championshipIds.includes(candidate.championshipId)) {
    return match.championship;
  }

  // Past this point the objective is not about this race in particular, so a
  // targeted objective that the race does not satisfy contributes nothing.
  const targeted =
    objective.raceIds.length > 0 || objective.seasonIds.length > 0 || objective.championshipIds.length > 0;

  if (objective.requiresMajorEvent) return candidate.isMajorEvent ? match.majorEvent : 0;
  if (objective.minRuntimeSec > 0) return candidate.runtimeSec >= objective.minRuntimeSec ? match.runtime : 0;
  if (targeted) return 0;
  if (objective.favoursStoryComplete) {
    return estimate.canFinishInWindow ? match.storyCompletion : match.generic;
  }
  return match.generic;
}

// ---------------------------------------------------------------------------
// Deterministic wildcard draw
// ---------------------------------------------------------------------------

/**
 * A 32-bit FNV-1a hash of a string. Used only to seed the wildcard draw.
 */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One deterministic draw in [0, 1) from a string seed (a mulberry32 step).
 *
 * `Math.random()` is deliberately not used anywhere in this engine: the
 * wildcard has to be the same race all day, or refreshing the page would
 * reshuffle the suggestion and the panel would feel like a slot machine rather
 * than a considered recommendation.
 */
function deterministicUnit(seed: string): number {
  let state = (hashSeed(seed) + 0x6d2b79f5) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 1 | state);
  state = (state + Math.imul(state ^ (state >>> 7), 61 | state)) ^ state;
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
}

/**
 * How good a wildcard a race is: a little of its ordinary score, plus the three
 * things that make a suggestion feel like a change of scene, plus a stable
 * daily jitter so the wildcard is not simply the fourth-best race every day.
 */
function wildcardAffinity(
  candidate: RaceCandidate,
  context: StrategistContext,
  score: number,
  bestScore: number,
): number {
  const shape = STRATEGIST_SHAPE.wildcard;
  const estimate = estimateCandidate(candidate, context);
  const seed = `${context.daySeed ?? dayPeriod(context.now).key}:${candidate.id}`;

  const differentChampionship =
    candidate.championshipId === null ||
    !(context.alreadySuggestedChampionshipIds ?? []).includes(candidate.championshipId);

  const excitementSpan = STRATEGIST_SHAPE.excitementScale.max - STRATEGIST_SHAPE.excitementScale.min;
  const excitement = excitementSpan <= 0
    ? 0
    : clamp01((candidate.excitement - STRATEGIST_SHAPE.excitementScale.min) / excitementSpan);

  const relativeScore = bestScore > 0 ? clamp01(score / bestScore) : 0;

  return (
    shape.scoreShare * relativeScore +
    shape.differentChampionship * (differentChampionship ? 1 : 0) +
    shape.unstarted * (estimate.started ? 0 : 1) +
    shape.excitement * excitement +
    shape.jitter * deterministicUnit(seed)
  );
}

// ---------------------------------------------------------------------------
// Headlines
// ---------------------------------------------------------------------------

/**
 * The single sentence the UI prints verbatim.
 *
 * Written as a statement of fact about the race and the clock, never as an
 * instruction. A suggestion that tells you what you must do is a chore.
 */
function buildHeadline(
  kind: RecommendationKind,
  candidate: RaceCandidate,
  context: StrategistContext,
  estimate: CandidateEstimate,
): string {
  const percent = Math.round(estimate.completionPercent);
  const remaining = formatDuration(estimate.realSecondsToFinish);
  const stint = formatDuration(estimate.suggestedStintSeconds);
  const window = formatDuration(context.windowSeconds);
  const stintFits = context.windowSeconds > 0 && estimate.suggestedStintSeconds <= context.windowSeconds;

  if (kind === 'CONTINUE') {
    if (estimate.isLongHaul) {
      return `Continue the ${candidate.name}. You're ${percent}% through the race; the next stint is about ${stint} at your usual playback speed, with ${remaining} still to come.`;
    }
    const tail = estimate.canFinishInWindow
      ? ` That sits inside the ${window} you have.`
      : '';
    return `Continue the ${candidate.name}. You're ${percent}% through the race and about ${remaining} at your usual playback speed completes the story.${tail}`;
  }

  if (kind === 'BEST_FIT') {
    if (estimate.isLongHaul) {
      return stintFits
        ? `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} is an expedition of about ${remaining}, and a first stint of roughly ${stint} sits inside your ${window}.`
        : `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} is an expedition of about ${remaining}, divided into stints of roughly ${stint} — it begins whenever you have the time.`;
    }
    if (estimate.started) {
      return estimate.canFinishInWindow
        ? `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} is ${percent}% watched, and the remaining ${remaining} at your usual playback speed fits your ${window}.`
        : `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} is ${percent}% watched, with about ${remaining} left — your ${window} would take a good chunk out of it.`;
    }
    return estimate.canFinishInWindow
      ? `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} runs about ${remaining} at your usual playback speed, start to finish, inside your ${window}.`
      : `${RECOMMENDATION_PREFIXES.bestFit}: the ${candidate.name} runs about ${remaining} at your usual playback speed — a fine one to open with your ${window} and return to.`;
  }

  const scene = candidate.championshipName === null
    ? ''
    : ` A change of scene from the ${candidate.championshipName}.`;
  if (estimate.started) {
    return `${RECOMMENDATION_PREFIXES.wildcard}: the ${candidate.name}, sitting at ${percent}% with about ${remaining} left whenever you fancy it.${scene}`;
  }
  return `${RECOMMENDATION_PREFIXES.wildcard}: the ${candidate.name}, still untouched — about ${remaining} at your usual playback speed.${scene}`;
}

function toRecommendation(
  kind: RecommendationKind,
  candidate: RaceCandidate,
  context: StrategistContext,
  score: number,
  reasons: string[],
): Recommendation {
  const estimate = estimateCandidate(candidate, context);
  return {
    kind,
    raceId: candidate.id,
    raceName: candidate.name,
    championshipName: candidate.championshipName,
    championshipColor: candidate.championshipColor,
    circuit: candidate.circuit,
    runtimeSec: candidate.runtimeSec,
    coverageSec: Math.min(Math.max(0, candidate.coverageSec), Math.max(0, candidate.runtimeSec)),
    completionPercent: estimate.completionPercent,
    realSecondsToFinish: estimate.realSecondsToFinish,
    suggestedStintSeconds: estimate.suggestedStintSeconds,
    isMajorEvent: candidate.isMajorEvent,
    headline: buildHeadline(kind, candidate, context, estimate),
    reasons,
    score,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  candidate: RaceCandidate;
  score: number;
  reasons: string[];
}

/**
 * Rank by score, breaking ties on the race id.
 *
 * The tie-break matters: without it the suggestion could change when the
 * database happened to return rows in a different order, and a recommendation
 * that moves for no reason is not a recommendation.
 */
function rank(scored: ScoredCandidate[]): ScoredCandidate[] {
  return [...scored].sort(
    (a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
  );
}

function scoreAll(candidates: readonly RaceCandidate[], context: StrategistContext): ScoredCandidate[] {
  return candidates.map((candidate) => ({ candidate, ...scoreCandidate(candidate, context) }));
}

/**
 * Turn a library into at most three suggestions.
 *
 * Pure, and the whole selection policy in one readable place. The three slots
 * are filled in order, each one told which championships are already spoken
 * for, which is how the variety term stops the panel being three races from the
 * same season.
 *
 * If fewer than three races genuinely qualify, fewer are returned. A race is
 * never repeated across slots, and a finished story is never padding.
 */
export function buildRecommendations(
  candidates: readonly RaceCandidate[],
  context: StrategistContext,
): Recommendation[] {
  const eligible = new Map<string, RaceCandidate>();
  for (const candidate of candidates) {
    if (isEligible(candidate, context.now) && !eligible.has(candidate.id)) eligible.set(candidate.id, candidate);
  }

  const picked: Recommendation[] = [];
  const pickedIds = new Set<string>();
  const championships: string[] = [];

  const withVariety = (): StrategistContext => ({ ...context, alreadySuggestedChampionshipIds: [...championships] });
  const remaining = (): RaceCandidate[] =>
    [...eligible.values()].filter((candidate) => !pickedIds.has(candidate.id));

  const take = (kind: RecommendationKind, choice: ScoredCandidate | undefined, ctx: StrategistContext): void => {
    if (choice === undefined) return;
    picked.push(toRecommendation(kind, choice.candidate, ctx, choice.score, choice.reasons));
    pickedIds.add(choice.candidate.id);
    if (choice.candidate.championshipId !== null) championships.push(choice.candidate.championshipId);
  };

  // -- CONTINUE: the best story already under way ---------------------------
  const continueCtx = withVariety();
  const started = remaining().filter((candidate) => estimateCandidate(candidate, continueCtx).started);
  take('CONTINUE', rank(scoreAll(started, continueCtx))[0], continueCtx);

  // -- BEST_FIT: the best race that the window can actually hold ------------
  // Races that can be finished in the window are preferred outright, because
  // "and you could finish it tonight" is the thing that makes the slot useful.
  // When nothing fits, the best-scoring race takes the slot instead.
  const fitCtx = withVariety();
  const fitPool = scoreAll(remaining(), fitCtx);
  const finishable = fitPool.filter((entry) => estimateCandidate(entry.candidate, fitCtx).canFinishInWindow);
  take('BEST_FIT', rank(finishable.length > 0 ? finishable : fitPool)[0], fitCtx);

  // -- WILDCARD: deliberately different, and the same all day ---------------
  const wildCtx = withVariety();
  const wildPool = scoreAll(remaining(), wildCtx);
  const bestScore = rank(wildPool)[0]?.score ?? 0;
  const wildcard = [...wildPool]
    .map((entry) => ({
      entry,
      affinity: wildcardAffinity(entry.candidate, wildCtx, entry.score, bestScore),
    }))
    .sort((a, b) => b.affinity - a.affinity || a.entry.candidate.id.localeCompare(b.entry.candidate.id))[0];
  take('WILDCARD', wildcard?.entry, wildCtx);

  return picked.slice(0, STRATEGIST_CONFIG.recommendationCount);
}

/**
 * The unfinished races left out only because they have not been run yet: how
 * many, and the first day one of them is on.
 *
 * Pure, like `buildRecommendations`, and counted with the same rules, so the
 * number the panel quotes is exactly the races the suggestions skipped. Only
 * the count and a date leave this function, never the races: they are not
 * shown until they can be watched.
 */
export function summariseStillToCome(candidates: readonly RaceCandidate[], now: Date): StillToCome {
  const seen = new Set<string>();
  let count = 0;
  let next: Date | null = null;
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (!isUnfinished(candidate) || !isStillToCome(candidate, now)) continue;
    count += 1;
    const day = raceDayStart(candidate.raceDate);
    if (day !== null && (next === null || day.getTime() < next.getTime())) next = day;
  }
  return { count, nextRaceDay: next };
}

// ---------------------------------------------------------------------------
// Reading the library
// ---------------------------------------------------------------------------

/** Metrics whose progress is advanced by finishing a story, not by time spent. */
const STORY_ORIENTED_METRICS: readonly string[] = [
  'storyCompletes',
  'racesCompleted',
  'seasonsCompleted',
  'seasonsStoryComplete',
  'majorEventStories',
];

function readParam(params: unknown, key: string): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  return (params as Record<string, unknown>)[key];
}

function readStringArray(params: unknown, key: string): string[] {
  const value = readParam(params, key);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readNumber(params: unknown, key: string): number {
  const value = readParam(params, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Challenge metrics of the form `stories12h` carry their own runtime floor.
 * Reading it from the name keeps the strategist in step with the challenge
 * generator without either engine importing the other.
 */
function runtimeFloorFromMetric(metric: string): number {
  const match = /^stories(\d+)h$/.exec(metric);
  if (match === null) return 0;
  const hours = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(hours) ? hours * 3600 : 0;
}

/**
 * How a season is named in a reason chip: the user's own label if they set one,
 * otherwise the year and the championship's short name — "2027 WEC".
 */
function seasonLabelFor(
  season: { year: number; label: string | null } | null,
  championshipLabel: string | null,
): string | null {
  if (season === null) return null;
  if (season.label !== null) return season.label;
  return championshipLabel === null ? `${season.year}` : `${season.year} ${championshipLabel}`;
}

/**
 * Suggest what to watch next.
 *
 * The suggestions alone; `getStrategist` also says how many races were left
 * out because they have not been run yet.
 */
export async function getRecommendations(
  userId: string,
  opts: { windowMinutes?: number; now?: Date } = {},
): Promise<Recommendation[]> {
  return (await getStrategist(userId, opts)).recommendations;
}

/**
 * Suggest what to watch next, and say what was left out for not having been
 * run yet.
 *
 * Read-only, so it uses `prisma` directly rather than a transaction client.
 * Everything it reads is turned into plain `RaceCandidate` values and handed to
 * `buildRecommendations`, so the database layer and the rules stay separable.
 */
export async function getStrategist(
  userId: string,
  opts: { windowMinutes?: number; now?: Date } = {},
): Promise<StrategistView> {
  const now = opts.now ?? new Date();
  const windowMinutes = opts.windowMinutes ?? STRATEGIST_CONFIG.defaultWindowMinutes;

  const [races, intervalRows, sessionTotals, challengeRows, activePass] = await Promise.all([
    // The whole library, not just the eligible part: completed and archived
    // races are what make "one race from completing 2027 WEC" true.
    prisma.race.findMany({
      where: { userId },
      select: {
        id: true, name: true, status: true, priority: true, excitement: true,
        runtimeSec: true, coverageSec: true, isMajorEvent: true, circuit: true, raceDate: true,
        avgPlaybackSpeed: true, sessionCount: true, lastWatchedAt: true,
        storyCompletedAt: true, championshipId: true, seasonId: true,
        championship: { select: { name: true, shortName: true, accentColor: true } },
        season: { select: { year: true, label: true, plannedRaceCount: true } },
      },
    }),
    prisma.watchedInterval.findMany({
      where: { race: { userId } },
      select: { raceId: true, startSec: true, endSec: true },
    }),
    // The career-wide playback speed, used for races the user has not watched
    // yet and therefore has no speed of their own.
    prisma.raceViewingSession.aggregate({
      where: { userId },
      _sum: { timelineSeconds: true, realSeconds: true },
    }),
    prisma.challenge.findMany({
      where: { userId, periodStart: { lte: now }, periodEnd: { gt: now } },
      select: {
        id: true, title: true, metric: true, target: true, params: true,
        progress: { select: { value: true, state: true } },
      },
    }),
    prisma.seasonPass.findFirst({
      where: { userId, isArchived: false, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true, year: true, quarter: true },
    }),
  ]);

  const careerSpeed = averagePlaybackSpeed([
    {
      timelineSeconds: sessionTotals._sum.timelineSeconds ?? 0,
      realSeconds: sessionTotals._sum.realSeconds ?? 0,
    },
  ]);

  const intervalsByRace = new Map<string, { startSec: number; endSec: number }[]>();
  for (const row of intervalRows) {
    const bucket = intervalsByRace.get(row.raceId);
    if (bucket === undefined) intervalsByRace.set(row.raceId, [row]);
    else bucket.push(row);
  }

  // Season bookkeeping. A season's size is whatever the user declared, or the
  // number of races they have actually filed under it, whichever is larger —
  // the user owns the definition of their own season.
  const seasonTotals = new Map<string, { count: number; remaining: number; planned: number }>();
  for (const race of races) {
    if (race.seasonId === null) continue;
    if (race.status === 'ARCHIVED') continue;
    const entry = seasonTotals.get(race.seasonId) ?? {
      count: 0,
      remaining: 0,
      planned: race.season?.plannedRaceCount ?? 0,
    };
    entry.count += 1;
    if (race.storyCompletedAt === null && race.status !== 'ABANDONED') entry.remaining += 1;
    seasonTotals.set(race.seasonId, entry);
  }

  const objectives: StrategistObjective[] = [];
  for (const row of challengeRows) {
    const state = row.progress?.state ?? 'ACTIVE';
    if (state !== 'ACTIVE') continue;
    const value = row.progress?.value ?? 0;
    objectives.push({
      key: `challenge:${row.id}`,
      label: row.title,
      kind: 'CHALLENGE',
      raceIds: readStringArray(row.params, 'raceIds'),
      championshipIds: readStringArray(row.params, 'championshipIds'),
      seasonIds: readStringArray(row.params, 'seasonIds'),
      minRuntimeSec: Math.max(readNumber(row.params, 'minRuntimeSec'), runtimeFloorFromMetric(row.metric)),
      requiresMajorEvent:
        readParam(row.params, 'majorEventOnly') === true || row.metric === 'majorEventStories',
      favoursStoryComplete: STORY_ORIENTED_METRICS.includes(row.metric),
      remainingFraction: row.target > 0 ? clamp01(1 - value / row.target) : 1,
    });
  }

  if (activePass !== null) {
    // The pass is an open objective, nothing more. What it pays is none of the
    // strategist's business — see the header of this file.
    objectives.push({
      key: `season-pass:${activePass.id}`,
      label: `your Q${activePass.quarter} ${activePass.year} season pass`,
      kind: 'SEASON_PASS',
      raceIds: [],
      championshipIds: [],
      seasonIds: [],
      minRuntimeSec: 0,
      requiresMajorEvent: false,
      favoursStoryComplete: true,
      remainingFraction: 1,
    });
  }

  const context: StrategistContext = {
    now,
    windowSeconds: Math.max(0, Math.round(windowMinutes * 60)),
    defaultPlaybackSpeed: careerSpeed,
    objectives,
    alreadySuggestedChampionshipIds: [],
    daySeed: dayPeriod(now).key,
  };

  const candidates: RaceCandidate[] = races.map((race) => {
    const runtimeSec = Math.max(0, race.runtimeSec);
    const intervals = fromRows(intervalsByRace.get(race.id) ?? []);
    const season = race.seasonId === null ? undefined : seasonTotals.get(race.seasonId);
    const championshipLabel = race.championship?.shortName ?? race.championship?.name ?? null;

    return {
      id: race.id,
      name: race.name,
      championshipId: race.championshipId,
      championshipName: race.championship?.name ?? null,
      championshipColor: race.championship?.accentColor ?? null,
      seasonId: race.seasonId,
      seasonLabel: seasonLabelFor(race.season, championshipLabel),
      circuit: race.circuit,
      runtimeSec,
      coverageSec: race.coverageSec,
      status: race.status,
      priority: race.priority,
      excitement: race.excitement,
      isMajorEvent: race.isMajorEvent,
      storyComplete: race.storyCompletedAt !== null,
      raceDate: race.raceDate,
      sessionCount: race.sessionCount,
      lastWatchedAt: race.lastWatchedAt,
      gaps: gapsIn(intervals, runtimeSec),
      avgPlaybackSpeed: race.sessionCount > 0 ? race.avgPlaybackSpeed : null,
      seasonRaceCount: season === undefined ? 0 : Math.max(season.count, season.planned),
      seasonRacesRemaining: season === undefined ? 0 : season.remaining,
    };
  });

  return {
    recommendations: buildRecommendations(candidates, context),
    stillToCome: summariseStillToCome(candidates, now),
  };
}
