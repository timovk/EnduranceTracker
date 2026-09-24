/**
 * One number for one idea: credited time (R7), races experienced, and editions.
 *
 * Every hour figure counts a stint's real time the way XP counts it — never
 * more than its timeline at 0.75× — so the career's hours, the race page, the
 * mastery trees and the events all agree, and very slow playback cannot make
 * ten hours out of one. Editions are counted once per year of an event, by the
 * race date's UTC year with the season's year standing in, wherever they are
 * counted — and an edition of a merged event is counted with the event it was
 * merged into.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import { XP_CONFIG } from '@/lib/config';
import { ensureMasteryTrees, recomputeRaceMasteries } from '@/lib/engines/mastery-engine';
import { computeCareerMetrics, computeCareerMetricsWithHistory } from '@/lib/engines/metrics';
import { getRaceDetail } from '@/lib/server/races';
import { addRace, createCareerUser, H, logStint } from '../helpers/career-db';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const USER = '00000000-0000-4000-8000-0000000002c1';
const OTHER = '00000000-0000-4000-8000-0000000002c2';
const NOW = new Date(2026, 8, 24, 20, 0);

beforeEach(async () => {
  await createCareerUser(USER, 'CreditedTimeTest');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await disconnectDb();
});

describe('credited time', () => {
  it('credits a stint played at 0.1× as its timeline at 0.75×, everywhere', async () => {
    const raceId = await addRace(USER, { iconicKey: 'slow-motion' });
    // One hour of timeline at 0.1× is ten hours of real time. XP credits it
    // as 80 minutes, and so does every hour figure.
    const outcome = await logStint(USER, raceId, { from: 0, to: H, speed: 0.1, now: NOW });
    expect(outcome.realSeconds).toBe(10 * H);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.realViewingSec).toBe(10 * H);
    expect(race.creditedViewingSec).toBe(80 * 60);

    const viewing = await prisma.xPTransaction.findFirstOrThrow({ where: { userId: USER, source: 'VIEWING' } });
    expect(viewing.amount).toBe(80 * XP_CONFIG.xpPerRealMinute);

    const metrics = await computeCareerMetrics(USER);
    expect(metrics.realHours).toBe(1.3);
    expect(metrics.longestSessionHours).toBe(1.33);
    expect(metrics.averageSessionMinutes).toBe(80);
    // Playback speed is about how the timeline was played, so it keeps real time.
    expect(metrics.averagePlaybackSpeed).toBe(0.1);

    const detail = await getRaceDetail(USER, raceId);
    expect(detail?.creditedViewingSec).toBe(80 * 60);

    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'slow-motion' } } });
    expect(event.totalRealSec).toBe(80 * 60);

    const globalHours = await prisma.masteryProgress.findFirstOrThrow({
      where: { userId: USER, node: { key: 'global_hours_100' } },
    });
    expect(globalHours.value).toBe(1.3);
  });

  it('is simply real time at 0.75× and faster', async () => {
    const raceId = await addRace(USER);
    for (const [from, to, speed] of [[0, 1, 0.75], [1, 2, 1], [2, 4, 1.5]] as const) {
      await logStint(USER, raceId, { from: from * H, to: to * H, speed, now: NOW });
    }
    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.creditedViewingSec).toBe(race.realViewingSec);
    expect((await computeCareerMetrics(USER)).realHours).toBe(Math.round((race.realViewingSec / H) * 10) / 10);
  });

  it('lets real time stand in for a race the upgrade has not reached yet', async () => {
    const raceId = await addRace(USER, { iconicKey: 'legacy-event' });
    // A 0.3.2 row: aggregates filled, the 0.4.0 column still null.
    await prisma.race.update({ where: { id: raceId }, data: { realViewingSec: 2 * H, creditedViewingSec: null } });

    await prisma.$transaction((tx) => recomputeRaceMasteries(tx as Tx, USER, NOW));

    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'legacy-event' } } });
    expect(event.totalRealSec).toBe(2 * H);
  });
});

describe('races experienced', () => {
  it('leaves out a glimpse and counts a race watched for a tenth of it', async () => {
    const glimpsed = await addRace(USER, { name: 'Glimpsed' });
    const experienced = await addRace(USER, { name: 'Experienced' });
    await logStint(USER, glimpsed, { from: 0, to: 5 * 60, now: NOW });
    // A tenth of six hours is 36 minutes.
    await logStint(USER, experienced, { from: 0, to: 36 * 60, now: NOW });

    const metrics = await computeCareerMetrics(USER);
    expect(metrics.racesStarted).toBe(2);
    expect(metrics.racesExperienced).toBe(1);
  });

  it('needs ten credited minutes, however much of a short race was covered', async () => {
    const sprint = await addRace(USER, { hours: 0.5 });
    // Half of a thirty-minute race, but at 8× it is under four minutes of viewing.
    await logStint(USER, sprint, { from: 0, to: 15 * 60, speed: 8, now: NOW });
    expect((await computeCareerMetrics(USER)).racesExperienced).toBe(0);
  });
});

describe('long races', () => {
  it('counts a six-hour story, and a five-hour one only towards the shorter bands', async () => {
    const six = await addRace(USER, { hours: 6 });
    const five = await addRace(USER, { hours: 5 });
    await logStint(USER, six, { from: 0, to: 6 * H, now: NOW });
    await logStint(USER, five, { from: 0, to: 5 * H, now: NOW });

    const metrics = await computeCareerMetrics(USER);
    expect(metrics.storyCompletes).toBe(2);
    expect(metrics.stories6h).toBe(1);
    expect(metrics.stories8h).toBe(0);
  });
});

describe('editions', () => {
  it('counts two races of one event in the same year as one edition', async () => {
    const june = await addRace(USER, { iconicKey: 'twice', raceDate: new Date(Date.UTC(2026, 5, 13)) });
    const rerun = await addRace(USER, { iconicKey: 'twice', raceDate: new Date(Date.UTC(2026, 5, 14)) });
    const before = await addRace(USER, { iconicKey: 'twice', raceDate: new Date(Date.UTC(2025, 5, 14)) });
    for (const raceId of [june, rerun, before]) await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });

    const { metrics, history } = await computeCareerMetricsWithHistory(USER);
    expect(metrics.maxEditionsOfOneEvent).toBe(2);
    expect(metrics.maxEditionsExperiencedOfOneEvent).toBe(2);
    expect(metrics.longestConsecutiveEditions).toBe(2);
    expect(history.races.find((race) => race.id === june)).toMatchObject({ eventKey: 'twice', editionYear: 2026 });

    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'twice' } } });
    expect(event.editionsTracked).toBe(3);
    expect(event.editionsStoryComplete).toBe(2);
    expect(event.longestConsecutiveEditions).toBe(2);
  });

  it('takes the season’s year for an undated race', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'credited-cup', name: 'Credited Cup' },
      select: { id: true },
    });
    const season = await prisma.championshipSeason.create({
      data: { championshipId: championship.id, year: 2024 },
      select: { id: true },
    });
    const undated = await addRace(USER, { iconicKey: 'seasonal', championshipId: championship.id, seasonId: season.id });
    const dated = await addRace(USER, { iconicKey: 'seasonal', raceDate: new Date(Date.UTC(2025, 2, 1)) });
    for (const raceId of [undated, dated]) await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });

    const metrics = await computeCareerMetrics(USER);
    expect(metrics.longestConsecutiveEditions).toBe(2);
    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'seasonal' } } });
    expect(event.firstCompletedYear).toBe(2024);
  });

  describe('west of Greenwich', () => {
    inTimeZone(ZONES.losAngeles.zone, ZONES.losAngeles.offsets);

    it('keeps a race dated 1 January in its own year', async () => {
      // Stored as UTC midnight of the typed day: in Los Angeles that instant
      // is still 31 December, and a local year would put the edition in 2025.
      const newYear = await addRace(USER, { iconicKey: 'new-year', raceDate: new Date(Date.UTC(2026, 0, 1)) });
      const summer = await addRace(USER, { iconicKey: 'new-year', raceDate: new Date(Date.UTC(2025, 6, 1)) });
      for (const raceId of [newYear, summer]) await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });

      const metrics = await computeCareerMetrics(USER);
      expect(metrics.maxEditionsOfOneEvent).toBe(2);
      expect(metrics.longestConsecutiveEditions).toBe(2);
      const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'new-year' } } });
      expect(event.latestCompletedYear).toBe(2026);
    });
  });
});

describe('events', () => {
  /** An event row, as the Events page will keep them. */
  async function event(userId: string, key: string, data: { mergedIntoId?: string; archivedAt?: Date; displayName?: string } = {}) {
    return prisma.raceMastery.create({ data: { userId, key, name: key, ...data }, select: { id: true, key: true } });
  }

  it('moves a race carrying a merged event’s key to the event it was merged into, however far along', async () => {
    const survivor = await event(USER, 'survivor');
    const middle = await event(USER, 'middle', { mergedIntoId: survivor.id });
    await event(USER, 'merged', { mergedIntoId: middle.id });
    const raceId = await addRace(USER, { iconicKey: 'merged', raceDate: new Date(Date.UTC(2026, 5, 13)) });
    await logStint(USER, raceId, { from: 0, to: 6 * H, now: NOW });

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.iconicKey).toBe('survivor');
    expect(race.raceMasteryId).toBe(survivor.id);
    const figures = await prisma.raceMastery.findUniqueOrThrow({ where: { id: survivor.id } });
    expect(figures.editionsStoryComplete).toBe(1);
  });

  it('never follows a merge into another account', async () => {
    await createCareerUser(OTHER, 'CreditedTimeTest Other');
    const theirs = await event(OTHER, 'theirs');
    await event(USER, 'mine', { mergedIntoId: theirs.id });
    const raceId = await addRace(USER, { iconicKey: 'mine' });

    await prisma.$transaction((tx) => recomputeRaceMasteries(tx as Tx, USER, NOW));

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.iconicKey).toBe('mine');
    expect(await prisma.race.count({ where: { raceMasteryId: theirs.id } })).toBe(0);
  });

  it('stops following a merge chain after ten steps', async () => {
    // Twelve events, each merged into the next: a chain no merge should make,
    // followed only as far as the guard allows.
    const chain = [];
    let next: string | undefined;
    for (let index = 11; index >= 0; index -= 1) {
      const row = await event(USER, `link-${index}`, next === undefined ? {} : { mergedIntoId: next });
      chain.unshift(row);
      next = row.id;
    }
    const raceId = await addRace(USER, { iconicKey: 'link-0' });

    await prisma.$transaction((tx) => recomputeRaceMasteries(tx as Tx, USER, NOW));

    expect((await prisma.race.findUniqueOrThrow({ where: { id: raceId } })).iconicKey).toBe('link-10');
  });

  it('draws a tree for an active event, in its own name, and leaves merged and archived ones alone', async () => {
    const survivor = await event(USER, 'named', { displayName: 'The Named Event' });
    await event(USER, 'folded', { mergedIntoId: survivor.id });
    await event(USER, 'shelved', { archivedAt: NOW });

    await prisma.$transaction((tx) => ensureMasteryTrees(tx as Tx, USER, NOW));

    const trees = await prisma.masteryTree.findMany({ where: { userId: USER, kind: 'RACE_EVENT' }, select: { key: true, name: true } });
    expect(trees).toEqual([{ key: 'event:named', name: 'The Named Event' }]);
  });
});
