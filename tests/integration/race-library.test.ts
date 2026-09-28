/**
 * The race library at ten-year scale.
 *
 * Prisma caps a SQLite query at 999 bound values. It splits an unordered
 * to-many load into several queries, but not an ordered one, so a library
 * read that loaded each race's intervals with `orderBy` failed with P2029 once
 * the account held about 998 races. These tests hold more than that, and check
 * that the library reads them all, that every card's intervals still come out
 * in timeline order, and that the library page shows them a page at a time.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAREER_STATS_SHAPE } from '@/lib/config';
import { disconnectDb, prisma } from '@/lib/db/client';
import { getRaceLibraryPage, listRaces } from '@/lib/server/races';
import { createCareerUser, H } from '../helpers/career-db';

const USER = '00000000-0000-4000-8000-0000000009a1';
const OTHER = '00000000-0000-4000-8000-0000000009a2';

/** Comfortably past the 998 races at which the ordered load failed. */
const RACES = 1_100;
/** Every third race is watched, in two stretches; every fifth of those is Story Complete. */
const WATCHED = (index: number) => index % 3 === 0;
const COMPLETE = (index: number) => index % 15 === 0;

beforeAll(async () => {
  await createCareerUser(USER, 'RaceLibraryTest');
  await createCareerUser(OTHER, 'RaceLibraryTest Other');

  const base = new Date(2020, 0, 1).getTime();
  const races = Array.from({ length: RACES }, (_, index) => ({
    id: randomUUID(),
    userId: USER,
    name: `Library Race ${String(index).padStart(4, '0')}`,
    scheduledDurationSec: 6 * H,
    runtimeSec: 6 * H,
    coverageSec: WATCHED(index) ? 3.5 * H : 0,
    storyCompletedAt: COMPLETE(index) ? new Date(base + index * 60_000) : null,
    lastWatchedAt: WATCHED(index) ? new Date(base + index * 60_000) : null,
  }));
  await prisma.race.createMany({ data: races });
  // The later piece is written first, so the rows' insertion order is not
  // their timeline order, and two rows overlap, as rows a 0.3.x upgrade left
  // can: a card shows the one merged set the race page shows.
  await prisma.watchedInterval.createMany({
    data: races.filter((_, index) => WATCHED(index)).flatMap((race) => [
      { raceId: race.id, startSec: 4 * H, endSec: 5 * H },
      { raceId: race.id, startSec: 0, endSec: 2 * H },
      { raceId: race.id, startSec: 1 * H, endSec: 2.5 * H },
    ]),
  });
  // Another account's races never reach this library, or its counts.
  await prisma.race.createMany({
    data: Array.from({ length: 5 }, (_, index) => ({
      userId: OTHER, name: `Other Race ${index}`, scheduledDurationSec: 6 * H, runtimeSec: 6 * H,
    })),
  });
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await disconnectDb();
});

function expectTimelineOrder(cards: { intervals: { start: number; end: number }[]; coverageSec: number }[]) {
  for (const card of cards) {
    const expected = card.coverageSec > 0 ? [{ start: 0, end: 2.5 * H }, { start: 4 * H, end: 5 * H }] : [];
    expect(card.intervals).toEqual(expected);
  }
}

describe('a library of more than a thousand races', () => {
  it('reads every race, with each card’s intervals merged and in timeline order, in every sort', async () => {
    for (const sort of ['recent', 'date', 'name', 'progress', 'duration', 'priority'] as const) {
      const cards = await listRaces(USER, { sort });
      expect(cards).toHaveLength(RACES);
      expectTimelineOrder(cards);
    }
  });

  it('shows one page of cards at a time, and counts the whole library for the page', async () => {
    const size = CAREER_STATS_SHAPE.libraryPageSize;
    const first = await getRaceLibraryPage(USER, { sort: 'recent' }, 1);
    expect(first).toMatchObject({
      total: RACES,
      unwatched: Array.from({ length: RACES }, (_, index) => index).filter((index) => !WATCHED(index)).length,
      page: 1,
      pageCount: Math.ceil(RACES / size),
      pageSize: size,
    });
    expect(first.races).toHaveLength(size);
    expectTimelineOrder(first.races);
    // Most recently watched first, as the whole list has it.
    expect(first.races.map((card) => card.id))
      .toEqual((await listRaces(USER, { sort: 'recent' })).slice(0, size).map((card) => card.id));
  });

  it('walks the whole library page by page without repeating or skipping a race, in every sort', async () => {
    for (const sort of ['recent', 'date', 'name', 'progress', 'duration', 'priority'] as const) {
      const seen: string[] = [];
      const { pageCount } = await getRaceLibraryPage(USER, { sort }, 1);
      for (let page = 1; page <= pageCount; page += 1) {
        seen.push(...(await getRaceLibraryPage(USER, { sort }, page)).races.map((card) => card.id));
      }
      expect(seen).toHaveLength(RACES);
      expect(new Set(seen).size).toBe(RACES);
    }
  });

  it('keeps a page number inside the library, and counts only what the filter shows', async () => {
    const size = CAREER_STATS_SHAPE.libraryPageSize;
    const last = await getRaceLibraryPage(USER, {}, 10_000);
    expect(last.page).toBe(last.pageCount);
    expect(last.races).toHaveLength(RACES - (last.pageCount - 1) * size);
    expect((await getRaceLibraryPage(USER, {}, 0)).page).toBe(1);
    expect((await getRaceLibraryPage(USER, {}, Number.NaN)).page).toBe(1);

    // "Complete" and the backlog count agree with the filter: a Story Complete
    // race is never waiting, and nothing unwatched is complete.
    const complete = await getRaceLibraryPage(USER, { storyCompleteOnly: true }, 1);
    expect(complete.total).toBe(Array.from({ length: RACES }, (_, index) => index).filter(COMPLETE).length);
    expect(complete.unwatched).toBe(0);
    expect(complete.races.every((card) => card.storyComplete)).toBe(true);

    const search = await getRaceLibraryPage(USER, { search: 'race 000' }, 1);
    expect(search.races.map((card) => card.name).sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => `Library Race 000${index}`),
    );
    expect(search).toMatchObject({ total: 10, pageCount: 1, unwatched: 6 });
  });

  it('gives an account with no races one empty page', async () => {
    await prisma.race.deleteMany({ where: { userId: OTHER } });
    expect(await getRaceLibraryPage(OTHER, {}, 3)).toMatchObject({
      races: [], total: 0, unwatched: 0, page: 1, pageCount: 1,
    });
  });
});
