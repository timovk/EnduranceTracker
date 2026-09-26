/**
 * Event Legacy (0.4.0): recurring events as profiles the user manages.
 *
 * The events are driven the way the application drives them — the race forms
 * and the Events page's actions, the engine underneath — on the real test
 * database, with stints logged through the real engine at injected times. A
 * test of what an event pays is in `xp-exploits.test.ts`; this file is about
 * what events are, what their pages say, and that managing them keeps every
 * race's history and pays nothing twice.
 *
 * After every test, invariant I6 is checked: no race has helped pay an event
 * step twice (`eventStepProblems`), and the ledger is settled (I2).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signedIn = vi.hoisted(() => ({ userId: '00000000-0000-4000-8000-0000000004e1' }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'endurance_session',
  requireUserId: async () => signedIn.userId,
  getSessionUserId: async () => signedIn.userId,
  getSessionUser: async () => null,
}));
// No router here to tell about revalidated routes.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import {
  createEvent, EventOperationRefused, findRacesToLink, getEventLegacy, getEventsIndex, getEventSuggestionForRace,
  linkRaces, mergeEvents, renameEvent, resolveEventForRaceInput, setEventArchived, unlinkRace, type EventLegacyView,
} from '@/lib/engines/event-legacy-engine';
import { getCareerMilestonesView } from '@/lib/engines/career-milestone-engine';
import { getMasteryOverview } from '@/lib/engines/mastery-engine';
import { reconstructStintUnlocks } from '@/lib/engines/stint-unlocks';
import { createRaceAction, updateRaceAction } from '@/lib/server/actions';
import {
  createEventAction, dismissEventSuggestionAction, linkStrongSuggestionsAction, suggestEventForNameAction,
} from '@/lib/server/career-actions';
import { getDashboard } from '@/lib/server/dashboard';
import { getEventOptions, getRaceDetail } from '@/lib/server/races';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import { addRace, createCareerUser, eventStepProblems, H, ledgerProblems, logStint } from '../helpers/career-db';

const USER = signedIn.userId;
const NOW = new Date(2026, 8, 25, 20, 0);

/** Stints are logged one after another, two hours apart, from New Year's Day. */
let clock = new Date(2026, 0, 1, 8, 0);
function nextInstant(): Date {
  clock = new Date(clock.getTime() + 2 * H * 1000);
  return clock;
}

beforeEach(async () => {
  clock = new Date(2026, 0, 1, 8, 0);
  await createCareerUser(USER, 'EventsTest');
});

afterEach(async () => {
  expect(await eventStepProblems(USER)).toEqual([]);
  expect(await ledgerProblems(USER)).toEqual([]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

function inTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => work(tx as Tx), { maxWait: 15_000, timeout: 60_000 });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function raceForm(fields: Record<string, string>): FormData {
  return form({ raceType: 'H6', scheduledDuration: '01:00:00', priority: 'NORMAL', excitement: '3', status: 'UNWATCHED', ...fields });
}

/** A one-hour edition of a year, in an event when a key is given. */
async function edition(name: string, year: number | null, options: { eventKey?: string; circuit?: string; hours?: number } = {}) {
  return addRace(USER, {
    name, hours: options.hours ?? 1, iconicKey: options.eventKey ?? null, circuit: options.circuit ?? null,
    raceDate: year === null ? null : new Date(Date.UTC(year, 5, 15)),
  });
}

/** Watch the whole race: Story Complete. */
async function complete(raceId: string, hours = 1) {
  const at = nextInstant();
  return logStint(USER, raceId, { from: 0, to: hours * H, watchedAt: at, now: at });
}

/** Watch a quarter of an hour: experienced (ten credited minutes and a tenth of the race), not complete. */
async function experience(raceId: string) {
  const at = nextInstant();
  return logStint(USER, raceId, { from: 0, to: 15 * 60, watchedAt: at, now: at });
}

async function newEvent(name: string) {
  const created = await inTx((tx) => createEvent(tx, USER, name, NOW));
  if (!created.ok) throw new Error(`${name} already exists`);
  return created.event;
}

async function pageOf(key: string): Promise<EventLegacyView> {
  const view = await getEventLegacy(USER, key);
  if (view === null || 'redirectTo' in view) throw new Error(`no page for ${key}`);
  return view;
}

async function steps(key: string) {
  const rows = await prisma.masteryProgress.findMany({
    where: { userId: USER, node: { tree: { key: `event:${key}` } } },
    select: { unlockedAt: true, node: { select: { key: true } } },
  });
  return new Map(rows.map((row) => [row.node.key, row.unlockedAt !== null]));
}

async function paid(key: string, nodeKey: string): Promise<number | null> {
  const row = await prisma.xPTransaction.findFirst({ where: { userId: USER, dedupeKey: `mastery:event:${key}:${nodeKey}` } });
  return row?.amount ?? null;
}

async function careerXp(): Promise<number> {
  return Number((await prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER } })).careerXp);
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof EventOperationRefused) return error.reason;
    throw error;
  }
  throw new Error('the operation was not refused');
}

// ---------------------------------------------------------------------------

describe('the race forms', () => {
  it('the race form’s event reuses an existing event typed in another case', async () => {
    const first = await createRaceAction(raceForm({ name: '2024 24 Hours of Le Mans', newEventName: '24 Hours of Le Mans' }));
    const second = await createRaceAction(raceForm({ name: '2025 24 Hours of Le Mans', newEventName: '24 HOURS OF LE MANS' }));
    expect([first.ok, second.ok]).toEqual([true, true]);

    const events = await prisma.raceMastery.findMany({ where: { userId: USER } });
    expect(events).toHaveLength(1);
    const leMans = events[0]!;
    expect(leMans).toMatchObject({
      key: '24-hours-of-le-mans', displayName: '24 Hours of Le Mans', createdByUser: true, archivedAt: null, mergedIntoId: null,
    });
    const races = await prisma.race.findMany({
      where: { id: { in: [first.data!.id, second.data!.id] } },
      select: { iconicKey: true, raceMasteryId: true },
    });
    expect(races).toEqual([
      { iconicKey: leMans.key, raceMasteryId: leMans.id },
      { iconicKey: leMans.key, raceMasteryId: leMans.id },
    ]);
  });

  it('keeps a race in its event when "Major event" is off, and takes it out only when "None" is chosen', async () => {
    const event = await newEvent('Petit Le Mans');
    const created = await createRaceAction(raceForm({ name: '2025 Petit Le Mans', eventKey: event.key, isMajorEvent: 'false' }));
    const id = created.data!.id;
    expect((await getRaceDetail(USER, id))?.event).toMatchObject({ key: event.key, name: 'Petit Le Mans', editionYear: null });

    // Saved with "Major event" off and the event still chosen: 0.3.x cleared the link here.
    expect((await updateRaceAction(raceForm({ id, name: '2025 Petit Le Mans', eventKey: event.key }))).ok).toBe(true);
    expect((await prisma.race.findUniqueOrThrow({ where: { id } })).iconicKey).toBe(event.key);

    // A caller that says nothing about the event leaves the race where it is.
    expect((await updateRaceAction(raceForm({ id, name: '2025 Petit Le Mans', raceDate: '2025-10-04' }))).ok).toBe(true);
    const kept = await getRaceDetail(USER, id);
    expect(kept?.event).toMatchObject({ key: event.key, editionYear: 2025, href: `/events/${event.key}` });

    // "None".
    expect((await updateRaceAction(raceForm({ id, name: '2025 Petit Le Mans', eventKey: '' }))).ok).toBe(true);
    expect(await prisma.race.findUniqueOrThrow({ where: { id }, select: { iconicKey: true, raceMasteryId: true } }))
      .toEqual({ iconicKey: null, raceMasteryId: null });
  });

  it('asks for a name when "New event…" is chosen without one, rather than reading it as "None"', async () => {
    const event = await newEvent('Named Classic');
    const created = await createRaceAction(raceForm({ name: '2025 Named Classic', eventKey: event.key }));
    const id = created.data!.id;

    // What the picker posts for "New event…" with the name left empty.
    const saved = await updateRaceAction(raceForm({ id, name: '2025 Named Classic', eventKey: '', newEventName: '' }));
    expect(saved).toMatchObject({ ok: false, errors: { newEventName: 'Give the new event a name.' } });
    expect(await prisma.race.findUniqueOrThrow({ where: { id }, select: { iconicKey: true } })).toEqual({ iconicKey: event.key });

    const added = await createRaceAction(raceForm({ name: '2026 Named Classic', eventKey: '', newEventName: '   ' }));
    expect(added).toMatchObject({ ok: false, errors: { newEventName: 'Give the new event a name.' } });
    expect(await prisma.race.count({ where: { userId: USER } })).toBe(1);
  });

  it('reads a 0.3.x key as the event, and creates the event with exactly that key when the account has none', async () => {
    const created = await createRaceAction(raceForm({ name: 'Fort Aurelia 2025', iconicKey: 'fort-aurelia-24' }));
    const event = await prisma.raceMastery.findFirstOrThrow({ where: { userId: USER, key: 'fort-aurelia-24' } });
    expect(event).toMatchObject({ name: 'Fort Aurelia 24', displayName: null });
    expect((await prisma.race.findUniqueOrThrow({ where: { id: created.data!.id } })).raceMasteryId).toBe(event.id);
  });

  it('lists the active events with their editions for the forms', async () => {
    const sebring = await newEvent('12 Hours of Sebring');
    const spare = await newEvent('Spare Event');
    await edition('Sebring 2024', 2024, { eventKey: sebring.key });
    await edition('Sebring 2024 (re-upload)', 2024, { eventKey: sebring.key });
    await edition('Sebring 2025', 2025, { eventKey: sebring.key });
    await inTx((tx) => setEventArchived(tx, USER, spare.key, true, NOW));

    expect(await getEventOptions(USER)).toEqual([{ key: sebring.key, name: '12 Hours of Sebring', editions: 2 }]);
  });
});

describe('creating, renaming and archiving', () => {
  it('creating an event with an existing name is refused', async () => {
    const event = await newEvent('24 Hours of Daytona');
    for (const name of ['24 hours of daytona', '24-Hours-Of-Daytona', '  24 Hours of Daytona ']) {
      const result = await createEventAction(form({ name }));
      expect(result).toMatchObject({
        ok: false,
        message: 'You already follow 24 Hours of Daytona.',
        data: { existing: { key: event.key, href: `/events/${event.key}` } },
      });
    }
    expect(await prisma.raceMastery.count({ where: { userId: USER } })).toBe(1);
  });

  it('never reuses a key, even one an archived or merged event holds', async () => {
    const first = await newEvent('Spa 24 Hours');
    const other = await newEvent('Total 24 Hours of Spa');
    await inTx((tx) => mergeEvents(tx, USER, first.key, other.key, NOW));
    const again = await newEvent('Spa 24 Hours');
    expect(first.key).toBe('spa-24-hours');
    expect(again.key).toBe('spa-24-hours-2');
  });

  it('renaming changes the name and nothing else', async () => {
    const event = await newEvent('Bathurst');
    const race = await edition('2025 Bathurst 12 Hour', 2025, { eventKey: event.key });
    await complete(race);
    const xp = await careerXp();
    const trees = await prisma.masteryTree.findMany({ where: { userId: USER }, select: { id: true, key: true } });

    const renamed = await inTx((tx) => renameEvent(tx, USER, event.key, '  Bathurst 12 Hour  '));
    expect(renamed).toEqual({ id: event.id, key: event.key, name: 'Bathurst 12 Hour' });
    expect(await prisma.masteryTree.findMany({ where: { userId: USER }, select: { id: true, key: true } })).toEqual(trees);
    expect((await prisma.masteryTree.findFirstOrThrow({ where: { userId: USER, key: `event:${event.key}` } })).name)
      .toBe('Bathurst 12 Hour');
    expect(await careerXp()).toBe(xp);
    expect((await pageOf(event.key)).event.name).toBe('Bathurst 12 Hour');

    const taken = await newEvent('Suzuka 10 Hours');
    expect(await refusal(inTx((tx) => renameEvent(tx, USER, taken.key, 'BATHURST 12 HOUR')))).toBe('name-taken');
  });

  it('archives only an event with no races, and brings it back', async () => {
    const event = await newEvent('Indianapolis 8 Hour');
    const race = await edition('2025 Indianapolis 8 Hour', 2025, { eventKey: event.key });
    expect(await refusal(inTx((tx) => setEventArchived(tx, USER, event.key, true, NOW)))).toBe('has-races');

    await inTx((tx) => unlinkRace(tx, USER, race, NOW));
    await inTx((tx) => setEventArchived(tx, USER, event.key, true, NOW));
    let index = await getEventsIndex(USER);
    expect(index.events.map((card) => card.key)).not.toContain(event.key);
    expect(index.inactive).toEqual([expect.objectContaining({ key: event.key, state: 'archived', mergedInto: null })]);
    expect((await pageOf(event.key)).event.archived).toBe(true);

    await inTx((tx) => setEventArchived(tx, USER, event.key, false, NOW));
    index = await getEventsIndex(USER);
    expect(index.events.map((card) => card.key)).toContain(event.key);
    expect(index.inactive).toEqual([]);
  });
});

describe('streaks are history', () => {
  it('Three Complete in a Row unlocks at three consecutive Story Complete editions', async () => {
    const event = await newEvent('Three in a Row Test');
    const [a, b, c] = [
      await edition('Test 2023', 2023, { eventKey: event.key }),
      await edition('Test 2024', 2024, { eventKey: event.key }),
      await edition('Test 2025', 2025, { eventKey: event.key }),
    ];
    await complete(a);
    await complete(b);
    expect((await steps(event.key)).get('consecutive_3')).toBe(false);
    await complete(c);
    expect((await steps(event.key)).get('consecutive_3')).toBe(true);
    expect(await paid(event.key, 'consecutive_3')).toBe(6_000);
    const row = await prisma.xPTransaction.findFirstOrThrow({ where: { userId: USER, dedupeKey: `mastery:event:${event.key}:consecutive_3` } });
    expect(row.seasonAmount).toBe(0);
  });

  it('a streak broken by a missing year restarts', async () => {
    const event = await newEvent('Broken Run Test');
    for (const year of [2020, 2021, 2023, 2024]) await complete(await edition(`Run ${year}`, year, { eventKey: event.key }));
    expect((await steps(event.key)).get('consecutive_3')).toBe(false);
    expect((await pageOf(event.key)).stats.longestCompleteRun).toEqual({ length: 2, fromYear: 2020, toYear: 2021 });

    await complete(await edition('Run 2025', 2025, { eventKey: event.key }));
    expect((await steps(event.key)).get('consecutive_3')).toBe(true);
    expect((await pageOf(event.key)).stats.longestCompleteRun).toEqual({ length: 3, fromYear: 2023, toYear: 2025 });
  });

  it('the page shows runs as history, never a current streak', async () => {
    const event = await newEvent('History Test');
    for (const year of [2022, 2023, 2024]) await complete(await edition(`History ${year}`, year, { eventKey: event.key }));
    // A later edition watched but not finished ends nothing: the run stays what it was.
    await experience(await edition('History 2026', 2026, { eventKey: event.key }));

    const view = await pageOf(event.key);
    expect(view.stats.longestCompleteRun).toEqual({ length: 3, fromYear: 2022, toYear: 2024 });
    expect(view.stats.longestExperiencedRun).toEqual({ length: 3, fromYear: 2022, toYear: 2024 });
    expect(Object.keys(view.stats).filter((key) => /current|streak/i.test(key))).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/current streak|streak|missed/i);
  });
});

describe('the event page', () => {
  it('the event page shows missing years as rows and counts nothing for them', async () => {
    const event = await newEvent('Missing Years Test');
    for (const year of [2008, 2009, 2015, 2017]) await edition(`Missing ${year}`, year, { eventKey: event.key });
    await edition('Missing, undated', null, { eventKey: event.key });

    const view = await pageOf(event.key);
    expect(view.editions.map((row) => (row.kind === 'edition'
      ? `${row.editionYear ?? 'undated'} ${row.name}`
      : `missing ${row.fromYear}–${row.toYear}`))).toEqual([
      '2017 Missing 2017',
      'missing 2016–2016',
      '2015 Missing 2015',
      'missing 2010–2014',
      '2009 Missing 2009',
      '2008 Missing 2008',
      'undated Missing, undated',
    ]);
    expect(view.stats).toMatchObject({ editionsInLibrary: 5, editionsExperienced: 0, editionsStoryComplete: 0, undatedEditions: 1 });
    // Nothing watched, so no figure that would need watching.
    expect(view.stats.firstEditionWatched).toBeNull();
    expect(view.stats.longestCompleteRun).toBeNull();
    expect(view.headline).toBe('Missing Years Test — its story starts with the first edition you watch');
  });

  it('describes the history from the replay: editions once a year, credited time, coverage and re-watches', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, slug: 'wec', name: 'WEC', accentColor: '#3366cc' },
    });
    const event = await newEvent('Replay Test');
    const early = await edition('Replay 2024', 2024, { eventKey: event.key, hours: 2 });
    const late = await edition('Replay 2025', 2025, { eventKey: event.key });
    const twin = await edition('Replay 2025 (second upload)', 2025, { eventKey: event.key });
    await prisma.race.updateMany({ where: { id: { in: [early, late] } }, data: { championshipId: championship.id } });

    await complete(early, 2);
    const at = nextInstant();
    await logStint(USER, early, { from: 0, to: 30 * 60, watchedAt: at, now: at }); // a re-watch
    await complete(late);
    await experience(twin);

    const view = await pageOf(event.key);
    expect(view.stats).toMatchObject({
      editionsInLibrary: 2,
      editionsExperienced: 2,
      editionsStoryComplete: 2,
      storyCompleteRaces: 2,
      creditedSeconds: 2 * H + 30 * 60 + H + 15 * 60,
      uniqueCoverageSeconds: 2 * H + H + 15 * 60,
      rewatchSeconds: 30 * 60,
      longestCompleteRun: { length: 2, fromYear: 2024, toYear: 2025 },
    });
    expect(view.stats.firstEditionWatched).toMatchObject({ raceId: early, editionYear: 2024 });
    expect(view.stats.mostRecentEditionWatched).toMatchObject({ raceId: twin, editionYear: 2025 });
    expect(view.stats.longestEdition).toMatchObject({ raceId: early, runtimeSec: 2 * H });
    expect(view.stats.highestCompletion).toMatchObject({ raceId: early, percentText: '100%' });
    expect(view.championships).toEqual([{ id: championship.id, name: 'WEC', accentColor: '#3366cc', editions: 2 }]);
    expect(view.headline).toBe('Replay Test — 2 editions experienced — 3h 45m watched — 2 complete race stories');
    const twinRow = view.editions.find((row) => row.kind === 'edition' && row.raceId === twin);
    expect(twinRow).toMatchObject({ completionPercentText: '25%', storyCompletedAt: null, sessions: 1, creditedSeconds: 15 * 60 });

    // The steps: grouped in their order, each with its date and what it paid.
    expect([...new Set(view.steps.map((step) => step.group))]).toEqual(['experienced', 'complete', 'in-a-row', 'hours']);
    const first = view.steps.find((step) => step.nodeKey === 'edition_1')!;
    expect(first).toMatchObject({ name: 'First Complete Edition', unlocked: true, xp: 1_000, recordedOnly: false, precision: 'STINT' });
    const experienced = view.steps.find((step) => step.nodeKey === 'experienced_1')!;
    expect(experienced).toMatchObject({ unlocked: true, xp: null, recordedOnly: false });
    const hours = view.steps.find((step) => step.nodeKey === 'event_hours_25')!;
    expect(hours).toMatchObject({ unlocked: false, value: 3.8, threshold: 25, xp: 500 });
  });

  it('counts an edition rushed through at 8× as complete but not experienced, on the page and in its steps alike', async () => {
    const event = await newEvent('Rushed Test');
    const race = await edition('Rushed 2025', 2025, { eventKey: event.key });
    let at = nextInstant();
    // The whole hour at 8×: a complete story in seven and a half credited minutes.
    await logStint(USER, race, { from: 0, to: H, speed: 8, watchedAt: at, now: at });

    let view = await pageOf(event.key);
    expect(view.stats).toMatchObject({ editionsStoryComplete: 1, editionsExperienced: 0, creditedSeconds: 450 });
    expect(view.headline).toBe('Rushed Test — 7m watched — 1 complete race story');
    expect(view.steps.find((step) => step.nodeKey === 'edition_1')).toMatchObject({ unlocked: true, value: 1 });
    expect(view.steps.find((step) => step.nodeKey === 'experienced_1')).toMatchObject({ unlocked: false, value: 0 });

    // Five more minutes at 1× make it experienced, for the page and the step together.
    at = nextInstant();
    await logStint(USER, race, { from: 0, to: 5 * 60, watchedAt: at, now: at });
    view = await pageOf(event.key);
    expect(view.stats.editionsExperienced).toBe(1);
    expect(view.stats.longestExperiencedRun).toEqual({ length: 1, fromYear: 2025, toYear: 2025 });
    expect(view.steps.find((step) => step.nodeKey === 'experienced_1')).toMatchObject({ unlocked: true, value: 1 });
  });

  it('leads a merged event’s address to the event it was merged into, and knows no other', async () => {
    const from = await newEvent('Merged Away');
    const into = await newEvent('Merged Into');
    await edition('Merged Away 2025', 2025, { eventKey: from.key });
    const result = await inTx((tx) => mergeEvents(tx, USER, from.key, into.key, NOW));
    expect(result).toEqual({ racesMoved: 1, stepsCarried: 0 });

    expect(await getEventLegacy(USER, from.key)).toEqual({ redirectTo: `/events/${into.key}` });
    expect(await getEventLegacy(USER, 'no-such-event')).toBeNull();
    const view = await pageOf(into.key);
    expect(view.event.mergedFrom).toEqual([{ key: from.key, name: 'Merged Away' }]);
    expect(view.stats.editionsInLibrary).toBe(1);

    // The merged event's tree is left out of Mastery, and its event out of every list.
    const trees = await getMasteryOverview(USER);
    expect(trees.map((tree) => tree.key)).not.toContain(`event:${from.key}`);
    expect(trees.find((tree) => tree.key === `event:${into.key}`)?.eventHref).toBe(`/events/${into.key}`);
    expect((await getEventOptions(USER)).map((option) => option.key)).toEqual([into.key]);
    const index = await getEventsIndex(USER);
    expect(index.inactive).toEqual([
      expect.objectContaining({ key: from.key, state: 'merged', mergedInto: { key: into.key, name: 'Merged Into', href: `/events/${into.key}` } }),
    ]);
  });

  it('encodes free-text keys in every link', async () => {
    const event = await inTx((tx) => resolveEventForRaceInput(tx, USER, { eventKey: 'Le Mans / 24h?' }, NOW));
    expect(event?.key).toBe('Le Mans / 24h?');
    const index = await getEventsIndex(USER);
    expect(index.events[0]?.href).toBe(`/events/${encodeURIComponent('Le Mans / 24h?')}`);
  });
});

describe('linking and unlinking', () => {
  it('unlinking takes nothing back: the steps stay, the figures follow the races', async () => {
    const event = await newEvent('Unlink Test');
    const race = await edition('Unlink 2025', 2025, { eventKey: event.key });
    await complete(race);
    expect(await paid(event.key, 'edition_1')).toBe(1_000);
    const xp = await careerXp();

    await inTx((tx) => unlinkRace(tx, USER, race, NOW));
    expect(await careerXp()).toBe(xp);
    expect((await steps(event.key)).get('edition_1')).toBe(true);
    expect(await prisma.race.findUniqueOrThrow({ where: { id: race }, select: { iconicKey: true, raceMasteryId: true } }))
      .toEqual({ iconicKey: null, raceMasteryId: null });
    const view = await pageOf(event.key);
    expect(view.stats.editionsInLibrary).toBe(0);
    expect(view.steps.find((step) => step.nodeKey === 'edition_1')).toMatchObject({ unlocked: true, xp: 1_000 });
  });

  it('linking brings a race’s history with it, and dates the steps it reaches from that history', async () => {
    const event = await newEvent('Link Test');
    const race = await edition('Link 2024', 2024);
    const outcome = await complete(race);

    const linked = await inTx((tx) => linkRaces(tx, USER, event.key, [race], NOW));
    expect(linked).toBe(1);
    const view = await pageOf(event.key);
    expect(view.stats).toMatchObject({ editionsInLibrary: 1, editionsStoryComplete: 1 });
    // Reached when the edition was completed, in January, not when it was linked in September.
    const step = view.steps.find((candidate) => candidate.nodeKey === 'edition_1')!;
    expect(step).toMatchObject({ unlocked: true, xp: 1_000, precision: 'STINT' });
    const stint = await prisma.raceViewingSession.findUniqueOrThrow({ where: { id: outcome.sessionId } });
    expect(step.date).toEqual(stint.watchedAt);
  });
});

describe('a step reached on editions that already paid it', () => {
  it('is recorded without XP, and the stint that reached it says so, live and reopened', async () => {
    const original = await newEvent('Paid Once');
    const [a, b, c] = [
      await edition('Paid Once 2021', 2021, { eventKey: original.key }),
      await edition('Paid Once 2022', 2022, { eventKey: original.key }),
      await edition('Paid Once 2023', 2023, { eventKey: original.key }),
    ];
    for (const race of [a, b, c]) await complete(race);
    expect(await paid(original.key, 'edition_3')).toBe(4_000);

    // Two of its editions move to a new event, and a third, new, edition is completed there.
    const moved = await newEvent('Paid Once, Continued');
    await inTx((tx) => linkRaces(tx, USER, moved.key, [b, c], NOW));
    const outcome = await complete(await edition('Paid Once 2024', 2024, { eventKey: moved.key }));

    const live = outcome.mastery.find((unlock) => unlock.treeKey === `event:${moved.key}` && unlock.nodeKey === 'edition_3');
    expect(live).toMatchObject({ nodeName: 'Three Complete Editions', xpAwarded: 0 });
    const reopened = await buildOutcomeForSession(USER, outcome.sessionId);
    expect(reopened?.mastery.find((unlock) => unlock.nodeKey === 'edition_3')).toMatchObject({ xpAwarded: 0 });
    expect(await paid(moved.key, 'edition_3')).toBeNull();

    // The event page says why.
    const step = (await pageOf(moved.key)).steps.find((candidate) => candidate.nodeKey === 'edition_3');
    expect(step).toMatchObject({ unlocked: true, xp: null, recordedOnly: true });
  });
});

describe('what a merge leaves in the history', () => {
  it('reopening a stint lists what it unlocked then, and the dashboard shows each step once, however often it is merged', async () => {
    const from = await newEvent('History From');
    const into = await newEvent('History Into');
    const last = await newEvent('History Last');
    const completed = await complete(await edition('History From 2024', 2024, { eventKey: from.key }));
    const experienced = await experience(await edition('History Into 2025', 2025, { eventKey: into.key }));

    const listed = async (sessionId: string) => {
      const stint = await prisma.raceViewingSession.findUniqueOrThrow({ where: { id: sessionId } });
      const unlocks = await reconstructStintUnlocks(prisma, USER, stint);
      return unlocks.mastery.map((unlock) => `${unlock.treeKey}:${unlock.nodeKey}=${unlock.xpAwarded}`).sort();
    };
    const shelf = async () => (await getDashboard(USER, NOW)).unlocks
      .filter((unlock) => unlock.kind === 'mastery' && unlock.key.startsWith('mastery:event:'))
      .map((unlock) => unlock.key)
      .sort();

    const completedBefore = await listed(completed.sessionId);
    const experiencedBefore = await listed(experienced.sessionId);
    expect(completedBefore).toEqual([`event:${from.key}:edition_1=1000`, `event:${from.key}:experienced_1=0`]);
    expect(experiencedBefore).toEqual([`event:${into.key}:experienced_1=0`]);
    const shelfBefore = await shelf();

    // Merged, and the survivor merged again: every step is carried twice, with its dates.
    await inTx((tx) => mergeEvents(tx, USER, from.key, into.key, NOW));
    await inTx((tx) => mergeEvents(tx, USER, into.key, last.key, new Date(NOW.getTime() + 60_000)));
    expect([...(await steps(last.key))].filter(([, unlocked]) => unlocked).map(([key]) => key).sort())
      .toEqual(['edition_1', 'experienced_1']);

    expect(await listed(completed.sessionId)).toEqual(completedBefore);
    expect(await listed(experienced.sessionId)).toEqual(experiencedBefore);
    expect(await shelf()).toEqual(shelfBefore);
  });
});

describe('suggestions', () => {
  it('suggests links, new events and merges from the library, and links nothing without a click', async () => {
    const event = await newEvent('24 Hours of Testing');
    await edition('2024 24 Hours of Testing', 2024, { eventKey: event.key, circuit: 'Test Ring' });
    const unlinked = await edition('2025 24 Hours of Testing', 2025, { circuit: 'Test Ring' });
    await edition('2023 6 Hours of Somewhere', 2023);
    await edition('2024 6 Hours of Somewhere', 2024);
    // A look-alike the application would refuse to create now: an event 0.3.x keyed by hand.
    const twin = await inTx((tx) => resolveEventForRaceInput(tx, USER, { eventKey: '24-hours-of-testing-old' }, NOW));
    await prisma.raceMastery.updateMany({ where: { id: twin!.id }, data: { displayName: '24 hours of testing' } });

    const before = await prisma.race.findMany({ where: { userId: USER }, select: { id: true, iconicKey: true } });
    const index = await getEventsIndex(USER);
    expect(index.suggestions.map((item) => item.kind)).toEqual(['merge', 'link', 'create']);
    expect(index.suggestions[0]).toMatchObject({ kind: 'merge', from: { key: twin!.key }, into: { key: event.key } });
    expect(index.suggestions[1]).toMatchObject({
      kind: 'link', strength: 'strong', reason: 'name-and-circuit',
      race: { id: unlinked, name: '2025 24 Hours of Testing' }, event: { key: event.key, name: '24 Hours of Testing' },
    });
    expect(index.suggestions[2]).toMatchObject({ kind: 'create', name: '6 Hours of Somewhere' });
    expect(await prisma.race.findMany({ where: { userId: USER }, select: { id: true, iconicKey: true } })).toEqual(before);

    // The race page offers the strong match in one line; dismissed, it is not offered again.
    const offer = await getEventSuggestionForRace(USER, unlinked);
    expect(offer).toMatchObject({ key: event.key, name: '24 Hours of Testing' });
    expect((await dismissEventSuggestionAction(offer!.suggestionId)).ok).toBe(true);
    expect(await getEventSuggestionForRace(USER, unlinked)).toBeNull();
    expect((await getEventsIndex(USER)).suggestions.map((item) => item.kind)).toEqual(['merge', 'create']);
  });

  it('links every confirmed strong suggestion in one step, and only those', async () => {
    const event = await newEvent('Endurance Classic');
    await edition('2023 Endurance Classic', 2023, { eventKey: event.key });
    const a = await edition('2024 Endurance Classic', 2024);
    const b = await edition('2025 Endurance Classic', 2025);
    const c = await edition('2026 Endurance Classic', 2026);
    const ids = (await getEventsIndex(USER)).suggestions.filter((item) => item.kind === 'link').map((item) => item.id);
    expect(ids).toHaveLength(3);

    const result = await linkStrongSuggestionsAction(ids.filter((id) => !id.includes(c)));
    expect(result).toMatchObject({ ok: true, data: { linked: 2 } });
    const races = await prisma.race.findMany({ where: { id: { in: [a, b, c] } }, select: { id: true, iconicKey: true } });
    expect(Object.fromEntries(races.map((race) => [race.id, race.iconicKey]))).toEqual({ [a]: event.key, [b]: event.key, [c]: null });
  });

  it('picks the event a typed race name looks like for the Add Race form', async () => {
    const event = await newEvent('Nürburgring 24 Hours');
    await edition('2024 Nürburgring 24 Hours', 2024, { eventKey: event.key });
    expect(await suggestEventForNameAction('2026 Nurburgring 24 Hours')).toMatchObject({ key: event.key, name: 'Nürburgring 24 Hours' });
    expect(await suggestEventForNameAction('Six Hours of Elsewhere')).toBeNull();
    expect(await suggestEventForNameAction('   ')).toBeNull();
  });

  it('offers the likely editions first in the Add races dialog, and searches the rest', async () => {
    const event = await newEvent('Dialog Test Hours');
    await edition('2024 Dialog Test Hours', 2024, { eventKey: event.key, circuit: 'Dialog Park' });
    const byName = await edition('2025 Dialog Test Hours', 2025);
    const byCircuit = await edition('Something Else 2025', 2025, { circuit: 'Dialog Park' });
    const watched = await edition('Watched Recently', 2025);
    await experience(watched);
    await edition('Zzz Never Watched', 2025);

    const offered = await findRacesToLink(USER, event.key);
    expect(offered.slice(0, 3).map((race) => [race.id, race.suggested])).toEqual([
      [byName, 'strong'], [byCircuit, 'likely'], [watched, null],
    ]);
    expect((await findRacesToLink(USER, event.key, 'zzz')).map((race) => race.name)).toEqual(['Zzz Never Watched']);
    expect(await findRacesToLink(USER, 'no-such-event')).toEqual([]);
  });
});

describe('Career Milestones', () => {
  it('link a milestone reached in an event to its page', async () => {
    const event = await newEvent('Milestone Event');
    for (const year of [2021, 2022, 2023, 2024, 2025]) await experience(await edition(`Milestone ${year}`, year, { eventKey: event.key }));
    const view = await getCareerMilestonesView(USER, NOW);
    const item = view.groups.flatMap((group) => group.items).find((candidate) => candidate.id === 'event-editions-5');
    expect(item).toMatchObject({ reached: true, subject: { kind: 'event', name: 'Milestone Event', href: `/events/${event.key}` } });
    // Paid by the event's own step, once.
    expect(await paid(event.key, 'experienced_5')).toBe(500);
  });
});
