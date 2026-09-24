/**
 * The local-time calendar of a career (0.4.0).
 *
 * Every day, week, month and year a stint is counted in is decided here, and
 * only here. Years follow the computer's own clock: a stint at 00:30 on
 * 1 January belongs to the year the user was living in, not to the year UTC
 * had reached. So every key is built from local date parts, and every walk
 * from one day to the next steps from local midnight to local midnight with
 * `new Date(y, m, d + 1)` — never by adding 86,400,000 ms, which is wrong
 * twice a year on a clock with summer time.
 *
 * Weeks are the budget's weeks: `viewingWeek` in `./periods` with the user's
 * week start, so a week here and a week on the budget page are the same week.
 * `dayPeriod().key` is deliberately not used — it is a UTC date.
 *
 * Everything is pure. Nothing reads the clock.
 */

import { viewingWeek } from './periods';

/** A half-open span of local time: [start, end). */
export interface LocalWindow {
  start: Date;
  end: Date;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export function localDayKey(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** The local calendar month of an instant, as `YYYY-MM`. */
export function localMonthKey(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}`;
}

/** Local midnight at the start of a `YYYY-MM-DD` day. */
export function dayKeyToLocalDate(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** A calendar year in local time: 1 January at midnight to the next 1 January. */
export function yearWindow(year: number): LocalWindow {
  return { start: new Date(year, 0, 1, 0, 0, 0, 0), end: new Date(year + 1, 0, 1, 0, 0, 0, 0) };
}

/** A calendar month in local time. `month1to12` is written the way a person writes it. */
export function monthWindow(year: number, month1to12: number): LocalWindow {
  return {
    start: new Date(year, month1to12 - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month1to12, 1, 0, 0, 0, 0),
  };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * The key of the viewing week a day belongs to, exactly as the budget keys it.
 *
 * `memo` is optional and belongs to one week start: a fold over a whole career
 * asks this for the same few thousand days over and over, and remembering the
 * answer per day is most of the cost of bucketing sixty thousand stints.
 */
export function weekKeyForDay(dayKey: string, weekStartsOn: number, memo?: Map<string, string>): string {
  const known = memo?.get(dayKey);
  if (known !== undefined) return known;
  const key = viewingWeek(dayKeyToLocalDate(dayKey), weekStartsOn).key;
  memo?.set(dayKey, key);
  return key;
}

/**
 * The local midnight a viewing week starts at, from its key.
 *
 * A week key names the ISO week its first day falls in (`viewingWeek`), and
 * that first day is the one day of that ISO week, Monday to Sunday, with the
 * user's week-start weekday. ISO week 1 is the week holding 4 January.
 */
function weekStartFromKey(weekKey: string, weekStartsOn: number): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`"${weekKey}" is not a week key.`);
  const isoYear = Number.parseInt(match[1]!, 10);
  const isoWeek = Number.parseInt(match[2]!, 10);
  const fourth = new Date(isoYear, 0, 4);
  const mondayOffset = (fourth.getDay() + 6) % 7;
  const startOffset = (weekStartsOn - 1 + 7) % 7;
  return new Date(isoYear, 0, 4 - mondayOffset + 7 * (isoWeek - 1) + startOffset, 0, 0, 0, 0);
}

function dayLabel(date: Date, withMonth: boolean): string {
  const base = `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
  return withMonth ? `${base} ${MONTHS[date.getMonth()]}` : base;
}

/**
 * A readable label for a viewing week: "Mon 22 – Sun 28 Dec".
 *
 * With `clipTo`, the week is cut to that window first, so the most active week
 * of a year that straddles New Year reads "Mon 29 – Wed 31 Dec" and says it was
 * `clipped`: its hours are the ones inside the year, and the label should not
 * claim the days that are not. `end` is exclusive.
 */
export function weekLabel(
  weekKey: string,
  weekStartsOn: number,
  clipTo?: LocalWindow,
): { label: string; start: Date; end: Date; clipped: boolean } {
  let start = weekStartFromKey(weekKey, weekStartsOn);
  let end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0);
  let clipped = false;

  if (clipTo) {
    if (clipTo.start > start) {
      start = new Date(clipTo.start.getTime());
      clipped = true;
    }
    if (clipTo.end < end) {
      end = new Date(clipTo.end.getTime());
      clipped = true;
    }
  }

  // The last day shown is the one before the exclusive end.
  const last = end > start ? new Date(end.getTime() - 1) : start;
  const sameMonth = last.getMonth() === start.getMonth() && last.getFullYear() === start.getFullYear();
  const label = localDayKey(last) === localDayKey(start)
    ? dayLabel(start, true)
    : `${dayLabel(start, !sameMonth)} – ${dayLabel(last, true)}`;

  return { label, start, end, clipped };
}

/** A share of one stint's time that fell on one local day. */
export interface TimeSlice {
  dayKey: string;
  /** The fractions of one stint sum to exactly 1. */
  fraction: number;
}

/**
 * Split a span of wall-clock time across the local days it touches.
 *
 * A zero-length span (no credited time, or a window cut to nothing by a stint
 * logged just before it) still has to land somewhere, and it lands on the day
 * of its end: the stint's own instant.
 */
export function splitAcrossLocalDays(startsAt: Date, endsAt: Date): TimeSlice[] {
  const total = endsAt.getTime() - startsAt.getTime();
  if (!(total > 0)) return [{ dayKey: localDayKey(endsAt), fraction: 1 }];

  const slices: TimeSlice[] = [];
  let cursor = startsAt;
  let assigned = 0;
  while (cursor < endsAt) {
    const nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0);
    const segmentEnd = nextMidnight < endsAt ? nextMidnight : endsAt;
    const isLast = segmentEnd === endsAt;
    // The last slice takes whatever is left, so rounding can never make a
    // stint worth more or less than the whole of itself.
    const fraction = isLast ? 1 - assigned : (segmentEnd.getTime() - cursor.getTime()) / total;
    slices.push({ dayKey: localDayKey(cursor), fraction });
    assigned += fraction;
    cursor = segmentEnd;
  }
  return slices;
}

/**
 * The part of a span inside a window, and what share of the span it is.
 *
 * A zero-length span is inside a window when its instant is (`start` included,
 * `end` excluded), and then all of it is.
 */
export function clipToWindow(
  startsAt: Date,
  endsAt: Date,
  window: LocalWindow,
): { startsAt: Date; endsAt: Date; fraction: number } | null {
  const total = endsAt.getTime() - startsAt.getTime();
  if (!(total > 0)) {
    return endsAt >= window.start && endsAt < window.end ? { startsAt: endsAt, endsAt, fraction: 1 } : null;
  }
  const start = startsAt > window.start ? startsAt : window.start;
  const end = endsAt < window.end ? endsAt : window.end;
  if (end <= start) return null;
  return { startsAt: start, endsAt: end, fraction: (end.getTime() - start.getTime()) / total };
}

/**
 * The same moment of the year in another year, for comparing a year in
 * progress with the same stretch of another one.
 *
 * 29 February has no twin in an ordinary year, so it maps to the very end of
 * 28 February: the whole of that stretch, and nothing of 1 March.
 */
export function samePeriodEnd(targetYear: number, reference: Date): Date {
  const month = reference.getMonth();
  const day = reference.getDate();
  if (month === 1 && day === 29 && !isLeapYear(targetYear)) {
    return new Date(targetYear, 1, 28, 23, 59, 59, 999);
  }
  return new Date(
    targetYear, month, day,
    reference.getHours(), reference.getMinutes(), reference.getSeconds(), reference.getMilliseconds(),
  );
}

/** The time zone this computer's clock is set to, for saying which calendar a chapter follows. */
export function localTimeZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
