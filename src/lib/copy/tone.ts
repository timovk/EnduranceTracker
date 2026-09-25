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

import { TIMELINE_SHAPE } from '@/lib/config';
import type { MilestonePrecision } from '@/lib/domain/types';

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

/** Recommendation framing. Suggestions, never instructions. */
export const RECOMMENDATION_PREFIXES = {
  continue: 'Continue the story',
  bestFit: 'Fits your window',
  wildcard: 'Something different',
} as const;

export const RECOMMENDATION_FOOTNOTE =
  'Suggestions only. Watch whatever you actually feel like watching.';
