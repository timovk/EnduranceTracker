/**
 * The Career Chronicle's chapter and Endurance Wrapped, pure (SPEC §4.5.3,
 * §4.5.4). Histories are written with the timeline DSL in local time; the
 * rows the engines would load — the ledger, landmarks, summaries — are given
 * directly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { CHRONICLE_SHAPE } from '@/lib/config';
import {
  buildChapter, buildWrappedCards, chronicleChapterSchema, UnreadableChapterError, upgradeChapterSnapshot,
  type ChapterInput, type ChapterMilestoneRow, type ChronicleChapterV1, type WrappedCard,
} from '@/lib/domain/chronicle';
import type { CareerTimeline } from '@/lib/domain/career-timeline';
import { careerRecordOptions, computeRecordProgression, RECORD_ORDER } from '@/lib/domain/records';
import { chapterBeginning, wrappedCardLine } from '@/lib/copy/tone';
import { career, localTime, race, resetStintIds, stint } from '../helpers/timeline-fixture';

const H = 3600;

beforeEach(() => resetStintIds());

/** What the engine would hand `buildChapter` for a year with nothing else loaded. */
function input(timeline: CareerTimeline, year: number, overrides: Partial<ChapterInput> = {}): ChapterInput {
  const weekStartsOn = overrides.weekStartsOn ?? 1;
  return {
    year,
    complete: true,
    generatedAt: localTime(`${year + 1}-01-05T09:00`),
    timeZone: 'Europe/Test',
    weekStartsOn,
    timeline,
    progression: computeRecordProgression(timeline, careerRecordOptions(weekStartsOn)),
    ledger: [],
    levelAtStart: 1,
    achievements: [],
    careerMilestones: [],
    ladderRungs: [],
    masterySteps: [],
    expeditions: [],
    eventKeyById: new Map(),
    previousYearFrozen: null,
    previousYearXp: 0,
    ...overrides,
  };
}

function kinds(cards: readonly WrappedCard[]): string[] {
  return cards.map((card) => card.kind);
}

describe('a chapter', () => {
  it('summary totals equal the sum of the monthly rows', () => {
    const lm = race('lm', { hours: 24, championshipId: 'wec', championshipName: 'WEC' });
    const spa = race('spa', { hours: 6 });
    const timeline = career([lm, spa], [
      // Across New Year: most of it belongs to the year before.
      stint(lm, '2026-01-01T00:30', { from: '0:00', to: '2:00' }),
      stint(lm, '2026-01-31T23:30', { from: '2:00', to: '3:00' }),
      // Across the end of January.
      stint(lm, '2026-02-01T01:00', { from: '3:00', to: '4:30' }),
      stint(spa, '2026-03-14T22:00', { from: '0:00', to: '6:00' }),
      stint(lm, '2026-07-04T23:00', { from: '4:30', to: '24:00', speed: 4 }),
      // Across the end of the year.
      stint(spa, '2027-01-01T01:00', { from: '0:00', to: '2:00' }),
    ]);
    const ledger = [
      { createdAt: localTime('2026-01-01T00:30'), amount: 120, source: 'VIEWING', levelAfter: 1 },
      { createdAt: localTime('2026-03-14T22:00'), amount: 360, source: 'VIEWING', levelAfter: 2 },
      { createdAt: localTime('2026-07-04T23:00'), amount: 3_000, source: 'STORY_COMPLETE', levelAfter: 4 },
    ];
    const chapter = buildChapter(input(timeline, 2026, { ledger }));
    const sum = (pick: (month: ChronicleChapterV1['monthly'][number]) => number) =>
      chapter.monthly.reduce((total, month) => total + pick(month), 0);

    expect(chapter.monthly).toHaveLength(12);
    expect(chapter.monthly.map((month) => month.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sum((month) => month.creditedSeconds)).toBeCloseTo(chapter.summary.creditedSeconds, 6);
    expect(sum((month) => month.newCoverageSeconds)).toBeCloseTo(chapter.summary.newCoverageSeconds, 6);
    expect(sum((month) => month.sessions)).toBe(chapter.summary.sessions);
    expect(sum((month) => month.activeDays)).toBe(chapter.summary.activeDays);
    expect(sum((month) => month.storyCompletes)).toBe(chapter.summary.storyCompletes);
    expect(sum((month) => month.xpEarned)).toBe(chapter.summary.xpEarned);
    // The New Year stint's last half hour, the hour on 31 January, and the
    // half hour of the 1 February stint before midnight (its window is cut at
    // the stint before it).
    expect(chapter.summary.sessions).toBe(5);
    expect(chapter.summary.xpEarned).toBe(3_480);
    expect(chapter.monthly[0]!.creditedSeconds).toBeCloseTo(2 * H, 6);
    expect(chapter.summary.storyCompletes).toBe(2);
  });

  it('most active week honours a Sunday week start', () => {
    const spa = race('spa', { hours: 12 });
    const timeline = career([spa], [
      stint(spa, '2026-03-08T23:00', { from: '0:00', to: '4:00' }), // a Sunday
      stint(spa, '2026-03-09T23:00', { from: '4:00', to: '7:00' }), // the Monday after
    ]);
    const monday = buildChapter(input(timeline, 2026, { weekStartsOn: 1 }));
    const sunday = buildChapter(input(timeline, 2026, { weekStartsOn: 0 }));
    expect(monday.viewing.mostActiveWeek).toMatchObject({ label: 'Mon 2 – Sun 8 Mar', seconds: 4 * H, clipped: false });
    expect(sunday.viewing.mostActiveWeek).toMatchObject({ label: 'Sun 8 – Sat 14 Mar', seconds: 7 * H, clipped: false });
    expect(sunday.weekStartsOn).toBe(0);
  });

  it('a most active week straddling New Year is labelled with its days in the year', () => {
    const spa = race('spa', { hours: 24 });
    const timeline = career([spa], [
      stint(spa, '2026-12-29T23:00', { from: '0:00', to: '5:00' }),
      stint(spa, '2026-12-30T23:00', { from: '5:00', to: '10:00' }),
      stint(spa, '2027-01-02T23:00', { from: '10:00', to: '11:00' }),
    ]);
    const chapter = buildChapter(input(timeline, 2026));
    expect(chapter.viewing.mostActiveWeek).toMatchObject({ label: 'Mon 28 – Thu 31 Dec', clipped: true, seconds: 10 * H });
    // The week's days in the next year are the next chapter's.
    const next = buildChapter(input(timeline, 2027));
    expect(next.viewing.mostActiveWeek).toMatchObject({ label: 'Fri 1 – Sun 3 Jan', clipped: true, seconds: H });
    expect(wrappedCardLine({
      asOf: null, kind: 'active', year: 2026, month: null,
      week: { label: chapter.viewing.mostActiveWeek!.label, seconds: 10 * H, clipped: true },
    })).toBe('Your biggest week was Mon 28 – Thu 31 Dec (the days in 2026), with 10h 00m.');
  });

  it('championship shares sum to 1', () => {
    const races = [
      race('a', { championshipId: 'wec', championshipName: 'WEC', championshipAccent: '#123456' }),
      race('b', { championshipId: 'imsa', championshipName: 'IMSA' }),
      race('c', { championshipId: 'wec', championshipName: 'WEC' }),
      race('d'),
    ];
    const timeline = career(races, [
      stint('a', '2026-04-01T22:00', { from: '0:00', to: '3:00' }),
      stint('b', '2026-04-02T22:00', { from: '0:00', to: '1:30' }),
      stint('c', '2026-04-03T22:00', { from: '0:00', to: '2:15' }),
      stint('d', '2026-04-04T22:00', { from: '0:00', to: '0:45' }),
    ]);
    const chapter = buildChapter(input(timeline, 2026));
    expect(chapter.championships.map((row) => row.name)).toEqual(['WEC', 'IMSA', 'Without a championship']);
    expect(chapter.championships.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 9);
    expect(chapter.championships[0]).toMatchObject({ id: 'wec', accent: '#123456', creditedSeconds: 5.25 * H });
  });

  it('completion percentage is runtime-weighted', () => {
    const lm = race('lm', { hours: 24 });
    const sprint = race('sprint', { hours: 1 });
    const timeline = career([lm, sprint], [
      stint(lm, '2026-06-13T23:00', { from: '0:00', to: '12:00', speed: 4 }),
      stint(sprint, '2026-06-14T21:00', { from: '0:00', to: '1:00' }),
    ]);
    const chapter = buildChapter(input(timeline, 2026));
    // (12 h + 1 h) of (24 h + 1 h), not the mean of 50% and 100%.
    expect(chapter.summary.completionPercent).toBeCloseTo((100 * 13) / 25, 9);
    expect(chapter.viewing.longestRace).toMatchObject({ raceId: 'lm', storyComplete: false, coverageSeconds: 12 * H });
  });

  it('a year that finishes last year\'s races never shows a rate above 100%', () => {
    const races = Array.from({ length: 11 }, (_, index) => race(`r${index}`, { hours: 1 }));
    const sessions = [
      // Six races started in 2025 and finished in 2026.
      ...races.slice(0, 6).flatMap((one, index) => [
        stint(one, `2025-12-${String(10 + index).padStart(2, '0')}T21:00`, { from: '0:00', to: '0:30' }),
        stint(one, `2026-01-${String(10 + index).padStart(2, '0')}T21:00`, { from: '0:30', to: '1:00' }),
      ]),
      // Five started in 2026, two of them finished.
      ...races.slice(6).map((one, index) => stint(one, `2026-02-${String(10 + index).padStart(2, '0')}T21:00`, {
        from: '0:00', to: index < 2 ? '1:00' : '0:20',
      })),
    ];
    const chapter = buildChapter(input(career(races, sessions), 2026));
    expect(chapter.summary.storyCompletes).toBe(8);
    expect(chapter.summary.racesStarted).toBe(5);
    expect(chapter.storyComplete.rate).toBe(40);
    expect(chapter.storyComplete.rate!).toBeLessThanOrEqual(100);
    // Below five races started, there is no rate at all.
    const earlier = buildChapter(input(career(races, sessions), 2025));
    expect(earlier.summary.racesStarted).toBe(6);
    expect(earlier.storyComplete.rate).toBe(0);
  });

  it('notable races are deterministic and never repeat a race', () => {
    const races = [
      race('lm', { hours: 24, eventKey: 'le-mans', eventName: 'Le Mans', eventId: 'e1', raceDate: new Date(Date.UTC(2026, 5, 13)) }),
      race('seb', { hours: 12, eventKey: 'sebring', eventName: 'Sebring', eventId: 'e2', raceDate: new Date(Date.UTC(2026, 2, 21)) }),
      race('spa', { hours: 6 }),
      race('fuji', { hours: 6 }),
      race('day', { hours: 24, eventKey: 'daytona', eventName: 'Daytona', eventId: 'e3' }),
      race('glimpse', { hours: 4 }),
    ];
    const sessions = [
      stint('seb', '2026-03-21T23:00', { from: '0:00', to: '12:00' }),
      stint('lm', '2026-06-13T20:00', { from: '0:00', to: '6:00' }),
      stint('lm', '2026-06-20T20:00', { from: '6:00', to: '12:00' }),
      stint('lm', '2026-06-27T20:00', { from: '12:00', to: '24:00', speed: 2 }),
      stint('spa', '2026-05-01T20:00', { from: '0:00', to: '2:00' }),
      stint('spa', '2026-05-02T20:00', { from: '2:00', to: '4:00' }),
      stint('spa', '2026-05-03T20:00', { from: '4:00', to: '5:00' }),
      stint('spa', '2026-05-04T20:00', { from: '5:00', to: '6:00' }),
      stint('fuji', '2026-09-01T23:00', { from: '0:00', to: '6:00' }),
      stint('day', '2026-01-31T23:00', { from: '0:00', to: '1:00' }),
      stint('glimpse', '2026-10-01T21:00', { from: '0:00', to: '0:05' }),
    ];
    const expeditions = [
      { summaryId: 'x1', raceId: 'lm', raceName: 'lm', completedAt: localTime('2026-06-27T20:00'), creditedSeconds: 18 * H, calendarDays: 15 },
      { summaryId: 'x2', raceId: 'fuji', raceName: 'fuji', completedAt: localTime('2026-09-01T23:00'), creditedSeconds: 6 * H, calendarDays: 1 },
    ];
    const chapter = buildChapter(input(career(races, sessions), 2026, { expeditions }));
    const again = buildChapter(input(career([...races].reverse(), [...sessions].reverse()), 2026, { expeditions }));

    expect(again.notableRaces).toEqual(chapter.notableRaces);
    const ids = chapter.notableRaces.map((notable) => notable.raceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(CHRONICLE_SHAPE.notableRacesCount);
    expect(chapter.notableRaces.map((notable) => [notable.raceId, notable.reason])).toEqual([
      ['lm', 'longest-story'],
      // Le Mans holds the most credited time too, but a race is listed once.
      ['seb', 'most-watched'],
      // Le Mans is an Expedition as well; only Fuji is left to list as one.
      ['fuji', 'expedition'],
      ['spa', 'most-stints'],
      // Sebring and Le Mans were first editions too, and are already listed.
      ['day', 'first-edition'],
    ]);
    expect(chapter.notableRaces.map((notable) => notable.detail)).toEqual([
      'The longest race you completed in 2026: 24h 00m',
      'Your most-watched race of 2026: 12h 00m',
      'An Expedition completed over one day',
      '4 stints in 2026',
      'Your first edition of Daytona experienced',
    ]);
    // Without the Expeditions, the longest journey from first stint to complete story gets its place.
    const plain = buildChapter(input(career(races, sessions), 2026));
    expect(plain.notableRaces.map((notable) => notable.reason)).toEqual(['longest-story', 'most-watched', 'most-stints', 'first-edition', 'longest-journey']);
    expect(plain.notableRaces[4]).toMatchObject({ raceId: 'fuji', detail: 'From first stint to complete story in 6h 00m' });
  });

  it('keeps the best record of each kind set in the year, in the order records are listed', () => {
    const spa = race('spa', { hours: 12 });
    const timeline = career([spa], [
      stint(spa, '2025-11-01T21:00', { from: '0:00', to: '3:00' }),
      stint(spa, '2026-02-01T21:00', { from: '3:00', to: '4:00' }),
      stint(spa, '2026-03-01T23:00', { from: '4:00', to: '8:00' }),
      stint(spa, '2026-04-01T23:30', { from: '8:00', to: '12:00', speed: 0.8 }),
    ]);
    const chapter = buildChapter(input(timeline, 2026));
    const kinds = chapter.records.map((record) => record.kind);
    expect(kinds).toEqual(RECORD_ORDER.filter((kind) => kinds.includes(kind)));
    expect(new Set(kinds).size).toBe(kinds.length);
    const longest = chapter.records.find((record) => record.kind === 'longest-session');
    expect(longest).toMatchObject({ value: 5 * H, valueText: '5h 00m', raceId: 'spa' });
    expect(chapter.records.every((record) => record.at >= localTime('2026-01-01').toISOString())).toBe(true);
  });

  it('reaches its levels and titles from the ledger of the year', () => {
    const spa = race('spa');
    const timeline = career([spa], [stint(spa, '2026-05-01T21:00', { from: '0:00', to: '1:00' })]);
    const ledger = [
      { createdAt: localTime('2026-05-01T21:00'), amount: 100, source: 'VIEWING', levelAfter: 3 },
      { createdAt: localTime('2026-05-01T21:00:01'), amount: 50, source: 'VIEWING', levelAfter: 3 },
      { createdAt: localTime('2026-08-01T21:00'), amount: 9_000, source: 'ACHIEVEMENT', levelAfter: 11 },
    ];
    const chapter = buildChapter(input(timeline, 2026, { ledger, levelAtStart: 2 }));
    expect(chapter.summary).toMatchObject({ xpEarned: 9_150, levelStart: 2, levelEnd: 11, levelsGained: 9 });
    expect(chapter.progression.levelsReached.map((reached) => reached.level)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(chapter.progression.levelsReached[0]!.at).toBe(localTime('2026-05-01T21:00').toISOString());
    expect(chapter.progression.levelsReached[8]!.at).toBe(localTime('2026-08-01T21:00').toISOString());
    expect(chapter.progression.titlesReached).toEqual(['Grandstand Regular', 'Rookie Endurance Fan']);
    expect(chapter.progression.xpBySource).toEqual([{ source: 'ACHIEVEMENT', amount: 9_000 }, { source: 'VIEWING', amount: 150 }]);
  });

  it('lists the landmarks of the year by when they happened, and names where they happened', () => {
    const spa = race('spa');
    const timeline = career([spa], [stint(spa, '2026-05-01T21:00', { from: '0:00', to: '1:00' })]);
    const row = (overrides: Partial<ChapterMilestoneRow>): ChapterMilestoneRow => ({
      metric: 'x', threshold: 1, reachedAt: null, achievedAt: null, achievedPrecision: null, xpAwarded: 0,
      raceId: null, eventId: null, subjectName: null, ...overrides,
    });
    const chapter = buildChapter(input(timeline, 2026, {
      careerMilestones: [
        // Reached in 2026 by its history, recorded in 2027: it belongs to 2026.
        { id: 'hours-100', title: '100 hours', celebration: 'notable', row: row({
          achievedAt: localTime('2026-12-31T23:00'), reachedAt: localTime('2027-01-02T10:00'),
          achievedPrecision: 'INTERPOLATED', xpAwarded: 500, raceId: 'spa', subjectName: 'Spa',
        }) },
        // Recorded in 2026, not placed by history: dated when it was recorded.
        { id: 'events-5', title: 'Five editions', celebration: 'none', row: row({
          reachedAt: localTime('2026-03-01T10:00'), achievedPrecision: 'RECOGNISED', eventId: 'e1', subjectName: 'Le Mans',
        }) },
        // Reached in 2025.
        { id: 'first-race', title: 'First race', celebration: 'none', row: row({ achievedAt: localTime('2025-06-01T10:00') }) },
      ],
      eventKeyById: new Map([['e1', 'le-mans']]),
      ladderRungs: [{ metric: 'realHours', label: 'Real viewing hours', row: row({ metric: 'realHours', threshold: 5, achievedAt: localTime('2026-02-01T10:00') }) }],
      masterySteps: [
        { treeKey: 'event:le-mans', treeName: 'Le Mans', eventKey: 'le-mans', nodeKey: 'edition_1', nodeName: 'First Complete Edition', at: localTime('2026-06-14T15:00'), xp: 1_000 },
        { treeKey: 'championship:wec', treeName: 'WEC', eventKey: null, nodeKey: 'first_race', nodeName: 'Lights Out', at: localTime('2026-06-13T15:00'), xp: 500 },
        { treeKey: 'championship:wec', treeName: 'WEC', eventKey: null, nodeKey: 'second', nodeName: 'Later', at: localTime('2027-01-01T01:00'), xp: 500 },
      ],
      achievements: [
        { key: 'green_flag', name: 'Green Flag', rarity: 'COMMON', unlockedAt: localTime('2026-05-01T21:00'), xp: 250 },
        { key: 'old', name: 'Old', rarity: 'RARE', unlockedAt: localTime('2025-05-01T21:00'), xp: 250 },
      ],
    }));

    expect(chapter.milestones.career.map((milestone) => milestone.id)).toEqual(['events-5', 'hours-100']);
    expect(chapter.milestones.career[0]).toMatchObject({ subjectKind: 'event', subjectId: 'le-mans', precision: 'RECOGNISED' });
    expect(chapter.milestones.career[1]).toMatchObject({ subjectKind: 'race', subjectId: 'spa', precision: 'INTERPOLATED', xp: 500 });
    expect(chapter.milestones.ladder).toEqual([{ metric: 'realHours', label: 'Real viewing hours', threshold: 5, at: localTime('2026-02-01T10:00').toISOString() }]);
    expect(chapter.mastery.steps.map((step) => step.nodeKey)).toEqual(['first_race', 'edition_1']);
    expect(chapter.mastery.xp).toBe(1_500);
    expect(chapter.milestones.eventLegacy).toEqual([{
      eventKey: 'le-mans', eventName: 'Le Mans', nodeKey: 'edition_1', nodeName: 'First Complete Edition',
      at: localTime('2026-06-14T15:00').toISOString(),
    }]);
    expect(chapter.achievements.map((achievement) => achievement.key)).toEqual(['green_flag']);
    expect(chapter.summary).toMatchObject({ achievementsUnlocked: 1, milestonesReached: 2, masteryStepsUnlocked: 2, masteryXp: 1_500 });
  });

  it('tells how the career began only in its first year', () => {
    const fuji = race('fuji', { name: '6 Hours of Fuji', hours: 6, eventKey: 'fuji-6', eventName: 'Fuji 6 Hours' });
    const timeline = career([fuji], [
      stint(fuji, '2026-09-22T21:00', { from: '0:00', to: '1:00' }),
      stint(fuji, '2026-09-23T23:00', { from: '1:00', to: '6:00' }),
      stint(fuji, '2027-02-01T21:00', { from: '0:00', to: '1:00' }),
    ]);
    const first = buildChapter(input(timeline, 2026));
    expect(first.beginnings).toEqual({
      firstStint: { at: localTime('2026-09-22T21:00').toISOString(), raceId: 'fuji', raceName: '6 Hours of Fuji' },
      firstStoryComplete: { at: localTime('2026-09-23T23:00').toISOString(), raceId: 'fuji', raceName: '6 Hours of Fuji' },
      firstEventEdition: {
        at: localTime('2026-09-22T21:00').toISOString(), eventKey: 'fuji-6', eventName: 'Fuji 6 Hours', raceName: '6 Hours of Fuji',
      },
    });
    expect(chapterBeginning(first.beginnings)).toEqual([
      'Your chronicle begins on 22 September 2026 with the 6 Hours of Fuji.',
      'Your first complete race story followed on 23 September 2026: the 6 Hours of Fuji.',
      'Your first edition of Fuji 6 Hours came on 22 September 2026, with the 6 Hours of Fuji.',
    ]);
    expect(buildChapter(input(timeline, 2027)).beginnings).toBeNull();
  });

  it('compares with the year before from its frozen chapter, or live, and says when the career began inside it', () => {
    const spa = race('spa', { hours: 12 });
    const timeline = career([spa], [
      stint(spa, '2025-09-22T21:00', { from: '0:00', to: '2:00' }),
      stint(spa, '2026-03-01T21:00', { from: '2:00', to: '5:00' }),
    ]);
    const live = buildChapter(input(timeline, 2026, { previousYearXp: 700 }));
    expect(live.previousYear).toEqual({
      year: 2025, activeFrom: localTime('2025-09-22T21:00').toISOString(), careerBeganInYear: true,
      creditedSeconds: 2 * H, racesExperienced: 1, storyCompletes: 0, xpEarned: 700, averageSessionSeconds: 2 * H,
    });

    const frozen = buildChapter(input(timeline, 2025, { ledger: [{ createdAt: localTime('2025-09-22T21:00'), amount: 900, source: 'VIEWING', levelAfter: 2 }] }));
    const fromFrozen = buildChapter(input(timeline, 2026, { previousYearFrozen: frozen, previousYearXp: 0 }));
    expect(fromFrozen.previousYear).toMatchObject({ year: 2025, xpEarned: 900, creditedSeconds: 2 * H, careerBeganInYear: true });

    // The career's first chapter has no year before it.
    expect(frozen.previousYear).toBeNull();
    const cards = buildWrappedCards(fromFrozen, { careerYear: 2, state: 'frozen' });
    const compared = cards.find((card) => card.kind === 'compared');
    expect(compared).toMatchObject({ previousYear: 2025, beganOn: localTime('2025-09-22T21:00').toISOString() });
    // A first year that was not a whole one gets no percentage changes.
    if (compared?.kind !== 'compared') throw new Error('no comparison card');
    expect(compared.rows.map((row) => row.percentChange)).toEqual([null, null, null, null]);
    expect(wrappedCardLine(compared)).toBe(
      'Your 2025 chapter began on 22 September. Next to 2025: hours watched, 1h 00m more; races experienced, the same; '
        + 'complete race stories, the same; XP earned, 900 XP less.',
    );
  });

  it('is JSON that reads back as itself, and a snapshot of another version is not read', () => {
    const lm = race('lm', { hours: 24, championshipId: 'wec', championshipName: 'WEC', circuitSlug: 'la-sarthe', circuit: 'La Sarthe' });
    const timeline = career([lm], [stint(lm, '2026-06-14T16:00', { from: '0:00', to: '24:00', speed: 8 })]);
    const chapter = buildChapter(input(timeline, 2026));
    const stored: unknown = JSON.parse(JSON.stringify(chapter));
    expect(chronicleChapterSchema.parse(stored)).toEqual(chapter);
    expect(upgradeChapterSnapshot(stored)).toEqual(chapter);
    expect(() => upgradeChapterSnapshot({ ...chapter, schemaVersion: 2 })).toThrow(UnreadableChapterError);
    expect(() => upgradeChapterSnapshot({ year: 2026 })).toThrow('This chapter was saved by a newer version.');
  });
});

describe('Endurance Wrapped', () => {
  it('Wrapped omits cards without data', () => {
    const spa = race('spa', { hours: 6 });
    const timeline = career([spa], [stint(spa, '2026-05-01T23:00', { from: '0:00', to: '3:00' })]);
    const chapter = buildChapter(input(timeline, 2026, { previousYearFrozen: null }));
    // No championship, event or circuit, no landmarks, no Expedition, and no year before.
    expect(kinds(buildWrappedCards(chapter, { careerYear: 1, state: 'frozen' }))).toEqual([
      'opening', 'hours', 'races', 'longest-race', 'longest-session', 'active', 'xp', 'records', 'closing',
    ]);

    // A year with nothing in it keeps only the cards that are always there.
    const quiet = buildChapter(input(career([spa], []), 2026));
    expect(kinds(buildWrappedCards(quiet, { careerYear: 1, state: 'year-to-date' }))).toEqual(['opening', 'races', 'xp', 'closing']);
  });

  it('keeps its cards in the fixed order when every card has something to say', () => {
    const lm = race('lm', {
      hours: 24, championshipId: 'wec', championshipName: 'WEC', championshipAccent: '#0a7abf',
      eventKey: 'le-mans', eventName: 'Le Mans', eventId: 'e1', circuit: 'La Sarthe', circuitSlug: 'la-sarthe',
      raceDate: new Date(Date.UTC(2026, 5, 13)),
    });
    const timeline = career([lm], [
      stint(lm, '2025-06-14T23:00', { from: '0:00', to: '1:00' }),
      stint(lm, '2026-06-14T23:00', { from: '1:00', to: '24:00', speed: 4 }),
    ]);
    const chapter = buildChapter(input(timeline, 2026, {
      ledger: [{ createdAt: localTime('2026-06-14T23:00'), amount: 5_000, source: 'VIEWING', levelAfter: 4 }],
      achievements: [{ key: 'a', name: 'Around the Clock', rarity: 'EPIC', unlockedAt: localTime('2026-06-14T23:00'), xp: 1_000 }],
      expeditions: [{ summaryId: 'x', raceId: 'lm', raceName: '24 Hours of Le Mans', completedAt: localTime('2026-06-14T23:00'), creditedSeconds: 6.75 * H, calendarDays: 366 }],
    }));
    const cards = buildWrappedCards(chapter, { careerYear: 2, state: 'frozen' });
    expect(kinds(cards)).toEqual([
      'opening', 'hours', 'races', 'championship', 'event', 'longest-race', 'longest-session', 'circuit', 'active',
      'xp', 'landmarks', 'expeditions', 'records', 'compared', 'closing',
    ]);
    expect(cards.find((card) => card.kind === 'championship')).toMatchObject({ accent: '#0a7abf', share: 1 });
    const records = cards.find((card) => card.kind === 'records');
    if (records?.kind !== 'records') throw new Error('no records card');
    expect(records.records.length).toBeLessThanOrEqual(CHRONICLE_SHAPE.wrappedRecordsShown);
    for (const card of cards) expect(wrappedCardLine(card).length).toBeGreaterThan(0);
  });

  it('the favourite-circuit card needs circuit data for half the hours', () => {
    const withCircuit = race('a', { circuit: 'Spa', circuitSlug: 'spa' });
    const without = race('b');
    const cardsFor = (circuitHours: string, otherHours: string) => {
      resetStintIds();
      const timeline = career([withCircuit, without], [
        stint(withCircuit, '2026-04-01T23:00', { from: '0:00', to: circuitHours }),
        stint(without, '2026-04-02T23:00', { from: '0:00', to: otherHours }),
      ]);
      return buildWrappedCards(buildChapter(input(timeline, 2026)), { careerYear: 1, state: 'frozen' });
    };
    // 2 hours of 5 carry a circuit: not enough to call one a favourite.
    expect(kinds(cardsFor('2:00', '3:00'))).not.toContain('circuit');
    // 3 of 5 do.
    const cards = cardsFor('3:00', '2:00');
    expect(cards.find((card) => card.kind === 'circuit')).toMatchObject({ name: 'Spa', creditedSeconds: 3 * H, share: 0.6 });
    // Exactly half is enough.
    expect(kinds(cardsFor('2:30', '2:30'))).toContain('circuit');
  });

  it('Career Year 1 opens with its beginning', () => {
    const fuji = race('fuji', { name: '6 Hours of Fuji' });
    const timeline = career([fuji], [
      stint(fuji, '2026-09-22T21:00', { from: '0:00', to: '1:00' }),
      stint(fuji, '2027-03-01T21:00', { from: '1:00', to: '2:00' }),
    ]);
    const [opening] = buildWrappedCards(buildChapter(input(timeline, 2026)), { careerYear: 1, state: 'frozen' });
    expect(opening).toMatchObject({ kind: 'opening', year: 2026, careerYear: 1, beginning: { raceName: '6 Hours of Fuji' } });
    expect(wrappedCardLine(opening!)).toBe('Your chronicle begins on 22 September 2026 with the 6 Hours of Fuji.');

    const [later] = buildWrappedCards(buildChapter(input(timeline, 2027, { complete: false })), { careerYear: 2, state: 'year-to-date' });
    expect(later).toMatchObject({ kind: 'opening', careerYear: 2, beginning: null, complete: false });
    expect(wrappedCardLine(later!)).toBe('Your 2027 so far, card by card: a chapter still being written.');
  });

  it('every year-to-date card is marked year to date', () => {
    const lm = race('lm', { hours: 24, championshipId: 'wec', championshipName: 'WEC', circuit: 'La Sarthe', circuitSlug: 'la-sarthe' });
    const timeline = career([lm], [stint(lm, '2026-06-14T23:00', { from: '0:00', to: '10:00', speed: 2 })]);
    const chapter = buildChapter(input(timeline, 2026, { complete: false, generatedAt: localTime('2026-09-26T09:00') }));
    const preview = buildWrappedCards(chapter, { careerYear: 1, state: 'year-to-date' });
    expect(preview.length).toBeGreaterThan(5);
    for (const card of preview) expect(card.asOf, card.kind).toBe(localTime('2026-09-26T09:00').toISOString());
    expect(wrappedCardLine(preview.find((card) => card.kind === 'longest-race')!))
      .toBe('Your longest race was the lm: 41.6% of the story so far.');

    // A finished year, finalising or frozen, is not a preview.
    for (const state of ['finalising', 'frozen'] as const) {
      for (const card of buildWrappedCards({ ...chapter, complete: true }, { careerYear: 1, state })) {
        expect(card.asOf, `${state} ${card.kind}`).toBeNull();
      }
    }
  });

  it('never says a race was not completed, only how much of its story was seen', () => {
    const lm = race('lm', { name: '24 Hours of Le Mans', hours: 24 });
    const timeline = career([lm], [stint(lm, '2026-06-14T23:00', { from: '0:00', to: '14:53', speed: 4 })]);
    const card = buildWrappedCards(buildChapter(input(timeline, 2026)), { careerYear: 1, state: 'frozen' })
      .find((candidate) => candidate.kind === 'longest-race')!;
    const line = wrappedCardLine(card);
    expect(line).toBe('Your longest race was the 24 Hours of Le Mans: 62% of the story seen by the end of 2026.');
    expect(line).not.toMatch(/not completed|missed|incomplete|unfinished/i);
  });
});
