/**
 * Voice of the account screens.
 *
 * These are the first words the application says, so they follow the same
 * rules as src/lib/copy/tone.ts:
 *
 *   - An empty machine is an invitation, not an error.
 *   - A password that did not match is a fact, not a refusal. No lockout, no
 *     counter, no countdown — on a local machine those only ever inconvenience
 *     the person they belong to.
 *   - A gap since the last stint is greeted, never counted against anyone.
 *   - Deleting is described in real numbers, because a figure is a decision
 *     and "this cannot be undone" is a shrug.
 *
 * Copy is a function of state, computed here, never assembled inline in JSX.
 */

import { formatHours, formatNumber } from '@/lib/utils';

/** The first-run invitation. Nothing has happened yet, and that is the point. */
export const FIRST_RUN_TITLE = 'No careers on this PC yet';

export const FIRST_RUN_BODY =
  'Make an account and the career behind it is yours — your library, your hours, your record. Nothing is imported, and nothing is shared with anyone else who uses this PC.';

/** Framing for the picker. Several careers on one machine is the normal case, not an edge case. */
export const PICKER_DESCRIPTION =
  'More than one person can keep a career on this PC. Choose yours and carry on where you left it.';

export const NEW_ACCOUNT_DESCRIPTION =
  'A second career starts completely empty. It takes nothing away from the ones already here.';

/**
 * Honest about what a local password is for.
 *
 * It keeps a housemate out of a career; it is not encryption, and there is
 * nobody to ask for a reset. Saying so plainly is kinder than implying more.
 */
export const PASSWORD_HINT =
  'Optional. It keeps someone else on this PC out of your career — it is not encryption, and there is nobody to ask for a reset, so choose something you will remember.';

/** Shown when a password did not match. One sentence, and nothing else happens. */
export const WRONG_PASSWORD_NOTE = 'That password didn’t match.';

export const PASSWORDS_DIFFER_NOTE = 'Those two passwords are different.';

/** Shown when the account behind a screen has gone — deleted from another window, say. */
export const ACCOUNT_GONE_NOTE = 'That account is no longer on this PC.';

export const SIGN_OUT_EVERYWHERE_NOTE =
  'Ends every signed-in session for this account on this PC. The career itself is untouched.';

/**
 * When this account was last in the driving seat.
 *
 * Chosen by gap length in the same spirit as `welcomeBack`: a long pause is
 * described, never remarked upon.
 */
export function lastRacedNote(lastActiveAt: Date | null, now: Date = new Date()): string {
  if (lastActiveAt === null) return 'Waiting for its first stint';

  const days = wholeDaysBetween(lastActiveAt, now);
  if (days <= 0) return 'Last raced today';
  if (days === 1) return 'Last raced yesterday';
  if (days < 7) return `Last raced ${days} days ago`;
  if (days < 14) return 'Last raced a week ago';
  if (days < 61) return `Last raced ${Math.round(days / 7)} weeks ago`;
  return `Last raced ${Math.round(days / 30)} months ago`;
}

/**
 * What deleting an account takes with it, in real numbers.
 *
 * The figures come from `describeAccountLosses`, so they are this account's
 * actual library rather than a generic caution.
 */
export function deletionNote(losses: { races: number; hours: number; achievements: number }): string {
  const races = `${formatNumber(losses.races)} ${losses.races === 1 ? 'race' : 'races'}`;
  const achievements = `${formatNumber(losses.achievements)} ${
    losses.achievements === 1 ? 'achievement' : 'achievements'
  }`;
  return `Deleting this account removes ${races}, ${formatHours(losses.hours)} of viewing and ${achievements} — permanently, and only on this PC.`;
}

/** The typed-name confirmation. Specific, so it cannot be clicked through by reflex. */
export function deletionConfirmHint(name: string): string {
  return `Type “${name}” to confirm.`;
}

/**
 * Whole days between two moments, measured from local midnight.
 *
 * Elapsed hours would call 23:50 last night "today"; calendar days match what
 * the user means when they say yesterday.
 */
function wholeDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
