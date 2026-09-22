/**
 * Calendar periods: viewing weeks, months, quarters and years.
 *
 * Everything here takes an explicit `now` so that year and quarter transitions
 * are testable without mocking the clock. Weeks follow ISO-8601 (Monday start)
 * by default but honour the user's configured week start.
 */

import {
  addDays, addWeeks, differenceInCalendarDays, endOfDay, endOfMonth, endOfQuarter,
  endOfYear, getISOWeek, getISOWeekYear, getQuarter, startOfDay, startOfMonth,
  startOfQuarter, startOfYear,
} from 'date-fns';

export interface Period {
  start: Date;
  /** Exclusive end. */
  end: Date;
  label: string;
  key: string;
}

/** Start of the viewing week containing `date`, for a given week start day. */
export function startOfViewingWeek(date: Date, weekStartsOn = 1): Date {
  const day = date.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  return startOfDay(addDays(date, -diff));
}

export function viewingWeek(date: Date, weekStartsOn = 1): Period {
  const start = startOfViewingWeek(date, weekStartsOn);
  const end = addWeeks(start, 1);
  const isoWeek = getISOWeek(start);
  const isoYear = getISOWeekYear(start);
  return {
    start,
    end,
    label: `Week ${isoWeek}`,
    key: `${isoYear}-W${isoWeek.toString().padStart(2, '0')}`,
  };
}

export function isoWeekParts(date: Date, weekStartsOn = 1): { isoYear: number; isoWeek: number } {
  const start = startOfViewingWeek(date, weekStartsOn);
  return { isoYear: getISOWeekYear(start), isoWeek: getISOWeek(start) };
}

export function dayPeriod(date: Date): Period {
  const start = startOfDay(date);
  return {
    start,
    end: addDays(start, 1),
    label: 'Today',
    key: start.toISOString().slice(0, 10),
  };
}

export function monthPeriod(date: Date): Period {
  const start = startOfMonth(date);
  return {
    start,
    end: startOfMonth(addDays(endOfMonth(date), 1)),
    label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    key: `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`,
  };
}

export function quarterPeriod(date: Date): Period {
  const start = startOfQuarter(date);
  const quarter = getQuarter(date);
  return {
    start,
    end: new Date(endOfQuarter(date).getTime() + 1),
    label: `Q${quarter} ${start.getFullYear()}`,
    key: `${start.getFullYear()}-Q${quarter}`,
  };
}

export function yearPeriod(date: Date): Period {
  const start = startOfYear(date);
  return {
    start,
    end: new Date(endOfYear(date).getTime() + 1),
    label: `${start.getFullYear()}`,
    key: `${start.getFullYear()}`,
  };
}

/** Exclusive end of the day, for daily challenge expiry at local midnight. */
export function endOfToday(date: Date): Date {
  return new Date(endOfDay(date).getTime() + 1);
}

export function quarterOf(date: Date): number {
  return getQuarter(date);
}

export function quarterBounds(year: number, quarter: number): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * Whole viewing weeks remaining in the year, counting the current one as a
 * fraction of the days left in it. The budget engine uses the fractional
 * figure so mid-week pace calculations stay honest.
 */
export function weeksRemainingInYear(now: Date): number {
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  const daysLeft = Math.max(0, differenceInCalendarDays(yearEnd, startOfDay(now)));
  return Math.max(0.1, daysLeft / 7);
}

/** Whole weeks remaining, for display ("11 weeks left in the year"). */
export function wholeWeeksRemainingInYear(now: Date, weekStartsOn = 1): number {
  const week = viewingWeek(now, weekStartsOn);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  return Math.max(0, Math.ceil(differenceInCalendarDays(yearEnd, week.start) / 7));
}

/** Days elapsed in the year, as a fraction, for pace comparisons. */
export function yearProgress(now: Date): number {
  const start = startOfYear(now);
  const end = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

/** The list of viewing weeks covering `[from, to)`. */
export function weeksBetween(from: Date, to: Date, weekStartsOn = 1): Period[] {
  const weeks: Period[] = [];
  let cursor = startOfViewingWeek(from, weekStartsOn);
  let guard = 0;
  while (cursor < to && guard < 400) {
    weeks.push(viewingWeek(cursor, weekStartsOn));
    cursor = addWeeks(cursor, 1);
    guard += 1;
  }
  return weeks;
}

export function periodForScope(
  scope: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEASONAL',
  now: Date,
  weekStartsOn = 1,
): Period {
  switch (scope) {
    case 'DAILY':
      return dayPeriod(now);
    case 'WEEKLY':
      return viewingWeek(now, weekStartsOn);
    case 'MONTHLY':
      return monthPeriod(now);
    case 'SEASONAL':
      return quarterPeriod(now);
  }
}
