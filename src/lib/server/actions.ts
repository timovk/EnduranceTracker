'use server';

/**
 * Server actions.
 *
 * Everything that mutates goes through here: validate with zod, call the
 * engine that owns the write, then revalidate the affected routes. No engine
 * is ever called from a component directly, and no component is trusted to
 * have validated anything.
 *
 * Every action resolves the signed-in account first, before it looks at
 * anything the client sent. An account id is never a parameter: one that
 * arrived from the browser would be a request to act as somebody else. Where
 * an action is handed an entity id — a race, a championship — that id is
 * checked against the caller before it is written through, so a uuid belonging
 * to another career reads as gone rather than as something to edit.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/client';
import type { Tx } from '@/lib/db/client';
import { requireUserId } from '@/lib/auth/session';
import {
  championshipInputSchema, raceInputSchema, raceUpdateSchema, restWeekSchema,
  seasonInputSchema, sessionDeleteSchema, sessionInputSchema, settingsSchema,
} from '@/lib/validation/schemas';
import { circuitSlug, rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { clearCareerTimelineCache } from '@/lib/engines/career-timeline-engine';
import type { RaceEditResync } from '@/lib/engines/progression-resync';
import { raceRemovedNotice } from '@/lib/copy/tone';
import { formatTimestamp } from '@/lib/domain/time';
import { formatNumber } from '@/lib/utils';
import { championshipSlug, ensureCareer, ensureChampionshipPresets } from './bootstrap';
import { DISPLAY_TITLE_KEY, getCosmeticState, isChoosable, type CosmeticKind } from './cosmetics';
import { rememberStintEntryMode } from './preferences';
import { isStintEntryMode } from '@/lib/domain/race-clock';

export interface ActionResult<T = undefined> {
  ok: boolean;
  /** A single sentence, written in the application's voice. Never scolding. */
  message?: string;
  /** Field-level messages for inline display. */
  errors?: Record<string, string>;
  data?: T;
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function formValue(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

function raceFormToObject(form: FormData) {
  return {
    name: formValue(form, 'name') ?? '',
    championshipId: formValue(form, 'championshipId') ?? null,
    newChampionshipName: formValue(form, 'newChampionshipName'),
    seasonYear: formValue(form, 'seasonYear') ?? null,
    plannedRaceCount: formValue(form, 'plannedRaceCount') ?? null,
    circuit: formValue(form, 'circuit'),
    country: formValue(form, 'country'),
    raceDate: formValue(form, 'raceDate') ?? null,
    raceType: formValue(form, 'raceType') ?? 'H6',
    scheduledDuration: formValue(form, 'scheduledDuration') ?? '',
    actualDuration: formValue(form, 'actualDuration') ?? null,
    priority: formValue(form, 'priority') ?? 'NORMAL',
    excitement: formValue(form, 'excitement') ?? '3',
    status: formValue(form, 'status') ?? 'UNWATCHED',
    isMajorEvent: form.get('isMajorEvent') === 'on' || form.get('isMajorEvent') === 'true',
    eventKey: formValue(form, 'eventKey'),
    newEventName: formValue(form, 'newEventName'),
    iconicKey: formValue(form, 'iconicKey'),
    notes: formValue(form, 'notes'),
    replayUrl: formValue(form, 'replayUrl') ?? '',
    posterUrl: formValue(form, 'posterUrl') ?? '',
  };
}

/**
 * The interactive transaction for an edit that re-syncs progression: the
 * default five seconds is far too short for mastery, metrics and achievements
 * on a long career. The same generous limits as logging a stint.
 */
const EDIT_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

/**
 * Whether the form says which event the race belongs to. The race forms
 * always do — "None" is a choice — and a caller that sends none of the event
 * fields leaves the race where it is: saving with "Major event" off no longer
 * takes a race out of its event (0.4.0).
 */
function formChoosesEvent(form: FormData): boolean {
  return form.has('eventKey') || form.has('newEventName') || form.has('iconicKey');
}

/**
 * "New event…" chosen and no name typed. Refused rather than read as "None",
 * which would quietly take the race out of its event and still say "Saved.".
 */
function unnamedNewEvent(form: FormData): ActionResult<{ id: string }> | null {
  if (!form.has('newEventName') || formValue(form, 'newEventName') !== undefined) return null;
  return { ok: false, message: 'A couple of fields need a second look.', errors: { newEventName: 'Give the new event a name.' } };
}

/** The event fields as the event engine reads them; the 0.3.x `iconicKey` stands in for a missing `eventKey`. */
function eventInput(input: { eventKey?: string; newEventName?: string; iconicKey?: string }) {
  return { eventKey: input.eventKey ?? input.iconicKey, newEventName: input.newEventName };
}

export async function createRaceAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const parsed = raceInputSchema.safeParse(raceFormToObject(form));
  if (!parsed.success) {
    return { ok: false, message: 'A couple of fields need a second look.', errors: fieldErrors(parsed.error.issues) };
  }

  const unnamed = unnamedNewEvent(form);
  if (unnamed !== null) return unnamed;

  const input = parsed.data;
  const now = new Date();
  const { resolveEventForRaceInput } = await import('@/lib/engines/event-legacy-engine');
  const race = await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const { championshipId, seasonId } = await resolveChampionshipAndSeason(db, userId, input);
    // The event the form chose, or named: an event already going by a typed
    // name is reused rather than duplicated.
    const event = await resolveEventForRaceInput(db, userId, eventInput(input), now);

    return db.race.create({
      data: {
        userId,
        name: input.name,
        championshipId,
        seasonId,
        circuit: input.circuit ?? null,
        circuitSlug: circuitSlug(input.circuit),
        country: input.country ?? null,
        raceDate: input.raceDate,
        raceType: input.raceType,
        scheduledDurationSec: input.scheduledDuration,
        actualDurationSec: input.actualDuration,
        // Kept in sync so every query has one authoritative runtime to work with.
        runtimeSec: input.actualDuration ?? input.scheduledDuration,
        priority: input.priority,
        excitement: input.excitement,
        status: input.status,
        isMajorEvent: input.isMajorEvent,
        iconicKey: event?.key ?? null,
        raceMasteryId: event?.id ?? null,
        notes: input.notes ?? null,
        replayUrl: input.replayUrl ?? null,
        posterUrl: input.posterUrl ?? null,
      },
      select: { id: true },
    });
  }, EDIT_TRANSACTION);

  clearCareerTimelineCache(userId);
  revalidatePath('/races');
  revalidatePath('/');
  revalidatePath('/collections');
  revalidatePath('/events');
  revalidatePath('/mastery');
  return { ok: true, data: { id: race.id }, message: `${input.name} is in the library.` };
}

export async function updateRaceAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const parsed = raceUpdateSchema.safeParse({
    ...raceFormToObject(form),
    id: formValue(form, 'id') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, message: 'A couple of fields need a second look.', errors: fieldErrors(parsed.error.issues) };
  }

  const unnamed = unnamedNewEvent(form);
  if (unnamed !== null) return unnamed;

  const input = parsed.data;
  const now = new Date();
  const choosesEvent = formChoosesEvent(form);
  const { resyncAfterRaceEdit } = await import('@/lib/engines/progression-resync');
  const { resolveEventForRaceInput } = await import('@/lib/engines/event-legacy-engine');
  const { writeMissingEventStepCredits } = await import('@/lib/engines/mastery-engine');
  const updated = await prisma.$transaction(async (tx) => {
    const db = tx as Tx;

    // The race id came from the form. Ownership is established inside the same
    // transaction as the write, so there is no window in which it could change
    // between the two.
    const owned = await db.race.findFirst({
      where: { id: input.id, userId },
      select: { id: true, runtimeSec: true, iconicKey: true, raceMasteryId: true },
    });
    if (owned === null) return null;

    const { championshipId, seasonId } = await resolveChampionshipAndSeason(db, userId, input);
    const runtimeSec = input.actualDuration ?? input.scheduledDuration;

    // The race's event. When it changes, the steps the race helped its
    // current event reach are credited to it first, so moving it can never
    // pay them again (§4.2.5).
    const event = choosesEvent
      ? await resolveEventForRaceInput(db, userId, eventInput(input), now)
      : undefined;
    const link = event === undefined
      ? { iconicKey: owned.iconicKey, raceMasteryId: owned.raceMasteryId }
      : { iconicKey: event?.key ?? null, raceMasteryId: event?.id ?? null };
    if (link.iconicKey !== owned.iconicKey) await writeMissingEventStepCredits(db, userId);

    await db.race.update({
      where: { id: input.id },
      data: {
        name: input.name,
        championshipId,
        seasonId,
        circuit: input.circuit ?? null,
        circuitSlug: circuitSlug(input.circuit),
        country: input.country ?? null,
        raceDate: input.raceDate,
        raceType: input.raceType,
        scheduledDurationSec: input.scheduledDuration,
        actualDurationSec: input.actualDuration,
        runtimeSec,
        priority: input.priority,
        excitement: input.excitement,
        isMajorEvent: input.isMajorEvent,
        ...link,
        notes: input.notes ?? null,
        replayUrl: input.replayUrl ?? null,
        posterUrl: input.posterUrl ?? null,
      },
    });

    // Changing the runtime changes what "complete" means: the coverage is
    // rebuilt against the new length, so timeline past a shortened end stops
    // counting, and the aggregates follow it.
    const runtimeChanged = runtimeSec !== owned.runtimeSec;
    if (runtimeChanged) await rebuildRaceIntervals(db, input.id);
    await recomputeRaceAggregates(db, input.id, now);

    // Then progression: balances follow the edit at once, landmarks only when
    // the runtime did not change (`resyncAfterRaceEdit`).
    const resync = await resyncAfterRaceEdit(db, userId, input.id, now, { runtimeChanged });
    return { runtimeSec, runtimeChanged, resync };
  }, EDIT_TRANSACTION);

  if (updated === null) return { ok: false, message: 'That race is no longer in the library.' };

  clearCareerTimelineCache(userId);
  revalidatePathsAfterSession(input.id);
  return { ok: true, data: { id: input.id }, message: raceSavedMessage(updated) };
}

/** What saving a race changed, in a sentence or two. Plain "Saved." when it changed no XP. */
function raceSavedMessage(saved: { runtimeSec: number; runtimeChanged: boolean; resync: RaceEditResync }): string {
  const { resync } = saved;
  const sentences = ['Saved.'];
  if (resync.storyBonus.revoked > 0) {
    sentences.push(
      saved.runtimeChanged
        ? `The Story Complete bonus came off because the race now runs to ${formatTimestamp(saved.runtimeSec)}.`
        : 'The Story Complete bonus came off because the race is no longer a complete story.',
    );
  }
  if (resync.storyBonus.awarded > 0) {
    sentences.push(
      `At ${formatTimestamp(saved.runtimeSec)} the race is a complete story, ` +
        `so its Story Complete bonus of ${formatNumber(resync.storyBonus.awarded)} XP was added.`,
    );
  }
  const unlocked = resync.xpAwarded - resync.storyBonus.awarded;
  if (unlocked > 0) sentences.push(`The change also earned ${formatNumber(unlocked)} XP.`);
  return sentences.join(' ');
}

/**
 * Resolve (or create) the championship and season a race belongs to.
 *
 * The Add Race form can create a championship inline, because being made to
 * leave the form to create one first would be tedious.
 */
async function resolveChampionshipAndSeason(
  db: Tx,
  userId: string,
  input: { championshipId: string | null; newChampionshipName?: string; seasonYear: number | null; plannedRaceCount: number | null },
): Promise<{ championshipId: string | null; seasonId: string | null }> {
  let championshipId = input.championshipId;

  // The form supplies this id, and a ChampionshipSeason is owned through its
  // championship rather than directly — so an id from another career has to be
  // dropped here or the season upsert below would write into it. A race with no
  // championship is a perfectly ordinary race, so this degrades rather than
  // refusing.
  if (championshipId !== null) {
    const owned = await db.championship.findFirst({ where: { id: championshipId, userId }, select: { id: true } });
    if (owned === null) championshipId = null;
  }

  if (!championshipId && input.newChampionshipName) {
    const slug = championshipSlug(input.newChampionshipName);
    const championship = await db.championship.upsert({
      where: { userId_slug: { userId, slug } },
      update: {},
      create: { userId, slug, name: input.newChampionshipName, isCustom: true },
      select: { id: true },
    });
    championshipId = championship.id;
  }

  if (!championshipId || input.seasonYear === null) {
    return { championshipId, seasonId: null };
  }

  const season = await db.championshipSeason.upsert({
    where: { championshipId_year: { championshipId, year: input.seasonYear } },
    update: input.plannedRaceCount !== null ? { plannedRaceCount: input.plannedRaceCount } : {},
    create: {
      championshipId,
      year: input.seasonYear,
      plannedRaceCount: input.plannedRaceCount,
    },
    select: { id: true },
  });

  return { championshipId, seasonId: season.id };
}

export async function setRaceStatusAction(raceId: string, status: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const allowed = ['UNWATCHED', 'QUEUED', 'WATCHING', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED'] as const;
  if (!allowed.includes(status as (typeof allowed)[number])) {
    return { ok: false, message: 'That status is not one of the options.' };
  }

  // updateMany rather than update: the userId in the `where` is what makes
  // another account's race id a no-op instead of an edit.
  const { count } = await prisma.race.updateMany({
    where: { id: raceId, userId },
    data: { status: status as (typeof allowed)[number] },
  });
  if (count === 0) return { ok: false, message: 'That race is no longer in the library.' };

  clearCareerTimelineCache(userId);
  revalidatePath(`/races/${raceId}`);
  revalidatePath('/races');
  return { ok: true };
}

/**
 * Remove a race, and the XP it earned with it (owner decision D4). The race is
 * looked up inside the signed-in account by the engine, so another career's
 * race id reads as already gone.
 */
export async function deleteRaceAction(
  raceId: string,
): Promise<ActionResult<{ raceName: string; xpRemoved: number }>> {
  const userId = await requireUserId();
  const { deleteRace } = await import('@/lib/engines/session-engine');
  const removal = await deleteRace(userId, raceId, new Date());
  if (removal === null) return { ok: false, message: 'That race is no longer in the library.' };

  clearCareerTimelineCache(userId);
  for (const path of [
    '/races', '/', '/collections', '/chronicle', '/events', '/career', '/stats', '/career/milestones',
    '/mastery', '/hall-of-fame',
  ]) {
    revalidatePath(path);
  }
  return {
    ok: true,
    message: raceRemovedNotice(removal.raceName, removal.careerXpRemoved),
    data: { raceName: removal.raceName, xpRemoved: removal.careerXpRemoved },
  };
}

// ---------------------------------------------------------------------------
// Viewing sessions
// ---------------------------------------------------------------------------

export async function logSessionAction(form: FormData): Promise<ActionResult<{ sessionId: string; raceId: string }>> {
  const userId = await requireUserId();
  const parsed = sessionInputSchema.safeParse({
    raceId: formValue(form, 'raceId') ?? '',
    mode: formValue(form, 'mode') ?? 'RANGE',
    startTimestamp: formValue(form, 'startTimestamp') ?? '0',
    endTimestamp: formValue(form, 'endTimestamp'),
    realMinutes: formValue(form, 'realMinutes'),
    playbackSpeed: formValue(form, 'playbackSpeed') ?? '1',
    watchedAt: formValue(form, 'watchedAt') ?? null,
    note: formValue(form, 'note'),
  });

  if (!parsed.success) {
    return { ok: false, message: 'That stint could not be read.', errors: fieldErrors(parsed.error.issues) };
  }

  const { InvalidStintError, logViewingSession } = await import('@/lib/engines/session-engine');
  let outcome: Awaited<ReturnType<typeof logViewingSession>>;
  try {
    outcome = await logViewingSession(userId, parsed.data);
  } catch (error) {
    if (error instanceof InvalidStintError) {
      return { ok: false, message: 'That stint is dated in the future, so it was not logged.' };
    }
    throw error;
  }
  clearCareerTimelineCache(userId);

  // The way this stint was typed becomes the default for the next one. Only
  // after the stint is safely logged: a preference is not worth failing a
  // write over, and a failed write has not earned remembering.
  const entryMode = formValue(form, 'entryMode');
  if (isStintEntryMode(entryMode)) {
    await rememberStintEntryMode(userId, entryMode).catch(() => undefined);
  }

  revalidatePathsAfterSession(outcome.raceId);
  return { ok: true, data: { sessionId: outcome.sessionId, raceId: outcome.raceId } };
}

export async function deleteSessionAction(sessionId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = sessionDeleteSchema.safeParse({ sessionId });
  if (!parsed.success) return { ok: false, message: 'That session could not be found.' };

  const session = await prisma.raceViewingSession.findFirst({
    where: { id: sessionId, userId },
    select: { raceId: true },
  });
  if (!session) return { ok: false, message: 'That session is no longer recorded.' };

  const { deleteViewingSession } = await import('@/lib/engines/session-engine');
  const removal = await deleteViewingSession(userId, sessionId);
  clearCareerTimelineCache(userId);

  revalidatePathsAfterSession(session.raceId);
  return {
    ok: true,
    // Said plainly: XP follows the data, so what the stint earned went with it.
    message: removal.careerXpRemoved > 0
      ? `Stint removed. ${formatNumber(removal.careerXpRemoved)} XP came off with it; coverage has been recalculated.`
      : 'Stint removed. Coverage has been recalculated.',
  };
}

function revalidatePathsAfterSession(raceId: string): void {
  for (const path of [
    '/', '/races', `/races/${raceId}`, '/planner', '/budget', '/career', '/challenges', '/season-pass', '/mastery',
    '/collections', '/achievements', '/stats', '/trophies', '/hall-of-fame',
    '/chronicle', '/events', '/career/milestones', `/races/${raceId}/expedition`,
  ]) {
    revalidatePath(path);
  }
}

// ---------------------------------------------------------------------------
// Championships and seasons
// ---------------------------------------------------------------------------

export async function createChampionshipAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const parsed = championshipInputSchema.safeParse({
    name: formValue(form, 'name') ?? '',
    shortName: formValue(form, 'shortName'),
    accentColor: formValue(form, 'accentColor') ?? '#c8a45c',
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check the championship details.' };
  }

  const championship = await prisma.championship.upsert({
    where: { userId_slug: { userId, slug: championshipSlug(parsed.data.name) } },
    update: { name: parsed.data.name, shortName: parsed.data.shortName ?? null, accentColor: parsed.data.accentColor },
    create: {
      userId,
      slug: championshipSlug(parsed.data.name),
      name: parsed.data.name,
      shortName: parsed.data.shortName ?? null,
      accentColor: parsed.data.accentColor,
      isCustom: true,
    },
    select: { id: true },
  });

  clearCareerTimelineCache(userId);
  revalidatePath('/races');
  revalidatePath('/mastery');
  return { ok: true, data: championship, message: `${parsed.data.name} added.` };
}

export async function upsertSeasonAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = seasonInputSchema.safeParse({
    championshipId: formValue(form, 'championshipId') ?? '',
    year: formValue(form, 'year') ?? '',
    label: formValue(form, 'label'),
    plannedRaceCount: formValue(form, 'plannedRaceCount') ?? null,
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check the season details.' };
  }

  // A season has no userId of its own — it belongs to a championship — so the
  // championship is what establishes whose season this is.
  const championship = await prisma.championship.findFirst({
    where: { id: parsed.data.championshipId, userId },
    select: { id: true },
  });
  if (!championship) return { ok: false, message: 'That championship is no longer in the library.' };

  await prisma.championshipSeason.upsert({
    where: { championshipId_year: { championshipId: parsed.data.championshipId, year: parsed.data.year } },
    update: { label: parsed.data.label ?? null, plannedRaceCount: parsed.data.plannedRaceCount },
    create: {
      championshipId: parsed.data.championshipId,
      year: parsed.data.year,
      label: parsed.data.label ?? null,
      plannedRaceCount: parsed.data.plannedRaceCount,
    },
  });

  clearCareerTimelineCache(userId);
  revalidatePath('/collections');
  revalidatePath('/races');
  return { ok: true, message: 'Season saved.' };
}

export async function seedPresetChampionshipsAction(): Promise<ActionResult<{ created: number }>> {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const created = await ensureChampionshipPresets(userId);
  clearCareerTimelineCache(userId);
  revalidatePath('/races');
  revalidatePath('/settings');
  return { ok: true, data: { created }, message: `${created} championship${created === 1 ? '' : 's'} added.` };
}

// ---------------------------------------------------------------------------
// Settings and budget
// ---------------------------------------------------------------------------

export async function updateSettingsAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const parsed = settingsSchema.safeParse({
    weekStart: formValue(form, 'weekStart'),
    annualBudgetHours: formValue(form, 'annualBudgetHours'),
    weeklyTargetHours: formValue(form, 'weeklyTargetHours'),
    themeKey: formValue(form, 'themeKey'),
    raceCardKey: formValue(form, 'raceCardKey'),
    badgeKey: formValue(form, 'badgeKey'),
    bannerKey: formValue(form, 'bannerKey'),
    displayTitle: formValue(form, 'displayTitle'),
    defaultPlaybackSpeed: formValue(form, 'defaultPlaybackSpeed'),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check those settings.' };
  }

  const input = parsed.data;

  // The pickers only offer what has been unlocked, but this action can be
  // reached without them, so the rule is enforced here as well. Nothing is
  // saved if any choice is not available — a half-applied look is worse than
  // an unchanged one.
  const cosmetics = await getCosmeticState(userId);
  const choices: [CosmeticKind, string | undefined][] = [
    ['theme', input.themeKey],
    ['raceCard', input.raceCardKey],
    ['badge', input.badgeKey],
    ['banner', input.bannerKey],
    ['title', input.displayTitle],
  ];
  for (const [kind, value] of choices) {
    if (value !== undefined && value !== cosmetics[kind].chosen && !isChoosable(cosmetics, kind, value)) {
      return { ok: false, message: "That one hasn't been unlocked yet, so nothing was changed." };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (input.weekStart !== undefined) {
      await tx.user.update({ where: { id: userId }, data: { weekStart: input.weekStart } });
    }

    if (
      input.themeKey !== undefined || input.raceCardKey !== undefined
      || input.badgeKey !== undefined || input.bannerKey !== undefined
    ) {
      await tx.careerProfile.update({
        where: { userId },
        data: {
          ...(input.themeKey !== undefined ? { themeKey: input.themeKey } : {}),
          ...(input.raceCardKey !== undefined ? { raceCardKey: input.raceCardKey } : {}),
          ...(input.badgeKey !== undefined ? { badgeKey: input.badgeKey } : {}),
          ...(input.bannerKey !== undefined ? { bannerKey: input.bannerKey } : {}),
        },
      });
    }

    // Not `careerProfile.titleKey`: that one belongs to the level ladder and is
    // rewritten on every XP award, which is exactly how a chosen title used to
    // vanish the next time a stint was logged.
    if (input.displayTitle !== undefined) {
      await tx.configOverride.upsert({
        where: { userId_key: { userId, key: DISPLAY_TITLE_KEY } },
        update: { value: input.displayTitle },
        create: { userId, key: DISPLAY_TITLE_KEY, value: input.displayTitle },
      });
    }

    if (input.annualBudgetHours !== undefined || input.weeklyTargetHours !== undefined) {
      const year = new Date().getFullYear();
      await tx.budgetYear.upsert({
        where: { userId_year: { userId, year } },
        update: {
          ...(input.annualBudgetHours !== undefined ? { annualBudgetHours: input.annualBudgetHours } : {}),
          ...(input.weeklyTargetHours !== undefined ? { weeklyTargetHours: input.weeklyTargetHours } : {}),
        },
        create: {
          userId,
          year,
          annualBudgetHours: input.annualBudgetHours ?? 336,
          weeklyTargetHours: input.weeklyTargetHours ?? 8,
        },
      });
    }

    if (input.defaultPlaybackSpeed !== undefined) {
      await tx.configOverride.upsert({
        where: { userId_key: { userId, key: 'defaultPlaybackSpeed' } },
        update: { value: input.defaultPlaybackSpeed },
        create: { userId, key: 'defaultPlaybackSpeed', value: input.defaultPlaybackSpeed },
      });
    }
  });

  // The theme is applied by the root layout, so every page has to redraw.
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Settings saved.' };
}

export async function setRestWeekAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = restWeekSchema.safeParse({
    isoYear: formValue(form, 'isoYear') ?? '',
    isoWeek: formValue(form, 'isoWeek') ?? '',
    isRestWeek: form.get('isRestWeek') === 'on' || form.get('isRestWeek') === 'true',
  });
  if (!parsed.success) return { ok: false, message: 'That week could not be read.' };

  const { setRestWeek } = await import('@/lib/engines/budget-engine');
  await setRestWeek(userId, parsed.data.isoYear, parsed.data.isoWeek, parsed.data.isRestWeek);

  revalidatePath('/budget');
  revalidatePath('/');
  return {
    ok: true,
    message: parsed.data.isRestWeek
      ? 'Marked as a rest week. Those hours have been spread across the weeks around it.'
      : 'Back in the plan.',
  };
}
