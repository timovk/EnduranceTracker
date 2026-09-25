/**
 * The career replay's loader and cache (§3.2.9).
 *
 * The replay is kept in memory per account and served again while the
 * account's data fingerprint is unchanged. Any change to what the replay
 * reads — a stint logged or deleted, a race or championship edited — changes
 * the fingerprint, so a stale replay is never served. Concurrent requests
 * build once, at most four accounts are kept, and clearing forgets one
 * account without touching another.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import {
  clearCareerTimelineCache, getCareerTimeline, loadRaceTimelineInputs, loadTimelineInputs, timelineFingerprint,
} from '@/lib/engines/career-timeline-engine';
import { deleteViewingSession } from '@/lib/engines/session-engine';
import { CAREER_STATS_SHAPE } from '@/lib/config';
import { addRace, createCareerUser, H, logStint } from '../helpers/career-db';

const PREFIX = '00000000-0000-4000-8000-0000000002d';
const USER = `${PREFIX}1`;
const NOW = new Date(2026, 8, 24, 20, 0);

beforeEach(async () => {
  clearCareerTimelineCache();
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await createCareerUser(USER, 'TimelineCacheTest');
});

afterAll(async () => {
  clearCareerTimelineCache();
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await disconnectDb();
});

describe('the replay cache', () => {
  it('serves the same replay while nothing has changed', async () => {
    const raceId = await addRace(USER);
    await logStint(USER, raceId, { from: 0, to: H, now: NOW });

    const first = await getCareerTimeline(USER);
    const second = await getCareerTimeline(USER);
    expect(second).toBe(first);
    expect(first.stints).toHaveLength(1);
  });

  it('replays again after a stint is logged or deleted', async () => {
    const raceId = await addRace(USER);
    await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    const before = await getCareerTimeline(USER);

    const second = await logStint(USER, raceId, { from: H, to: 2 * H, now: NOW });
    const logged = await getCareerTimeline(USER);
    expect(logged).not.toBe(before);
    expect(logged.stints).toHaveLength(2);

    await deleteViewingSession(USER, second.sessionId, NOW);
    const deleted = await getCareerTimeline(USER);
    expect(deleted.stints).toHaveLength(1);
    expect(deleted.races.get(raceId)?.coverageSeconds).toBe(H);
  });

  it('replays again after a race, its championship or its event is edited', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'cache-cup', name: 'Cache Cup' },
      select: { id: true },
    });
    const raceId = await addRace(USER, { championshipId: championship.id, iconicKey: 'cache-event' });
    await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    const before = await getCareerTimeline(USER);

    await prisma.race.update({ where: { id: raceId }, data: { name: 'Renamed Race' } });
    const renamed = await getCareerTimeline(USER);
    expect(renamed).not.toBe(before);
    expect(renamed.racesById.get(raceId)?.name).toBe('Renamed Race');

    await prisma.championship.update({ where: { id: championship.id }, data: { name: 'Renamed Cup' } });
    const recoloured = await getCareerTimeline(USER);
    expect(recoloured).not.toBe(renamed);
    expect(recoloured.racesById.get(raceId)?.championshipName).toBe('Renamed Cup');

    // The event's name is the user's to change, and it changes only the event's row.
    await prisma.raceMastery.update({
      where: { userId_key: { userId: USER, key: 'cache-event' } },
      data: { displayName: 'The Cache Event' },
    });
    const eventRenamed = await getCareerTimeline(USER);
    expect(eventRenamed).not.toBe(recoloured);
    expect(eventRenamed.racesById.get(raceId)?.eventName).toBe('The Cache Event');
  });

  it('builds once for requests that arrive together', async () => {
    const raceId = await addRace(USER);
    await logStint(USER, raceId, { from: 0, to: H, now: NOW });

    const [a, b, c] = await Promise.all([getCareerTimeline(USER), getCareerTimeline(USER), getCareerTimeline(USER)]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it(`keeps at most ${CAREER_STATS_SHAPE.timelineCacheEntries} accounts, forgetting the least recently used`, async () => {
    const users = [USER];
    for (let index = 2; index <= CAREER_STATS_SHAPE.timelineCacheEntries + 1; index += 1) {
      users.push(await createCareerUser(`${PREFIX}${index}`, `TimelineCacheTest ${index}`));
    }
    const timelines = new Map<string, unknown>();
    for (const userId of users.slice(0, -1)) timelines.set(userId, await getCareerTimeline(userId));

    // USER is used again, so the second account is now the least recently used…
    expect(await getCareerTimeline(USER)).toBe(timelines.get(USER));
    // …and a fifth account pushes it out, and only it.
    await getCareerTimeline(users[users.length - 1]!);
    expect(await getCareerTimeline(users[2]!)).toBe(timelines.get(users[2]!));
    expect(await getCareerTimeline(USER)).toBe(timelines.get(USER));
    expect(await getCareerTimeline(users[1]!)).not.toBe(timelines.get(users[1]!));
  });

  it('forgets one account when asked, and no other', async () => {
    const other = await createCareerUser(`${PREFIX}9`, 'TimelineCacheTest Other');
    const mine = await getCareerTimeline(USER);
    const theirs = await getCareerTimeline(other);

    clearCareerTimelineCache(USER);
    expect(await getCareerTimeline(USER)).not.toBe(mine);
    expect(await getCareerTimeline(other)).toBe(theirs);
  });
});

describe('the fingerprint', () => {
  it('changes with every write the replay would see, and not otherwise', async () => {
    const raceId = await addRace(USER);
    const empty = await timelineFingerprint(USER);
    expect(await timelineFingerprint(USER)).toBe(empty);

    await logStint(USER, raceId, { from: 0, to: H, now: NOW });
    const logged = await timelineFingerprint(USER);
    expect(logged).not.toBe(empty);

    // A setting the replay never reads leaves it as it was.
    await prisma.user.update({ where: { id: USER }, data: { weekStart: 0 } });
    expect(await timelineFingerprint(USER)).toBe(logged);
  });
});

describe('loading', () => {
  it('reads every stint in canonical order and every race with its event and edition year', async () => {
    const raceId = await addRace(USER, { name: '2026 Six Hours', iconicKey: 'six-hours', raceDate: new Date(Date.UTC(2026, 0, 1)) });
    const unwatched = await addRace(USER, { name: 'Not yet' });
    // Logged out of order: the later stint first.
    await logStint(USER, raceId, { from: H, to: 2 * H, watchedAt: new Date(2026, 5, 2, 20, 0), now: NOW });
    await logStint(USER, raceId, { from: 0, to: H, watchedAt: new Date(2026, 5, 1, 20, 0), now: NOW });

    const inputs = await loadTimelineInputs(prisma, USER);
    expect(inputs.sessions.map((session) => session.startTimestampSec)).toEqual([0, H]);
    expect(inputs.races.map((race) => race.id).sort()).toEqual([raceId, unwatched].sort());

    const event = await prisma.raceMastery.findUniqueOrThrow({ where: { userId_key: { userId: USER, key: 'six-hours' } } });
    expect(inputs.races.find((race) => race.id === raceId)).toMatchObject({
      editionYear: 2026, eventKey: 'six-hours', eventId: event.id, eventName: event.name,
    });

    // A name the user gave the event wins.
    await prisma.raceMastery.update({ where: { id: event.id }, data: { displayName: 'The Six Hours' } });
    const one = await loadRaceTimelineInputs(prisma, USER, raceId);
    expect(one?.race.eventName).toBe('The Six Hours');
    expect(one?.sessions).toHaveLength(2);
  });

  it('sees what a transaction has written, where the cache would not', async () => {
    const raceId = await addRace(USER);
    await getCareerTimeline(USER);
    await prisma.$transaction(async (tx) => {
      await tx.raceViewingSession.create({
        data: {
          raceId, userId: USER, startTimestampSec: 0, endTimestampSec: 600, playbackSpeed: 1,
          timelineSeconds: 600, realSeconds: 600, newCoverageSeconds: 600, watchedAt: NOW,
        },
      });
      const inputs = await loadTimelineInputs(tx as Tx, USER);
      expect(inputs.sessions).toHaveLength(1);
    });
  });
});
