/**
 * Voice of the application.
 *
 * Anti-chore design lives here as much as it lives in the engines. Every
 * string in this file is written to the same rules:
 *
 *   - A backlog is a library of future experiences, never debt.
 *   - Nothing is ever "missed", "failed", "lost" or "overdue".
 *   - Inactivity is greeted, not scolded.
 *   - Exceeding the budget is information, not a warning.
 *
 * `tests/domain/tone.test.ts` asserts no forbidden word ever appears here.
 */

import { EXPEDITION_CONFIG, EXPEDITION_SHAPE, TIMELINE_SHAPE } from '@/lib/config';
import { clampIntervals, gapsIn } from '@/lib/domain/intervals';
import { formatDuration } from '@/lib/domain/time';
import type { Interval, MilestonePrecision } from '@/lib/domain/types';

/** Words this application does not say to its user. */
export const FORBIDDEN_TONE_WORDS = [
  'failed',
  'failure',
  'you lost',
  'lost your',
  'penalty',
  'penalised',
  'penalized',
  'behind schedule',
  'overdue',
  'wasted',
  'you should have',
  'don’t forget',
  'warning',
  'debt',
] as const;

/** Shown when the user returns after a gap. Chosen by gap length, not guilt. */
export function welcomeBack(daysAway: number): string {
  if (daysAway <= 1) return 'Ready for another stint?';
  if (daysAway <= 3) return 'Welcome back. Ready for another stint?';
  if (daysAway <= 10) return 'Welcome back. Your library is exactly where you left it.';
  if (daysAway <= 35) return 'Welcome back. Plenty of racing still waiting for you.';
  return 'Welcome back. Everything you started is still here, right where you paused it.';
}

/** Neutral framing for a challenge whose window closed. */
export const EXPIRED_CHALLENGE_NOTE =
  'This window has closed. Nothing was deducted — challenges are opportunities, not obligations.';

/** Neutral framing for an archived season pass. */
export const ARCHIVED_PASS_NOTE =
  'This quarter is archived exactly as it finished. Rewards here were cosmetic, so nothing in your permanent career depends on it.';

/** Framing for a library with unwatched races in it. */
export function backlogFraming(count: number): string {
  if (count === 0) return 'Nothing queued. A good moment to add something you have been meaning to watch.';
  if (count === 1) return 'One race waiting for you.';
  return `${count} races waiting for you — a library of future experiences.`;
}

/** Neutral projection copy for the annual budget. Never a restriction. */
export function budgetProjectionNote(projectedHours: number, budgetHours: number): string {
  const rounded = Math.round(projectedHours);
  if (projectedHours <= budgetHours * 0.85) {
    return `At your current pace, you’re projected to finish the year at ${rounded} hours. There’s room for more if you want it.`;
  }
  if (projectedHours <= budgetHours * 1.02) {
    return `At your current pace, you’re projected to finish the year at ${rounded} hours — right around your ${budgetHours}-hour plan.`;
  }
  return `At your current pace, you’re projected to finish the year at ${rounded} hours. That’s above the ${budgetHours}-hour plan, which is entirely fine — the Race Strategist can spread things out if you’d prefer.`;
}

/** Copy for the momentum panel. Never about what happens if you stop. */
export function momentumNote(tierName: string): string {
  return `${tierName}. Momentum reflects recent watching and settles gently on its own.`;
}

/** Stint summary heading. Every session matters, including a short one. */
export function stintHeading(realMinutes: number): string {
  if (realMinutes < 15) return 'STINT LOGGED';
  if (realMinutes < 45) return 'STINT COMPLETE';
  if (realMinutes < 120) return 'LONG STINT COMPLETE';
  return 'DOUBLE STINT COMPLETE';
}

// ---------------------------------------------------------------------------
// The season closure (0.3.1)
// ---------------------------------------------------------------------------
//
// The season pass is closed for a while and opens on a known date. Said
// plainly: what carries on comes first, then when the pass opens. Never
// framed as something taken away. `opensOn` is always a formatted date, e.g.
// "1 October 2026", and `passLabel` the quarter, e.g. "Q4 2026".

/** Headline for the closed season pass. */
export function seasonPassClosedHeadline(opensOn: string): string {
  return `Closed until ${opensOn}`;
}

/** The season pass page, while the pass is closed. */
export function seasonPassClosedNote(passLabel: string, opensOn: string): string {
  return (
    `The ${passLabel} pass opens on ${opensOn} and starts from tier 0, like every pass. ` +
    'Until then every stint still counts towards your career: career XP, levels, achievements, milestones, ' +
    'mastery, collections and daily, weekly and monthly challenges all carry on as usual. ' +
    'Season XP begins when the pass opens.'
  );
}

/** The dashboard's season pass panel, while the pass is closed. */
export function seasonPassClosedShortNote(passLabel: string): string {
  return `The ${passLabel} pass opens then. Stints keep earning career XP in the meantime.`;
}

/** The challenges page, in place of the seasonal challenges. */
export function seasonalChallengesClosedNote(passLabel: string, opensOn: string): string {
  return (
    `Seasonal challenges return on ${opensOn}, with the ${passLabel} season pass. ` +
    'Daily, weekly and monthly challenges carry on as usual.'
  );
}

/** The stint summary, in place of the season XP figure. */
export function seasonClosedStintNote(opensOn: string): string {
  return `Career XP only until the season pass opens on ${opensOn}.`;
}

// ---------------------------------------------------------------------------
// Races still to come (0.3.2)
// ---------------------------------------------------------------------------
//
// A race dated after today is not suggested until its race day. Said as a
// fact about the calendar, never as something withheld. `firstOn` is always a
// formatted date, e.g. "7 November 2026".

/** The strategist's footnote, when races were left out of its suggestions. */
export function stillToComeNote(count: number): string {
  return count === 1
    ? 'One race dated after today joins the suggestions on its race day.'
    : `${count} races dated after today join the suggestions on their race days.`;
}

/** The strategist's empty state, when every unfinished race is still to come. */
export function stillToComeEmptyNote(count: number, firstOn: string): string {
  return count === 1
    ? `The one race in your library still to watch is run on ${firstOn}. The strategist suggests it from that day.`
    : `The ${count} races in your library still to watch have not been run yet; the first is on ${firstOn}. ` +
        'The strategist suggests each one from its race day.';
}

// ---------------------------------------------------------------------------
// Removing a race (0.4.0)
// ---------------------------------------------------------------------------
//
// Deleting a race takes back the XP it earned, and the library says so in one
// plain line: what went, and that everything reached along the way stays.

/** The library's one-line notice after a race was removed. */
export function raceRemovedNotice(raceName: string, xpRemoved: number): string {
  const xp = Math.max(0, Math.round(xpRemoved));
  if (xp === 0) return `${raceName} was removed from the library.`;
  return (
    `${raceName} was removed from the library, with the ${xp.toLocaleString('en-GB')} XP it earned. ` +
    'Achievements and milestones you reached stay.'
  );
}

// ---------------------------------------------------------------------------
// Career Milestones (0.4.0)
// ---------------------------------------------------------------------------
//
// A milestone says when it happened and how exactly that is known, and never
// claims more precision than the history holds. A time worked out inside a
// stint rests on when the stint was logged, so it is shown to the nearest
// few minutes and says so.

function clockTime(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function longDate(at: Date): string {
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * How a milestone's date is known, in one sentence.
 *
 * `at` is `achievedAt`, or the moment the app recorded the milestone when
 * history cannot place it. `subjectName` names the race an interpolated time
 * fell inside. A milestone whose date is still being worked out (the upgrade
 * has not reached it yet) says only when it was recorded.
 */
export function precisionLabel(
  precision: MilestonePrecision | null,
  at: Date,
  subjectName?: string | null,
): string {
  if (precision === 'INTERPOLATED') {
    const step = TIMELINE_SHAPE.displayRoundingMinutes * 60_000;
    const rounded = new Date(Math.round(at.getTime() / step) * step);
    const during = subjectName ? `, during a stint of ${subjectName}` : '';
    return `Reached around ${clockTime(rounded)} on ${longDate(rounded)}${during} (worked out from when the stint was logged)`;
  }
  if (precision === 'STINT') return `Reached with the stint logged at ${clockTime(at)} on ${longDate(at)}`;
  if (precision === 'RECOGNISED') return `Recorded on ${longDate(at)} (history cannot place it more exactly)`;
  return `Recorded on ${longDate(at)}`;
}

/**
 * Who celebrates a milestone that pays no XP of its own, because something
 * else already pays that moment: "Celebrated by the Green Flag achievement
 * and the first viewing-session rung." The payers are written as they read
 * mid-sentence (`alsoPaidBy`), so a name such as The Archive keeps its
 * capital; they are only joined here.
 */
export function celebratedBy(payers: readonly string[]): string {
  if (payers.length === 0) return '';
  const list = payers.length === 1
    ? payers[0]
    : `${payers.slice(0, -1).join(', ')} and ${payers[payers.length - 1]}`;
  return `Celebrated by ${list}.`;
}

/**
 * A milestone still to come, as a position rather than a gap: "Still ahead:
 * 212 of 250 hours". Hours are shown whole and never rounded up, so a
 * milestone never reads as reached before it is.
 */
export function stillAheadNote(value: number, target: number, unit: 'hours' | 'count'): string {
  const shown = Math.min(Math.floor(Math.max(0, value)), target);
  const figures = `${shown.toLocaleString('en-GB')} of ${target.toLocaleString('en-GB')}`;
  return `Still ahead: ${figures}${unit === 'hours' ? ' hours' : ''}`;
}

/**
 * The current year's hours as a plain fact — "2026 so far: 36 hours". Never a
 * bar and never a remaining figure: a yearly target that resets every January
 * would be a quota.
 */
export function yearToDateFact(year: number, creditedSeconds: number): string {
  const hours = Math.max(0, creditedSeconds) / 3600;
  const shown = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  const figure = shown.toLocaleString('en-GB');
  return `${year} so far: ${figure} ${shown === 1 ? 'hour' : 'hours'}`;
}

// ---------------------------------------------------------------------------
// Event Legacy (0.4.0)
// ---------------------------------------------------------------------------
//
// An event's headline is its history in one line, from what was actually
// watched — never a count of what was not.

/**
 * "24 Hours of Le Mans — 9 editions experienced — 181h 42m watched — 8
 * complete race stories". Each figure appears once there is something to
 * say; an event nothing has been watched of yet says where its story starts.
 */
export function eventLegacyHeadline(stats: {
  name: string;
  editionsExperienced: number;
  creditedSeconds: number;
  storyCompleteRaces: number;
}): string {
  const parts = [stats.name];
  if (stats.editionsExperienced > 0) {
    parts.push(`${count(stats.editionsExperienced)} ${stats.editionsExperienced === 1 ? 'edition' : 'editions'} experienced`);
  }
  if (stats.creditedSeconds >= 60) parts.push(`${formatDuration(stats.creditedSeconds)} watched`);
  if (stats.storyCompleteRaces > 0) {
    parts.push(
      `${count(stats.storyCompleteRaces)} complete race ${stats.storyCompleteRaces === 1 ? 'story' : 'stories'}`,
    );
  }
  if (parts.length === 1) return `${stats.name} — its story starts with the first edition you watch`;
  return parts.join(' — ');
}

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

// ---------------------------------------------------------------------------
// Race Expeditions (0.4.0)
// ---------------------------------------------------------------------------
//
// An Expedition says what has been watched and what is still ahead, in that
// order. Reaching the end of a race is never read as having seen all of it:
// the stretches still to watch are always named. The viewing plan is a guide,
// so a long race next to it is information, never a warning.

/**
 * The shape of the coverage in one sentence or two: "Watched in 3 stretches:
 * 18h 12m of 24h 00m. 2 stretches still to watch, 5h 48m in total." The
 * stretches are counted inside the runtime, so a race whose end has been
 * reached still names every gap before it.
 */
export function describeFragments(intervals: readonly Interval[], runtimeSec: number): string {
  const runtime = Math.max(0, Math.round(runtimeSec));
  const watched = clampIntervals(intervals, runtime);
  const covered = watched.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  if (watched.length === 0) return `Nothing watched yet: ${formatDuration(runtime)} still to watch.`;

  const gaps = gapsIn(watched, runtime);
  const still = gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0);
  const first = `Watched in ${count(watched.length)} ${watched.length === 1 ? 'stretch' : 'stretches'}: ` +
    `${formatDuration(covered)} of ${formatDuration(runtime)}.`;
  if (gaps.length === 0) return `${first} Every second of it is watched.`;
  return gaps.length === 1
    ? `${first} 1 stretch still to watch, ${formatDuration(still, { seconds: still < 60 })}.`
    : `${first} ${count(gaps.length)} stretches still to watch, ${formatDuration(still, { seconds: still < 60 })} in total.`;
}

/** Hours as a figure: whole from ten, one decimal below it. */
function hoursFigure(hours: number): string {
  const shown = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${shown.toLocaleString('en-GB')} ${shown === 1 ? 'hour' : 'hours'}`;
}

/**
 * What the rest of a race asks of the viewing plan, in neutral words: the real
 * time left at the race's own speed, its share of the hours left in the year's
 * plan, this week's hours, and roughly how many weeks that is at the pace the
 * plan recommends. A race longer than what is left of the plan is said to be
 * so, and that it is entirely fine; the plan is a guide.
 */
export function expeditionBudgetNote(input: {
  realRemainingSec: number;
  speed: number;
  year: number;
  yearRemainingHours: number;
  weekRemainingHours: number;
  recommendedPaceHours: number;
}): string {
  const remaining = Math.max(0, input.realRemainingSec);
  if (remaining === 0) return `Nothing of this race is still to watch, so it asks nothing more of your ${input.year} plan.`;

  const hours = remaining / 3600;
  const speed = `${Math.round(input.speed * 100) / 100}×`;
  const sentences = [`The rest of this race is about ${formatDuration(remaining)} of real time at ${speed}`];
  if (input.yearRemainingHours > 0) {
    const share = (hours / input.yearRemainingHours) * 100;
    sentences[0] += share > 100
      ? `, more than the ${hoursFigure(input.yearRemainingHours)} left in your ${input.year} plan, which is entirely fine.`
      : `, ${share < 1 ? 'under 1%' : `about ${Math.round(share)}%`} of the ${hoursFigure(input.yearRemainingHours)} left in your ${input.year} plan.`;
  } else {
    sentences[0] += `. Your ${input.year} plan has no hours left in it, which is entirely fine: the plan is a guide.`;
  }

  sentences.push(input.weekRemainingHours > 0
    ? `This week’s plan has ${hoursFigure(input.weekRemainingHours)} left.`
    : 'This week’s planned hours are all watched.');

  if (input.recommendedPaceHours > 0) {
    const weeks = hours / input.recommendedPaceHours;
    const span = weeks < 1 ? 'less than a week' : `roughly ${count(Math.round(weeks))} ${Math.round(weeks) === 1 ? 'week' : 'weeks'}`;
    sentences.push(`At the plan’s pace of ${hoursFigure(input.recommendedPaceHours)} a week, that is ${span} of viewing.`);
  }
  return sentences.join(' ');
}

/** "10%, 25%, 50%, 75% and 90%", from configuration. */
function checkpointList(): string {
  const percents = EXPEDITION_CONFIG.checkpoints.map((checkpoint) => `${checkpoint.percent}%`);
  return percents.length === 1 ? percents[0] ?? '' : `${percents.slice(0, -1).join(', ')} and ${percents[percents.length - 1]}`;
}

/**
 * What switching Expedition Mode did, in the application's voice. Switching
 * off takes nothing back, and says so; switching on names the checkpoints that
 * were already behind the race and what they paid.
 */
export function expeditionModeMessage(input: {
  mode: 'auto' | 'on' | 'off';
  /** Whether the race is an Expedition now. */
  isExpedition: boolean;
  /** Whether its checkpoints pay XP (a runtime of six hours or more). */
  paysXp: boolean;
  /** Checkpoints paid by this switch, and their XP. */
  checkpointsBehind: number;
  xpAwarded: number;
  /** An Expedition Summary was written by this switch. */
  summaryWritten: boolean;
  /** The race has an Expedition Summary, from before or from now. */
  hasSummary: boolean;
}): string {
  const sentences: string[] = [];
  if (input.mode === 'off') {
    sentences.push('Expedition Mode is off. Checkpoints you already reached keep their XP.');
    if (input.hasSummary) sentences.push('Its Expedition Summary stays.');
    return sentences.join(' ');
  }

  sentences.push(input.mode === 'on'
    ? 'Expedition Mode is on.'
    : `Expedition Mode follows the race’s length again (automatic from ${EXPEDITION_SHAPE.autoThresholdHours} hours).`);
  if (!input.isExpedition) return sentences.join(' ');

  if (input.checkpointsBehind > 0) {
    sentences.push(
      `${count(input.checkpointsBehind)} ${input.checkpointsBehind === 1 ? 'checkpoint was' : 'checkpoints were'} ` +
        `already behind you: +${count(input.xpAwarded)} XP.`,
    );
  } else if (!input.paysXp) {
    sentences.push(`Checkpoints on races of ${EXPEDITION_SHAPE.checkpointXpMinimumHours} hours or more also earn XP.`);
  } else if (input.mode === 'on') {
    sentences.push(`Its checkpoints are at ${checkpointList()} of the story.`);
  }
  if (input.summaryWritten) sentences.push('The story is already complete, so its Expedition Summary is ready.');
  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// Career Statistics (0.4.0)
// ---------------------------------------------------------------------------
//
// Two years side by side are two chapters of one career, not a race between
// them. A difference is said as an amount — more, fewer, higher, lower, the
// same — and never as a judgement: nothing here is worse, a decline, or behind.

/**
 * `b − a` in words: "4h 10m more", "2 fewer", "1,200 XP less", "3.5 points
 * higher", "the same". Time under a minute, and a share under a twentieth of
 * a point, reads as the same: the figures beside it are shown to that
 * precision, and a difference they cannot show is not worth a word.
 */
export function differencePhrase(difference: number, unit: 'seconds' | 'count' | 'xp' | 'percent-points'): string {
  const size = Math.abs(difference);
  const up = difference > 0;
  switch (unit) {
    case 'seconds':
      return size < 60 ? 'the same' : `${formatDuration(size)} ${up ? 'more' : 'less'}`;
    case 'count': {
      const whole = Math.round(size);
      return whole === 0 ? 'the same' : `${count(whole)} ${up ? 'more' : 'fewer'}`;
    }
    case 'xp': {
      const whole = Math.round(size);
      return whole === 0 ? 'the same' : `${count(whole)} XP ${up ? 'more' : 'less'}`;
    }
    case 'percent-points': {
      const tenths = Math.round(size * 10) / 10;
      if (tenths === 0) return 'the same';
      return `${tenths.toLocaleString('en-GB')} ${tenths === 1 ? 'point' : 'points'} ${up ? 'higher' : 'lower'}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Lifetime ladders
// ---------------------------------------------------------------------------

/**
 * "5 real viewing hours", but "1 real viewing hour".
 *
 * Milestone labels are written plural because that is how they read on the
 * board; the very first rung of a ladder is the one case where that grates.
 * Only the final word is touched, and only the two English plural endings that
 * actually occur in these labels — this is not a general-purpose inflector and
 * is not trying to be.
 */
export function milestoneLabel(threshold: number, label: string): string {
  const lower = label.toLowerCase();
  if (threshold !== 1) return `${count(threshold)} ${lower}`;

  const words = lower.split(' ');
  const last = words[words.length - 1] ?? '';
  if (last.endsWith('ies')) words[words.length - 1] = `${last.slice(0, -3)}y`;
  else if (last.endsWith('s') && !last.endsWith('ss')) words[words.length - 1] = last.slice(0, -1);

  return `${count(threshold)} ${words.join(' ')}`;
}

/** Recommendation framing. Suggestions, never instructions. */
export const RECOMMENDATION_PREFIXES = {
  continue: 'Continue the story',
  bestFit: 'Fits your window',
  wildcard: 'Something different',
} as const;

export const RECOMMENDATION_FOOTNOTE =
  'Suggestions only. Watch whatever you actually feel like watching.';
