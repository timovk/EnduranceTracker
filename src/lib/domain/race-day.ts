/**
 * Race dates, resolved without a database (0.3.2).
 *
 * A race date is a calendar day, not a moment. The date field stores the day
 * that was typed as midnight UTC — `new Date('2026-11-07')` — and the edit form
 * reads it back from the UTC parts (`toISOString().slice(0, 10)`), so the day a
 * race is on is read from the UTC parts here too. "Today" is the local
 * calendar day of `now`: the day on the user's own clock.
 *
 * Every decision takes the `now` it was handed, never the clock, so both sides
 * of midnight can be tested.
 */

/** A calendar day as a number that sorts like the day, e.g. 20261107. */
function dayNumber(year: number, monthIndex: number, day: number): number {
  return year * 10_000 + (monthIndex + 1) * 100 + day;
}

function isValid(date: Date | null): date is Date {
  return date !== null && !Number.isNaN(date.getTime());
}

/** Whether a race date names a day after today. False when there is no date. */
export function isRaceDayAhead(raceDate: Date | null, now: Date): boolean {
  if (!isValid(raceDate)) return false;
  const race = dayNumber(raceDate.getUTCFullYear(), raceDate.getUTCMonth(), raceDate.getUTCDate());
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  return race > today;
}

/**
 * Whether a race has not been run yet, as far as the library can tell: its
 * race date is after today and no stint has been logged on it.
 *
 * A logged stint outranks the date. Having watched some of a race is proof it
 * can be watched — an overnight race from the other side of the world starts
 * the evening before the day it is dated — and a story already under way is
 * never put out of reach by the calendar.
 */
export function isStillToCome(race: { raceDate: Date | null; sessionCount: number }, now: Date): boolean {
  return race.sessionCount === 0 && isRaceDayAhead(race.raceDate, now);
}

/**
 * Local midnight at the start of the day a race date names, for display with
 * `formatDate`, which formats in local time. Null when there is no date.
 */
export function raceDayStart(raceDate: Date | null): Date | null {
  if (!isValid(raceDate)) return null;
  return new Date(raceDate.getUTCFullYear(), raceDate.getUTCMonth(), raceDate.getUTCDate());
}
