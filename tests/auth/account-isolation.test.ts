/**
 * One PC, two careers, and nothing leaking between them.
 *
 * This is the test that justifies the whole `USER_ID` → `requireUserId()`
 * refactor. The application was multi-tenant in its schema from the first
 * commit and single-tenant in its code, and the danger in closing that gap is
 * not the pages that were converted — it is the ones where an entity id still
 * arrives from the browser. A race id, a session id, a championship id: each
 * one is a uuid somebody could paste, and each one has to read as *gone* when
 * it belongs to somebody else, not as something to edit.
 *
 * So these tests drive the real server actions, with the real engines and the
 * real database behind them. The only thing replaced is the session: an action
 * asks `requireUserId()` who is signed in, and here that question is answered
 * by a variable the test controls. That is exactly the question a browser
 * cannot influence in production, which is the property being tested.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Who is signed in right now, as far as every server action is concerned. */
const signedIn = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'endurance_session',
  requireUserId: async () => {
    if (signedIn.userId === null) throw new Error('NEXT_REDIRECT:/accounts');
    return signedIn.userId;
  },
  getSessionUserId: async () => signedIn.userId,
  getSessionUser: async () => null,
}));

// Server actions revalidate the routes they changed. There is no router here
// to tell, and the cache behaviour is not what is under test.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { prisma, disconnectDb } from '@/lib/db/client';
import { createAccount } from '@/lib/auth/accounts';
import { awardXpStandalone } from '@/lib/engines/xp-ledger';
import {
  clearCareerTimelineCache, getCareerTimeline, timelineFingerprint,
} from '@/lib/engines/career-timeline-engine';
import { getRaceDetail, listRaces } from '@/lib/server/races';
import { getEventLegacy, getEventsIndex, resolveEventForRaceInput } from '@/lib/engines/event-legacy-engine';
import { recomputeRaceMasteries } from '@/lib/engines/mastery-engine';
import {
  createEventAction, findRacesToLinkAction, linkRacesToEventAction, mergeEventsAction, renameEventAction,
  setEventArchivedAction, setExpeditionModeAction, unlinkRaceFromEventAction,
} from '@/lib/server/career-actions';
import {
  getExpeditionSummary, getExpeditionSummaryForRace, getExpeditionView,
} from '@/lib/engines/expedition-engine';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import type { Tx } from '@/lib/db/client';
import {
  createChampionshipAction,
  createRaceAction,
  deleteRaceAction,
  deleteSessionAction,
  logSessionAction,
  setRaceStatusAction,
  updateRaceAction,
  upsertSeasonAction,
} from '@/lib/server/actions';

const H = 3600;
const PREFIX = 'IsolationTest';

let alex = '';
let sam = '';

/** Run something as a signed-in account. Restores whoever was signed in before. */
async function as<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = signedIn.userId;
  signedIn.userId = userId;
  try {
    return await work();
  } finally {
    signedIn.userId = previous;
  }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function raceForm(overrides: Record<string, string> = {}): FormData {
  return form({
    name: 'Test 6 Hours',
    raceType: 'H6',
    scheduledDuration: '06:00:00',
    priority: 'NORMAL',
    excitement: '3',
    status: 'UNWATCHED',
    ...overrides,
  });
}

function stintForm(raceId: string, overrides: Record<string, string> = {}): FormData {
  return form({
    raceId,
    mode: 'RANGE',
    startTimestamp: '00:00:00',
    endTimestamp: '02:00:00',
    playbackSpeed: '1',
    ...overrides,
  });
}

/** A race belonging to `userId`, created the way the application creates one. */
async function createRace(userId: string, overrides: Record<string, string> = {}): Promise<string> {
  const result = await as(userId, () => createRaceAction(raceForm(overrides)));
  expect(result.ok, result.message).toBe(true);
  return result.data!.id;
}

async function wipe(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
});

beforeEach(async () => {
  await wipe();
  alex = await createAccount({ name: `${PREFIX} Alex` });
  sam = await createAccount({ name: `${PREFIX} Sam` });
  signedIn.userId = null;
});

afterAll(async () => {
  await wipe();
  await disconnectDb();
});

describe('a race belongs to the account that added it', () => {
  it('is not in the other account’s library', async () => {
    const raceId = await createRace(alex);

    expect((await listRaces(alex)).map((race) => race.id)).toEqual([raceId]);
    expect(await listRaces(sam)).toEqual([]);
    expect(await getRaceDetail(sam, raceId)).toBeNull();
    expect(await getRaceDetail(alex, raceId)).not.toBeNull();
  });

  it('cannot have its status changed from the other account', async () => {
    const raceId = await createRace(alex);

    const result = await as(sam, () => setRaceStatusAction(raceId, 'COMPLETED'));

    expect(result.ok).toBe(false);
    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.status).toBe('UNWATCHED');
  });

  it('cannot be edited from the other account', async () => {
    const raceId = await createRace(alex, { name: 'Alex’s Race' });

    const result = await as(sam, () =>
      updateRaceAction(raceForm({ id: raceId, name: 'Sam’s Race', scheduledDuration: '24:00:00' })),
    );

    expect(result.ok).toBe(false);
    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.name).toBe('Alex’s Race');
    expect(race.runtimeSec).toBe(6 * H);
  });

  it('cannot be deleted from the other account', async () => {
    const raceId = await createRace(alex);

    const result = await as(sam, () => deleteRaceAction(raceId));

    expect(result.ok).toBe(false);
    expect(await prisma.race.count({ where: { id: raceId } })).toBe(1);
  });

  it('deleting a race from the other account takes back no XP', async () => {
    const raceId = await createRace(alex);
    const logged = await as(alex, () => logSessionAction(stintForm(raceId, { endTimestamp: '06:00:00' })));
    expect(logged.ok, logged.message).toBe(true);
    const before = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: alex } });
    const rowsBefore = await prisma.xPTransaction.count({ where: { userId: alex } });

    const result = await as(sam, () => deleteRaceAction(raceId));

    expect(result).toEqual({ ok: false, message: 'That race is no longer in the library.' });
    const after = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: alex } });
    expect(after.careerXp).toBe(before.careerXp);
    expect(await prisma.xPTransaction.count({ where: { userId: alex } })).toBe(rowsBefore);
    expect(await prisma.raceViewingSession.count({ where: { raceId } })).toBe(1);
  });

  it('says it is gone rather than saying it is forbidden', async () => {
    // The tone rule applies here too. To Sam, Alex's race genuinely is not in
    // the library — there is nothing to explain and nobody to accuse.
    const raceId = await createRace(alex);
    const result = await as(sam, () => deleteRaceAction(raceId));

    expect(result.message?.toLowerCase()).not.toContain('permission');
    expect(result.message?.toLowerCase()).not.toContain('denied');
    expect(result.message?.toLowerCase()).not.toContain('not allowed');
  });
});

describe('a stint belongs to the account that watched it', () => {
  it('cannot be logged against the other account’s race', async () => {
    const raceId = await createRace(alex);

    // The engine looks the race up scoped by the account, so a foreign id has
    // no race behind it at all. Prisma logs the resulting `findFirstOrThrow`
    // as `prisma:error` on its way out — that line in the test output is this
    // test working, not this test failing.
    await expect(as(sam, () => logSessionAction(stintForm(raceId)))).rejects.toThrow();

    expect(await prisma.raceViewingSession.count({ where: { userId: sam } })).toBe(0);
    expect(await prisma.raceViewingSession.count({ where: { raceId } })).toBe(0);
    expect(await prisma.watchedInterval.count({ where: { raceId } })).toBe(0);
  });

  it('cannot be deleted from the other account', async () => {
    const raceId = await createRace(alex);
    const logged = await as(alex, () => logSessionAction(stintForm(raceId)));
    expect(logged.ok, logged.message).toBe(true);
    const sessionId = logged.data!.sessionId;

    const result = await as(sam, () => deleteSessionAction(sessionId));

    expect(result.ok).toBe(false);
    expect(await prisma.raceViewingSession.count({ where: { id: sessionId } })).toBe(1);
  });

  it('moves only the watching account’s career', async () => {
    const raceId = await createRace(alex);
    const logged = await as(alex, () => logSessionAction(stintForm(raceId)));
    expect(logged.ok, logged.message).toBe(true);

    const alexProfile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: alex } });
    const samProfile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId: sam } });

    expect(Number(alexProfile.careerXp)).toBeGreaterThan(0);
    expect(Number(samProfile.careerXp)).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { userId: alex } })).toBeGreaterThan(0);
    expect(await prisma.xPTransaction.count({ where: { userId: sam } })).toBe(0);
    expect(await prisma.watchedInterval.count({ where: { race: { userId: sam } } })).toBe(0);
  });
});

describe('a career replay belongs to one account', () => {
  it('the career-timeline cache never serves another account', async () => {
    clearCareerTimelineCache();
    const alexRace = await createRace(alex, { name: 'Alex Only' });
    await as(alex, () => logSessionAction(stintForm(alexRace)));

    const alexTimeline = await getCareerTimeline(alex);
    const samTimeline = await getCareerTimeline(sam);

    expect(alexTimeline.stints).toHaveLength(1);
    expect(samTimeline).not.toBe(alexTimeline);
    expect(samTimeline.stints).toHaveLength(0);
    expect(samTimeline.racesById.has(alexRace)).toBe(false);
  });

  it('the timeline fingerprint changes only with this account’s data', async () => {
    const samRace = await createRace(sam);
    const alexBefore = await timelineFingerprint(alex);
    const samBefore = await timelineFingerprint(sam);

    // Everything the fingerprint watches, written to Alex's account: a race,
    // a stint, a championship, and an event — made by the stint, then renamed.
    const alexRace = await createRace(alex, { iconicKey: 'alex-event' });
    await as(alex, () => logSessionAction(stintForm(alexRace)));
    await as(alex, () => createChampionshipAction(form({ name: 'Alex Endurance Cup' })));
    await prisma.raceMastery.update({
      where: { userId_key: { userId: alex, key: 'alex-event' } },
      data: { displayName: 'Alex’s Event' },
    });

    expect(await timelineFingerprint(alex)).not.toBe(alexBefore);
    expect(await timelineFingerprint(sam)).toBe(samBefore);

    await as(sam, () => logSessionAction(stintForm(samRace)));
    expect(await timelineFingerprint(sam)).not.toBe(samBefore);
  });
});

describe('an event belongs to the account that follows it', () => {
  async function alexEvent(): Promise<{ key: string; raceId: string }> {
    const created = await as(alex, () => createEventAction(form({ name: 'Alex’s Classic' })));
    expect(created.ok, created.message).toBe(true);
    const key = created.data!.event!.key;
    const raceId = await createRace(alex, { name: '2025 Alex’s Classic', eventKey: key });
    return { key, raceId };
  }

  it('an event cannot be renamed, merged, linked or read from the other account', async () => {
    const { key, raceId } = await alexEvent();
    const samRace = await createRace(sam, { name: 'Sam’s Race' });
    const samEvent = await as(sam, () => createEventAction(form({ name: 'Sam’s Event' })));
    const samKey = samEvent.data!.event!.key;

    const gone = { ok: false, message: 'That event is no longer in your list.' };
    expect(await as(sam, () => renameEventAction(form({ key, name: 'Taken Over' })))).toEqual(gone);
    expect(await as(sam, () => mergeEventsAction(key, samKey))).toEqual(gone);
    expect(await as(sam, () => mergeEventsAction(samKey, key))).toEqual(gone);
    expect(await as(sam, () => setEventArchivedAction(key, true))).toEqual(gone);
    expect(await as(sam, () => linkRacesToEventAction(key, [samRace]))).toEqual(gone);
    // Sam's own event, with Alex's race: the race reads as gone.
    expect(await as(sam, () => linkRacesToEventAction(samKey, [raceId])))
      .toEqual({ ok: false, message: 'Those races are no longer in the library.' });
    expect(await as(sam, () => unlinkRaceFromEventAction(raceId)))
      .toEqual({ ok: false, message: 'That race is no longer in the library.' });
    expect(await as(sam, () => findRacesToLinkAction(key, ''))).toEqual([]);
    expect(await getEventLegacy(sam, key)).toBeNull();
    expect((await getEventsIndex(sam)).events.map((event) => event.key)).toEqual([samKey]);

    // Nothing of Alex's moved.
    const event = await prisma.raceMastery.findFirstOrThrow({ where: { userId: alex, key } });
    expect(event).toMatchObject({ displayName: 'Alex’s Classic', archivedAt: null, mergedIntoId: null });
    expect((await prisma.race.findUniqueOrThrow({ where: { id: raceId } })).iconicKey).toBe(key);
    expect((await prisma.race.findUniqueOrThrow({ where: { id: samRace } })).iconicKey).toBeNull();
  });

  it('a merge chain never follows into the other account', async () => {
    const { key: alexKey } = await alexEvent();
    const alexRow = await prisma.raceMastery.findFirstOrThrow({ where: { userId: alex, key: alexKey } });
    // A merged event of Sam's whose pointer names Alex's event: a row the
    // application would never write, planted to test that nothing follows it.
    await prisma.raceMastery.create({
      data: { userId: sam, key: 'planted', name: 'Planted', archivedAt: new Date(), mergedIntoId: alexRow.id },
    });
    const samRace = await createRace(sam, { name: 'Sam Planted Race' });
    await prisma.race.update({ where: { id: samRace }, data: { iconicKey: 'planted' } });

    // The page does not lead into Alex's career…
    const page = await getEventLegacy(sam, 'planted');
    expect(page).not.toBeNull();
    expect(page && 'redirectTo' in page).toBe(false);
    // …the race form does not resolve into it…
    const resolved = await prisma.$transaction((tx) => resolveEventForRaceInput(tx as Tx, sam, { eventKey: 'planted' }, new Date()));
    expect(resolved).toBeNull();
    // …and recomputing Sam's events leaves the race where it is.
    await prisma.$transaction((tx) => recomputeRaceMasteries(tx as Tx, sam, new Date()));
    const race = await prisma.race.findUniqueOrThrow({ where: { id: samRace } });
    expect(race.iconicKey).toBe('planted');
    expect(race.raceMasteryId).not.toBe(alexRow.id);
    expect(await prisma.race.count({ where: { raceMasteryId: alexRow.id, userId: sam } })).toBe(0);
  });
});

describe('an Expedition belongs to the account whose race it is', () => {
  it('Expedition Mode cannot be switched on the other account’s race', async () => {
    const raceId = await createRace(alex, { name: 'Alex’s 24', raceType: 'H24', scheduledDuration: '24:00:00' });
    expect((await as(alex, () => logSessionAction(stintForm(raceId, { endTimestamp: '13:00:00' })))).ok).toBe(true);
    const held = await prisma.xPTransaction.count({ where: { userId: alex, source: 'EXPEDITION' } });
    expect(held).toBe(3);

    for (const mode of ['off', 'on', 'auto']) {
      expect(await as(sam, () => setExpeditionModeAction(raceId, mode)))
        .toEqual({ ok: false, message: 'That race is no longer in the library.' });
    }
    expect((await prisma.race.findUniqueOrThrow({ where: { id: raceId } })).expeditionMode).toBeNull();
    expect(await prisma.xPTransaction.count({ where: { userId: alex, source: 'EXPEDITION' } })).toBe(held);
    expect(await prisma.xPTransaction.count({ where: { userId: sam, source: 'EXPEDITION' } })).toBe(0);
    expect(await getExpeditionView(sam, raceId, new Date())).toBeNull();
  });

  it('an expedition summary of the other account cannot be opened', async () => {
    const raceId = await createRace(alex, { name: 'Alex’s Ten', raceType: 'H10', scheduledDuration: '10:00:00' });
    const logged = await as(alex, () => logSessionAction(stintForm(raceId, { endTimestamp: '10:00:00' })));
    expect(logged.ok, logged.message).toBe(true);
    const summary = await prisma.expeditionSummary.findFirstOrThrow({ where: { userId: alex } });

    expect(await getExpeditionSummary(sam, summary.id)).toBeNull();
    expect(await getExpeditionSummaryForRace(sam, raceId)).toBeNull();
    expect(await buildOutcomeForSession(sam, logged.data!.sessionId)).toBeNull();
    expect(await getExpeditionSummary(alex, summary.id)).toMatchObject({ id: summary.id, raceId });
  });
});

describe('a championship belongs to the account that created it', () => {
  it('cannot be borrowed by a race added from the other account', async () => {
    // A championship id is a uuid on a `<select>`. Accepting one from another
    // career would attach a race to somebody else's championship — and, worse,
    // write a season row underneath it.
    const created = await as(alex, () => createChampionshipAction(form({ name: 'Alex Endurance Cup' })));
    expect(created.ok, created.message).toBe(true);
    const championshipId = created.data!.id;

    const raceId = await createRace(sam, { championshipId, seasonYear: '2026', plannedRaceCount: '8' });

    // The race is still added — an unassigned race is perfectly ordinary, and
    // refusing the whole form would be a worse answer than quietly not
    // borrowing somebody else's championship.
    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });
    expect(race.championshipId).toBeNull();
    expect(race.seasonId).toBeNull();
    expect(await prisma.championshipSeason.count({ where: { championshipId } })).toBe(0);
  });

  it('cannot have a season written into it from the other account', async () => {
    const created = await as(alex, () => createChampionshipAction(form({ name: 'Alex Endurance Cup' })));
    const championshipId = created.data!.id;

    const result = await as(sam, () =>
      upsertSeasonAction(form({ championshipId, year: '2026', label: 'Sam was here' })),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.championshipSeason.count({ where: { championshipId } })).toBe(0);
  });

  it('is not in the other account’s list of championships', async () => {
    await as(alex, () => createChampionshipAction(form({ name: 'Alex Endurance Cup' })));

    expect(await prisma.championship.count({ where: { userId: sam } })).toBe(0);
    expect(await prisma.championship.count({ where: { userId: alex } })).toBe(1);
  });
});

describe('an action never trusts who the browser says it is', () => {
  it('sends a signed-out caller to the picker instead of guessing', async () => {
    signedIn.userId = null;

    await expect(createRaceAction(raceForm())).rejects.toThrow('NEXT_REDIRECT:/accounts');
    await expect(setRaceStatusAction('00000000-0000-4000-8000-00000000dead', 'COMPLETED')).rejects.toThrow(
      'NEXT_REDIRECT:/accounts',
    );
  });

  it('writes new rows to the signed-in account, whatever the form said', async () => {
    // There is deliberately no `userId` field on any form. If one were added,
    // this is the test that would notice it being honoured.
    const result = await as(sam, () => createRaceAction(raceForm({ userId: alex })));
    expect(result.ok, result.message).toBe(true);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: result.data!.id } });
    expect(race.userId).toBe(sam);
  });
});

describe('a one-shot bonus belongs to one account', () => {
  it('pays each account its own viewing XP for the same race name', async () => {
    // Repeatable awards carry no dedupe key, so two accounts watching the same
    // thing simply both get paid. This is the case that works today.
    const alexRace = await createRace(alex);
    const samRace = await createRace(sam);

    await as(alex, () => logSessionAction(stintForm(alexRace)));
    await as(sam, () => logSessionAction(stintForm(samRace)));

    const [alexXp, samXp] = await Promise.all([
      prisma.xPTransaction.aggregate({ where: { userId: alex, source: 'VIEWING' }, _sum: { amount: true } }),
      prisma.xPTransaction.aggregate({ where: { userId: sam, source: 'VIEWING' }, _sum: { amount: true } }),
    ]);

    expect(alexXp._sum.amount).toBeGreaterThan(0);
    expect(samXp._sum.amount).toBe(alexXp._sum.amount);
  });

  /**
   * The regression test for the bug that made a second account worth less
   * than the first. `dedupeKey` used to be `@unique` across the whole table,
   * and every one-shot key an engine builds — achievements, milestones, the
   * global and event mastery trees — is derived from what was earned rather
   * than from who earned it. So the second account to unlock any of them was
   * shown the unlock and paid nothing: the same career seeded into two
   * accounts scored 321,130 XP and 188,330 XP.
   *
   * The constraint is now `@@unique([userId, dedupeKey])` and `awardXp` looks
   * the key up with `findFirst` scoped by account, so both halves of the
   * guarantee hold at once — a second account earns it for the first time,
   * and re-running an engine still cannot pay the same account twice.
   */
  it('pays two accounts the same one-shot bonus', async () => {
    const key = 'story:test-race';

    const first = await awardXpStandalone(alex, {
      source: 'STORY_COMPLETE',
      amount: 5000,
      description: 'Story complete',
      dedupeKey: key,
    });
    const second = await awardXpStandalone(sam, {
      source: 'STORY_COMPLETE',
      amount: 5000,
      description: 'Story complete',
      dedupeKey: key,
    });

    expect(first.granted).toBe(5000);
    expect(first.duplicate).toBe(false);
    expect(second.granted).toBe(5000);
    expect(second.duplicate).toBe(false);

    // And re-running an engine still must not pay the same account twice.
    const again = await awardXpStandalone(alex, {
      source: 'STORY_COMPLETE',
      amount: 5000,
      description: 'Story complete',
      dedupeKey: key,
    });
    expect(again.duplicate).toBe(true);
    expect(again.granted).toBe(0);
  });
});
