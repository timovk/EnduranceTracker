/**
 * Career Statistics on the replay (SPEC §4.4).
 *
 * Every figure is read from the career replay through the window summary the
 * Chronicle shares, so hours are credited hours, new coverage is what the
 * stints still standing uncovered, "completed" is Story Complete and nothing
 * else, and a year in progress is compared with the same stretch of another.
 * Stints are logged through the real engine with explicit instants in local
 * time, so the figures below hold in any time zone the tests run in.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { levelFromXp } from '@/lib/domain/progression';
import { COMPARE_ROW_ORDER } from '@/lib/domain/window-summary';
import { createEvent, mergeEvents } from '@/lib/engines/event-legacy-engine';
import { eventHref } from '@/lib/engines/mastery-engine';
import { deleteViewingSession } from '@/lib/engines/session-engine';
import {
  getFilterOptions, getRecords, getStatistics, getYearComparison, isRaceStatus, isRaceType,
} from '@/lib/engines/stats-engine';
import { rebuildCareerTotals } from '@/lib/engines/xp-ledger';
import { addRace, createCareerUser, H, ledgerProblems, logStint } from '../helpers/career-db';

const USER = '00000000-0000-4000-8000-0000000006a1';
const OTHER = '00000000-0000-4000-8000-0000000006a2';
const NOW = new Date(2027, 5, 15, 21, 0);
const MINUTE = 60;

/** A local instant: 21:00 on the day, unless said otherwise. */
function at(year: number, month1to12: number, day: number, hour = 21, minute = 0): Date {
  return new Date(year, month1to12 - 1, day, hour, minute);
}

/** A stint logged at `watchedAt`, the engine's clock a minute later. */
async function watch(
  userId: string,
  raceId: string,
  watchedAt: Date,
  from: number,
  to: number,
  speed = 1,
) {
  return logStint(userId, raceId, { from, to, speed, watchedAt, now: new Date(watchedAt.getTime() + 60_000) });
}

interface LedgerRow {
  id: string;
  amount: number;
}

/** A stint, and the ledger rows it wrote, in order. */
async function watchAwarding(userId: string, raceId: string, watchedAt: Date, from: number, to: number): Promise<LedgerRow[]> {
  const before = await prisma.xPTransaction.findMany({ where: { userId }, select: { id: true } });
  await watch(userId, raceId, watchedAt, from, to);
  const known = new Set(before.map((row) => row.id));
  const rows = await prisma.xPTransaction.findMany({
    where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, amount: true },
  });
  return rows.filter((row) => !known.has(row.id));
}

/**
 * The ledger is stamped with the real clock. Date each stint's awards to the
 * stint's own instant, in order, and settle: the ledger then reads as if each
 * stint had been logged when it was watched.
 */
async function dateAwards(userId: string, stints: readonly (readonly [rows: readonly LedgerRow[], at: Date])[]) {
  for (const [rows, at] of stints) {
    for (const [index, row] of rows.entries()) {
      await prisma.xPTransaction.updateMany({
        where: { id: row.id, userId },
        data: { createdAt: new Date(at.getTime() + index) },
      });
    }
  }
  await prisma.$transaction((tx) => rebuildCareerTotals(tx as Tx, userId), { timeout: 60_000 });
  expect(await ledgerProblems(userId)).toEqual([]);
}

function xpOf(rows: readonly LedgerRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function inTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => work(tx as Tx), { maxWait: 15_000, timeout: 60_000 });
}

beforeEach(async () => {
  await createCareerUser(USER, 'StatsEngineTest');
  await createCareerUser(OTHER, 'StatsEngineOther');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await disconnectDb();
});

describe('Career Statistics', () => {
  it('credited totals', async () => {
    const raceId = await addRace(USER, { name: 'Six Hours of Spa', hours: 6 });
    await watch(USER, raceId, at(2027, 3, 6), 0, H);
    // An hour of timeline at 0.1× is ten real hours; it is credited as 80 minutes.
    await watch(USER, raceId, at(2027, 3, 13), H, 2 * H, 0.1);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.viewing.realSeconds).toBe(H + 80 * MINUTE);
    expect(stats.viewing.realHours).toBe(2.3);
    expect(stats.viewing.timelinePlayedSeconds).toBe(2 * H);
    expect(stats.viewing.newCoverageSeconds).toBe(2 * H);
    expect(stats.viewing.uniqueCoverageSeconds).toBe(2 * H);
    expect(stats.rewatchSeconds).toBe(0);
    expect(stats.sessions.sessions).toBe(2);
    // The longest session is credited time too, so slow playback cannot set it.
    expect(stats.sessions.longestRealSeconds).toBe(80 * MINUTE);
    expect(stats.sessions.longestSession?.raceName).toBe('Six Hours of Spa');
    // Speed is about how the timeline was played, so it keeps real time.
    expect(stats.sessions.averagePlaybackSpeed).toBeCloseTo((2 * H) / (H + 10 * H), 3);
    expect(stats.years).toEqual([expect.objectContaining({ year: 2027, realSeconds: H + 80 * MINUTE, sessions: 2 })]);
    expect(stats.monthly.find((month) => month.key === '2027-03')?.realSeconds).toBe(H + 80 * MINUTE);

    // The same career seen through its year is the same numbers.
    const year = await getStatistics(USER, { year: 2027 }, NOW);
    expect(year.viewing.realSeconds).toBe(stats.viewing.realSeconds);
    expect(year.races.racesInScope).toBe(1);
    expect(year.monthly).toHaveLength(12);
    const before = await getStatistics(USER, { year: 2026 }, NOW);
    expect(before.viewing.realSeconds).toBe(0);
    expect(before.races.racesInScope).toBe(0);
  });

  it('a year shows each race covered as far as it was when the year ended', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2026, 11, 7), 0, H);
    await watch(USER, raceId, at(2027, 2, 6), H, 3 * H);

    const in2026 = await getStatistics(USER, { year: 2026 }, NOW);
    expect(in2026.viewing.uniqueCoverageSeconds).toBe(H);
    expect(in2026.races.averageCoveragePercent).toBeCloseTo(100 / 6, 1);
    const in2027 = await getStatistics(USER, { year: 2027 }, NOW);
    expect(in2027.viewing.uniqueCoverageSeconds).toBe(3 * H);
    expect(in2027.viewing.newCoverageSeconds).toBe(2 * H);
  });

  it('a stint logged at 00:30 on 1 January puts its race in both years', async () => {
    const lastYear = await addRace(USER, { name: 'Last year', hours: 6 });
    const thisYear = await addRace(USER, { name: 'This year', hours: 6 });
    const newYear = await addRace(USER, { name: 'Over New Year', hours: 6 });
    await watch(USER, lastYear, at(2026, 11, 7), 0, H);
    await watch(USER, thisYear, at(2027, 2, 6), 0, 2 * H);
    // An hour from 23:30 on New Year's Eve: half of it in each year.
    await watch(USER, newYear, at(2027, 1, 1, 0, 30), 0, H);

    const in2026 = await getStatistics(USER, { year: 2026 }, NOW);
    expect(in2026.races.racesInScope).toBe(2);
    expect(in2026.viewing.realSeconds).toBe(H + 30 * MINUTE);
    // Its session, a fact at its instant, is the new year's.
    expect(in2026.sessions.sessions).toBe(1);
    const in2027 = await getStatistics(USER, { year: 2027 }, NOW);
    expect(in2027.races.racesInScope).toBe(2);
    expect(in2027.viewing.realSeconds).toBe(2 * H + 30 * MINUTE);
    expect(in2027.sessions.sessions).toBe(2);

    // A year offers the races it touched, most watched first, and no others.
    expect((await getFilterOptions(USER, { year: 2026 })).races.map((race) => race.id)).toEqual([lastYear, newYear]);
    expect((await getFilterOptions(USER, { year: 2027 })).races.map((race) => race.id)).toEqual([thisYear, newYear]);
  });

  it('re-watching adds re-watch time and never coverage', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2027, 4, 3), 0, 2 * H);
    await watch(USER, raceId, at(2027, 4, 10), H, 2 * H);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.viewing.realSeconds).toBe(3 * H);
    expect(stats.viewing.newCoverageSeconds).toBe(2 * H);
    expect(stats.rewatchSeconds).toBe(H);
    expect(stats.viewing.rewatchRealSeconds).toBe(H);
  });

  it('event filter', async () => {
    const first = await addRace(USER, { name: '2026 Six Hours of the Hills', iconicKey: 'hills-6', raceDate: new Date(Date.UTC(2026, 4, 1)) });
    const second = await addRace(USER, { name: '2027 Six Hours of the Hills', iconicKey: 'hills-6', raceDate: new Date(Date.UTC(2027, 4, 1)) });
    const elsewhere = await addRace(USER, { name: 'Somewhere Else' });
    // Another account's races with the same key are never counted here.
    const theirs = await addRace(OTHER, { name: 'Theirs', iconicKey: 'hills-6' });
    await watch(USER, first, at(2027, 2, 6), 0, H);
    await watch(USER, second, at(2027, 2, 13), 0, 2 * H);
    await watch(USER, elsewhere, at(2027, 2, 20), 0, 3 * H);
    await watch(OTHER, theirs, at(2027, 2, 20), 0, 4 * H);

    const stats = await getStatistics(USER, { eventKey: 'hills-6' }, NOW);
    expect(stats.races.racesInScope).toBe(2);
    expect(stats.viewing.realSeconds).toBe(3 * H);
    expect(stats.byEvent).toHaveLength(1);
    expect(stats.byEvent[0]).toMatchObject({ id: 'hills-6', realSeconds: 3 * H, href: '/events/hills-6', share: 1 });
    expect(stats.eventsFollowed).toBe(1);

    const whole = await getStatistics(USER, {}, NOW);
    expect(whole.byEvent[0]?.share).toBeCloseTo(0.5, 6);
    expect(whole.eventsFollowed).toBe(1);

    const options = await getFilterOptions(USER, { eventKey: 'hills-6' });
    expect(options.events).toEqual([expect.objectContaining({ key: 'hills-6', hours: 3 })]);
    // An event narrows the library enough to offer its races, most watched first.
    expect(options.races.map((race) => race.id)).toEqual([second, first]);
    expect((await getFilterOptions(USER)).races).toEqual([]);
  });

  it('race filter', async () => {
    const mine = await addRace(USER, { name: 'Mine' });
    const other = await addRace(USER, { name: 'Also mine' });
    const theirs = await addRace(OTHER, { name: 'Theirs' });
    await watch(USER, mine, at(2027, 2, 6), 0, H);
    await watch(USER, other, at(2027, 2, 7), 0, 2 * H);
    await watch(OTHER, theirs, at(2027, 2, 7), 0, 5 * H);

    const stats = await getStatistics(USER, { raceId: mine }, NOW);
    expect(stats.races.racesInScope).toBe(1);
    expect(stats.viewing.realSeconds).toBe(H);
    expect(stats.scopeLabel).toBe('Mine');
    expect(stats.careerWideNote).not.toBeNull();

    // A race id from another account chooses nothing and names nothing of theirs.
    const foreign = await getStatistics(USER, { raceId: theirs }, NOW);
    expect(foreign.races.racesInScope).toBe(0);
    expect(foreign.viewing.realSeconds).toBe(0);
    expect(foreign.scopeLabel).not.toContain('Theirs');
    expect((await getRecords(USER, { raceId: theirs })).records).toEqual([]);

    const options = await getFilterOptions(USER, { raceId: mine });
    expect(options.races.map((race) => race.id)).toContain(mine);
    expect(options.races.map((race) => race.id)).not.toContain(theirs);
  });

  it('length filter uses the duration classes', async () => {
    const sprint = await addRace(USER, { name: 'Sprint', hours: 3 });
    const six = await addRace(USER, { name: 'Six', hours: 6 });
    const day = await addRace(USER, { name: 'Day', hours: 24 });
    await watch(USER, sprint, at(2027, 1, 9), 0, H);
    await watch(USER, six, at(2027, 1, 10), 0, 2 * H);
    await watch(USER, day, at(2027, 1, 11), 0, 4 * H);

    const sixes = await getStatistics(USER, { length: 'h6' }, NOW);
    expect(sixes.races.racesInScope).toBe(1);
    expect(sixes.viewing.realSeconds).toBe(2 * H);
    expect(sixes.scopeLabel).toBe('Races of 6 hours');
    const days = await getStatistics(USER, { length: 'h24' }, NOW);
    expect(days.viewing.realSeconds).toBe(4 * H);
    const short = await getStatistics(USER, { length: 'short' }, NOW);
    expect(short.viewing.realSeconds).toBe(H);

    // The filter offers the bands the library has races in, as the chart names them.
    const options = await getFilterOptions(USER);
    expect(options.lengths.map((band) => [band.key, band.label, band.races])).toEqual([
      ['short', 'Up to 3 hours', 1], ['h6', '6 hours', 1], ['h24', '24 hours', 1],
    ]);
  });

  it('a 10-hour race is classed as 10 hours', async () => {
    const ten = await addRace(USER, { name: 'Ten', hours: 10 });
    const almost = await addRace(USER, { name: 'Nearly ten', hours: 9 + 50 / 60 });
    const eight = await addRace(USER, { name: 'Eight', hours: 8 });
    await watch(USER, ten, at(2027, 1, 9), 0, H);
    await watch(USER, almost, at(2027, 1, 10), 0, H);
    await watch(USER, eight, at(2027, 1, 11), 0, H);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.byDurationClass.map((band) => [band.name, band.realSeconds])).toEqual([
      ['8 hours', H], ['10 hours', 2 * H],
    ]);
    const tens = await getStatistics(USER, { length: 'h10' }, NOW);
    expect(tens.races.racesInScope).toBe(2);
    const eights = await getStatistics(USER, { length: 'h8' }, NOW);
    expect(eights.races.racesInScope).toBe(1);
  });

  it('new coverage is right after a delete', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    const first = await watch(USER, raceId, at(2027, 2, 6), 0, 2 * H);
    await watch(USER, raceId, at(2027, 2, 13), H, 3 * H);
    // The second stint's row keeps the snapshot it took: one new hour.
    const snapshot = await prisma.raceViewingSession.findFirstOrThrow({ where: { userId: USER, watchedAt: at(2027, 2, 13) } });
    expect(snapshot.newCoverageSeconds).toBe(H);

    await deleteViewingSession(USER, first.sessionId, NOW);
    const stats = await getStatistics(USER, {}, NOW);
    // With the first stint gone, the second uncovered two hours, not one.
    expect(stats.viewing.newCoverageSeconds).toBe(2 * H);
    expect(stats.viewing.uniqueCoverageSeconds).toBe(2 * H);
    expect(stats.viewing.realSeconds).toBe(2 * H);
    expect(stats.rewatchSeconds).toBe(0);
    expect(stats.monthly.find((month) => month.key === '2027-02')?.newCoverageSeconds).toBe(2 * H);
  });

  it('shortest meaningful session ignores stints under 10 minutes', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2027, 2, 6), 0, 5 * MINUTE);
    await watch(USER, raceId, at(2027, 2, 7), 5 * MINUTE, 17 * MINUTE);
    await watch(USER, raceId, at(2027, 2, 8), 17 * MINUTE, 47 * MINUTE);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.shortestMeaningfulSession?.realSeconds).toBe(12 * MINUTE);
    expect(stats.sessions.longestRealSeconds).toBe(30 * MINUTE);
  });

  it('completed equals Story Complete, never manual status', async () => {
    const watched = await addRace(USER, { name: 'Watched through', hours: 1 });
    const marked = await addRace(USER, { name: 'Marked by hand', hours: 6 });
    await watch(USER, watched, at(2027, 3, 6), 0, H);
    await watch(USER, marked, at(2027, 3, 7), 0, H);
    // A library label says "done"; the story is not complete.
    await prisma.race.updateMany({ where: { id: marked, userId: USER }, data: { status: 'COMPLETED', completedAt: at(2027, 3, 8) } });

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.races.racesCompleted).toBe(1);
    expect(stats.races.racesStoryComplete).toBe(1);
    expect(stats.championships[0]?.racesCompleted).toBe(1);
    expect(stats.storyCompletesByYear).toEqual([{ year: 2027, storyCompletes: 1 }]);
    expect(stats.completionsOverTime.find((point) => point.month === '2027-03')).toMatchObject({ storyCompletes: 1, cumulative: 1 });
    expect(stats.completionsOverTime[stats.completionsOverTime.length - 1]?.cumulative).toBe(1);
    // The Completion panel counts it once, as the story library.
    expect(stats.completion.storyLibrary).toMatchObject({ done: 1, total: 2 });
    expect('library' in stats.completion).toBe(false);
  });

  it('races experienced leaves out glimpses', async () => {
    const glimpse = await addRace(USER, { name: 'A glimpse', hours: 6 });
    const properly = await addRace(USER, { name: 'Properly', hours: 6 });
    await watch(USER, glimpse, at(2027, 3, 6), 0, MINUTE);
    await watch(USER, properly, at(2027, 3, 7), 0, H);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.races.racesStarted).toBe(2);
    expect(stats.racesExperienced).toBe(1);
    expect(stats.longestRace?.name).toBe('Properly');
    // Too few races started for a rate to say anything.
    expect(stats.storyCompleteRate).toBeNull();
  });

  it('counts the championships followed and their Story Completes, and major events within the year', async () => {
    const wec = await prisma.championship.create({ data: { userId: USER, slug: 'wec', name: 'WEC', accentColor: '#3366cc' } });
    const imsa = await prisma.championship.create({ data: { userId: USER, slug: 'imsa', name: 'IMSA', accentColor: '#cc3333' } });
    const complete = await addRace(USER, { name: 'Complete', hours: 1, championshipId: wec.id, isMajorEvent: true });
    const partly = await addRace(USER, { name: 'Partly', hours: 6, championshipId: imsa.id });
    await watch(USER, complete, at(2026, 5, 2), 0, H);
    await watch(USER, partly, at(2026, 5, 3), 0, H);
    // Watched again the next year: in that year's scope, completed the year before.
    await watch(USER, complete, at(2027, 5, 1), 0, H / 2);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.championshipsFollowed).toBe(2);
    expect(stats.eventsFollowed).toBe(0);
    // Only championships with a Story Complete are listed.
    expect(stats.storyCompletesByChampionship).toEqual([
      { id: wec.id, name: 'WEC', accentColor: '#3366cc', storyCompletes: 1 },
    ]);

    const in2026 = await getStatistics(USER, { year: 2026 }, NOW);
    expect(in2026.races).toMatchObject({ majorEvents: 1, majorEventsStoryComplete: 1 });
    const in2027 = await getStatistics(USER, { year: 2027 }, NOW);
    expect(in2027.races).toMatchObject({ majorEvents: 1, majorEventsStoryComplete: 0 });
    expect(in2027.championshipsFollowed).toBe(1);
    expect(in2027.storyCompletesByChampionship).toEqual([]);
  });

  it('keeps a quiet year between Story Completes as an empty slot', async () => {
    const first = await addRace(USER, { name: 'First', hours: 1 });
    const second = await addRace(USER, { name: 'Second', hours: 1 });
    await watch(USER, first, at(2024, 5, 4), 0, H);
    await watch(USER, second, at(2026, 5, 2), 0, H);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.storyCompletesByYear).toEqual([
      { year: 2024, storyCompletes: 1 }, { year: 2025, storyCompletes: 0 }, { year: 2026, storyCompletes: 1 },
    ]);
  });

  it('by weekday and by race length', async () => {
    const six = await addRace(USER, { hours: 6 });
    const day = await addRace(USER, { hours: 24 });
    // Saturday 12 June 2027, 20:00–21:00, and Sunday 13 June, 19:00–21:00.
    await watch(USER, six, at(2027, 6, 12), 0, H);
    await watch(USER, day, at(2027, 6, 13), 0, 2 * H);

    const stats = await getStatistics(USER, {}, NOW);
    // The user's week starts on Monday, so the seven days run Monday to Sunday.
    expect(stats.byWeekday.map((row) => row.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(stats.byWeekday.find((row) => row.label === 'Saturday')).toMatchObject({ realSeconds: H, sessions: 1 });
    expect(stats.byWeekday.find((row) => row.label === 'Sunday')).toMatchObject({ realSeconds: 2 * H, sessions: 1 });
    expect(stats.byWeekday.filter((row) => row.realSeconds > 0)).toHaveLength(2);
    expect(stats.byDurationClass.map((band) => [band.id, band.realSeconds, band.share])).toEqual([
      ['h6', H, 1 / 3], ['h24', 2 * H, 2 / 3],
    ]);

    // A Sunday week start moves Sunday to the front.
    await prisma.user.update({ where: { id: USER }, data: { weekStart: 0 } });
    const sunday = await getStatistics(USER, {}, NOW);
    expect(sunday.byWeekday[0]?.label).toBe('Sunday');
  });

  it('XP and levels by year', async () => {
    const raceId = await addRace(USER, { hours: 24 });
    const first = await watchAwarding(USER, raceId, at(2026, 3, 10), 0, 3 * H);
    const second = await watchAwarding(USER, raceId, at(2027, 3, 10), 3 * H, 6 * H);
    await dateAwards(USER, [[first, at(2026, 3, 10)], [second, at(2027, 3, 10)]]);

    const earned2026 = xpOf(first);
    const earned2027 = xpOf(second);
    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.xpAndLevelsByYear).toEqual([
      {
        year: 2027,
        xpEarned: earned2027,
        levelsGained: levelFromXp(earned2026 + earned2027).level - levelFromXp(earned2026).level,
      },
      { year: 2026, xpEarned: earned2026, levelsGained: levelFromXp(earned2026).level - 1 },
    ]);
    expect(stats.xpAndLevelsByYear[1]?.levelsGained).toBeGreaterThan(0);

    // A year filter asks only for its own year.
    const year = await getStatistics(USER, { year: 2026 }, NOW);
    expect(year.xpAndLevelsByYear).toEqual([stats.xpAndLevelsByYear[1]]);
  });

  it('counts landmarks over time as they were reached, one line per kind', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2027, 3, 6), 0, 6 * H);

    const [achievements, milestones] = await Promise.all([
      prisma.achievementProgress.count({ where: { userId: USER, unlockedAt: { not: null } } }),
      prisma.milestoneProgress.count({ where: { userId: USER, reachedAt: { not: null } } }),
    ]);
    const stats = await getStatistics(USER, {}, NOW);
    const last = stats.landmarksOverTime[stats.landmarksOverTime.length - 1];
    expect(last?.achievements).toBe(achievements);
    expect(last?.milestones).toBe(milestones);
    expect(achievements).toBeGreaterThan(0);
    // Running totals never go down.
    for (let index = 1; index < stats.landmarksOverTime.length; index += 1) {
      const [previous, current] = [stats.landmarksOverTime[index - 1]!, stats.landmarksOverTime[index]!];
      expect(current.achievements).toBeGreaterThanOrEqual(previous.achievements);
      expect(current.masteryNodes).toBeGreaterThanOrEqual(previous.masteryNodes);
      expect(current.milestones).toBeGreaterThanOrEqual(previous.milestones);
    }
  });

  it('under a year, counts only that year\'s landmarks, each dated when the history places it', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2026, 3, 6), 0, H);
    await watch(USER, raceId, at(2027, 3, 6), H, 6 * H);

    // A rung the history dated earlier than it was recorded counts where the history puts it.
    const rung = await prisma.milestoneProgress.findFirstOrThrow({
      where: { userId: USER, reachedAt: { gte: at(2027, 1, 1, 0) } },
      select: { id: true },
    });
    await prisma.milestoneProgress.updateMany({ where: { id: rung.id, userId: USER }, data: { achievedAt: at(2027, 1, 20) } });

    const [achievements, milestones] = await Promise.all([
      prisma.achievementProgress.findMany({ where: { userId: USER, unlockedAt: { not: null } }, select: { unlockedAt: true } }),
      prisma.milestoneProgress.findMany({
        where: { userId: USER, reachedAt: { not: null } }, select: { reachedAt: true, achievedAt: true },
      }),
    ]);
    const in2027 = (at: Date | null) => at !== null && at.getFullYear() === 2027;
    const year = await getStatistics(USER, { year: 2027 }, NOW);
    expect(year.landmarksOverTime[0]).toMatchObject({ month: '2027-01', achievements: 0, masteryNodes: 0, milestones: 1 });
    expect(year.landmarksOverTime[year.landmarksOverTime.length - 1]).toMatchObject({
      month: '2027-06',
      achievements: achievements.filter((row) => in2027(row.unlockedAt)).length,
      milestones: milestones.filter((row) => in2027(row.achievedAt ?? row.reachedAt)).length,
    });
    expect(achievements.some((row) => row.unlockedAt !== null && row.unlockedAt.getFullYear() === 2026)).toBe(true);

    // A year that reached no landmark draws no lines.
    expect((await getStatistics(USER, { year: 2025 }, NOW)).landmarksOverTime).toEqual([]);
  });

  it('counts a merged event\'s steps once, in the event it was merged into', async () => {
    const from = await inTx((tx) => createEvent(tx, USER, 'Merged Away', NOW));
    const into = await inTx((tx) => createEvent(tx, USER, 'Merged Into', NOW));
    if (!from.ok || !into.ok) throw new Error('the events already exist');
    const raceId = await addRace(USER, { name: 'Merged Away 2026', hours: 1, iconicKey: from.event.key, raceDate: new Date(Date.UTC(2026, 5, 15)) });
    await watch(USER, raceId, at(2027, 3, 6), 0, H);
    await inTx((tx) => mergeEvents(tx, USER, from.event.key, into.event.key, NOW));

    const mergedTree = `event:${from.event.key}`;
    const [trees, unlocked] = await Promise.all([
      prisma.masteryTree.findMany({ where: { userId: USER }, select: { key: true, _count: { select: { nodes: true } } } }),
      prisma.masteryProgress.findMany({
        where: { userId: USER, unlockedAt: { not: null } }, select: { node: { select: { tree: { select: { key: true } } } } },
      }),
    ]);
    // The merged tree stays, with its unlocks, as a landmark.
    expect(trees.some((tree) => tree.key === mergedTree)).toBe(true);
    expect(unlocked.some((row) => row.node.tree.key === mergedTree)).toBe(true);
    const kept = trees.filter((tree) => tree.key !== mergedTree);

    const stats = await getStatistics(USER, {}, NOW);
    expect(stats.completion.masteryTreesTotal).toBe(kept.length);
    expect(stats.completion.mastery.total).toBe(kept.reduce((sum, tree) => sum + tree._count.nodes, 0));
    expect(stats.completion.mastery.done).toBe(unlocked.filter((row) => row.node.tree.key !== mergedTree).length);
    expect(stats.landmarksOverTime[stats.landmarksOverTime.length - 1]?.masteryNodes).toBe(stats.completion.mastery.done);
  });

  it('keeps records within the filters, and within a year', async () => {
    const short = await addRace(USER, { name: 'Short', hours: 1 });
    const long = await addRace(USER, { name: 'Long', hours: 6 });
    await watch(USER, short, at(2026, 5, 2), 0, H);
    await watch(USER, long, at(2027, 5, 1), 0, 3 * H);

    const career = await getRecords(USER, {});
    const longest = career.records.find((record) => record.kind === 'longest-session');
    expect(longest).toMatchObject({ value: 3 * H, valueText: '3h 00m', subject: { name: 'Long', href: `/races/${long}` } });
    expect(longest?.history.map((entry) => entry.value)).toEqual([3 * H, H]);
    expect(career.withinYear).toBeNull();
    expect(career.stillToBeSet).toContain('longest run of complete editions');
    expect(career.loggedTimeNote).not.toBeNull();

    const in2026 = await getRecords(USER, { year: 2026 });
    expect(in2026.withinYear).toBe(2026);
    expect(in2026.records.find((record) => record.kind === 'longest-session')?.value).toBe(H);
    expect(in2026.records.find((record) => record.kind === 'longest-race-story-completed')?.subject?.name).toBe('Short');

    const filtered = await getRecords(USER, { raceId: short });
    expect(filtered.narrowed).toBe(true);
    expect(filtered.records.find((record) => record.kind === 'longest-session')?.value).toBe(H);
  });

  it('links the longest run of editions to its event', async () => {
    const first = await addRace(USER, { name: '2025 Hills 1 Hour', hours: 1, iconicKey: 'hills-1', raceDate: new Date(Date.UTC(2025, 4, 1)) });
    const second = await addRace(USER, { name: '2026 Hills 1 Hour', hours: 1, iconicKey: 'hills-1', raceDate: new Date(Date.UTC(2026, 4, 1)) });
    await watch(USER, first, at(2026, 5, 2), 0, H);
    await watch(USER, second, at(2026, 5, 9), 0, H);

    const streak = (await getRecords(USER, {})).records.find((record) => record.kind === 'longest-edition-streak');
    expect(streak).toMatchObject({ value: 2, valueText: '2 editions' });
    expect(streak?.subject?.href).toBe(eventHref('hills-1'));
  });

  it('a year in progress compares against the same stretch of the other year, whichever side it is on', async () => {
    const raceId = await addRace(USER, { hours: 24 });
    const march2026 = await watchAwarding(USER, raceId, at(2026, 3, 10), 0, H);
    // After 15 June: outside the stretch 2027 has reached.
    const september2026 = await watchAwarding(USER, raceId, at(2026, 9, 10), H, 3 * H);
    const march2027 = await watchAwarding(USER, raceId, at(2027, 3, 10), 3 * H, 7 * H);
    await dateAwards(USER, [
      [march2026, at(2026, 3, 10)], [september2026, at(2026, 9, 10)], [march2027, at(2027, 3, 10)],
    ]);

    type View = Awaited<ReturnType<typeof getYearComparison>>;
    const row = (view: View, key: string) => view.rows.find((candidate) => candidate.key === key);
    // The level the ledger stood at after this much XP: levels gained are the difference.
    const level = (xp: number) => levelFromXp(xp).level;
    const [xpMarch2026, xpSeptember2026, xpMarch2027] = [xpOf(march2026), xpOf(september2026), xpOf(march2027)];
    expect(xpSeptember2026).toBeGreaterThan(0);

    const forward = await getYearComparison(USER, 2026, 2027, {}, NOW);
    expect(forward.rows.map((candidate) => candidate.key)).toEqual([...COMPARE_ROW_ORDER]);
    expect(forward).toMatchObject({ a: 2026, b: 2027, samePeriodOffered: true, samePeriod: true, stretchLabel: '1 January to 15 June' });
    expect(row(forward, 'hours')).toMatchObject({ a: H, b: 4 * H, difference: 3 * H });
    // XP and levels come from the ledger inside the same stretch: September 2026 is left out.
    expect(row(forward, 'xp')).toMatchObject({ a: xpMarch2026, b: xpMarch2027, difference: xpMarch2027 - xpMarch2026 });
    expect(row(forward, 'levelsGained')).toMatchObject({
      a: level(xpMarch2026) - 1,
      b: level(xpMarch2026 + xpSeptember2026 + xpMarch2027) - level(xpMarch2026 + xpSeptember2026),
    });
    // The career began in 2026, so no row gets a percentage, and the tab says why first.
    expect(forward.partialNote).toBe('Your 2026 chapter began on 10 March');
    expect(forward.rows.every((candidate) => candidate.percentChange === null)).toBe(true);

    const backward = await getYearComparison(USER, 2027, 2026, {}, NOW);
    expect(row(backward, 'hours')).toMatchObject({ a: 4 * H, b: H, difference: -3 * H });
    expect(row(backward, 'xp')).toMatchObject({ a: xpMarch2027, b: xpMarch2026 });

    const whole = await getYearComparison(USER, 2026, 2027, { samePeriod: false }, NOW);
    expect(whole.samePeriod).toBe(false);
    expect(whole.stretchLabel).toBeNull();
    expect(row(whole, 'hours')).toMatchObject({ a: 3 * H, b: 4 * H });
    expect(row(whole, 'xp')).toMatchObject({ a: xpMarch2026 + xpSeptember2026, b: xpMarch2027 });
    expect(row(whole, 'levelsGained')?.a).toBe(level(xpMarch2026 + xpSeptember2026) - 1);

    // Two past years are compared whole: neither is in progress.
    const later = await getYearComparison(USER, 2026, 2027, {}, new Date(2028, 1, 1, 12));
    expect(later.samePeriodOffered).toBe(false);
    expect(row(later, 'hours')).toMatchObject({ a: 3 * H, b: 4 * H });
    expect(row(later, 'xp')).toMatchObject({ a: xpMarch2026 + xpSeptember2026, b: xpMarch2027 });
  });

  it('opens comparisons once the career spans two calendar years, and defaults to last year and this one', async () => {
    const raceId = await addRace(USER, { hours: 6 });
    await watch(USER, raceId, at(2027, 3, 10), 0, H);
    const single = await getYearComparison(USER, undefined, undefined, {}, NOW);
    expect(single.a).toBeNull();
    expect(single.emptyNote).toBe(
      'Comparisons open once your career spans two calendar years. Your first year ends on 31 December 2027.',
    );

    const next = await getYearComparison(USER, undefined, undefined, {}, new Date(2028, 0, 20, 12));
    expect(next).toMatchObject({ a: 2027, b: 2028, years: [2028, 2027], samePeriodOffered: true });
    // A year outside the career falls back to the defaults.
    const outside = await getYearComparison(USER, 1999, 2028, {}, new Date(2028, 0, 20, 12));
    expect(outside).toMatchObject({ a: 2027, b: 2028 });
    // A year is never compared with itself: the base moves to another year.
    const itself = await getYearComparison(USER, 2028, 2028, {}, new Date(2028, 0, 20, 12));
    expect(itself).toMatchObject({ a: 2027, b: 2028 });
    const first = await getYearComparison(USER, 2027, 2027, {}, new Date(2028, 0, 20, 12));
    expect(first).toMatchObject({ a: 2028, b: 2027 });
  });

  it('drops a status or race type from the address that the library does not have', () => {
    expect(isRaceStatus('COMPLETED')).toBe(true);
    expect(isRaceStatus('FOO')).toBe(false);
    // Not a key of the label table either, however objects are built.
    expect(isRaceStatus('constructor')).toBe(false);
    expect(isRaceStatus(undefined)).toBe(false);
    expect(isRaceType('H24')).toBe(true);
    expect(isRaceType('FOO')).toBe(false);
    expect(isRaceType(undefined)).toBe(false);
  });
});
