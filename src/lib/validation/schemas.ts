/**
 * Server-side validation.
 *
 * Every mutation validates here before it reaches an engine, so an engine can
 * assume its inputs are sane. The same schemas are reused on the client for
 * inline feedback, which keeps the two in step.
 */

import { z } from 'zod';
import { MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from '@/lib/domain/playback';
import { tryParseTimestamp } from '@/lib/domain/time';
import { XP_CONFIG } from '@/lib/config';

const RACE_TYPES = ['SPRINT_ENDURANCE', 'H4', 'H6', 'H8', 'H10', 'H12', 'H24', 'CUSTOM'] as const;
const RACE_STATUSES = ['UNWATCHED', 'QUEUED', 'WATCHING', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'MUST_WATCH'] as const;

/** A duration entered as `HH:MM:SS`, or as a plain number of hours. */
const durationSeconds = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Enter a duration greater than zero.' });
        return z.NEVER;
      }
      return Math.round(value);
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      ctx.addIssue({ code: 'custom', message: 'Enter a duration, for example 06:00:00.' });
      return z.NEVER;
    }
    if (trimmed.includes(':')) {
      const parsed = tryParseTimestamp(trimmed);
      if (parsed === null || parsed <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Use HH:MM:SS, for example 06:00:00.' });
        return z.NEVER;
      }
      return parsed;
    }
    const hours = Number.parseFloat(trimmed);
    if (!Number.isFinite(hours) || hours <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter a duration greater than zero.' });
      return z.NEVER;
    }
    return Math.round(hours * 3600);
  })
  .pipe(z.number().int().positive().max(48 * 3600, 'Races longer than 48 hours are not supported.'));

/** A race-timeline position, `HH:MM:SS` or seconds. */
const timestampSeconds = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    if (typeof value === 'number') return Math.max(0, Math.round(value));
    const parsed = tryParseTimestamp(value);
    if (parsed === null) {
      ctx.addIssue({ code: 'custom', message: 'Use HH:MM:SS, for example 02:47:31.' });
      return z.NEVER;
    }
    return parsed;
  })
  .pipe(z.number().int().min(0));

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v === '' ? undefined : v));

const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'That date could not be read.' });
      return z.NEVER;
    }
    return date;
  });

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

export const raceInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the race a name.').max(160),
    championshipId: z.string().uuid().nullish().transform((v) => v ?? null),
    /** Creating a championship inline from the Add Race form. */
    newChampionshipName: optionalText(120),
    seasonYear: z.coerce.number().int().min(1900).max(2200).nullish().transform((v) => v ?? null),
    /** How many races the user considers the official season. Null = "whatever I add". */
    plannedRaceCount: z.coerce.number().int().min(1).max(100).nullish().transform((v) => v ?? null),

    circuit: optionalText(120),
    country: optionalText(80),
    raceDate: optionalDate,

    raceType: z.enum(RACE_TYPES).default('H6'),
    scheduledDuration: durationSeconds,
    /** Set when the race did not run to its advertised length. */
    actualDuration: durationSeconds.nullish().transform((v) => v ?? null),

    priority: z.enum(PRIORITIES).default('NORMAL'),
    excitement: z.coerce.number().int().min(1).max(5).default(3),
    status: z.enum(RACE_STATUSES).default('UNWATCHED'),

    isMajorEvent: z.coerce.boolean().default(false),
    /** Groups recurring editions for Race Mastery. Entirely user-defined. */
    iconicKey: optionalText(80),

    notes: optionalText(4000),
    replayUrl: z.string().trim().url('That does not look like a URL.').or(z.literal('')).optional()
      .transform((v) => (v === '' ? undefined : v)),
    posterUrl: z.string().trim().url('That does not look like a URL.').or(z.literal('')).optional()
      .transform((v) => (v === '' ? undefined : v)),
  })
  .refine(
    (data) => data.championshipId !== null || data.newChampionshipName !== undefined || true,
    { message: 'Pick a championship or leave it unassigned.' },
  );

export type RaceInput = z.infer<typeof raceInputSchema>;

export const raceUpdateSchema = raceInputSchema.safeExtend({ id: z.string().uuid() });
export type RaceUpdateInput = z.infer<typeof raceUpdateSchema>;

// ---------------------------------------------------------------------------
// Viewing sessions
// ---------------------------------------------------------------------------

/**
 * A logged stint.
 *
 * Two ways to describe the same thing, because both are natural depending on
 * how you watched: either you know where you stopped, or you know how long you
 * sat there. `mode` picks which fields are authoritative; the engine derives
 * the rest.
 */
export const sessionInputSchema = z
  .object({
    raceId: z.string().uuid(),
    mode: z.enum(['RANGE', 'DURATION']).default('RANGE'),

    /** RANGE mode: where the stint started and stopped on the race timeline. */
    startTimestamp: timestampSeconds,
    endTimestamp: timestampSeconds.optional(),

    /** DURATION mode: how long you actually sat there, in minutes. */
    realMinutes: z.coerce.number().positive().max(XP_CONFIG.maxSessionRealHours * 60).optional(),

    playbackSpeed: z.coerce
      .number()
      .min(MIN_PLAYBACK_SPEED, `Playback speed must be at least ${MIN_PLAYBACK_SPEED}x.`)
      .max(MAX_PLAYBACK_SPEED, `Playback speed must be at most ${MAX_PLAYBACK_SPEED}x.`)
      .default(1),

    watchedAt: optionalDate,
    note: optionalText(500),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'RANGE') {
      if (data.endTimestamp === undefined) {
        ctx.addIssue({ code: 'custom', path: ['endTimestamp'], message: 'Enter where you stopped.' });
        return;
      }
      if (data.endTimestamp <= data.startTimestamp) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTimestamp'],
          message: 'The stint has to end after it starts.',
        });
      }
    } else if (data.realMinutes === undefined) {
      ctx.addIssue({ code: 'custom', path: ['realMinutes'], message: 'Enter how long you watched.' });
    }
  });

export type SessionInput = z.infer<typeof sessionInputSchema>;

export const sessionDeleteSchema = z.object({ sessionId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Championships and seasons
// ---------------------------------------------------------------------------

export const championshipInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the championship a name.').max(120),
  shortName: optionalText(24),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #c8a45c.').default('#c8a45c'),
});
export type ChampionshipInput = z.infer<typeof championshipInputSchema>;

export const seasonInputSchema = z.object({
  championshipId: z.string().uuid(),
  year: z.coerce.number().int().min(1900).max(2200),
  label: optionalText(80),
  /** The user owns the definition of what an official season contains. */
  plannedRaceCount: z.coerce.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
});
export type SeasonInput = z.infer<typeof seasonInputSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  weekStart: z.coerce.number().int().min(0).max(6).optional(),
  annualBudgetHours: z.coerce.number().positive().max(8760).optional(),
  weeklyTargetHours: z.coerce.number().positive().max(168).optional(),
  themeKey: z.string().trim().max(40).optional(),
  raceCardKey: z.string().trim().max(40).optional(),
  titleKey: z.string().trim().max(80).nullish(),
  defaultPlaybackSpeed: z.coerce.number().min(MIN_PLAYBACK_SPEED).max(MAX_PLAYBACK_SPEED).optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const restWeekSchema = z.object({
  isoYear: z.coerce.number().int().min(1900).max(2200),
  isoWeek: z.coerce.number().int().min(1).max(53),
  isRestWeek: z.coerce.boolean(),
});
