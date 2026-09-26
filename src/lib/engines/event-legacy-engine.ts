/**
 * Event Legacy (0.4.0): the recurring events of a career as profiles the user
 * manages — every Le Mans, every Sebring, gathered into one history.
 *
 * An event is a `RaceMastery` row. Its `key` is its permanent identity and is
 * never rewritten or reused; the name the user sees is `displayName ?? name`.
 * A race belongs to an event through `Race.raceMasteryId`, and its `iconicKey`
 * always carries the event's key, so everything that has grouped editions by
 * key since 0.3.x keeps working. The event's steps are its `RACE_EVENT`
 * mastery tree.
 *
 * Four rules shape this module:
 *
 *   1. NOTHING IS PAID TWICE. Every operation that can move a race between
 *      events — linking, unlinking, merging, the race form, deleting a race —
 *      first records the steps the race helped its current event reach
 *      (`writeMissingEventStepCredits`), so the race can never help pay the
 *      same kind of step again anywhere. Renaming changes a name only.
 *   2. NOTHING IS TAKEN BACK. Unlinking or merging never takes XP back: an
 *      event's figures follow its races, its steps stay unlocked, and a
 *      merged event's tree and unlocks stay where they are.
 *   3. NOTHING IS LINKED WITHOUT A CLICK. Suggestions are worked out on read
 *      (`domain/event-association`) and only ever offered.
 *   4. EVERYTHING IS ACCOUNT-SCOPED. Every key and race id from the browser is
 *      looked up inside the account before use, and a merge chain is
 *      followed through the account's own rows only, at most
 *      `EVENT_SHAPE.maxMergeHops` hops.
 *
 * The write operations take the caller's transaction; the views read the
 * cached career replay (`getCareerTimeline`) and never load the library into
 * the page.
 */

import { CAREER_STATS_SHAPE, EVENT_SHAPE } from '@/lib/config';
import { eventLegacyHeadline } from '@/lib/copy/tone';
import { prisma, type Tx } from '@/lib/db/client';
import type { CareerTimeline, RaceHistory, TimelineRaceRow } from '@/lib/domain/career-timeline';
import {
  editionIdentityOf, longestConsecutiveRun, missingEditionYears, normaliseEventKey, type Run,
} from '@/lib/domain/edition';
import {
  suggestEventLinks, type AssociationEvent, type AssociationRace, type EventSuggestion,
} from '@/lib/domain/event-association';
import { isExpedition } from '@/lib/domain/expedition';
import { formatCoveragePercent } from '@/lib/domain/time';
import type { MilestonePrecision } from '@/lib/domain/types';
import { fillLandmarkDates, syncCareerMilestones } from './career-milestone-engine';
import { getCareerTimeline } from './career-timeline-engine';
import {
  carryOverEventSteps, ensureMasteryTrees, eventDisplayName, eventHref, recomputeRaceMasteries, syncMastery,
  writeMissingEventStepCredits,
} from './mastery-engine';
import { computeCareerMetricsWithHistory } from './metrics';
import { circuitSlug } from './race-engine';

// ---------------------------------------------------------------------------
// Events and their names
// ---------------------------------------------------------------------------

/** An event, as the rest of the application refers to it. */
export interface EventRef {
  id: string;
  key: string;
  /** The name the user sees: their own name for it, or the one derived from its key. */
  name: string;
}

/** Why an event operation was refused. The action turns it into a sentence. */
export type EventRefusalReason =
  | 'not-found'
  | 'name-taken'
  | 'invalid-name'
  | 'same-event'
  | 'not-active'
  | 'merged'
  | 'has-races';

/**
 * An event operation that was not carried out, and why. Thrown inside the
 * operation's transaction, so nothing it had started is kept.
 */
export class EventOperationRefused extends Error {
  constructor(readonly reason: EventRefusalReason, readonly existing: EventRef | null = null) {
    super(`Event operation refused: ${reason}`);
    this.name = 'EventOperationRefused';
  }
}

/** The longest name an event can be given, and the longest key a form can post. */
export const EVENT_NAME_MAX_LENGTH = 80;

/** The most of a new key taken from the name, leaving room for a "-NN" suffix inside 80 characters. */
const EVENT_KEY_BASE_LENGTH = 72;

/** The per-account `ConfigOverride` key holding dismissed suggestion ids. */
export const DISMISSED_SUGGESTIONS_KEY = 'dismissedEventSuggestions';

const EVENT_SELECT = {
  id: true, key: true, name: true, displayName: true, createdByUser: true,
  archivedAt: true, mergedIntoId: true, createdAt: true,
} as const;

interface EventRow {
  id: string;
  key: string;
  name: string;
  displayName: string | null;
  createdByUser: boolean | null;
  archivedAt: Date | null;
  mergedIntoId: string | null;
  createdAt: Date;
}

function refOf(row: EventRow): EventRef {
  return { id: row.id, key: row.key, name: row.displayName ?? row.name };
}

/** Neither archived nor merged into another event. */
function isActive(row: Pick<EventRow, 'archivedAt' | 'mergedIntoId'>): boolean {
  return row.archivedAt === null && row.mergedIntoId === null;
}

async function loadEvents(db: Tx, userId: string): Promise<EventRow[]> {
  return db.raceMastery.findMany({ where: { userId }, select: EVENT_SELECT, orderBy: [{ createdAt: 'asc' }, { key: 'asc' }] });
}

/**
 * Whether an event goes by a name: its key or its name, reduced the way keys
 * are ("Le Mans 24" and "le-mans-24" are one name). A name that reduces to
 * nothing — all punctuation, or a script the reduction does not keep — is
 * compared as typed, ignoring case.
 */
function goesBy(row: EventRow, name: string): boolean {
  const wanted = normaliseEventKey(name);
  const shown = row.displayName ?? row.name;
  if (wanted === '') return shown.trim().toLowerCase() === name.trim().toLowerCase();
  return wanted === normaliseEventKey(row.key) || wanted === normaliseEventKey(shown);
}

/** A name cut to size, or a refusal when nothing is left of it. */
function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > EVENT_NAME_MAX_LENGTH) throw new EventOperationRefused('invalid-name');
  return trimmed;
}

/**
 * A key for a new event: its name reduced the way keys are, with "-2", "-3"
 * and so on added when the account has used that key before — by any event,
 * archived and merged ones included, or by a race. Keys are never reused, so
 * an old key can never start pointing at a different event.
 */
async function freshEventKey(db: Tx, userId: string, name: string, events: readonly EventRow[]): Promise<string> {
  // Short enough that a suffix still fits the 80 characters a key can be.
  const base = normaliseEventKey(name).slice(0, EVENT_KEY_BASE_LENGTH).replace(/-+$/, '') || 'event';
  const carried = await db.race.findMany({
    where: { userId, iconicKey: { not: null } },
    select: { iconicKey: true },
    distinct: ['iconicKey'],
  });
  const taken = new Set([...events.map((event) => event.key), ...carried.map((race) => race.iconicKey)]);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const key = `${base}-${suffix}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Where an event leads once merges are followed: the event itself, or the one
 * it was merged into, hop by hop, each hop looked up inside the account (the
 * column has no foreign key, so an id is never trusted to lead anywhere
 * else). Null when a hop leads nowhere or the chain runs past the limit.
 */
async function followMerges(db: Tx, userId: string, row: EventRow): Promise<EventRow | null> {
  let current = row;
  for (let hop = 0; current.mergedIntoId !== null; hop += 1) {
    if (hop >= EVENT_SHAPE.maxMergeHops) return null;
    const next = await db.raceMastery.findFirst({ where: { id: current.mergedIntoId, userId }, select: EVENT_SELECT });
    if (next === null) return null;
    current = next;
  }
  return current;
}

/**
 * The active event a key leads to, following merges; null when the account
 * has no such event, the chain cannot be followed, or the event it leads to
 * was archived.
 */
export async function resolveActiveEvent(tx: Tx, userId: string, key: string): Promise<EventRef | null> {
  const row = await tx.raceMastery.findFirst({ where: { userId, key }, select: EVENT_SELECT });
  if (row === null) return null;
  const survivor = await followMerges(tx, userId, row);
  return survivor !== null && isActive(survivor) ? refOf(survivor) : null;
}

/** An active event of the account's that goes by this name, other than `exceptId`. */
function activeEventNamed(events: readonly EventRow[], name: string, exceptId?: string): EventRow | null {
  return events.find((row) => row.id !== exceptId && isActive(row) && goesBy(row, name)) ?? null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create an event the user named. Refused, with the event that already goes
 * by that name, when an active event does: the application never creates a
 * look-alike. The new event is drawn at once (`ensureMasteryTrees`), so its
 * steps are there before its first edition is watched.
 */
export async function createEvent(
  tx: Tx,
  userId: string,
  name: string,
  now: Date,
): Promise<{ ok: true; event: EventRef } | { ok: false; existing: EventRef }> {
  const shown = cleanName(name);
  const events = await loadEvents(tx, userId);
  const existing = activeEventNamed(events, shown);
  if (existing !== null) return { ok: false, existing: refOf(existing) };

  const key = await freshEventKey(tx, userId, shown, events);
  const row = await tx.raceMastery.create({
    data: { userId, key, name: eventDisplayName(key), displayName: shown, createdByUser: true, createdAt: now },
    select: EVENT_SELECT,
  });
  await ensureMasteryTrees(tx, userId, now);
  return { ok: true, event: refOf(row) };
}

/**
 * The event a race form asks for.
 *
 *   - A new name wins: an active event that already goes by it is reused (so
 *     typing a name in another case is the same event), otherwise one is
 *     created as the user named it.
 *   - A key alone is looked up in the account and followed to the event it
 *     was merged into. An event archived by hand comes back when a race
 *     joins it. A key the account has never used creates the event with
 *     exactly that key: the path of 0.3.x keys, the demo seed and the tests.
 *   - Neither: no event.
 */
export async function resolveEventForRaceInput(
  tx: Tx,
  userId: string,
  input: { eventKey?: string; newEventName?: string },
  now: Date,
): Promise<EventRef | null> {
  if (input.newEventName !== undefined && input.newEventName.trim() !== '') {
    const created = await createEvent(tx, userId, input.newEventName, now);
    return created.ok ? created.event : created.existing;
  }
  const key = input.eventKey?.trim();
  if (key === undefined || key === '') return null;

  const row = await tx.raceMastery.findFirst({ where: { userId, key }, select: EVENT_SELECT });
  if (row === null) {
    const created = await tx.raceMastery.create({
      data: { userId, key, name: eventDisplayName(key), createdAt: now },
      select: EVENT_SELECT,
    });
    await ensureMasteryTrees(tx, userId, now);
    return refOf(created);
  }
  const survivor = await followMerges(tx, userId, row);
  if (survivor === null) return null;
  if (survivor.archivedAt !== null) {
    await tx.raceMastery.updateMany({ where: { id: survivor.id, userId }, data: { archivedAt: null } });
    await ensureMasteryTrees(tx, userId, now);
  }
  return refOf(survivor);
}

/**
 * Give an event a name of its own. Only its `displayName` changes — its key,
 * its tree and every step it has reached stay exactly as they are, so no XP
 * moves. Refused when another active event goes by the new name.
 */
export async function renameEvent(tx: Tx, userId: string, key: string, displayName: string): Promise<EventRef> {
  const shown = cleanName(displayName);
  const events = await loadEvents(tx, userId);
  const event = events.find((row) => row.key === key);
  if (event === undefined) throw new EventOperationRefused('not-found');
  if (event.mergedIntoId !== null) throw new EventOperationRefused('merged');
  const clash = activeEventNamed(events, shown, event.id);
  if (clash !== null) throw new EventOperationRefused('name-taken', refOf(clash));

  await tx.raceMastery.updateMany({ where: { id: event.id, userId }, data: { displayName: shown } });
  await ensureMasteryTrees(tx, userId);
  return { id: event.id, key: event.key, name: shown };
}

/** What an event operation's resync added: XP, and the event steps it unlocked. */
export interface EventResync {
  xpAwarded: number;
  stepsUnlocked: number;
}

/**
 * Bring progression in line after races moved between events: the event
 * caches, the steps (which credit before they pay), the Career Milestones
 * counted in editions, and the dates of whatever that reached. Nothing is
 * taken back here — moving a race is never a reason to.
 */
async function resyncEvents(tx: Tx, userId: string, now: Date): Promise<EventResync> {
  await ensureMasteryTrees(tx, userId, now);
  await recomputeRaceMasteries(tx, userId, now);
  const unlocks = await syncMastery(tx, userId, now);
  const { metrics, history } = await computeCareerMetricsWithHistory(userId, tx);
  const career = await syncCareerMilestones(tx, userId, { metrics, history, now });
  await fillLandmarkDates(tx, userId, { history, now });
  return {
    xpAwarded: unlocks.reduce((sum, unlock) => sum + unlock.xpAwarded, 0) + career.xpAwarded,
    stepsUnlocked: unlocks.filter((unlock) => unlock.treeKey.startsWith('event:')).length,
  };
}

/**
 * Merge one event into another. It cannot be undone.
 *
 *   1. The steps `from`'s races helped it reach are credited first.
 *   2. Its races move to `into` (their link and their key both).
 *   3. `from` is archived as merged into `into`; an event merged into `from`
 *      earlier now points straight at `into`, so no chain ever grows.
 *   4. The trees are brought up to date.
 *   5. Every step unlocked in `from` and not in `into` is carried over with
 *      its dates, and no ledger row: it was paid, if at all, where it was
 *      reached.
 *   6. Progression is resynced; only a step neither event had reached, and
 *      that editions which have not paid it before reach together, can pay.
 *
 * `from`'s tree and its unlocks stay, as landmarks. Both events must be
 * active and different.
 */
export async function mergeEvents(
  tx: Tx,
  userId: string,
  fromKey: string,
  intoKey: string,
  now: Date,
): Promise<{ racesMoved: number; stepsCarried: number }> {
  if (fromKey === intoKey) throw new EventOperationRefused('same-event');
  const events = await loadEvents(tx, userId);
  const from = events.find((row) => row.key === fromKey);
  const into = events.find((row) => row.key === intoKey);
  if (from === undefined || into === undefined) throw new EventOperationRefused('not-found');
  if (!isActive(from) || !isActive(into)) throw new EventOperationRefused('not-active');

  await writeMissingEventStepCredits(tx, userId);
  const moved = await tx.race.updateMany({
    where: { userId, OR: [{ raceMasteryId: from.id }, { iconicKey: from.key }] },
    data: { raceMasteryId: into.id, iconicKey: into.key },
  });
  await tx.raceMastery.updateMany({ where: { userId, mergedIntoId: from.id }, data: { mergedIntoId: into.id } });
  await tx.raceMastery.updateMany({ where: { id: from.id, userId }, data: { archivedAt: now, mergedIntoId: into.id } });
  await ensureMasteryTrees(tx, userId, now);
  const stepsCarried = await carryOverEventSteps(tx, userId, from.key, into.key);
  await resyncEvents(tx, userId, now);
  return { racesMoved: moved.count, stepsCarried };
}

/**
 * Link races to events, several groups at once, with one credit pass and one
 * resync. The races are the account's own (any other id is ignored), and a
 * race already in another event moves — after its steps there were credited.
 */
export async function linkRaceGroups(
  tx: Tx,
  userId: string,
  groups: readonly { key: string; raceIds: readonly string[] }[],
  now: Date,
): Promise<{ linked: number; resync: EventResync | null }> {
  const targets: { event: EventRef; raceIds: string[] }[] = [];
  for (const group of groups) {
    const event = await resolveActiveEvent(tx, userId, group.key);
    if (event === null) throw new EventOperationRefused('not-found');
    targets.push({ event, raceIds: [...new Set(group.raceIds)] });
  }

  await writeMissingEventStepCredits(tx, userId);
  let linked = 0;
  for (const target of targets) {
    if (target.raceIds.length === 0) continue;
    const result = await tx.race.updateMany({
      where: { userId, id: { in: target.raceIds } },
      data: { iconicKey: target.event.key, raceMasteryId: target.event.id },
    });
    linked += result.count;
  }
  return { linked, resync: linked > 0 ? await resyncEvents(tx, userId, now) : null };
}

/** Link the account's races to an event. Returns how many were linked. */
export async function linkRaces(
  tx: Tx,
  userId: string,
  key: string,
  raceIds: readonly string[],
  now: Date,
): Promise<number> {
  return (await linkRaceGroups(tx, userId, [{ key, raceIds }], now)).linked;
}

/**
 * Take a race out of its event. Never takes XP back: the event's figures drop
 * and its steps stay unlocked, and the steps the race helped reach are
 * credited to it first, so it cannot pay them again elsewhere.
 */
export async function unlinkRace(tx: Tx, userId: string, raceId: string, now: Date): Promise<void> {
  const race = await tx.race.findFirst({ where: { id: raceId, userId }, select: { id: true, iconicKey: true, raceMasteryId: true } });
  if (race === null) throw new EventOperationRefused('not-found');
  if (race.iconicKey === null && race.raceMasteryId === null) return;

  await writeMissingEventStepCredits(tx, userId);
  await tx.race.updateMany({ where: { id: race.id, userId }, data: { iconicKey: null, raceMasteryId: null } });
  await resyncEvents(tx, userId, now);
}

/**
 * Archive an event, or bring one back. Only an event with no races can be
 * archived ("Move or unlink its races first"); only one archived by hand can
 * come back — a merged event stays merged — and only while no other active
 * event goes by its name. Events are never deleted: archived is hidden.
 */
export async function setEventArchived(tx: Tx, userId: string, key: string, archived: boolean, now: Date): Promise<void> {
  const events = await loadEvents(tx, userId);
  const event = events.find((row) => row.key === key);
  if (event === undefined) throw new EventOperationRefused('not-found');
  if (event.mergedIntoId !== null) throw new EventOperationRefused('merged');

  if (archived) {
    if (event.archivedAt !== null) return;
    const races = await tx.race.count({ where: { userId, OR: [{ raceMasteryId: event.id }, { iconicKey: event.key }] } });
    if (races > 0) throw new EventOperationRefused('has-races');
    await tx.raceMastery.updateMany({ where: { id: event.id, userId }, data: { archivedAt: now } });
    return;
  }

  if (event.archivedAt === null) return;
  const clash = activeEventNamed(events, event.displayName ?? event.name, event.id);
  if (clash !== null) throw new EventOperationRefused('name-taken', refOf(clash));
  await tx.raceMastery.updateMany({ where: { id: event.id, userId }, data: { archivedAt: null } });
  await ensureMasteryTrees(tx, userId, now);
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

async function readDismissed(db: Tx, userId: string): Promise<Set<string>> {
  const row = await db.configOverride.findUnique({
    where: { userId_key: { userId, key: DISMISSED_SUGGESTIONS_KEY } },
    select: { value: true },
  });
  const value = row?.value;
  return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
}

/**
 * Remember that a suggestion was dismissed, so it is not offered again. The
 * most recent `EVENT_SHAPE.dismissedSuggestionLimit` are kept.
 */
export async function dismissEventSuggestion(tx: Tx, userId: string, id: string): Promise<void> {
  const dismissed = [...await readDismissed(tx, userId)].filter((known) => known !== id);
  dismissed.push(id);
  const kept = dismissed.slice(-EVENT_SHAPE.dismissedSuggestionLimit);
  await tx.configOverride.upsert({
    where: { userId_key: { userId, key: DISMISSED_SUGGESTIONS_KEY } },
    update: { value: kept },
    create: { userId, key: DISMISSED_SUGGESTIONS_KEY, value: kept },
  });
}

function associationRace(race: TimelineRaceRow): AssociationRace {
  return {
    id: race.id, name: race.name, circuitSlug: race.circuitSlug, runtimeSec: race.runtimeSec,
    championshipId: race.championshipId, eventKey: race.eventKey, raceDate: race.raceDate, seasonYear: race.seasonYear,
  };
}

/**
 * The race rows suggestions are worked out from, read straight from the
 * library: suggestions need names, circuits and lengths, not the viewing
 * history, so no replay is built for them. `inEventsAnd` narrows them to the
 * races already in events, and one more race (or none).
 */
async function loadAssociationRaces(
  userId: string,
  scope: { inEventsAnd?: string | null } = {},
): Promise<AssociationRace[]> {
  const inEvents = { iconicKey: { not: null } };
  const rows = await prisma.race.findMany({
    where: scope.inEventsAnd === undefined
      ? { userId }
      : { userId, OR: scope.inEventsAnd === null ? [inEvents] : [inEvents, { id: scope.inEventsAnd }] },
    select: {
      id: true, name: true, circuitSlug: true, runtimeSec: true, championshipId: true, iconicKey: true, raceDate: true,
      season: { select: { year: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id, name: row.name, circuitSlug: row.circuitSlug, runtimeSec: row.runtimeSec,
    championshipId: row.championshipId, eventKey: row.iconicKey, raceDate: row.raceDate, seasonYear: row.season?.year ?? null,
  }));
}

function associationEvents(events: readonly EventRow[], races: Iterable<{ eventKey: string | null }>): AssociationEvent[] {
  const members = new Map<string, number>();
  for (const race of races) {
    if (race.eventKey !== null) members.set(race.eventKey, (members.get(race.eventKey) ?? 0) + 1);
  }
  return events.map((event) => ({
    key: event.key,
    name: event.displayName ?? event.name,
    memberCount: members.get(event.key) ?? 0,
    createdAt: event.createdAt,
    active: isActive(event),
  }));
}

/**
 * Which races look like editions of which events, which unlinked races look
 * like an event of their own, and which events look like the same one — from
 * the library as it stands and the suggestions already dismissed. Worked out
 * on read; nothing is linked without a click.
 */
export async function getEventSuggestions(userId: string): Promise<EventSuggestion[]> {
  const [races, events, dismissed] = await Promise.all([
    loadAssociationRaces(userId),
    loadEvents(prisma, userId),
    readDismissed(prisma, userId),
  ]);
  return suggestEventLinks(races, associationEvents(events, races), dismissed);
}

/** A race that is not in the library yet, for matching a typed name. Never a real id. */
const TYPED_RACE_ID = '';

/**
 * The event a race being added probably belongs to, from its name and
 * circuit: the strongest suggestion that is a strong one (the same name
 * without its year), or null. Only the editions already in events are
 * compared, so it stays quick in a library of thousands.
 */
export async function suggestEventForName(userId: string, raceName: string, circuit?: string): Promise<EventRef | null> {
  if (raceName.trim() === '') return null;
  const [members, events] = await Promise.all([
    loadAssociationRaces(userId, { inEventsAnd: null }),
    loadEvents(prisma, userId),
  ]);
  const typed: AssociationRace = {
    id: TYPED_RACE_ID, name: raceName, circuitSlug: circuitSlug(circuit), runtimeSec: 0,
    championshipId: null, eventKey: null, raceDate: null, seasonYear: null,
  };
  const suggestion = suggestEventLinks([...members, typed], associationEvents(events, members), new Set())
    .find((candidate) => candidate.kind === 'link' && candidate.raceId === TYPED_RACE_ID && candidate.strength === 'strong');
  if (suggestion === undefined || suggestion.kind !== 'link') return null;
  const event = events.find((row) => row.key === suggestion.eventKey);
  return event === undefined ? null : refOf(event);
}

/**
 * The event a race in no event looks like an edition of, when the match is a
 * strong one and has not been dismissed: the race page's one-line prompt.
 * Only the races already in events are compared with it.
 */
export async function getEventSuggestionForRace(userId: string, raceId: string): Promise<(EventRef & { suggestionId: string }) | null> {
  const [races, events, dismissed] = await Promise.all([
    loadAssociationRaces(userId, { inEventsAnd: raceId }),
    loadEvents(prisma, userId),
    readDismissed(prisma, userId),
  ]);
  const race = races.find((candidate) => candidate.id === raceId);
  if (race === undefined || race.eventKey !== null) return null;
  const suggestion = suggestEventLinks(races, associationEvents(events, races), dismissed)
    .find((candidate) => candidate.kind === 'link' && candidate.raceId === raceId && candidate.strength === 'strong');
  if (suggestion === undefined || suggestion.kind !== 'link') return null;
  const event = events.find((row) => row.key === suggestion.eventKey);
  return event === undefined ? null : { ...refOf(event), suggestionId: suggestion.id };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** One edition of an event, as a moment in the career. */
export interface EditionRef {
  raceId: string;
  name: string;
  editionYear: number | null;
  at: Date;
}

interface EventFigures {
  editionsInLibrary: number;
  editionsExperienced: number;
  editionsStoryComplete: number;
  storyCompleteRaces: number;
  creditedSeconds: number;
  uniqueCoverageSeconds: number;
  rewatchSeconds: number;
  latestEditionYear: number | null;
  lastWatchedAt: Date | null;
}

/** An event's figures, from its races' replays. Editions are counted once a year. */
function eventFigures(histories: readonly RaceHistory[]): EventFigures {
  const inLibrary = new Set<string>();
  const experienced = new Set<string>();
  const complete = new Set<string>();
  const figures: EventFigures = {
    editionsInLibrary: 0, editionsExperienced: 0, editionsStoryComplete: 0, storyCompleteRaces: 0,
    creditedSeconds: 0, uniqueCoverageSeconds: 0, rewatchSeconds: 0, latestEditionYear: null, lastWatchedAt: null,
  };
  for (const history of histories) {
    const identity = editionIdentityOf(history.race.id, history.race.editionYear);
    inLibrary.add(identity);
    if (history.experiencedAt !== null) experienced.add(identity);
    if (history.storyCompletedAt !== null) {
      complete.add(identity);
      figures.storyCompleteRaces += 1;
    }
    figures.creditedSeconds += history.creditedSeconds;
    figures.uniqueCoverageSeconds += history.coverageSeconds;
    figures.rewatchSeconds += history.rewatchCreditedSeconds;
    const year = history.race.editionYear;
    if (year !== null && (figures.latestEditionYear === null || year > figures.latestEditionYear)) {
      figures.latestEditionYear = year;
    }
    if (history.lastStintAt !== null && (figures.lastWatchedAt === null || history.lastStintAt > figures.lastWatchedAt)) {
      figures.lastWatchedAt = history.lastStintAt;
    }
  }
  figures.editionsInLibrary = inLibrary.size;
  figures.editionsExperienced = experienced.size;
  figures.editionsStoryComplete = complete.size;
  figures.rewatchSeconds = Math.round(figures.rewatchSeconds);
  return figures;
}

/** Every race's replay, grouped by the event it belongs to. */
function historiesByEvent(timeline: CareerTimeline): Map<string, RaceHistory[]> {
  const byEvent = new Map<string, RaceHistory[]>();
  for (const history of timeline.races.values()) {
    const key = history.race.eventKey;
    if (key === null) continue;
    const list = byEvent.get(key);
    if (list) list.push(history);
    else byEvent.set(key, [history]);
  }
  return byEvent;
}

const FALLBACK_ACCENT = '#c8a45c';

// ---------------------------------------------------------------------------
// The Events page
// ---------------------------------------------------------------------------

export interface EventCard {
  id: string;
  key: string;
  name: string;
  href: string;
  accentColor: string;
  headline: string;
  editionsInLibrary: number;
  editionsExperienced: number;
  creditedSeconds: number;
  storyCompleteRaces: number;
  latestEditionYear: number | null;
  /** The last time any of its editions was watched, for "Recent". */
  lastWatchedAt: Date | null;
  stepsUnlocked: number;
  stepsTotal: number;
}

export interface InactiveEvent {
  key: string;
  name: string;
  href: string;
  state: 'archived' | 'merged';
  mergedInto: { key: string; name: string; href: string } | null;
}

/** A suggestion with the names the page shows. */
export type SuggestionItem =
  | {
    id: string; kind: 'link'; strength: 'strong' | 'likely'; reason: 'name' | 'name-and-circuit' | 'circuit-and-length';
    race: { id: string; name: string }; event: { key: string; name: string };
  }
  | { id: string; kind: 'create'; name: string; races: { id: string; name: string; editionYear: number | null }[] }
  | { id: string; kind: 'merge'; from: { key: string; name: string }; into: { key: string; name: string } };

export interface EventsIndexView {
  /** Active events, most watched first. */
  events: EventCard[];
  /** Events archived by hand, and events merged into another. */
  inactive: InactiveEvent[];
  suggestions: SuggestionItem[];
}

function describeSuggestions(
  suggestions: readonly EventSuggestion[],
  timeline: CareerTimeline,
  events: readonly EventRow[],
): SuggestionItem[] {
  const eventName = (key: string) => {
    const row = events.find((event) => event.key === key);
    return row === undefined ? eventDisplayName(key) : (row.displayName ?? row.name);
  };
  const items: SuggestionItem[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.kind === 'link') {
      const race = timeline.racesById.get(suggestion.raceId);
      if (race === undefined) continue;
      items.push({
        id: suggestion.id, kind: 'link', strength: suggestion.strength, reason: suggestion.reason,
        race: { id: race.id, name: race.name }, event: { key: suggestion.eventKey, name: eventName(suggestion.eventKey) },
      });
    } else if (suggestion.kind === 'create') {
      const races = suggestion.raceIds.flatMap((id) => {
        const race = timeline.racesById.get(id);
        return race === undefined ? [] : [{ id: race.id, name: race.name, editionYear: race.editionYear }];
      });
      items.push({ id: suggestion.id, kind: 'create', name: suggestion.name, races });
    } else {
      items.push({
        id: suggestion.id, kind: 'merge',
        from: { key: suggestion.fromKey, name: eventName(suggestion.fromKey) },
        into: { key: suggestion.intoKey, name: eventName(suggestion.intoKey) },
      });
    }
  }
  return items;
}

/**
 * The Events page: a card per active event, the archived and merged ones,
 * and the suggestions. One cached replay, the events, and one read of the
 * event trees' progress.
 */
export async function getEventsIndex(userId: string): Promise<EventsIndexView> {
  const [timeline, events, dismissed, trees] = await Promise.all([
    getCareerTimeline(userId),
    loadEvents(prisma, userId),
    readDismissed(prisma, userId),
    prisma.masteryTree.findMany({
      where: { userId, kind: 'RACE_EVENT' },
      select: {
        iconicKey: true, accentColor: true,
        nodes: { select: { progress: { where: { userId, unlockedAt: { not: null } }, select: { id: true } } } },
      },
    }),
  ]);

  const treeByKey = new Map(trees.flatMap((tree) => (tree.iconicKey === null ? [] : [[tree.iconicKey, tree] as const])));
  const byEvent = historiesByEvent(timeline);
  const byId = new Map(events.map((event) => [event.id, event]));

  const cards: EventCard[] = [];
  const inactive: InactiveEvent[] = [];
  for (const event of events) {
    const name = event.displayName ?? event.name;
    if (!isActive(event)) {
      const target = event.mergedIntoId === null ? undefined : byId.get(event.mergedIntoId);
      inactive.push({
        key: event.key, name, href: eventHref(event.key),
        state: event.mergedIntoId === null ? 'archived' : 'merged',
        mergedInto: target === undefined
          ? null
          : { key: target.key, name: target.displayName ?? target.name, href: eventHref(target.key) },
      });
      continue;
    }
    const figures = eventFigures(byEvent.get(event.key) ?? []);
    const tree = treeByKey.get(event.key);
    cards.push({
      id: event.id,
      key: event.key,
      name,
      href: eventHref(event.key),
      accentColor: tree?.accentColor ?? FALLBACK_ACCENT,
      headline: eventLegacyHeadline({
        name, editionsExperienced: figures.editionsExperienced,
        creditedSeconds: figures.creditedSeconds, storyCompleteRaces: figures.storyCompleteRaces,
      }),
      editionsInLibrary: figures.editionsInLibrary,
      editionsExperienced: figures.editionsExperienced,
      creditedSeconds: figures.creditedSeconds,
      storyCompleteRaces: figures.storyCompleteRaces,
      latestEditionYear: figures.latestEditionYear,
      lastWatchedAt: figures.lastWatchedAt,
      stepsUnlocked: tree?.nodes.filter((node) => node.progress.length > 0).length ?? 0,
      stepsTotal: tree?.nodes.length ?? 0,
    });
  }
  cards.sort((a, b) => b.creditedSeconds - a.creditedSeconds || a.name.localeCompare(b.name));
  inactive.sort((a, b) => a.name.localeCompare(b.name));

  const races = [...timeline.racesById.values()];
  const suggestions = suggestEventLinks(races.map(associationRace), associationEvents(events, races), dismissed);
  return { events: cards, inactive, suggestions: describeSuggestions(suggestions, timeline, events) };
}

// ---------------------------------------------------------------------------
// An event's own page
// ---------------------------------------------------------------------------

export type EditionRow =
  | {
    kind: 'edition'; raceId: string; name: string; editionYear: number | null; championshipName: string | null;
    runtimeSec: number; coverageSec: number; completionPercentText: string; storyCompletedAt: Date | null;
    creditedSeconds: number; sessions: number; isExpedition: boolean;
  }
  | { kind: 'missing'; fromYear: number; toYear: number };

export type StepGroup = 'experienced' | 'complete' | 'in-a-row' | 'hours';

export interface EventStepView {
  nodeKey: string;
  name: string;
  description: string;
  group: StepGroup;
  threshold: number;
  value: number;
  unlocked: boolean;
  /** When history says the step was reached, or when it was recorded. */
  date: Date | null;
  precision: MilestonePrecision | null;
  /** XP it paid, or pays when reached; null when it was reached without XP. */
  xp: number | null;
  /** Reached, but its editions had already paid this kind of step in another event. */
  recordedOnly: boolean;
}

export interface EventLegacyView {
  event: {
    id: string; key: string; name: string; href: string; accentColor: string;
    createdByUser: boolean; archived: boolean; mergedFrom: { key: string; name: string }[];
  };
  headline: string;
  stats: {
    editionsInLibrary: number; editionsExperienced: number; editionsStoryComplete: number; storyCompleteRaces: number;
    firstEditionWatched: EditionRef | null; mostRecentEditionWatched: EditionRef | null;
    creditedSeconds: number; uniqueCoverageSeconds: number; rewatchSeconds: number;
    longestCompleteRun: Run | null; longestExperiencedRun: Run | null;
    longestEdition: (EditionRef & { runtimeSec: number }) | null;
    highestCompletion: (EditionRef & { percentText: string }) | null;
    undatedEditions: number;
  };
  championships: { id: string; name: string; accentColor: string; editions: number }[];
  editions: EditionRow[];
  steps: EventStepView[];
}

/** Missing years in a row this long or longer are one row, not one row a year. */
const MISSING_YEARS_COLLAPSE = 5;

const STEP_GROUPS: Record<string, StepGroup> = {
  editionsExperienced: 'experienced',
  editionsStoryComplete: 'complete',
  consecutiveEditions: 'in-a-row',
  realHours: 'hours',
};
const STEP_GROUP_ORDER: readonly StepGroup[] = ['experienced', 'complete', 'in-a-row', 'hours'];

/** The rows of the edition history: newest first, the years in between that the library does not hold, undated last. */
function editionRows(histories: readonly RaceHistory[]): EditionRow[] {
  const row = (history: RaceHistory): EditionRow => ({
    kind: 'edition',
    raceId: history.race.id,
    name: history.race.name,
    editionYear: history.race.editionYear,
    championshipName: history.race.championshipName,
    runtimeSec: history.race.runtimeSec,
    coverageSec: history.coverageSeconds,
    completionPercentText: formatCoveragePercent(history.coverageSeconds, history.race.runtimeSec),
    storyCompletedAt: history.storyCompletedAt,
    creditedSeconds: history.creditedSeconds,
    sessions: history.sessionCount,
    isExpedition: isExpedition(history.race),
  });
  const byName = (a: RaceHistory, b: RaceHistory) => a.race.name.localeCompare(b.race.name) || a.race.id.localeCompare(b.race.id);

  const byYear = new Map<number, RaceHistory[]>();
  const undated: RaceHistory[] = [];
  for (const history of histories) {
    const year = history.race.editionYear;
    if (year === null) undated.push(history);
    else if (byYear.has(year)) byYear.get(year)!.push(history);
    else byYear.set(year, [history]);
  }

  const missing = new Set(missingEditionYears([...byYear.keys()]));
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const rows: EditionRow[] = [];
  if (years.length > 0) {
    for (let year = years[0]!; year >= years[years.length - 1]!; year -= 1) {
      const races = byYear.get(year);
      if (races !== undefined) {
        rows.push(...[...races].sort(byName).map(row));
        continue;
      }
      if (!missing.has(year)) continue;
      // A stretch of missing years, read from its newest year down.
      let from = year;
      while (missing.has(from - 1)) from -= 1;
      if (year - from + 1 >= MISSING_YEARS_COLLAPSE) rows.push({ kind: 'missing', fromYear: from, toYear: year });
      else for (let each = year; each >= from; each -= 1) rows.push({ kind: 'missing', fromYear: each, toYear: each });
      year = from;
    }
  }
  rows.push(...[...undated].sort(byName).map(row));
  return rows;
}

/**
 * One event's legacy page: its figures, its championships, every edition in
 * the library with the years between them it does not hold, and its steps.
 *
 * The key is looked up in the account exactly as given; an event merged into
 * another gives the survivor's address instead, and a key the account has no
 * event for gives null. Built from the cached career replay plus one read each
 * for the events, the tree and the ledger rows the steps paid.
 */
export async function getEventLegacy(userId: string, key: string): Promise<EventLegacyView | { redirectTo: string } | null> {
  const events = await loadEvents(prisma, userId);
  const event = events.find((row) => row.key === key);
  if (event === undefined) return null;
  if (event.mergedIntoId !== null) {
    const survivor = await followMerges(prisma, userId, event);
    if (survivor !== null) return { redirectTo: eventHref(survivor.key) };
  }

  const [timeline, tree] = await Promise.all([
    getCareerTimeline(userId),
    prisma.masteryTree.findFirst({
      where: { userId, kind: 'RACE_EVENT', iconicKey: event.key },
      select: {
        key: true, accentColor: true,
        nodes: {
          select: {
            key: true, name: true, description: true, metric: true, threshold: true, xpReward: true,
            progress: { where: { userId }, select: { unlockedAt: true, achievedAt: true, achievedPrecision: true } },
          },
        },
      },
    }),
  ]);
  const paid = tree === null
    ? []
    : await prisma.xPTransaction.findMany({
      where: { userId, dedupeKey: { in: tree.nodes.map((node) => `mastery:${tree.key}:${node.key}`) } },
      select: { dedupeKey: true, amount: true },
    });
  const paidByKey = new Map(paid.map((row) => [row.dedupeKey, row.amount]));

  const histories = historiesByEvent(timeline).get(event.key) ?? [];
  const figures = eventFigures(histories);
  const name = event.displayName ?? event.name;
  const watched = histories.filter((history) => history.firstStintAt !== null);

  const edition = (history: RaceHistory, at: Date): EditionRef =>
    ({ raceId: history.race.id, name: history.race.name, editionYear: history.race.editionYear, at });
  const earliest = [...watched].sort((a, b) => a.firstStintAt!.getTime() - b.firstStintAt!.getTime())[0];
  const latest = [...watched].sort((a, b) => b.lastStintAt!.getTime() - a.lastStintAt!.getTime())[0];
  const longest = [...watched].sort((a, b) => b.race.runtimeSec - a.race.runtimeSec)[0];
  // Compared as integers, as coverage is everywhere else: the fullest story, the earlier watched on a tie.
  const fullest = [...watched].sort((a, b) =>
    b.coverageSeconds * a.race.runtimeSec - a.coverageSeconds * b.race.runtimeSec
    || a.firstStintAt!.getTime() - b.firstStintAt!.getTime())[0];

  const datedYears = (keep: (history: RaceHistory) => boolean) =>
    histories.filter(keep).flatMap((history) => (history.race.editionYear === null ? [] : [history.race.editionYear]));
  const completeYears = datedYears((history) => history.storyCompletedAt !== null);
  const experiencedYears = datedYears((history) => history.experiencedAt !== null);

  const championships = new Map<string, { id: string; name: string; accentColor: string; editions: Set<string> }>();
  for (const history of histories) {
    const race = history.race;
    if (race.championshipId === null) continue;
    const entry = championships.get(race.championshipId) ?? {
      id: race.championshipId, name: race.championshipName ?? '', accentColor: race.championshipAccent ?? FALLBACK_ACCENT,
      editions: new Set<string>(),
    };
    entry.editions.add(editionIdentityOf(race.id, race.editionYear));
    championships.set(race.championshipId, entry);
  }

  const metricValues: Record<StepGroup, number> = {
    experienced: figures.editionsExperienced,
    complete: figures.editionsStoryComplete,
    'in-a-row': longestConsecutiveRun(completeYears)?.length ?? 0,
    hours: Math.round((figures.creditedSeconds / 3600) * 10) / 10,
  };
  const steps: EventStepView[] = (tree?.nodes ?? []).flatMap((node) => {
    const group = STEP_GROUPS[node.metric];
    if (group === undefined) return [];
    const progress = node.progress[0];
    const unlocked = progress !== undefined && progress.unlockedAt !== null;
    const amount = paidByKey.get(`mastery:${tree!.key}:${node.key}`);
    return [{
      nodeKey: node.key,
      name: node.name,
      description: node.description,
      group,
      threshold: node.threshold,
      value: metricValues[group],
      unlocked,
      date: unlocked ? (progress.achievedAt ?? progress.unlockedAt) : null,
      precision: unlocked ? progress.achievedPrecision : null,
      xp: unlocked ? (amount ?? null) : node.xpReward,
      recordedOnly: unlocked && amount === undefined && node.xpReward > 0,
    }];
  });
  steps.sort((a, b) =>
    STEP_GROUP_ORDER.indexOf(a.group) - STEP_GROUP_ORDER.indexOf(b.group) || a.threshold - b.threshold);

  return {
    event: {
      id: event.id,
      key: event.key,
      name,
      href: eventHref(event.key),
      accentColor: tree?.accentColor ?? FALLBACK_ACCENT,
      createdByUser: event.createdByUser === true,
      archived: event.archivedAt !== null,
      mergedFrom: events
        .filter((row) => row.mergedIntoId === event.id)
        .map((row) => ({ key: row.key, name: row.displayName ?? row.name })),
    },
    headline: eventLegacyHeadline({
      name, editionsExperienced: figures.editionsExperienced,
      creditedSeconds: figures.creditedSeconds, storyCompleteRaces: figures.storyCompleteRaces,
    }),
    stats: {
      editionsInLibrary: figures.editionsInLibrary,
      editionsExperienced: figures.editionsExperienced,
      editionsStoryComplete: figures.editionsStoryComplete,
      storyCompleteRaces: figures.storyCompleteRaces,
      firstEditionWatched: earliest === undefined ? null : edition(earliest, earliest.firstStintAt!),
      mostRecentEditionWatched: latest === undefined ? null : edition(latest, latest.lastStintAt!),
      creditedSeconds: figures.creditedSeconds,
      uniqueCoverageSeconds: figures.uniqueCoverageSeconds,
      rewatchSeconds: figures.rewatchSeconds,
      longestCompleteRun: longestConsecutiveRun(completeYears),
      longestExperiencedRun: longestConsecutiveRun(experiencedYears),
      longestEdition: longest === undefined
        ? null
        : { ...edition(longest, longest.firstStintAt!), runtimeSec: longest.race.runtimeSec },
      highestCompletion: fullest === undefined
        ? null
        : {
          ...edition(fullest, fullest.lastStintAt!),
          percentText: formatCoveragePercent(fullest.coverageSeconds, fullest.race.runtimeSec),
        },
      undatedEditions: histories.filter((history) => history.race.editionYear === null).length,
    },
    championships: [...championships.values()]
      .map((entry) => ({ id: entry.id, name: entry.name, accentColor: entry.accentColor, editions: entry.editions.size }))
      .sort((a, b) => b.editions - a.editions || a.name.localeCompare(b.name)),
    editions: editionRows(histories),
    steps,
  };
}

/** A race that can be added to an event, for the "Add races" dialog. */
export interface LinkableRace {
  id: string;
  name: string;
  editionYear: number | null;
  championshipName: string | null;
  /** Why it is offered first, when it is. */
  suggested: 'strong' | 'likely' | null;
}

/**
 * The account's races in no event that could be added to this one: the ones
 * that look like its editions first, then the most recently watched, then
 * the rest by name, filtered by a search of the name and circuit, at most
 * `CAREER_STATS_SHAPE.addRacesDialogLimit` at a time — so the dialog works for
 * a library of thousands.
 */
export async function findRacesToLink(userId: string, key: string, query = ''): Promise<LinkableRace[]> {
  const [timeline, events] = await Promise.all([getCareerTimeline(userId), loadEvents(prisma, userId)]);
  const event = events.find((row) => row.key === key && isActive(row));
  if (event === undefined) return [];

  const all = [...timeline.racesById.values()];
  const members = all.filter((race) => race.eventKey === event.key);
  const unlinked = all.filter((race) => race.eventKey === null);
  const strength = new Map<string, 'strong' | 'likely'>();
  for (const suggestion of suggestEventLinks(
    [...members, ...unlinked].map(associationRace),
    associationEvents([event], members),
    new Set(),
  )) {
    if (suggestion.kind === 'link') strength.set(suggestion.raceId, suggestion.strength);
  }

  const needle = query.trim().toLowerCase();
  const rank = (race: TimelineRaceRow) => (strength.get(race.id) === 'strong' ? 0 : strength.has(race.id) ? 1 : 2);
  const lastWatched = (race: TimelineRaceRow) => timeline.races.get(race.id)?.lastStintAt?.getTime() ?? -Infinity;
  return unlinked
    .filter((race) => needle === ''
      || race.name.toLowerCase().includes(needle)
      || (race.circuit ?? '').toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || lastWatched(b) - lastWatched(a) || a.name.localeCompare(b.name))
    .slice(0, CAREER_STATS_SHAPE.addRacesDialogLimit)
    .map((race) => ({
      id: race.id,
      name: race.name,
      editionYear: race.editionYear,
      championshipName: race.championshipName,
      suggested: strength.get(race.id) ?? null,
    }));
}
