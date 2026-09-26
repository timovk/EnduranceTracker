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
  ARCHIVED_PASS_NOTE, backlogFraming, budgetProjectionNote, celebratedBy, describeFragments, differencePhrase, eventLegacyHeadline,
  expeditionBudgetNote, expeditionModeMessage, EXPIRED_CHALLENGE_NOTE,
  FORBIDDEN_TONE_WORDS, milestoneLabel, momentumNote, precisionLabel, raceRemovedNotice, RECOMMENDATION_FOOTNOTE,
  seasonClosedStintNote, seasonalChallengesClosedNote, seasonPassClosedHeadline, seasonPassClosedNote,
  seasonPassClosedShortNote, stillAheadNote, stillToComeEmptyNote, stillToComeNote, stintHeading, welcomeBack,
  yearToDateFact,
} from '@/lib/copy/tone';
import { CAREER_MILESTONES, CAREER_MILESTONES_BY_ID, MILESTONES } from '@/lib/config';

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
  const at = new Date(2030, 5, 14, 21, 47);
  for (const precision of ['INTERPOLATED', 'STINT', 'RECOGNISED', null] as const) {
    strings.push(precisionLabel(precision, at, '24 Hours of Le Mans 2030'), precisionLabel(precision, at, null));
  }
  for (const seconds of [0, 1_800, 3_600, 5_400, 36 * 3_600, 400 * 3_600]) strings.push(yearToDateFact(2026, seconds));
  for (const def of CAREER_MILESTONES) if (def.alsoPaidBy.length > 0) strings.push(celebratedBy(def.alsoPaidBy));
  for (const [value, target] of [[0, 1], [0.4, 100], [212.7, 250], [9, 10]] as const) {
    strings.push(stillAheadNote(value, target, 'hours'), stillAheadNote(value, target, 'count'));
  }
  for (const [editionsExperienced, creditedSeconds, storyCompleteRaces] of [
    [0, 0, 0], [0, 45, 0], [0, 1_500, 0], [1, 3_600, 0], [1, 3_600, 1], [9, 654_120, 8], [1_200, 360_000_000, 1_000],
  ] as const) {
    strings.push(eventLegacyHeadline({ name: '24 Hours of Le Mans', editionsExperienced, creditedSeconds, storyCompleteRaces }));
  }
  for (const intervals of [[], [{ start: 0, end: 86_400 }], [{ start: 0, end: 3_600 }], [{ start: 0, end: 3_600 }, { start: 7_200, end: 86_000 }]]) {
    strings.push(describeFragments(intervals, 86_400));
  }
  for (const [realRemainingSec, yearRemainingHours, weekRemainingHours, recommendedPaceHours] of [
    [0, 200, 8, 8], [1_800, 200, 8, 8], [45_000, 200, 0, 8], [45_000, 5, 2, 8], [45_000, 0, 0, 0], [360_000, 336, 7.5, 6.5],
  ] as const) {
    strings.push(expeditionBudgetNote({ realRemainingSec, speed: 1.25, year: 2026, yearRemainingHours, weekRemainingHours, recommendedPaceHours }));
  }
  for (const mode of ['auto', 'on', 'off'] as const) {
    for (const [isExpedition, paysXp, checkpointsBehind, xpAwarded, summaryWritten, hasSummary] of [
      [true, true, 0, 0, false, false], [true, true, 3, 1_500, false, false], [true, true, 5, 3_000, true, true],
      [true, false, 0, 0, false, false], [false, true, 0, 0, false, true], [true, true, 1, 120, false, false],
    ] as const) {
      strings.push(expeditionModeMessage({ mode, isExpedition, paysXp, checkpointsBehind, xpAwarded, summaryWritten, hasSummary }));
    }
  }
  for (const def of MILESTONES) for (const threshold of [1, 5, 1_000]) strings.push(milestoneLabel(threshold, def.label));
  for (const unit of ['seconds', 'count', 'xp', 'percent-points'] as const) {
    for (const difference of [0, 0.04, 1, -1, 12.5, -59, 3_600, -15_000, 1_234_567]) {
      strings.push(differencePhrase(difference, unit));
    }
  }
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

  it('says how exactly a milestone’s moment is known, and never claims more', () => {
    const at = new Date(2030, 5, 14, 21, 47);
    // An interpolated time rests on when the stint was logged: shown to five minutes, and it says so.
    expect(precisionLabel('INTERPOLATED', at, '24 Hours of Le Mans 2030')).toBe(
      'Reached around 21:45 on 14 June 2030, during a stint of 24 Hours of Le Mans 2030 '
        + '(worked out from when the stint was logged)',
    );
    expect(precisionLabel('INTERPOLATED', new Date(2030, 5, 14, 23, 58))).toBe(
      'Reached around 00:00 on 15 June 2030 (worked out from when the stint was logged)',
    );
    expect(precisionLabel('STINT', new Date(2030, 5, 14, 21, 50))).toBe('Reached with the stint logged at 21:50 on 14 June 2030');
    expect(precisionLabel('RECOGNISED', at)).toBe('Recorded on 14 June 2030 (history cannot place it more exactly)');
    expect(precisionLabel(null, at)).toBe('Recorded on 14 June 2030');
  });

  it('states the year so far as a fact, with no target in it', () => {
    expect(yearToDateFact(2026, 36 * 3_600)).toBe('2026 so far: 36 hours');
    expect(yearToDateFact(2026, 36.6 * 3_600)).toBe('2026 so far: 37 hours');
    expect(yearToDateFact(2026, 5_400)).toBe('2026 so far: 1.5 hours');
    expect(yearToDateFact(2026, 3_600)).toBe('2026 so far: 1 hour');
    expect(yearToDateFact(2026, 0)).toBe('2026 so far: 0 hours');
    for (const seconds of [0, 3_600, 400 * 3_600]) {
      expect(yearToDateFact(2026, seconds)).not.toMatch(/left|remaining|of \d|target|still/i);
    }
  });

  it('names who celebrates a milestone that pays nothing itself', () => {
    const payers = (id: string) => CAREER_MILESTONES_BY_ID.get(id)!.alsoPaidBy;
    expect(celebratedBy(payers('first-race-started'))).toBe(
      'Celebrated by the Green Flag achievement and the first viewing-session rung.',
    );
    // The achievement is called The Archive, and keeps its capital mid-sentence.
    expect(celebratedBy(payers('hours-2500'))).toBe('Celebrated by The Archive achievement.');
    expect(celebratedBy(payers('event-editions-5'))).toBe(
      "Celebrated by that event's own Five Editions Experienced step.",
    );
    expect(celebratedBy(['the first rung', 'the second', 'the third'])).toBe(
      'Celebrated by the first rung, the second and the third.',
    );
    expect(celebratedBy([])).toBe('');
  });

  it('sums up an event in one line from what was watched, never from what was not', () => {
    const headline = (editionsExperienced: number, creditedSeconds: number, storyCompleteRaces: number) =>
      eventLegacyHeadline({ name: '24 Hours of Le Mans', editionsExperienced, creditedSeconds, storyCompleteRaces });
    expect(headline(9, 181 * 3_600 + 42 * 60, 8)).toBe(
      '24 Hours of Le Mans — 9 editions experienced — 181h 42m watched — 8 complete race stories',
    );
    expect(headline(1, 3_600, 1)).toBe('24 Hours of Le Mans — 1 edition experienced — 1h 00m watched — 1 complete race story');
    // A glimpse is time watched, not an edition experienced.
    expect(headline(0, 25 * 60, 0)).toBe('24 Hours of Le Mans — 25m watched');
    expect(headline(1_200, 3_600, 0)).toBe('24 Hours of Le Mans — 1,200 editions experienced — 1h 00m watched');
    expect(headline(0, 0, 0)).toBe('24 Hours of Le Mans — its story starts with the first edition you watch');
    // Under a minute is not yet worth a figure.
    expect(headline(0, 45, 0)).toBe(headline(0, 0, 0));
    for (const [editions, seconds, stories] of [[0, 0, 0], [3, 7_200, 0]] as const) {
      expect(headline(editions, seconds, stories)).not.toMatch(/missed|not completed|incomplete|only|still to|left/i);
    }
  });

  it('shows a milestone still ahead as where the career stands, never rounded up to it', () => {
    expect(stillAheadNote(212.7, 250, 'hours')).toBe('Still ahead: 212 of 250 hours');
    expect(stillAheadNote(249.99, 250, 'hours')).toBe('Still ahead: 249 of 250 hours');
    expect(stillAheadNote(3, 10, 'count')).toBe('Still ahead: 3 of 10');
    expect(stillAheadNote(1_234, 2_500, 'hours')).toBe('Still ahead: 1,234 of 2,500 hours');
  });

  it('describeFragments counts stretches and gaps', () => {
    const H = 3_600;
    expect(describeFragments([{ start: 0, end: 6 * H }, { start: 7 * H, end: 12 * H + 12 * 60 }, { start: 17 * H, end: 24 * H }], 24 * H))
      .toBe('Watched in 3 stretches: 18h 12m of 24h 00m. 2 stretches still to watch, 5h 48m in total.');
    // Reaching the end names the stretch before it that is still to watch.
    expect(describeFragments([{ start: 0, end: 10 * H }, { start: 11 * H, end: 12 * H }], 12 * H))
      .toBe('Watched in 2 stretches: 11h 00m of 12h 00m. 1 stretch still to watch, 1h 00m.');
    // Forty seconds short is still forty seconds short.
    expect(describeFragments([{ start: 0, end: 6 * H - 40 }], 6 * H))
      .toBe('Watched in 1 stretch: 5h 59m of 6h 00m. 1 stretch still to watch, 40s.');
    expect(describeFragments([{ start: 0, end: 6 * H }], 6 * H)).toBe('Watched in 1 stretch: 6h 00m of 6h 00m. Every second of it is watched.');
    expect(describeFragments([], 6 * H)).toBe('Nothing watched yet: 6h 00m still to watch.');
    // Coverage stored past a shortened runtime is not counted.
    expect(describeFragments([{ start: 0, end: 7 * H }], 6 * H)).toBe('Watched in 1 stretch: 6h 00m of 6h 00m. Every second of it is watched.');
  });

  it('says what the rest of an Expedition asks of the plan as information, never as a limit', () => {
    const note = (realRemainingSec: number, yearRemainingHours: number, weekRemainingHours: number, recommendedPaceHours: number) =>
      expeditionBudgetNote({ realRemainingSec, speed: 1.25, year: 2026, yearRemainingHours, weekRemainingHours, recommendedPaceHours });
    expect(note(12.5 * 3_600, 180, 6.5, 8)).toBe(
      'The rest of this race is about 12h 30m of real time at 1.25×, about 7% of the 180 hours left in your 2026 plan. '
        + 'This week’s plan has 6.5 hours left. At the plan’s pace of 8 hours a week, that is roughly 2 weeks of viewing.',
    );
    expect(note(12.5 * 3_600, 5, 0, 8)).toContain('more than the 5 hours left in your 2026 plan, which is entirely fine.');
    expect(note(12.5 * 3_600, 0, 0, 0)).toBe(
      'The rest of this race is about 12h 30m of real time at 1.25×. Your 2026 plan has no hours left in it, which is entirely fine: '
        + 'the plan is a guide. This week’s planned hours are all watched.',
    );
    expect(note(1_800, 200, 8, 8)).toContain('under 1% of the 200 hours left');
    expect(note(1_800, 200, 8, 8)).toContain('that is less than a week of viewing.');
    expect(note(0, 200, 8, 8)).toBe('Nothing of this race is still to watch, so it asks nothing more of your 2026 plan.');
    for (const text of [note(45_000, 200, 0, 8), note(45_000, 5, 2, 8), note(360_000, 1, 0, 1)]) {
      expect(text).toContain('plan');
      expect(text).not.toMatch(/exceed|over budget|too much|warning|limit/i);
    }
  });

  it('says what switching Expedition Mode did, and that switching it off takes nothing back', () => {
    const base = { isExpedition: true, paysXp: true, checkpointsBehind: 0, xpAwarded: 0, summaryWritten: false, hasSummary: false };
    expect(expeditionModeMessage({ ...base, mode: 'on', checkpointsBehind: 3, xpAwarded: 600 }))
      .toBe('Expedition Mode is on. 3 checkpoints were already behind you: +600 XP.');
    expect(expeditionModeMessage({ ...base, mode: 'on', checkpointsBehind: 1, xpAwarded: 120 }))
      .toBe('Expedition Mode is on. 1 checkpoint was already behind you: +120 XP.');
    expect(expeditionModeMessage({ ...base, mode: 'on', paysXp: false }))
      .toBe('Expedition Mode is on. Checkpoints on races of 6 hours or more also earn XP.');
    expect(expeditionModeMessage({ ...base, mode: 'on' }))
      .toBe('Expedition Mode is on. Its checkpoints are at 10%, 25%, 50%, 75% and 90% of the story.');
    expect(expeditionModeMessage({ ...base, mode: 'on', checkpointsBehind: 5, xpAwarded: 3_000, summaryWritten: true, hasSummary: true }))
      .toBe('Expedition Mode is on. 5 checkpoints were already behind you: +3,000 XP. The story is already complete, so its Expedition Summary is ready.');
    expect(expeditionModeMessage({ ...base, mode: 'off', isExpedition: false }))
      .toBe('Expedition Mode is off. Checkpoints you already reached keep their XP.');
    expect(expeditionModeMessage({ ...base, mode: 'off', isExpedition: false, hasSummary: true }))
      .toBe('Expedition Mode is off. Checkpoints you already reached keep their XP. Its Expedition Summary stays.');
    expect(expeditionModeMessage({ ...base, mode: 'auto', isExpedition: false }))
      .toBe('Expedition Mode follows the race’s length again (automatic from 10 hours).');
    expect(expeditionModeMessage({ ...base, mode: 'auto', checkpointsBehind: 2, xpAwarded: 750 }))
      .toBe('Expedition Mode follows the race’s length again (automatic from 10 hours). 2 checkpoints were already behind you: +750 XP.');
  });

  it('says a difference between two years as an amount, never as a judgement', () => {
    expect(differencePhrase(4 * 3_600 + 10 * 60, 'seconds')).toBe('4h 10m more');
    expect(differencePhrase(-(4 * 3_600 + 10 * 60), 'seconds')).toBe('4h 10m less');
    expect(differencePhrase(-2, 'count')).toBe('2 fewer');
    expect(differencePhrase(1, 'count')).toBe('1 more');
    expect(differencePhrase(1_200, 'xp')).toBe('1,200 XP more');
    expect(differencePhrase(-1_200, 'xp')).toBe('1,200 XP less');
    expect(differencePhrase(3.54, 'percent-points')).toBe('3.5 points higher');
    expect(differencePhrase(-1, 'percent-points')).toBe('1 point lower');
    // Nothing the figures beside it can show is "the same".
    for (const [difference, unit] of [[0, 'count'], [0, 'xp'], [45, 'seconds'], [-59, 'seconds'], [0.04, 'percent-points']] as const) {
      expect(differencePhrase(difference, unit)).toBe('the same');
    }
    for (const unit of ['seconds', 'count', 'xp', 'percent-points'] as const) {
      for (const difference of [-50_000, -3, 0, 3, 50_000]) {
        expect(differencePhrase(difference, unit)).not.toMatch(/worse|better|decline|behind|drop|down|up|lost|gain/i);
      }
    }
  });

  it('makes even a short stint feel worthwhile', () => {
    expect(stintHeading(5)).toBe('STINT LOGGED');
    expect(stintHeading(25)).toBe('STINT COMPLETE');
    expect(stintHeading(130)).toBe('DOUBLE STINT COMPLETE');
  });
});
