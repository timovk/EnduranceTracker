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

/** Recommendation framing. Suggestions, never instructions. */
export const RECOMMENDATION_PREFIXES = {
  continue: 'Continue the story',
  bestFit: 'Fits your window',
  wildcard: 'Something different',
} as const;

export const RECOMMENDATION_FOOTNOTE =
  'Suggestions only. Watch whatever you actually feel like watching.';
