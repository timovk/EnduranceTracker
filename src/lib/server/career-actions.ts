'use server';

/**
 * Server actions for the career's history (0.4.0): recurring events.
 *
 * The same rules as `actions.ts`: the signed-in account is resolved before
 * anything the browser sent is looked at, every key and race id is resolved
 * inside that account by the engine, the write happens in one transaction,
 * and the replay cache is cleared once it has committed. A refusal comes back
 * as one plain sentence.
 */

import { revalidatePath } from 'next/cache';
import { prisma, type Tx } from '@/lib/db/client';
import { requireUserId } from '@/lib/auth/session';
import { clearCareerTimelineCache } from '@/lib/engines/career-timeline-engine';
import {
  createEvent, dismissEventSuggestion, EventOperationRefused, findRacesToLink, getEventSuggestions, linkRaceGroups,
  mergeEvents, renameEvent, setEventArchived, suggestEventForName, unlinkRace,
  type EventRef, type EventRefusalReason, type LinkableRace,
} from '@/lib/engines/event-legacy-engine';
import { eventHref } from '@/lib/engines/mastery-engine';
import {
  eventKeySchema, eventNameSchema, eventSuggestionIdSchema, raceIdsSchema,
} from '@/lib/validation/schemas';
import type { ActionResult } from './actions';

/** Event operations re-sync mastery and milestones, so they get a stint's generous limits. */
const EVENT_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/** What an event operation's refusal says, in the application's voice. */
function refusalMessage(reason: EventRefusalReason, existing: EventRef | null): string {
  switch (reason) {
    case 'name-taken':
      return existing === null ? 'You already follow an event with that name.' : `You already follow ${existing.name}.`;
    case 'invalid-name':
      return 'Give the event a name of up to 80 characters.';
    case 'same-event':
      return 'Pick a different event to combine it with.';
    case 'not-active':
      return 'Only events in your list can be combined.';
    case 'merged':
      return 'That event was combined into another one, and stays part of it.';
    case 'has-races':
      return 'Move or unlink its races first.';
    case 'not-found':
    default:
      return 'That event is no longer in your list.';
  }
}

/** An operation that was refused: its sentence, and the event it points to when there is one. */
type Refusal = { ok: false; message: string; existing: EventLink | null };

/** Run an event operation in its transaction; a refusal becomes a sentence, anything else is a real fault. */
async function attempt<T>(work: (tx: Tx) => Promise<T>): Promise<{ ok: true; value: T } | Refusal> {
  try {
    const value = await prisma.$transaction((tx) => work(tx as Tx), EVENT_TRANSACTION);
    return { ok: true, value };
  } catch (error) {
    if (!(error instanceof EventOperationRefused)) throw error;
    return {
      ok: false,
      message: refusalMessage(error.reason, error.existing),
      existing: error.existing === null ? null : linkOf(error.existing),
    };
  }
}

/** A refusal as an action result. */
function refusal(result: Refusal): { ok: false; message: string } {
  return { ok: false, message: result.message };
}

/** After an event write: the replay cache, and every page that shows events or what they paid. */
function afterEventWrite(userId: string, keys: readonly string[] = []): void {
  clearCareerTimelineCache(userId);
  for (const path of ['/events', '/mastery', '/races', '/career', '/career/milestones', '/', '/achievements', '/stats', '/chronicle']) {
    revalidatePath(path);
  }
  for (const key of keys) revalidatePath(eventHref(key));
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return value === null ? '' : String(value);
}

type EventLink = { key: string; name: string; href: string };

function linkOf(event: EventRef): EventLink {
  return { key: event.key, name: event.name, href: eventHref(event.key) };
}

/**
 * Create an event from the Events page. With `raceIds` — the races of a
 * "create" suggestion — they become its first editions in the same step.
 * An event already going by the name is never duplicated: the answer names
 * it instead.
 */
export async function createEventAction(
  form: FormData,
): Promise<ActionResult<{ event?: EventLink; existing?: EventLink }>> {
  const userId = await requireUserId();
  const name = eventNameSchema.safeParse(formText(form, 'name'));
  if (!name.success) return { ok: false, message: 'Give the event a name of up to 80 characters.' };
  const raceIds = form.getAll('raceIds').map(String);
  const races = raceIds.length === 0 ? null : raceIdsSchema.safeParse(raceIds);
  if (races !== null && !races.success) return { ok: false, message: 'Those races could not be read.' };

  const now = new Date();
  const result = await attempt(async (tx) => {
    const created = await createEvent(tx, userId, name.data, now);
    if (created.ok && races !== null) {
      await linkRaceGroups(tx, userId, [{ key: created.event.key, raceIds: races.data }], now);
    }
    return created;
  });
  if (!result.ok) return refusal(result);
  if (!result.value.ok) {
    const existing = linkOf(result.value.existing);
    return { ok: false, message: `You already follow ${existing.name}.`, data: { existing } };
  }

  const event = linkOf(result.value.event);
  afterEventWrite(userId, [event.key]);
  return { ok: true, message: `${event.name} is in your events.`, data: { event } };
}

/** Give an event a name of its own. Its key and everything it reached stay as they are. */
export async function renameEventAction(form: FormData): Promise<ActionResult<{ event?: EventLink; existing?: EventLink }>> {
  const userId = await requireUserId();
  const key = eventKeySchema.safeParse(formText(form, 'key'));
  const name = eventNameSchema.safeParse(formText(form, 'name'));
  if (!key.success) return { ok: false, message: refusalMessage('not-found', null) };
  if (!name.success) return { ok: false, message: 'Give the event a name of up to 80 characters.' };

  const result = await attempt((tx) => renameEvent(tx, userId, key.data, name.data));
  if (!result.ok) {
    return result.existing === null ? refusal(result) : { ok: false, message: result.message, data: { existing: result.existing } };
  }
  afterEventWrite(userId, [key.data]);
  return { ok: true, message: `Renamed to ${result.value.name}. Nothing it reached has changed.`, data: { event: linkOf(result.value) } };
}

/** Combine one event into another. It cannot be undone, and nothing is paid twice. */
export async function mergeEventsAction(
  fromKey: string,
  intoKey: string,
): Promise<ActionResult<{ into: EventLink; racesMoved: number; stepsCarried: number }>> {
  const userId = await requireUserId();
  const from = eventKeySchema.safeParse(fromKey);
  const into = eventKeySchema.safeParse(intoKey);
  if (!from.success || !into.success) return { ok: false, message: refusalMessage('not-found', null) };

  const result = await attempt((tx) => mergeEvents(tx, userId, from.data, into.data, new Date()));
  if (!result.ok) return refusal(result);
  afterEventWrite(userId, [from.data, into.data]);
  const target = await prisma.raceMastery.findFirst({
    where: { userId, key: into.data },
    select: { key: true, name: true, displayName: true },
  });
  const intoLink: EventLink = target === null
    ? { key: into.data, name: into.data, href: eventHref(into.data) }
    : { key: target.key, name: target.displayName ?? target.name, href: eventHref(target.key) };
  const { racesMoved, stepsCarried } = result.value;
  return {
    ok: true,
    message: `Combined into ${intoLink.name}: ${racesMoved} ${racesMoved === 1 ? 'race' : 'races'} moved. Nothing was paid twice.`,
    data: { into: intoLink, racesMoved, stepsCarried },
  };
}

/** Add races to an event as editions of it. */
export async function linkRacesToEventAction(key: string, raceIds: string[]): Promise<ActionResult<{ linked: number }>> {
  const userId = await requireUserId();
  const event = eventKeySchema.safeParse(key);
  const races = raceIdsSchema.safeParse(raceIds);
  if (!event.success) return { ok: false, message: refusalMessage('not-found', null) };
  if (!races.success) return { ok: false, message: 'Pick at least one race.' };

  const result = await attempt((tx) => linkRaceGroups(tx, userId, [{ key: event.data, raceIds: races.data }], new Date()));
  if (!result.ok) return refusal(result);
  const { linked } = result.value;
  if (linked === 0) return { ok: false, message: 'Those races are no longer in the library.' };
  afterEventWrite(userId, [event.data]);
  return {
    ok: true,
    message: linked === 1 ? 'The race is now an edition of this event.' : `${linked} races are now editions of this event.`,
    data: { linked },
  };
}

/**
 * Link every strong suggestion the user confirmed, in one step. The
 * suggestions are worked out again here, and only those still strong links
 * and still in the confirmed list are applied.
 */
export async function linkStrongSuggestionsAction(suggestionIds: string[]): Promise<ActionResult<{ linked: number }>> {
  const userId = await requireUserId();
  const confirmed = new Set(suggestionIds.filter((id) => eventSuggestionIdSchema.safeParse(id).success));
  const suggestions = await getEventSuggestions(userId);
  const groups = new Map<string, string[]>();
  for (const suggestion of suggestions) {
    if (suggestion.kind !== 'link' || suggestion.strength !== 'strong' || !confirmed.has(suggestion.id)) continue;
    const list = groups.get(suggestion.eventKey) ?? [];
    list.push(suggestion.raceId);
    groups.set(suggestion.eventKey, list);
  }
  if (groups.size === 0) return { ok: false, message: 'Those suggestions have changed since the page was drawn.' };

  const result = await attempt((tx) =>
    linkRaceGroups(tx, userId, [...groups].map(([key, raceIds]) => ({ key, raceIds })), new Date()));
  if (!result.ok) return refusal(result);
  const { linked } = result.value;
  afterEventWrite(userId, [...groups.keys()]);
  return { ok: true, message: `${linked} ${linked === 1 ? 'race is' : 'races are'} now linked to their events.`, data: { linked } };
}

/** Take a race out of its event. Nothing it helped reach is taken back. */
export async function unlinkRaceFromEventAction(raceId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const race = raceIdsSchema.safeParse([raceId]);
  if (!race.success) return { ok: false, message: 'That race is no longer in the library.' };

  // Looked up inside the account first, so another career's race id reads as gone.
  const previous = await prisma.race.findFirst({ where: { id: raceId, userId }, select: { iconicKey: true } });
  if (previous === null) return { ok: false, message: 'That race is no longer in the library.' };
  const result = await attempt((tx) => unlinkRace(tx, userId, raceId, new Date()));
  if (!result.ok) return refusal(result);
  afterEventWrite(userId, previous.iconicKey === null ? [] : [previous.iconicKey]);
  revalidatePath(`/races/${raceId}`);
  return { ok: true, message: 'The race is no longer an edition of this event. Every step it reached stays.' };
}

/** Archive an event with no races, or bring one back. */
export async function setEventArchivedAction(key: string, archived: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  const event = eventKeySchema.safeParse(key);
  if (!event.success) return { ok: false, message: refusalMessage('not-found', null) };

  const result = await attempt((tx) => setEventArchived(tx, userId, event.data, archived, new Date()));
  if (!result.ok) return refusal(result);
  afterEventWrite(userId, [event.data]);
  return { ok: true, message: archived ? 'Archived. It is kept, out of the way.' : 'Back in your events.' };
}

/** Stop offering a suggestion. */
export async function dismissEventSuggestionAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = eventSuggestionIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'That suggestion could not be read.' };

  await prisma.$transaction((tx) => dismissEventSuggestion(tx as Tx, userId, parsed.data));
  revalidatePath('/events');
  return { ok: true };
}

/** The event a race being added looks like an edition of, for the Add Race form. Reads only. */
export async function suggestEventForNameAction(name: string, circuit?: string): Promise<EventLink | null> {
  const userId = await requireUserId();
  const raceName = name.trim().slice(0, 160);
  if (raceName === '') return null;
  const event = await suggestEventForName(userId, raceName, circuit?.trim().slice(0, 120));
  return event === null ? null : linkOf(event);
}

/** The races the "Add races" dialog offers for a search. Reads only. */
export async function findRacesToLinkAction(key: string, query: string): Promise<LinkableRace[]> {
  const userId = await requireUserId();
  const event = eventKeySchema.safeParse(key);
  if (!event.success) return [];
  return findRacesToLink(userId, event.data, query.slice(0, 120));
}
