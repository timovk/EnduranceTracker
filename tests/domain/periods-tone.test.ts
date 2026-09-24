/**
 * Calendar periods and the application's voice.
 *
 * Period boundaries matter because challenges and season passes expire on
 * them; year and quarter transitions must be exactly right.
 *
 * The tone tests exist because anti-chore design is a requirement, not a
 * preference. If a forbidden word ever appears in user-facing copy, this fails.
 */

import { describe, expect, it } from 'vitest';
import {
  dayPeriod, endOfToday, isoWeekParts, monthPeriod, periodForScope, quarterBounds,
  quarterOf, quarterPeriod, startOfViewingWeek, viewingWeek, weeksBetween,
  weeksRemainingInYear, wholeWeeksRemainingInYear, yearPeriod, yearProgress,
} from '@/lib/domain/periods';
import {
  ARCHIVED_PASS_NOTE, backlogFraming, budgetProjectionNote, EXPIRED_CHALLENGE_NOTE,
  FORBIDDEN_TONE_WORDS, momentumNote, raceRemovedNotice, RECOMMENDATION_FOOTNOTE, seasonClosedStintNote,
  seasonalChallengesClosedNote, seasonPassClosedHeadline, seasonPassClosedNote,
  seasonPassClosedShortNote, stillToComeEmptyNote, stillToComeNote, stintHeading, welcomeBack,
} from '@/lib/copy/tone';

describe('viewing weeks', () => {
  it('starts on Monday by default', () => {
    // 2026-09-22 is a Tuesday.
    expect(startOfViewingWeek(new Date(2026, 8, 22)).getDay()).toBe(1);
    expect(startOfViewingWeek(new Date(2026, 8, 22)).getDate()).toBe(21);
  });

  it('honours a different week start', () => {
    expect(startOfViewingWeek(new Date(2026, 8, 22), 0).getDay()).toBe(0);
  });

  it('treats the week start day as already inside its own week', () => {
    const monday = new Date(2026, 8, 21);
    expect(startOfViewingWeek(monday).getTime()).toBe(monday.getTime());
  });

  it('spans exactly seven days', () => {
    const week = viewingWeek(new Date(2026, 8, 22));
    expect((week.end.getTime() - week.start.getTime()) / 86_400_000).toBe(7);
  });

  it('produces stable ISO keys', () => {
    expect(viewingWeek(new Date(2026, 8, 22)).key).toBe('2026-W39');
    expect(isoWeekParts(new Date(2026, 8, 22))).toEqual({ isoYear: 2026, isoWeek: 39 });
  });

  it('handles a week straddling new year', () => {
    const week = viewingWeek(new Date(2026, 11, 31));
    expect(week.start.getFullYear()).toBe(2026);
    expect(week.end.getFullYear()).toBe(2027);
  });
});

describe('months, quarters and years', () => {
  it('ends a month at the first instant of the next', () => {
    const september = monthPeriod(new Date(2026, 8, 15));
    expect(september.start.getDate()).toBe(1);
    expect(september.end.getMonth()).toBe(9);
    expect(september.end.getDate()).toBe(1);
  });

  it('handles February in a leap year', () => {
    const february = monthPeriod(new Date(2028, 1, 10));
    expect(february.end.getMonth()).toBe(2);
    expect(february.end.getDate()).toBe(1);
  });

  it('rolls December into the next year', () => {
    const december = monthPeriod(new Date(2026, 11, 10));
    expect(december.end.getFullYear()).toBe(2027);
    expect(december.end.getMonth()).toBe(0);
  });

  it('bounds quarters on calendar boundaries', () => {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const { start, end } = quarterBounds(2027, quarter);
      expect(start.getMonth()).toBe((quarter - 1) * 3);
      expect(start.getDate()).toBe(1);
      if (quarter < 4) {
        expect(end.getMonth()).toBe(quarter * 3);
        expect(end.getFullYear()).toBe(2027);
      } else {
        expect(end.getFullYear()).toBe(2028);
        expect(end.getMonth()).toBe(0);
      }
    }
  });

  it('quarters tile the year without gaps or overlaps', () => {
    for (let quarter = 1; quarter < 4; quarter += 1) {
      expect(quarterBounds(2027, quarter).end.getTime())
        .toBe(quarterBounds(2027, quarter + 1).start.getTime());
    }
  });

  it('identifies the right quarter', () => {
    expect(quarterOf(new Date(2026, 0, 1))).toBe(1);
    expect(quarterOf(new Date(2026, 5, 30))).toBe(2);
    expect(quarterOf(new Date(2026, 8, 22))).toBe(3);
    expect(quarterOf(new Date(2026, 11, 31))).toBe(4);
  });

  it('labels quarters readably', () => {
    expect(quarterPeriod(new Date(2026, 8, 22)).label).toBe('Q3 2026');
    expect(quarterPeriod(new Date(2026, 8, 22)).key).toBe('2026-Q3');
  });

  it('bounds years on 1 January', () => {
    const year = yearPeriod(new Date(2026, 5, 15));
    expect(year.start.getMonth()).toBe(0);
    expect(year.end.getFullYear()).toBe(2027);
  });

  it('reports year progress between 0 and 1', () => {
    expect(yearProgress(new Date(2026, 0, 1))).toBeCloseTo(0, 3);
    expect(yearProgress(new Date(2026, 11, 31, 23))).toBeGreaterThan(0.99);
  });
});

describe('weeks remaining', () => {
  it('counts down through the year', () => {
    expect(weeksRemainingInYear(new Date(2026, 0, 1))).toBeCloseTo(365 / 7, 1);
    expect(weeksRemainingInYear(new Date(2026, 11, 31))).toBeCloseTo(1 / 7, 2);
  });

  it('never returns zero, so pace calculations cannot divide by it', () => {
    expect(weeksRemainingInYear(new Date(2026, 11, 31, 23, 59))).toBeGreaterThan(0);
  });

  it('reports whole weeks for display', () => {
    expect(wholeWeeksRemainingInYear(new Date(2026, 11, 28))).toBeGreaterThanOrEqual(1);
  });

  it('enumerates the weeks in a range', () => {
    const weeks = weeksBetween(new Date(2026, 8, 1), new Date(2026, 9, 1));
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weeks[i]!.start.getTime()).toBe(weeks[i - 1]!.end.getTime());
    }
  });
});

describe('challenge period selection', () => {
  const now = new Date(2026, 8, 22, 14, 30);

  it('gives each scope its real calendar deadline', () => {
    expect(periodForScope('DAILY', now).end.getTime()).toBe(dayPeriod(now).end.getTime());
    expect(periodForScope('WEEKLY', now).end.getTime()).toBe(viewingWeek(now).end.getTime());
    expect(periodForScope('MONTHLY', now).end.getTime()).toBe(monthPeriod(now).end.getTime());
    expect(periodForScope('SEASONAL', now).end.getTime()).toBe(quarterPeriod(now).end.getTime());
  });

  it('expires a daily challenge at local midnight', () => {
    const end = endOfToday(now);
    expect(end.getDate()).toBe(23);
    expect(end.getHours()).toBe(0);
  });

  it('contains the current moment in every scope', () => {
    for (const scope of ['DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL'] as const) {
      const period = periodForScope(scope, now);
      expect(period.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(period.end.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// Tone — anti-chore design is a requirement
// ---------------------------------------------------------------------------

function everyUserFacingString(): string[] {
  const strings: string[] = [
    EXPIRED_CHALLENGE_NOTE,
    ARCHIVED_PASS_NOTE,
    RECOMMENDATION_FOOTNOTE,
    momentumNote('In the Window'),
  ];
  for (const days of [0, 1, 2, 5, 14, 30, 90, 400]) strings.push(welcomeBack(days));
  for (const count of [0, 1, 2, 12, 250]) strings.push(backlogFraming(count));
  for (const minutes of [5, 25, 57, 130, 400]) strings.push(stintHeading(minutes));
  for (const projected of [100, 285, 336, 351, 500]) strings.push(budgetProjectionNote(projected, 336));
  strings.push(
    seasonPassClosedHeadline('1 October 2026'),
    seasonPassClosedNote('Q4 2026', '1 October 2026'),
    seasonPassClosedShortNote('Q4 2026'),
    seasonalChallengesClosedNote('Q4 2026', '1 October 2026'),
    seasonClosedStintNote('1 October 2026'),
  );
  for (const count of [1, 2, 7]) {
    strings.push(stillToComeNote(count), stillToComeEmptyNote(count, '7 November 2026'));
  }
  for (const xp of [0, 1, 360, 12_345]) strings.push(raceRemovedNotice('24 Hours of Le Mans', xp));
  return strings;
}

describe('tone', () => {
  it('never uses a forbidden word', () => {
    for (const text of everyUserFacingString()) {
      const lower = text.toLowerCase();
      for (const word of FORBIDDEN_TONE_WORDS) {
        expect(lower, `"${text}" contains "${word}"`).not.toContain(word);
      }
    }
  });

  it('greets a returning user warmly rather than mentioning a broken streak', () => {
    const message = welcomeBack(14);
    expect(message.toLowerCase()).toContain('welcome back');
    expect(message.toLowerCase()).not.toContain('streak');
  });

  it('frames a backlog as future experiences', () => {
    expect(backlogFraming(12).toLowerCase()).toContain('waiting for you');
  });

  it('presents exceeding the budget as neutral information', () => {
    const over = budgetProjectionNote(351, 336).toLowerCase();
    expect(over).toContain('351 hours');
    expect(over).toContain('entirely fine');
    expect(over).not.toContain('too much');
  });

  it('announces the season closure by what carries on and when it opens', () => {
    // The closure is a date, not a loss: every line names when the pass opens,
    // and what is being said about a stint is that career XP still counts.
    const note = seasonPassClosedNote('Q4 2026', '1 October 2026');
    expect(note).toContain('1 October 2026');
    expect(note).toContain('Q4 2026');
    expect(note.toLowerCase()).toContain('still counts towards your career');
    expect(seasonalChallengesClosedNote('Q4 2026', '1 October 2026')).toContain('return on 1 October 2026');
    expect(seasonClosedStintNote('1 October 2026')).toContain('Career XP');

    const closure = [
      seasonPassClosedHeadline('1 October 2026'), note, seasonPassClosedShortNote('Q4 2026'),
      seasonalChallengesClosedNote('Q4 2026', '1 October 2026'), seasonClosedStintNote('1 October 2026'),
    ].join(' ').toLowerCase();
    // Whole words: "closed" contains "lose", and "closed" is the point.
    for (const word of ['lost', 'lose', 'missed', 'removed', 'taken away', 'unfortunately', 'sorry']) {
      expect(closure, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it('never tells the user they cannot watch something', () => {
    for (const text of everyUserFacingString()) {
      expect(text.toLowerCase()).not.toContain('you cannot');
      expect(text.toLowerCase()).not.toContain("can't watch");
    }
  });

  it('says a race still to come waits for its race day, one race or several', () => {
    expect(stillToComeNote(1)).toBe('One race dated after today joins the suggestions on its race day.');
    expect(stillToComeNote(3)).toBe('3 races dated after today join the suggestions on their race days.');
    expect(stillToComeEmptyNote(1, '7 November 2026')).toContain('is run on 7 November 2026');
    expect(stillToComeEmptyNote(3, '7 November 2026')).toContain('The 3 races');
    expect(stillToComeEmptyNote(3, '7 November 2026')).toContain('the first is on 7 November 2026');
  });

  it('says what went with a removed race, and what stays', () => {
    expect(raceRemovedNotice('6 Hours of Spa', 12_345)).toBe(
      '6 Hours of Spa was removed from the library, with the 12,345 XP it earned. '
        + 'Achievements and milestones you reached stay.',
    );
    // Nothing to take back, nothing to mention.
    expect(raceRemovedNotice('6 Hours of Spa', 0)).toBe('6 Hours of Spa was removed from the library.');
  });

  it('makes even a short stint feel worthwhile', () => {
    expect(stintHeading(5)).toBe('STINT LOGGED');
    expect(stintHeading(25)).toBe('STINT COMPLETE');
    expect(stintHeading(130)).toBe('DOUBLE STINT COMPLETE');
  });
});
