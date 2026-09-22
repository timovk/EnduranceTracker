'use server';

/**
 * Server actions.
 *
 * Everything that mutates goes through here: validate with zod, call the
 * engine that owns the write, then revalidate the affected routes. No engine
 * is ever called from a component directly, and no component is trusted to
 * have validated anything.
 */

import { revalidatePath } from 'next/cache';
import { prisma, USER_ID } from '@/lib/db/client';
import type { Tx } from '@/lib/db/client';
import {
  championshipInputSchema, raceInputSchema, raceUpdateSchema, restWeekSchema,
  seasonInputSchema, sessionDeleteSchema, sessionInputSchema, settingsSchema,
} from '@/lib/validation/schemas';
import { circuitSlug } from '@/lib/engines/race-engine';
import { championshipSlug, ensureCareer, ensureChampionshipPresets } from './bootstrap';

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
    iconicKey: formValue(form, 'iconicKey'),
    notes: formValue(form, 'notes'),
    replayUrl: formValue(form, 'replayUrl') ?? '',
    posterUrl: formValue(form, 'posterUrl') ?? '',
  };
}

export async function createRaceAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  await ensureCareer();
  const parsed = raceInputSchema.safeParse(raceFormToObject(form));
  if (!parsed.success) {
    return { ok: false, message: 'A couple of fields need a second look.', errors: fieldErrors(parsed.error.issues) };
  }

  const input = parsed.data;
  const race = await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const { championshipId, seasonId } = await resolveChampionshipAndSeason(db, input);

    return db.race.create({
      data: {
        userId: USER_ID,
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
        iconicKey: input.iconicKey ?? null,
        notes: input.notes ?? null,
        replayUrl: input.replayUrl ?? null,
        posterUrl: input.posterUrl ?? null,
      },
      select: { id: true },
    });
  });

  revalidatePath('/races');
  revalidatePath('/');
  revalidatePath('/collections');
  return { ok: true, data: { id: race.id }, message: `${input.name} is in the library.` };
}

export async function updateRaceAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = raceUpdateSchema.safeParse({
    ...raceFormToObject(form),
    id: formValue(form, 'id') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, message: 'A couple of fields need a second look.', errors: fieldErrors(parsed.error.issues) };
  }

  const input = parsed.data;
  await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    const { championshipId, seasonId } = await resolveChampionshipAndSeason(db, input);

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
        runtimeSec: input.actualDuration ?? input.scheduledDuration,
        priority: input.priority,
        excitement: input.excitement,
        isMajorEvent: input.isMajorEvent,
        iconicKey: input.iconicKey ?? null,
        notes: input.notes ?? null,
        replayUrl: input.replayUrl ?? null,
        posterUrl: input.posterUrl ?? null,
      },
    });

    // Changing the runtime changes what "complete" means, so the aggregates
    // have to be rebuilt rather than left pointing at the old length.
    const { recomputeRaceAggregates } = await import('@/lib/engines/race-engine');
    await recomputeRaceAggregates(db, input.id);
  });

  revalidatePath('/races');
  revalidatePath(`/races/${input.id}`);
  revalidatePath('/');
  return { ok: true, data: { id: input.id }, message: 'Saved.' };
}

/**
 * Resolve (or create) the championship and season a race belongs to.
 *
 * The Add Race form can create a championship inline, because being made to
 * leave the form to create one first would be tedious.
 */
async function resolveChampionshipAndSeason(
  db: Tx,
  input: { championshipId: string | null; newChampionshipName?: string; seasonYear: number | null; plannedRaceCount: number | null },
): Promise<{ championshipId: string | null; seasonId: string | null }> {
  let championshipId = input.championshipId;

  if (!championshipId && input.newChampionshipName) {
    const slug = championshipSlug(input.newChampionshipName);
    const championship = await db.championship.upsert({
      where: { userId_slug: { userId: USER_ID, slug } },
      update: {},
      create: { userId: USER_ID, slug, name: input.newChampionshipName, isCustom: true },
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
  const allowed = ['UNWATCHED', 'QUEUED', 'WATCHING', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED'] as const;
  if (!allowed.includes(status as (typeof allowed)[number])) {
    return { ok: false, message: 'That status is not one of the options.' };
  }

  await prisma.race.update({
    where: { id: raceId },
    data: { status: status as (typeof allowed)[number] },
  });

  revalidatePath(`/races/${raceId}`);
  revalidatePath('/races');
  return { ok: true };
}

export async function deleteRaceAction(raceId: string): Promise<ActionResult> {
  const race = await prisma.race.findFirst({ where: { id: raceId, userId: USER_ID }, select: { name: true } });
  if (!race) return { ok: false, message: 'That race is no longer in the library.' };

  await prisma.race.delete({ where: { id: raceId } });

  revalidatePath('/races');
  revalidatePath('/');
  revalidatePath('/collections');
  return { ok: true, message: `${race.name} was removed from the library.` };
}

// ---------------------------------------------------------------------------
// Viewing sessions
// ---------------------------------------------------------------------------

export async function logSessionAction(form: FormData): Promise<ActionResult<{ sessionId: string; raceId: string }>> {
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

  const { logViewingSession } = await import('@/lib/engines/session-engine');
  const outcome = await logViewingSession(USER_ID, parsed.data);

  revalidatePathsAfterSession(outcome.raceId);
  return { ok: true, data: { sessionId: outcome.sessionId, raceId: outcome.raceId } };
}

export async function deleteSessionAction(sessionId: string): Promise<ActionResult> {
  const parsed = sessionDeleteSchema.safeParse({ sessionId });
  if (!parsed.success) return { ok: false, message: 'That session could not be found.' };

  const session = await prisma.raceViewingSession.findFirst({
    where: { id: sessionId, userId: USER_ID },
    select: { raceId: true },
  });
  if (!session) return { ok: false, message: 'That session is no longer recorded.' };

  const { deleteViewingSession } = await import('@/lib/engines/session-engine');
  await deleteViewingSession(USER_ID, sessionId);

  revalidatePathsAfterSession(session.raceId);
  return {
    ok: true,
    // Deliberately reassuring: correcting a mistake should never feel costly.
    message: 'Session removed. Your coverage has been recalculated; XP already earned stays where it is.',
  };
}

function revalidatePathsAfterSession(raceId: string): void {
  for (const path of ['/', '/races', `/races/${raceId}`, '/planner', '/budget', '/career', '/challenges', '/season-pass', '/mastery', '/collections', '/achievements', '/stats', '/trophies', '/hall-of-fame']) {
    revalidatePath(path);
  }
}

// ---------------------------------------------------------------------------
// Championships and seasons
// ---------------------------------------------------------------------------

export async function createChampionshipAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  await ensureCareer();
  const parsed = championshipInputSchema.safeParse({
    name: formValue(form, 'name') ?? '',
    shortName: formValue(form, 'shortName'),
    accentColor: formValue(form, 'accentColor') ?? '#c8a45c',
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check the championship details.' };
  }

  const championship = await prisma.championship.upsert({
    where: { userId_slug: { userId: USER_ID, slug: championshipSlug(parsed.data.name) } },
    update: { name: parsed.data.name, shortName: parsed.data.shortName ?? null, accentColor: parsed.data.accentColor },
    create: {
      userId: USER_ID,
      slug: championshipSlug(parsed.data.name),
      name: parsed.data.name,
      shortName: parsed.data.shortName ?? null,
      accentColor: parsed.data.accentColor,
      isCustom: true,
    },
    select: { id: true },
  });

  revalidatePath('/races');
  revalidatePath('/mastery');
  return { ok: true, data: championship, message: `${parsed.data.name} added.` };
}

export async function upsertSeasonAction(form: FormData): Promise<ActionResult> {
  const parsed = seasonInputSchema.safeParse({
    championshipId: formValue(form, 'championshipId') ?? '',
    year: formValue(form, 'year') ?? '',
    label: formValue(form, 'label'),
    plannedRaceCount: formValue(form, 'plannedRaceCount') ?? null,
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check the season details.' };
  }

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

  revalidatePath('/collections');
  revalidatePath('/races');
  return { ok: true, message: 'Season saved.' };
}

export async function seedPresetChampionshipsAction(): Promise<ActionResult<{ created: number }>> {
  await ensureCareer();
  const created = await ensureChampionshipPresets(USER_ID);
  revalidatePath('/races');
  revalidatePath('/settings');
  return { ok: true, data: { created }, message: `${created} championship${created === 1 ? '' : 's'} added.` };
}

// ---------------------------------------------------------------------------
// Settings and budget
// ---------------------------------------------------------------------------

export async function updateSettingsAction(form: FormData): Promise<ActionResult> {
  await ensureCareer();
  const parsed = settingsSchema.safeParse({
    name: formValue(form, 'name'),
    weekStart: formValue(form, 'weekStart'),
    annualBudgetHours: formValue(form, 'annualBudgetHours'),
    weeklyTargetHours: formValue(form, 'weeklyTargetHours'),
    themeKey: formValue(form, 'themeKey'),
    raceCardKey: formValue(form, 'raceCardKey'),
    titleKey: formValue(form, 'titleKey'),
    defaultPlaybackSpeed: formValue(form, 'defaultPlaybackSpeed'),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues), message: 'Check those settings.' };
  }

  const input = parsed.data;
  await prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.weekStart !== undefined) {
      await tx.user.update({
        where: { id: USER_ID },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.weekStart !== undefined ? { weekStart: input.weekStart } : {}),
        },
      });
    }

    if (input.themeKey !== undefined || input.raceCardKey !== undefined || input.titleKey !== undefined) {
      await tx.careerProfile.update({
        where: { userId: USER_ID },
        data: {
          ...(input.themeKey !== undefined ? { themeKey: input.themeKey } : {}),
          ...(input.raceCardKey !== undefined ? { raceCardKey: input.raceCardKey } : {}),
          ...(input.titleKey !== undefined ? { titleKey: input.titleKey } : {}),
        },
      });
    }

    if (input.annualBudgetHours !== undefined || input.weeklyTargetHours !== undefined) {
      const year = new Date().getFullYear();
      await tx.budgetYear.upsert({
        where: { userId_year: { userId: USER_ID, year } },
        update: {
          ...(input.annualBudgetHours !== undefined ? { annualBudgetHours: input.annualBudgetHours } : {}),
          ...(input.weeklyTargetHours !== undefined ? { weeklyTargetHours: input.weeklyTargetHours } : {}),
        },
        create: {
          userId: USER_ID,
          year,
          annualBudgetHours: input.annualBudgetHours ?? 336,
          weeklyTargetHours: input.weeklyTargetHours ?? 8,
        },
      });
    }

    if (input.defaultPlaybackSpeed !== undefined) {
      await tx.configOverride.upsert({
        where: { userId_key: { userId: USER_ID, key: 'defaultPlaybackSpeed' } },
        update: { value: input.defaultPlaybackSpeed },
        create: { userId: USER_ID, key: 'defaultPlaybackSpeed', value: input.defaultPlaybackSpeed },
      });
    }
  });

  revalidatePath('/settings');
  revalidatePath('/');
  revalidatePath('/budget');
  return { ok: true, message: 'Settings saved.' };
}

export async function setRestWeekAction(form: FormData): Promise<ActionResult> {
  const parsed = restWeekSchema.safeParse({
    isoYear: formValue(form, 'isoYear') ?? '',
    isoWeek: formValue(form, 'isoWeek') ?? '',
    isRestWeek: form.get('isRestWeek') === 'on' || form.get('isRestWeek') === 'true',
  });
  if (!parsed.success) return { ok: false, message: 'That week could not be read.' };

  const { setRestWeek } = await import('@/lib/engines/budget-engine');
  await setRestWeek(USER_ID, parsed.data.isoYear, parsed.data.isoWeek, parsed.data.isRestWeek);

  revalidatePath('/budget');
  revalidatePath('/');
  return {
    ok: true,
    message: parsed.data.isRestWeek
      ? 'Marked as a rest week. Those hours have been spread across the weeks around it.'
      : 'Back in the plan.',
  };
}
