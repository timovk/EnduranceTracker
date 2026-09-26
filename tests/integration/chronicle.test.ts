/**
 * The Career Chronicle against the real engines and database (SPEC §4.5,
 * §5.2 P5, §5.4).
 *
 * Stints are logged through the real `logViewingSession` at injected local
 * times, in London, and every Chronicle function is handed its `now`, so the
 * grace period after New Year can be walked through minute by minute. The
 * ledger is stamped with the real clock whatever `now` says (§8.1); nothing
 * here depends on which year that puts XP in.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma } from '@/lib/db/client';
import { buildWrappedCards, upgradeChapterSnapshot } from '@/lib/domain/chronicle';
import {
  buildChapterData, ensureChroniclesFrozen, freezeDueAt, getChronicleChapter, getChronicleIndex, markWrappedSeen,
  pendingWrapped, rebuildChronicleYear,
} from '@/lib/engines/chronicle-engine';
import { deleteRace } from '@/lib/engines/session-engine';
import { getStatistics } from '@/lib/engines/stats-engine';
import { freezeAllChronicles } from '@/lib/server/upgrades/chronicle-freeze';
import {
  deadlineClock, isCareerBackfillApplied, markCareerBackfillApplied, runCareerBackfillFor,
} from '@/lib/server/upgrades/career-backfill';
import { addRace, createCareerUser, H, ledgerProblems, logStint } from '../helpers/career-db';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const USER = '00000000-0000-4000-8000-0000000007c1';
const OTHER = '00000000-0000-4000-8000-0000000007c2';
const NAME = 'ChronicleTest';

inTimeZone(ZONES.london.zone, ZONES.london.offsets);

/** A local instant. Built inside each test, after the zone is set. */
function at(year: number, month1to12: number, day: number, hour = 21, minute = 0): Date {
  return new Date(year, month1to12 - 1, day, hour, minute);
}

/** A stint logged at `watchedAt`, the engine's clock a minute later. */
async function watch(raceId: string, watchedAt: Date, from: number, to: number, userId = USER) {
  return logStint(userId, raceId, { from, to, watchedAt, now: new Date(watchedAt.getTime() + 60_000) });
}

const QUIET = { info: () => undefined, error: () => undefined };

beforeEach(async () => {
  await createCareerUser(USER, NAME);
  await createCareerUser(OTHER, `${NAME} Other`);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await disconnectDb();
});

/**
 * A December 2026 and a New Year: an hour of Spa on 20 December, then a
 * two-hour race watched from 22:31 on 31 December to 00:31, logged then.
 */
async function newYearCareer(): Promise<{ spa: string; newYear: string }> {
  const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
  const newYear = await addRace(USER, { name: 'New Year Two Hours', hours: 2 });
  await watch(spa, at(2026, 12, 20), 0, H);
  await watch(newYear, at(2027, 1, 1, 0, 31), 0, 2 * H);
  return { spa, newYear };
}

describe('freezing a finished year', () => {
  it('nothing freezes before the grace period ends', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    expect(freezeDueAt(2026)).toEqual(at(2027, 1, 4, 0, 0));

    const justBefore = new Date(freezeDueAt(2026).getTime() - 1);
    expect(await ensureChroniclesFrozen(USER, justBefore)).toEqual([]);
    expect(await prisma.chronicleYear.count({ where: { userId: USER } })).toBe(0);
    const finalising = await getChronicleChapter(USER, 2026, justBefore);
    expect(finalising).toMatchObject({ state: 'finalising', settlesOn: freezeDueAt(2026), frozen: null });
    expect(finalising!.chapter.complete).toBe(true);

    expect(await ensureChroniclesFrozen(USER, freezeDueAt(2026))).toEqual([2026]);
    // Once is enough: the next call finds nothing due.
    expect(await ensureChroniclesFrozen(USER, at(2027, 2, 1))).toEqual([]);
    expect(await prisma.chronicleYear.findMany({ where: { userId: USER }, select: { year: true, frozenAt: true } }))
      .toEqual([{ year: 2026, frozenAt: freezeDueAt(2026) }]);
  });

  it('a stint logged at 00:31 on 1 January that began on 31 December is in the frozen 2026 chapter', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    await ensureChroniclesFrozen(USER, at(2027, 1, 5));

    const row = await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } });
    const chapter = upgradeChapterSnapshot(row.snapshot);
    // The hour on 20 December, and 22:31 to midnight of the New Year stint.
    expect(chapter.summary.creditedSeconds).toBeCloseTo(H + 89 * 60, 6);
    expect(chapter.monthly[11]!.creditedSeconds).toBeCloseTo(H + 89 * 60, 6);
    expect(chapter.viewing.mostActiveDay).toMatchObject({ dayKey: '2026-12-31' });
    // Its facts are the new year's: the session is not counted in 2026.
    expect(chapter.summary.sessions).toBe(1);
  });

  it('a stint ending at 00:30 on 1 January counts its facts in the new chapter', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    const now = at(2027, 3, 1);
    await ensureChroniclesFrozen(USER, now);

    const next = await getChronicleChapter(USER, 2027, now);
    expect(next?.state).toBe('year-to-date');
    expect(next!.chapter.summary).toMatchObject({ sessions: 1, storyCompletes: 1, racesStarted: 1, racesExperienced: 1 });
    expect(next!.chapter.summary.creditedSeconds).toBeCloseTo(31 * 60, 6);
    expect(next!.chapter.storyComplete.list.map((entry) => entry.name)).toEqual(['New Year Two Hours']);
    const frozen = await getChronicleChapter(USER, 2026, now);
    expect(frozen!.chapter.summary.storyCompletes).toBe(0);
    expect(frozen!.chapter.summary.racesStarted).toBe(1);
  });

  it('a finished year is frozen at the first start after its grace period', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    const lines: string[] = [];
    const log = { info: (line: string) => lines.push(line), error: (line: string) => lines.push(line) };

    // A start inside the grace period freezes nothing and says nothing.
    await freezeAllChronicles({ now: at(2027, 1, 2), shouldContinue: () => true, log });
    expect(await prisma.chronicleYear.count({ where: { userId: USER } })).toBe(0);
    expect(lines.filter((line) => line.includes(USER))).toEqual([]);

    const summaries = await freezeAllChronicles({ now: at(2027, 1, 4, 8, 0), shouldContinue: () => true, log });
    expect(summaries.find((summary) => summary.userId === USER)).toEqual({ userId: USER, frozen: [2026] });
    expect(lines.filter((line) => line.includes(USER))).toEqual([`[chronicle] ${NAME} (${USER}): froze the 2026 chapter`]);

    // The next start changes nothing, and says nothing about it.
    lines.length = 0;
    const before = await prisma.chronicleYear.findMany({ where: { userId: USER } });
    await freezeAllChronicles({ now: at(2027, 1, 5), shouldContinue: () => true, log });
    expect(await prisma.chronicleYear.findMany({ where: { userId: USER } })).toEqual(before);
    expect(lines.filter((line) => line.includes(USER))).toEqual([]);

    // Out of time, it starts on no account at all.
    await createCareerUser(OTHER, `${NAME} Other`);
    const other = await addRace(OTHER, { name: 'Other Race' });
    await watch(other, at(2026, 6, 1), 0, H, OTHER);
    await markCareerBackfillApplied(OTHER);
    expect(await freezeAllChronicles({ now: at(2027, 1, 5), shouldContinue: () => false, log })).toEqual([]);
    expect(await prisma.chronicleYear.count({ where: { userId: OTHER } })).toBe(0);
  });

  it('a chapter is never frozen before the account\'s backfill is complete', async () => {
    await newYearCareer();
    const now = at(2027, 1, 10);
    expect(await isCareerBackfillApplied(USER)).toBe(false);
    expect(await ensureChroniclesFrozen(USER, now)).toEqual([]);
    await freezeAllChronicles({ now, shouldContinue: () => true, log: QUIET });
    expect(await prisma.chronicleYear.count({ where: { userId: USER } })).toBe(0);
    // Past its grace period, but waiting for the upgrade: finalising, with no date to settle by.
    expect(await getChronicleChapter(USER, 2026, now)).toMatchObject({ state: 'finalising', settlesOn: null });

    // The backfill's last phase freezes it, and only then is the account complete.
    const summary = await runCareerBackfillFor(USER, { now, clock: deadlineClock(Date.now() + 60_000) });
    expect(summary).toMatchObject({ completed: true, chaptersFrozen: 1, pausedBefore: null });
    expect(await isCareerBackfillApplied(USER)).toBe(true);
    expect((await prisma.chronicleYear.findMany({ where: { userId: USER } })).map((row) => row.year)).toEqual([2026]);
    expect(await ledgerProblems(USER)).toEqual([]);
  });

  it('a live chapter equals the frozen chapter built after the grace period', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    const live = await getChronicleChapter(USER, 2026, at(2027, 1, 2, 12, 0));
    expect(live?.state).toBe('finalising');

    await ensureChroniclesFrozen(USER, at(2027, 1, 6));
    const frozen = await getChronicleChapter(USER, 2026, at(2027, 1, 6));
    expect(frozen?.state).toBe('frozen');
    expect({ ...frozen!.chapter, generatedAt: null }).toEqual({ ...live!.chapter, generatedAt: null });
    expect(frozen!.chapter.generatedAt).toBe(at(2027, 1, 6).toISOString());
  });

  it('a frozen chapter does not change when the machine time zone changes', async () => {
    await newYearCareer();
    await markCareerBackfillApplied(USER);
    const now = at(2027, 1, 6);
    await ensureChroniclesFrozen(USER, now);
    const stored = await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } });
    const inLondon = upgradeChapterSnapshot(stored.snapshot);
    expect(inLondon.timeZone).toBe('Europe/London');

    const previous = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-780);
      const view = await getChronicleChapter(USER, 2026, now);
      expect(view?.chapter).toEqual(inLondon);
      // Built again now, the same history falls on other days: the frozen one is what the page shows.
      const rebuiltHere = await buildChapterData(USER, 2026, now);
      expect(rebuiltHere.timeZone).toBe('Pacific/Auckland');
      expect(rebuiltHere.summary.creditedSeconds).not.toBeCloseTo(inLondon.summary.creditedSeconds, 0);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
    expect(await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } })).toEqual(stored);
  });

  it('the chapter of a deleted race\'s expedition still shows the full summary', async () => {
    const ten = await addRace(USER, { name: '10 Hours of Karoo', hours: 10 });
    await watch(ten, at(2026, 11, 14, 23, 0), 0, 10 * H);
    const summary = await prisma.expeditionSummary.findFirstOrThrow({ where: { userId: USER, raceId: ten } });
    await markCareerBackfillApplied(USER);
    const now = at(2027, 2, 1);
    await ensureChroniclesFrozen(USER, now);
    expect(await deleteRace(USER, ten, now)).not.toBeNull();

    const view = await getChronicleChapter(USER, 2026, now);
    expect(view?.state).toBe('frozen');
    expect(view!.chapter.expeditions).toEqual([expect.objectContaining({
      summaryId: summary.id, raceId: ten, raceName: '10 Hours of Karoo', creditedSeconds: 10 * H, calendarDays: 1,
    })]);
    expect(view!.chapter.summary.expeditionsCompleted).toBe(1);
    expect(view!.expeditionSummaries).toHaveLength(1);
    expect(view!.expeditionSummaries[0]).toMatchObject({ id: summary.id, raceId: null, accent: null });
    expect(view!.expeditionSummaries[0]!.snapshot.race.name).toBe('10 Hours of Karoo');
    // The race is gone from the library, so nothing links to it.
    expect(view!.raceIdsInLibrary).not.toContain(ten);
    expect(view!.chapter.notableRaces.map((race) => race.raceId)).toContain(ten);
  });
});

describe('a chapter and the statistics', () => {
  it('year-to-date chapters are marked incomplete', async () => {
    const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
    await watch(spa, at(2027, 3, 1), 0, 2 * H);
    const now = at(2027, 6, 1);
    const view = await getChronicleChapter(USER, 2027, now);
    expect(view).toMatchObject({ state: 'year-to-date', careerYear: 1, frozen: null, settlesOn: null });
    expect(view!.chapter.complete).toBe(false);
    expect(view!.chapter.generatedAt).toBe(now.toISOString());
    for (const card of buildWrappedCards(view!.chapter, { careerYear: view!.careerYear, state: view!.state })) {
      expect(card.asOf, card.kind).toBe(now.toISOString());
    }
    const index = await getChronicleIndex(USER, now);
    expect(index.years).toEqual([expect.objectContaining({ kind: 'chapter', year: 2027, state: 'year-to-date', careerYear: 1 })]);
  });

  it('statistics filtered to a year equal that year\'s chapter', async () => {
    const lm = await addRace(USER, { name: '24 Hours of Le Mans', hours: 24 });
    const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
    const tiny = await addRace(USER, { name: 'A Glimpse', hours: 3 });
    await watch(lm, at(2026, 6, 13, 23, 0), 0, 8 * H);
    await watch(lm, at(2026, 12, 31, 23, 30), 8 * H, 10 * H);
    await watch(lm, at(2027, 1, 2), 10 * H, 24 * H);
    await watch(spa, at(2026, 9, 1), 0, 6 * H);
    await watch(spa, at(2026, 9, 2), 0, H);
    await watch(tiny, at(2026, 10, 1), 0, 5 * 60);

    const now = at(2027, 6, 1);
    for (const year of [2026, 2027]) {
      const [stats, view] = await Promise.all([getStatistics(USER, { year }, now), getChronicleChapter(USER, year, now)]);
      const { summary } = view!.chapter;
      expect(stats.viewing.realSeconds, `${year}`).toBeCloseTo(summary.creditedSeconds, 6);
      expect(stats.viewing.newCoverageSeconds, `${year}`).toBeCloseTo(summary.newCoverageSeconds, 6);
      expect(stats.rewatchSeconds, `${year}`).toBeCloseTo(summary.rewatchSeconds, 6);
      expect(stats.sessions.sessions, `${year}`).toBe(summary.sessions);
      expect(stats.races.racesStarted, `${year}`).toBe(summary.racesStarted);
      expect(stats.racesExperienced, `${year}`).toBe(summary.racesExperienced);
      expect(stats.races.racesStoryComplete, `${year}`).toBe(summary.storyCompletes);
      expect(stats.storyCompleteRate, `${year}`).toBe(view!.chapter.storyComplete.rate);
    }
  });
});

describe('Wrapped, its prompt, and rebuilding a chapter', () => {
  it('offers last year\'s Wrapped once it is frozen, until it is seen', async () => {
    const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
    await watch(spa, at(2026, 11, 1), 0, 3 * H);
    await markCareerBackfillApplied(USER);

    // Finalising: its Wrapped can be opened, but it is not announced and cannot be marked seen.
    expect(await pendingWrapped(USER, at(2027, 1, 2))).toBeNull();
    expect(await markWrappedSeen(USER, 2026, at(2027, 1, 2))).toBe(false);

    // The prompt freezes the year itself, so it never waits for a visit to the Chronicle.
    expect(await pendingWrapped(USER, at(2027, 1, 4, 9, 0))).toEqual({ year: 2026 });
    expect((await getChronicleIndex(USER, at(2027, 1, 4, 9, 0))).pendingWrapped).toEqual({ year: 2026 });
    expect(await markWrappedSeen(USER, 2026, at(2027, 1, 4, 10, 0))).toBe(true);
    expect(await markWrappedSeen(USER, 2026, at(2027, 1, 4, 11, 0))).toBe(false);
    expect(await pendingWrapped(USER, at(2027, 1, 5))).toBeNull();
    const view = await getChronicleChapter(USER, 2026, at(2027, 1, 5));
    expect(view?.wrappedSeen).toBe(true);
    // Only last year's is ever announced.
    expect(await pendingWrapped(USER, at(2028, 1, 10))).toBeNull();
  });

  it('rebuilding replaces the snapshot with today\'s history and keeps when it was frozen and seen', async () => {
    const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
    await watch(spa, at(2026, 11, 1), 0, 3 * H);
    await markCareerBackfillApplied(USER);
    await ensureChroniclesFrozen(USER, at(2027, 1, 5));
    await markWrappedSeen(USER, 2026, at(2027, 1, 6));
    const before = await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } });

    // An engine-backdated stint into the frozen year leaves its chapter as it is…
    await watch(spa, at(2026, 11, 20), 3 * H, 6 * H);
    await ensureChroniclesFrozen(USER, at(2027, 2, 1));
    const untouched = await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } });
    expect(untouched).toEqual(before);
    expect(upgradeChapterSnapshot(untouched.snapshot).summary.storyCompletes).toBe(0);

    // …until the chapter is rebuilt on request.
    expect(await rebuildChronicleYear(USER, 2026, at(2027, 2, 2))).toBe(true);
    const rebuilt = await prisma.chronicleYear.findUniqueOrThrow({ where: { userId_year: { userId: USER, year: 2026 } } });
    expect(rebuilt).toMatchObject({ frozenAt: before.frozenAt, wrappedSeenAt: before.wrappedSeenAt, rebuiltAt: at(2027, 2, 2) });
    expect(upgradeChapterSnapshot(rebuilt.snapshot).summary.storyCompletes).toBe(1);
    // A year that is not frozen has nothing to rebuild.
    expect(await rebuildChronicleYear(USER, 2027, at(2027, 2, 2))).toBe(false);
    expect(await prisma.chronicleYear.count({ where: { userId: USER } })).toBe(1);
  });
});

describe('the index', () => {
  it('lists every year from the first stint, newest first, numbering Career Years without a gap', async () => {
    const spa = await addRace(USER, { name: '6 Hours of Spa', hours: 6 });
    const fuji = await addRace(USER, { name: '6 Hours of Fuji', hours: 6, circuit: 'Fuji Speedway' });
    await watch(spa, at(2024, 9, 22), 0, 3 * H);
    await watch(fuji, at(2026, 5, 1), 0, 6 * H);
    await watch(fuji, at(2027, 1, 2), 0, H);
    await markCareerBackfillApplied(USER);
    const now = at(2027, 1, 2, 22, 0);
    expect(await ensureChroniclesFrozen(USER, now)).toEqual([2024]);

    const index = await getChronicleIndex(USER, now);
    expect(index.currentYear).toBe(2027);
    expect(index.years.map((year) => [year.year, year.kind, year.careerYear, year.kind === 'chapter' ? year.state : null])).toEqual([
      [2027, 'chapter', 4, 'year-to-date'],
      [2026, 'chapter', 3, 'finalising'],
      [2025, 'quiet', 2, null],
      [2024, 'chapter', 1, 'frozen'],
    ]);
    expect(index.years[1]).toMatchObject({ settlesOn: freezeDueAt(2026), creditedSeconds: 6 * H, storyCompletes: 1 });
    expect(index.years[3]).toMatchObject({ creditedSeconds: 3 * H, storyCompletes: 0, racesExperienced: 1, unreadable: false });
    expect(index.pendingWrapped).toBeNull();

    // A quiet year has no neighbours of its own: the chapters either side skip it.
    expect((await getChronicleChapter(USER, 2026, now))?.neighbours).toEqual({ previous: 2024, next: 2027 });
    expect((await getChronicleChapter(USER, 2024, now))?.neighbours).toEqual({ previous: null, next: 2026 });
    expect((await getChronicleChapter(USER, 2026, now))?.careerYear).toBe(3);
    // Before the first year, after this one, or not a year: there is no chapter.
    for (const year of [2023, 2028, 2026.5]) expect(await getChronicleChapter(USER, year, now), `${year}`).toBeNull();
  });

  it('is empty, and has no chapter to open, before the first stint', async () => {
    const now = at(2027, 1, 2);
    expect(await getChronicleIndex(USER, now)).toEqual({ currentYear: 2027, years: [], pendingWrapped: null });
    expect(await getChronicleChapter(USER, 2027, now)).toBeNull();
    expect(await ensureChroniclesFrozen(USER, now)).toEqual([]);
  });
});
