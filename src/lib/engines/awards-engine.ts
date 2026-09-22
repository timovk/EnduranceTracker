/**
 * The Trophy Cabinet and the Hall of Fame.
 *
 * These are the two rooms of the museum this application keeps on the user's
 * behalf. The CABINET is a shelf of objects — a season trophy, a major-event
 * trophy, a completed mastery tree, a prestige emblem, the rarest achievements,
 * the collectibles a season pass left behind. The HALL OF FAME is the wall of
 * plaques beside it: a permanent, chronological archive of the moments a career
 * is actually remembered by.
 *
 * Five ideas shape the whole file.
 *
 *   1. NOTHING HERE MAY EVER BE REVOKED. There is no code path in this file
 *      that deletes a `Trophy` or a `HallOfFameEntry`, downgrades one, hides
 *      one behind a condition it must keep satisfying, or marks one as lapsed —
 *      and there must never be one. A trophy is not a statement about who the
 *      user is today; it is a statement about a day that happened. Rebalancing
 *      the thresholds in `AWARDS_CONFIG` can only ever cause the NEXT run to
 *      record something new, never to unmake something recorded. Everything
 *      below is written so that the only two verbs available are "record" and
 *      "read".
 *   2. AN ENTRY FREEZES THE CAREER AT THAT MOMENT. Each Hall of Fame plaque
 *      carries a `CareerSnapshot` — level, prestige, hours, stories, seasons —
 *      taken when it was recorded and never recomputed afterwards. Years later
 *      that frozen column is the interesting half of the plaque: not what was
 *      achieved, but where the career stood when it was. Recomputing a snapshot
 *      from today's numbers would quietly destroy exactly the thing that makes
 *      an archive worth keeping, so nothing in this file writes a snapshot onto
 *      a row that already has one.
 *   3. THE KEY IS THE GUARD. Both tables are unique on `(userId, key)`, and
 *      every key this engine derives is deterministic — `first:story-complete`,
 *      `milestone:level:100`, `season:season:wec-2027`. Re-running `syncAwards`
 *      over an unchanged career therefore records precisely nothing, which is
 *      what allows it to be called after every single stint and from a
 *      maintenance rebuild alike.
 *   4. REAL TIME AND TIMELINE TIME ARE DIFFERENT THINGS, and a plaque that
 *      confused them would be a plaque that lied. A season trophy shows the
 *      total RACE TIMELINE of the set — how much racing the season contained —
 *      and separately the ACTUAL VIEWING TIME the user spent on it, which
 *      includes every re-watch and is divided by whatever playback speed was
 *      used. They are labelled as two different figures because they are two
 *      different figures.
 *   5. THIS ENGINE GRANTS NO XP. Every moment it records has already been paid
 *      for by the engine that produced it — the Story Complete bonus, the
 *      Season Complete bonus, the mastery node, the achievement, the milestone.
 *      Paying a second time for the record of a payment would double-count the
 *      economy and, worse, would make the archive load-bearing: rebuilding the
 *      museum would then change the career. A museum must be safe to rebuild.
 *      (`XPSource.HALL_OF_FAME` and `XP_CONFIG.prestigeBonus` consequently have
 *      no owner in this file; see the note in the integration comment on
 *      `syncAwards`.)
 *
 * Division of labour. This engine is the only writer of `Trophy` and
 * `HallOfFameEntry`. It never writes a race, a collection, a mastery row or the
 * career profile, and it never decides whether something happened — the other
 * engines decide that and hand the conclusions over in an `AwardContext`. The
 * three write functions take the caller's transaction client and never open one
 * of their own, so a logged stint and the plaques it earns move together or not
 * at all. The read functions are read-only and use the global client.
 */

import { AWARDS_CONFIG, MASTERY_SHAPE, SEASON_PASS_CONFIG } from '@/lib/config';
import { prisma, type Tx } from '@/lib/db/client';
import { levelForPrestige, prestigeLabel } from '@/lib/domain/progression';
import { RARITY_ORDER, type HallOfFameCategory, type Rarity, type TrophyCategory } from '@/lib/domain/types';
import type {
  AchievementUnlock,
  CollectionOutcome,
  HallOfFameAward,
  MasteryUnlock,
  TrophyAward,
} from '@/lib/engines/contracts';
import { computeCareerMetrics, type CareerMetrics } from '@/lib/engines/metrics';

// ---------------------------------------------------------------------------
// Stored shapes
//
// Both of these end up in a JSON column, so they are declared as type aliases
// rather than interfaces: only a type alias picks up the implicit index
// signature Prisma's `InputJsonValue` wants. The same trick is used for
// `ChallengeParams` in the challenge engine, and for the same reason.
// ---------------------------------------------------------------------------

/** One labelled fact on an opened trophy. Rendered verbatim. */
export type AwardDetail = { label: string; value: string };

/**
 * The career, frozen.
 *
 * Stored on every Hall of Fame entry and on every trophy, and never written
 * over afterwards. Dates are held as ISO strings because this is JSON and a
 * `Date` would not survive the round trip; `capturedAt` is therefore the one
 * field here that has to be parsed rather than read.
 *
 * `championships` is the number of championships the career has finished a race
 * in, not the number of championships in the library — a museum plaque should
 * record where somebody had been, not what they owned.
 */
export type CareerSnapshot = {
  level: number;
  prestige: number;
  careerXp: number;
  /** Real-world hours in front of the screen, re-watches included. */
  realHours: number;
  /** Unique race-timeline hours covered. Re-watching never increases this. */
  timelineHours: number;
  racesCompleted: number;
  storyCompletes: number;
  championships: number;
  seasonsCompleted: number;
  circuits: number;
  countries: number;
  /** ISO-8601 instant the snapshot was taken. */
  capturedAt: string;
};

/** What an opened trophy knows about itself. */
export type TrophyMetadata = {
  details: AwardDetail[];
  snapshot: CareerSnapshot | null;
  /** Free pointer back to whatever earned it — a season id, a race id, a key. */
  sourceRef: string | null;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Everything needed to put one object on the shelf. */
export interface TrophyInput {
  /** Stable and deterministic. This is the double-award guard — see the header. */
  key: string;
  name: string;
  description: string;
  category: TrophyCategory;
  rarity?: Rarity;
  iconKey?: string;
  accentColor?: string;
  /** The facts shown when the trophy is opened. */
  details?: AwardDetail[];
  sourceRef?: string | null;
  /**
   * When it actually happened, when that is known and is not `now`. A season
   * finished in November and noticed in December belongs to November.
   */
  awardedAt?: Date;
  /** A snapshot already taken this run, so a batch of awards shares one. */
  snapshot?: CareerSnapshot | null;
}

/** Everything needed to hang one plaque on the wall. */
export interface HallOfFameInput {
  key: string;
  title: string;
  subtitle?: string | null;
  category: HallOfFameCategory;
  rarity?: Rarity;
  raceId?: string | null;
  championshipName?: string | null;
  seasonLabel?: string | null;
  occurredAt?: Date;
  snapshot?: CareerSnapshot | null;
}

/**
 * What the session engine hands over once every other engine has had its say.
 *
 * This engine deliberately takes conclusions rather than raw data: the mastery
 * engine decides what a completed tree is, the collection engine decides what a
 * completed season is, and the awards engine only decides which of those
 * conclusions belongs in a museum. `metrics` is the career as it stands AFTER
 * the session, read through the transaction client, so a plaque recorded now
 * freezes the career including the stint that earned it.
 */
export interface AwardContext {
  metrics: CareerMetrics;
  /** The race whose story was finished by this session, if one was. */
  storyCompletedRace?: { id: string; name: string; runtimeSec: number; isMajorEvent: boolean };
  completedCollections: CollectionOutcome['completedCollections'];
  masteryUnlocks: MasteryUnlock[];
  achievementUnlocks: AchievementUnlock[];
  levelAfter: number;
  /**
   * What this session moved. Carried because the session engine already knows
   * it and a future plaque may want to say "three levels in one evening" — but
   * the derivation below deliberately reads LEVELS and RANKS from `metrics`
   * instead. A first run over a career that predates this engine has no gains
   * to report and every plaque still has to be hung, so "what the career now
   * is" is the sound question and "what just changed" is not.
   */
  levelsGained: number;
  prestigeGained: number;
  seasonPassCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface TrophyCabinetEntry {
  key: string;
  name: string;
  description: string;
  category: TrophyCategory;
  rarity: Rarity;
  iconKey: string;
  accentColor: string;
  awardedAt: Date;
  /** The frozen facts, ready to render as a definition list. */
  details: AwardDetail[];
  snapshot: CareerSnapshot | null;
}

export interface TrophyCabinetGroup {
  category: TrophyCategory;
  label: string;
  /** One sentence describing what this shelf holds. */
  blurb: string;
  trophies: TrophyCabinetEntry[];
}

export interface TrophyRarityTally {
  rarity: Rarity;
  count: number;
}

export interface TrophyCabinetView {
  total: number;
  /** Ordered common to mythic, with empty rarities omitted. */
  byRarity: TrophyRarityTally[];
  categories: TrophyCabinetGroup[];
  mostRecent: TrophyCabinetEntry | null;
  headline: string;
}

export interface HallOfFameEntryView {
  key: string;
  title: string;
  subtitle: string | null;
  category: HallOfFameCategory;
  rarity: Rarity;
  raceId: string | null;
  championshipName: string | null;
  seasonLabel: string | null;
  occurredAt: Date;
  snapshot: CareerSnapshot | null;
}

export interface HallOfFameYear {
  year: number;
  entries: HallOfFameEntryView[];
}

export interface HallOfFameCategoryTally {
  category: HallOfFameCategory;
  label: string;
  count: number;
}

export interface HallOfFameView {
  /** Newest first. */
  entries: HallOfFameEntryView[];
  /** The same entries grouped for a timeline layout, newest year first. */
  years: HallOfFameYear[];
  byCategory: HallOfFameCategoryTally[];
  headline: string;
}

// ---------------------------------------------------------------------------
// Presentation
//
// Labels, blurbs and accent colours are not balance, so they live here rather
// than in `config/economy.ts` — the same split the achievement engine makes
// with its category labels. Changing any of them changes how a shelf reads and
// nothing else.
// ---------------------------------------------------------------------------

const TROPHY_CATEGORY_ORDER: readonly TrophyCategory[] = [
  'SEASON', 'MAJOR_EVENT', 'MASTERY', 'PRESTIGE', 'ACHIEVEMENT', 'SEASON_PASS', 'MILESTONE',
];

const TROPHY_CATEGORY_LABELS: Readonly<Record<TrophyCategory, string>> = {
  SEASON: 'Seasons',
  MAJOR_EVENT: 'Major events',
  MASTERY: 'Mastery',
  PRESTIGE: 'Prestige',
  ACHIEVEMENT: 'Rare achievements',
  SEASON_PASS: 'Season pass',
  MILESTONE: 'Milestones',
};

const TROPHY_CATEGORY_BLURBS: Readonly<Record<TrophyCategory, string>> = {
  SEASON: 'One for every championship season finished, card for card.',
  MAJOR_EVENT: 'The big ones — the races people plan their year around.',
  MASTERY: 'Mastery trees taken all the way to the last node.',
  PRESTIGE: 'Emblems for each prestige rank. Additive, like everything else.',
  ACHIEVEMENT: 'The rarest achievements, the ones worth a shelf of their own.',
  SEASON_PASS: 'Collectibles a quarter left behind. Cosmetic then, permanent now.',
  MILESTONE: 'Long-run counters that reached a number worth keeping.',
};

const TROPHY_ACCENTS: Readonly<Record<TrophyCategory, string>> = {
  SEASON: '#c8a45c',
  MAJOR_EVENT: '#c0504d',
  MASTERY: '#3fa06b',
  PRESTIGE: '#8f6fc0',
  ACHIEVEMENT: '#d97a3a',
  SEASON_PASS: '#3f7fb5',
  MILESTONE: '#8b98a5',
};

const HALL_OF_FAME_CATEGORY_ORDER: readonly HallOfFameCategory[] = [
  'FIRST', 'SEASON', 'MAJOR_EVENT', 'MASTERY', 'CAREER', 'MILESTONE', 'PRESTIGE', 'SEASON_PASS',
];

const HALL_OF_FAME_CATEGORY_LABELS: Readonly<Record<HallOfFameCategory, string>> = {
  FIRST: 'Firsts',
  MILESTONE: 'Milestones',
  SEASON: 'Seasons',
  MAJOR_EVENT: 'Major events',
  CAREER: 'Career',
  MASTERY: 'Mastery',
  SEASON_PASS: 'Season pass',
  PRESTIGE: 'Prestige',
};

const DEFAULT_TROPHY_RARITY: Rarity = 'RARE';
const DEFAULT_HALL_OF_FAME_RARITY: Rarity = 'RARE';
const DEFAULT_TROPHY_ICON = 'trophy';

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Freeze a set of career metrics into the shape a plaque stores.
 *
 * Pure, so the museum can be reasoned about without a database, and separated
 * from `captureSnapshot` so that a run recording eleven plaques at once takes
 * ONE reading of the career and gives all eleven the same one. Eleven readings
 * taken microseconds apart would differ only by noise, and a wall of plaques
 * disagreeing about what the level was that evening is precisely the kind of
 * detail that makes an archive stop feeling trustworthy.
 */
export function snapshotFromMetrics(metrics: CareerMetrics, now: Date = new Date()): CareerSnapshot {
  return {
    level: metrics.level,
    prestige: metrics.prestige,
    careerXp: metrics.careerXp,
    realHours: metrics.realHours,
    timelineHours: metrics.timelineHours,
    racesCompleted: metrics.racesCompleted,
    storyCompletes: metrics.storyCompletes,
    championships: metrics.championshipsCompleted,
    seasonsCompleted: metrics.seasonsCompleted,
    circuits: metrics.circuits,
    countries: metrics.countries,
    capturedAt: now.toISOString(),
  };
}

/**
 * Read the career and freeze it.
 *
 * `db` defaults to the global client but MUST be the active transaction client
 * when this is called mid-session, for the same reason `computeCareerMetrics`
 * says so: a snapshot read outside the transaction would not see the stint that
 * is being recorded, and every plaque minted for that stint would be frozen one
 * session out of date.
 */
export async function captureSnapshot(
  userId: string,
  db: Tx = prisma,
  now: Date = new Date(),
): Promise<CareerSnapshot> {
  const metrics = await computeCareerMetrics(userId, db);
  return snapshotFromMetrics(metrics, now);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Put one object in the cabinet, unless it is already there.
 *
 * Returns `null` when the user already holds a trophy with this key — which is
 * success, not an error. A caller re-running an engine is expected to hit this
 * path on every key it has already minted, and `null` simply means "nothing new
 * happened", so nothing is reported to the user a second time.
 *
 * There is deliberately no update branch. A trophy already on the shelf is left
 * exactly as it was awarded, including its name, its rarity and its frozen
 * metadata: rewriting it to today's copy would silently rewrite history, and
 * the one thing a cabinet has to be is honest about what was true at the time.
 */
export async function awardTrophy(
  tx: Tx,
  userId: string,
  input: TrophyInput,
  now: Date = new Date(),
): Promise<TrophyAward | null> {
  const existing = await tx.trophy.findUnique({
    where: { userId_key: { userId, key: input.key } },
    select: { id: true },
  });
  if (existing !== null) return null;

  const rarity = input.rarity ?? DEFAULT_TROPHY_RARITY;
  const iconKey = input.iconKey ?? DEFAULT_TROPHY_ICON;
  const metadata: TrophyMetadata = {
    details: input.details ?? [],
    snapshot: input.snapshot ?? null,
    sourceRef: input.sourceRef ?? null,
  };

  await tx.trophy.create({
    data: {
      userId,
      key: input.key,
      name: input.name,
      description: input.description,
      category: input.category,
      rarity,
      iconKey,
      accentColor: input.accentColor ?? TROPHY_ACCENTS[input.category],
      metadata,
      awardedAt: input.awardedAt ?? now,
    },
  });

  return {
    key: input.key,
    name: input.name,
    description: input.description,
    category: input.category,
    rarity,
    iconKey,
  };
}

/**
 * Hang one plaque on the wall, unless it is already hanging.
 *
 * Same contract as `awardTrophy`: `null` for an entry already recorded, no
 * update branch, and the snapshot written once and never touched again. An
 * entry's `occurredAt` is the moment the thing HAPPENED where that is knowable
 * — a season's completion date, a race's `storyCompletedAt` — and only falls
 * back to `now` when nothing better exists, so that a career imported or
 * rebuilt in one evening still hangs its plaques in the right order.
 */
export async function recordHallOfFame(
  tx: Tx,
  userId: string,
  input: HallOfFameInput,
  now: Date = new Date(),
): Promise<HallOfFameAward | null> {
  const existing = await tx.hallOfFameEntry.findUnique({
    where: { userId_key: { userId, key: input.key } },
    select: { id: true },
  });
  if (existing !== null) return null;

  const rarity = input.rarity ?? DEFAULT_HALL_OF_FAME_RARITY;
  const subtitle = input.subtitle ?? null;
  const snapshot: CareerSnapshot | null = input.snapshot ?? null;

  await tx.hallOfFameEntry.create({
    data: {
      userId,
      key: input.key,
      title: input.title,
      subtitle,
      category: input.category,
      rarity,
      raceId: input.raceId ?? null,
      championshipName: input.championshipName ?? null,
      seasonLabel: input.seasonLabel ?? null,
      // `?? {}` rather than `?? null`: an absent snapshot is an empty plaque,
      // and the column's own default is an empty object. A JSON null here would
      // be a third state to handle on the reading side for no benefit.
      snapshot: snapshot ?? {},
      occurredAt: input.occurredAt ?? now,
    },
  });

  return { key: input.key, title: input.title, subtitle, category: input.category, rarity };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * One once-in-a-career plaque, declared rather than coded.
 *
 * Keeping the firsts as data makes the whole list readable at a glance and
 * makes it obvious that each one is a pure function of a career metric — which
 * is what guarantees that re-running the engine over an unchanged career
 * derives exactly the same set and therefore records nothing.
 */
interface FirstMoment {
  key: string;
  title: string;
  subtitle: string;
  category: HallOfFameCategory;
  rarity: Rarity;
  reached: boolean;
  occurredAt?: Date;
  raceId?: string;
}

/**
 * The facts a season trophy is made of, gathered in one place.
 *
 * `timelineSec` and `realSec` are two different quantities and are carried as
 * two different fields for exactly that reason: the first is how much racing
 * the season contained, the second is how long the user actually sat in front
 * of it. A set watched at 1.5x has a smaller second figure than first; a set
 * with re-watches in it can have a larger one. Neither is a mistake.
 */
interface SeasonFacts {
  /** The set this came from. Carried for tracing; unused by the prose. */
  collectionKey: string;
  displayName: string;
  trophyName: string;
  championshipName: string | null;
  seasonLabel: string | null;
  year: number | null;
  itemCount: number;
  storyCompleteCount: number;
  timelineSec: number;
  realSec: number;
  isSweep: boolean;
  accentColor: string;
  completedAt: Date;
  seasonId: string | null;
}

/**
 * Record everything this career has earned and does not yet hold.
 *
 * Called by the session engine at the end of a logged stint, inside its
 * transaction, and safe to call from a maintenance rebuild over an untouched
 * database — in which case it records the plaques a career already deserved and
 * nothing else. Idempotency is structural rather than careful: every key below
 * is derived deterministically from the career's own numbers, and both tables
 * are unique on `(userId, key)`.
 *
 * Note for the integrator: this function writes no XP. See idea 5 in the file
 * header. `XP_CONFIG.prestigeBonus` and `XPSource.HALL_OF_FAME` are therefore
 * still unowned; if a prestige rank is meant to pay career XP, that belongs
 * wherever the prestige rank is DETECTED (the ledger raises `prestigeGained`),
 * not here in the room that only writes it down.
 */
export async function syncAwards(
  tx: Tx,
  userId: string,
  context: AwardContext,
  now: Date = new Date(),
): Promise<{ trophies: TrophyAward[]; hallOfFame: HallOfFameAward[] }> {
  const { metrics } = context;
  const snapshot = snapshotFromMetrics(metrics, now);

  const trophies: TrophyAward[] = [];
  const hallOfFame: HallOfFameAward[] = [];

  // What is already held, read once. `awardTrophy` and `recordHallOfFame` each
  // check for themselves and remain the real guard — this set only spares the
  // engine the lookups that would otherwise be done to BUILD an award it was
  // always going to discard, which for a season trophy means a join across a
  // whole collection every single stint.
  const [heldTrophies, heldEntries] = await Promise.all([
    tx.trophy.findMany({ where: { userId }, select: { key: true } }),
    tx.hallOfFameEntry.findMany({ where: { userId }, select: { key: true } }),
  ]);
  const heldTrophyKeys = new Set(heldTrophies.map((row) => row.key));
  const heldEntryKeys = new Set(heldEntries.map((row) => row.key));

  // Both helpers default the caller's award to the ONE snapshot taken above, so
  // everything recorded by a single run agrees about what the career was that
  // evening. A caller that supplies its own wins, which is what lets a future
  // back-fill hang a plaque with the career as it stood back then.
  const mintTrophy = async (input: TrophyInput): Promise<void> => {
    if (heldTrophyKeys.has(input.key)) return;
    const award = await awardTrophy(tx, userId, { ...input, snapshot: input.snapshot ?? snapshot }, now);
    if (award === null) return;
    heldTrophyKeys.add(input.key);
    trophies.push(award);
  };

  const mintEntry = async (input: HallOfFameInput): Promise<void> => {
    if (heldEntryKeys.has(input.key)) return;
    const award = await recordHallOfFame(tx, userId, { ...input, snapshot: input.snapshot ?? snapshot }, now);
    if (award === null) return;
    heldEntryKeys.add(input.key);
    hallOfFame.push(award);
  };

  // -- The race whose story finished this session --------------------------
  //
  // Read once, because several of the firsts below want to name it and the
  // major-event trophy wants its circuit, its date and its viewing figures.
  const storiedRace = context.storyCompletedRace
    ? await tx.race.findFirst({
        where: { id: context.storyCompletedRace.id, userId },
        select: {
          id: true, name: true, circuit: true, raceDate: true,
          runtimeSec: true, realViewingSec: true, sessionCount: true,
          storyCompletedAt: true, isMajorEvent: true,
          championship: { select: { name: true, shortName: true, accentColor: true } },
          season: { select: { year: true, label: true } },
        },
      })
    : null;

  const storiedHours = storiedRace === null ? 0 : storiedRace.runtimeSec / 3600;
  const storiedAt = storiedRace?.storyCompletedAt ?? undefined;
  const storiedName = storiedRace?.name ?? null;

  // -- Firsts ---------------------------------------------------------------
  const firsts: FirstMoment[] = [
    {
      key: 'first:race-completed',
      title: 'First Race Completed',
      subtitle: namedOr(storiedName, 'The first race in the library seen all the way through.'),
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstRaceCompleted,
      reached: metrics.racesCompleted >= 1,
      occurredAt: storiedAt,
      raceId: storiedRace?.id,
    },
    {
      key: 'first:story-complete',
      title: 'First Story Complete',
      subtitle: namedOr(storiedName, 'A race watched from the green flag to the chequered flag, with nothing skipped.'),
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstStoryComplete,
      reached: metrics.storyCompletes >= 1,
      occurredAt: storiedAt,
      raceId: storiedRace?.id,
    },
    {
      key: 'first:race-12h',
      title: 'First 12-Hour Race',
      subtitle: namedOr(
        storiedHours >= MASTERY_SHAPE.stories12hMinHours ? storiedName : null,
        'Half a day of racing, start to finish.',
      ),
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstRace12h,
      reached: metrics.stories12h >= 1,
      occurredAt: storiedHours >= MASTERY_SHAPE.stories12hMinHours ? storiedAt : undefined,
    },
    {
      key: 'first:race-24h',
      title: 'First 24-Hour Race',
      subtitle: namedOr(
        storiedHours >= MASTERY_SHAPE.stories24hMinHours ? storiedName : null,
        'Around the clock, every minute of it.',
      ),
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstRace24h,
      reached: metrics.stories24h >= 1,
      occurredAt: storiedHours >= MASTERY_SHAPE.stories24hMinHours ? storiedAt : undefined,
    },
    {
      key: 'first:major-event',
      title: 'First Major Event',
      subtitle: namedOr(
        storiedRace?.isMajorEvent === true ? storiedName : null,
        'One of the races the year is planned around.',
      ),
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstMajorEvent,
      reached: metrics.majorEventStories >= 1,
      occurredAt: storiedRace?.isMajorEvent === true ? storiedAt : undefined,
    },
    {
      key: 'first:season-complete',
      title: 'First Season Completed',
      subtitle: 'Every card of a championship season filled.',
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstSeasonComplete,
      reached: metrics.seasonsCompleted >= 1,
    },
    {
      key: 'first:season-sweep',
      title: 'First Season Sweep',
      subtitle: 'A whole season in which every single race is Story Complete.',
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstSeasonSweep,
      reached: metrics.seasonsStoryComplete >= 1,
    },
    {
      key: 'first:mastery-tree',
      title: 'First Mastery Tree Completed',
      subtitle: 'A mastery tree taken all the way to its last node.',
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstMasteryTree,
      reached: metrics.masteryTreesCompleted >= 1 || context.masteryUnlocks.some((node) => node.treeCompleted),
    },
    {
      key: 'first:season-pass',
      title: 'First Season Pass Completed',
      subtitle: `All ${SEASON_PASS_CONFIG.tierCount} tiers of a quarter, reached inside the quarter.`,
      category: 'FIRST',
      rarity: AWARDS_CONFIG.rarity.firstSeasonPass,
      reached: metrics.seasonPassesCompleted >= 1 || context.seasonPassCompleted,
    },
  ];

  for (const moment of firsts) {
    if (!moment.reached) continue;
    await mintEntry({
      key: moment.key,
      title: moment.title,
      subtitle: moment.subtitle,
      category: moment.category,
      rarity: moment.rarity,
      raceId: moment.raceId ?? null,
      occurredAt: moment.occurredAt ?? now,
    });
  }

  // -- Counting ladders -----------------------------------------------------
  //
  // Three short ladders, kept well short of the milestone ladders in
  // `config/milestones.ts` on purpose: a milestone marks every rung of the
  // climb, a plaque marks the rungs somebody would mention years later.
  for (const rung of AWARDS_CONFIG.storyMilestones) {
    if (metrics.storyCompletes < rung.threshold) continue;
    await mintEntry({
      key: `milestone:stories:${rung.threshold}`,
      title: `${formatNumber(rung.threshold)} Complete Stories`,
      subtitle: `The ${ordinal(rung.threshold)} race watched from lights out to flag.`,
      category: 'MILESTONE',
      rarity: rung.rarity,
    });
  }

  for (const rung of AWARDS_CONFIG.realHourMilestones) {
    if (metrics.realHours < rung.threshold) continue;
    await mintEntry({
      key: `milestone:real-hours:${rung.threshold}`,
      title: `${formatNumber(rung.threshold)} Hours of Racing`,
      // Real time, explicitly. The timeline figure is a different number and
      // is never what this plaque counts.
      subtitle: `${formatNumber(rung.threshold)} real hours in front of the screen, re-watches and all.`,
      category: 'MILESTONE',
      rarity: rung.rarity,
    });
  }

  for (const rung of AWARDS_CONFIG.levelMilestones) {
    if (metrics.level < rung.threshold) continue;
    await mintEntry({
      key: `milestone:level:${rung.threshold}`,
      title: `Career Level ${formatNumber(rung.threshold)}`,
      subtitle: `Level ${formatNumber(rung.threshold)} reached. The career only ever grows from here.`,
      category: 'CAREER',
      rarity: rung.rarity,
    });
  }

  // -- Prestige -------------------------------------------------------------
  //
  // Every rank the career has ever held, not merely the one it holds now, so
  // that a first run over an advanced career hangs the whole wall rather than
  // only its top plaque. Prestige is additive and never resets anything, which
  // is why walking the ranks backwards like this is sound.
  for (let rank = 1; rank <= metrics.prestige; rank += 1) {
    const label = prestigeLabel(rank);
    const atLevel = levelForPrestige(rank);
    await mintEntry({
      key: `prestige:${rank}`,
      title: label,
      subtitle: `Prestige rank ${rank}, reached at career level ${formatNumber(atLevel)}.`,
      category: 'PRESTIGE',
      rarity: rank === 1 ? AWARDS_CONFIG.rarity.firstPrestige : AWARDS_CONFIG.rarity.prestige,
    });
    await mintTrophy({
      key: `prestige:${rank}`,
      name: `${label} Emblem`,
      description: `Awarded on reaching prestige rank ${rank}. Prestige is layered on top of the career and resets nothing.`,
      category: 'PRESTIGE',
      rarity: rank === 1 ? AWARDS_CONFIG.rarity.firstPrestige : AWARDS_CONFIG.rarity.prestige,
      iconKey: 'shield',
      sourceRef: `prestige:${rank}`,
      details: [
        { label: 'Rank', value: String(rank) },
        { label: 'Unlocks at', value: `Career level ${formatNumber(atLevel)}` },
        { label: 'Career level then', value: formatNumber(snapshot.level) },
      ],
    });
  }

  // -- The major event that just finished -----------------------------------
  if (storiedRace !== null && storiedRace.isMajorEvent) {
    const championship = storiedRace.championship;
    const eventDetails: AwardDetail[] = [
      { label: 'Race', value: storiedRace.name },
      ...(storiedRace.circuit ? [{ label: 'Circuit', value: storiedRace.circuit }] : []),
      ...(storiedRace.raceDate ? [{ label: 'Raced', value: longDate(storiedRace.raceDate) }] : []),
      // Two figures, never one. See idea 4 in the file header.
      { label: 'Race timeline', value: wholeHours(storiedRace.runtimeSec) },
      { label: 'Actual viewing time', value: hoursAndMinutes(storiedRace.realViewingSec) },
      { label: 'Sessions', value: countLabel(storiedRace.sessionCount, 'stint', 'stints') },
    ];

    await mintTrophy({
      key: `major-event:${storiedRace.id}`,
      name: `${storiedRace.name} — Major Event Trophy`,
      description: 'Story Complete on a race tagged as a major event.',
      category: 'MAJOR_EVENT',
      rarity: AWARDS_CONFIG.rarity.majorEvent,
      iconKey: 'star',
      accentColor: championship?.accentColor,
      sourceRef: storiedRace.id,
      details: eventDetails,
      awardedAt: storiedRace.storyCompletedAt ?? now,
    });

    await mintEntry({
      key: `major-event:${storiedRace.id}`,
      title: storiedRace.name,
      subtitle: 'Major event, Story Complete.',
      category: 'MAJOR_EVENT',
      rarity: AWARDS_CONFIG.rarity.majorEvent,
      raceId: storiedRace.id,
      championshipName: championship?.name ?? null,
      seasonLabel: seasonLabelOf(storiedRace.season),
      occurredAt: storiedRace.storyCompletedAt ?? now,
    });
  }

  // -- Seasons completed this session ---------------------------------------
  for (const completed of context.completedCollections) {
    const trophyKey = `season:${completed.key}`;
    const entryKey = `season:${completed.key}`;
    if (heldTrophyKeys.has(trophyKey) && heldEntryKeys.has(entryKey)) continue;

    const facts = await gatherSeasonFacts(tx, userId, completed, now);
    if (facts === null) continue;

    const rarity = facts.isSweep ? AWARDS_CONFIG.rarity.seasonSweep : AWARDS_CONFIG.rarity.seasonComplete;

    await mintTrophy({
      key: trophyKey,
      name: facts.trophyName,
      description: facts.isSweep
        ? 'Every race of the season, and every one of them Story Complete.'
        : 'Every card of the season filled.',
      category: 'SEASON',
      rarity,
      iconKey: 'layers',
      accentColor: facts.accentColor,
      sourceRef: facts.seasonId,
      awardedAt: facts.completedAt,
      details: seasonDetails(facts),
    });

    await mintEntry({
      key: entryKey,
      title: `${facts.displayName} — Season Complete`,
      subtitle: facts.isSweep
        ? `Season Sweep: all ${formatNumber(facts.itemCount)} races Story Complete.`
        : `${formatNumber(facts.storyCompleteCount)} of ${formatNumber(facts.itemCount)} races Story Complete.`,
      category: 'SEASON',
      rarity,
      championshipName: facts.championshipName,
      seasonLabel: facts.seasonLabel,
      occurredAt: facts.completedAt,
    });
  }

  // -- Mastery trees completed this session ---------------------------------
  for (const unlock of context.masteryUnlocks) {
    if (!unlock.treeCompleted) continue;
    const trophyKey = `mastery:${unlock.treeKey}`;
    if (heldTrophyKeys.has(trophyKey) && heldEntryKeys.has(trophyKey)) continue;

    const tree = await tx.masteryTree.findUnique({
      where: { userId_key: { userId, key: unlock.treeKey } },
      select: { name: true, accentColor: true, nodes: { select: { id: true } } },
    });

    await mintTrophy({
      key: trophyKey,
      name: `${unlock.treeName} — Mastery Complete`,
      description: 'Every node of this mastery tree unlocked.',
      category: 'MASTERY',
      rarity: AWARDS_CONFIG.rarity.masteryTree,
      iconKey: 'grid',
      accentColor: tree?.accentColor,
      sourceRef: unlock.treeKey,
      details: [
        { label: 'Tree', value: unlock.treeName },
        ...(tree ? [{ label: 'Nodes', value: countLabel(tree.nodes.length, 'node', 'nodes') }] : []),
        { label: 'Final node', value: unlock.nodeName },
        { label: 'Career level then', value: formatNumber(snapshot.level) },
      ],
    });

    await mintEntry({
      key: trophyKey,
      title: `${unlock.treeName} — Mastery Complete`,
      subtitle: `The last node was ${unlock.nodeName}.`,
      category: 'MASTERY',
      rarity: AWARDS_CONFIG.rarity.masteryTree,
    });
  }

  // -- The rarest achievements ----------------------------------------------
  //
  // Only LEGENDARY and MYTHIC, per `trophyAchievementRarities`. Everything else
  // stays on the achievement board where the hundreds of ordinary unlocks live.
  for (const unlock of context.achievementUnlocks) {
    if (!AWARDS_CONFIG.trophyAchievementRarities.some((rarity) => rarity === unlock.rarity)) continue;
    await mintTrophy({
      key: `achievement:${unlock.key}`,
      name: unlock.name,
      description: unlock.description,
      category: 'ACHIEVEMENT',
      rarity: unlock.rarity,
      iconKey: unlock.iconKey,
      sourceRef: unlock.key,
      details: [
        { label: 'Rarity', value: titleCase(unlock.rarity) },
        { label: 'Career XP', value: formatNumber(unlock.xpAwarded) },
        { label: 'Career level then', value: formatNumber(snapshot.level) },
        { label: 'Real hours then', value: hoursAndMinutes(Math.round(snapshot.realHours * 3600)) },
      ],
    });
  }

  // -- Season passes: completed quarters and their collectibles -------------
  await syncSeasonPassAwards(tx, userId, mintTrophy, heldTrophyKeys, now);

  return { trophies, hallOfFame };
}

/**
 * Completed quarters and the collectibles they left behind.
 *
 * Split out because it is the one part of the derivation that reads the season
 * pass tables directly rather than working from the context: a collectible is
 * earned by a tier unlocking, which the season-pass engine records on the
 * `SeasonPassProgress` row itself, and that row IS the collectible (see the
 * closing comment of `applyTierReward`). Reading the rows rather than the
 * session's tier unlocks means a career whose passes were opened before this
 * engine existed still gets its shelf.
 *
 * A pass expiring never removes anything here. The rewards were cosmetic so
 * that a quarter could end on a real date without touching the permanent
 * career, and a collectible already earned is part of that permanent career.
 */
async function syncSeasonPassAwards(
  tx: Tx,
  userId: string,
  mintTrophy: (input: TrophyInput) => Promise<void>,
  heldTrophyKeys: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  const completedPasses = await tx.seasonPass.findMany({
    where: { userId, tier: { gte: SEASON_PASS_CONFIG.tierCount } },
    select: { id: true, year: true, quarter: true, tier: true, seasonXp: true, endsAt: true },
  });

  for (const pass of completedPasses) {
    const label = quarterLabel(pass.year, pass.quarter);
    const key = `season-pass-complete:${pass.year}q${pass.quarter}`;
    if (heldTrophyKeys.has(key)) continue;
    await mintTrophy({
      key,
      name: `${label} Season Pass Trophy`,
      description: `Every tier of the ${label} pass reached before the quarter closed.`,
      category: 'SEASON_PASS',
      rarity: AWARDS_CONFIG.rarity.seasonPassComplete,
      iconKey: 'award',
      sourceRef: pass.id,
      details: [
        { label: 'Quarter', value: label },
        { label: 'Tiers', value: `${formatNumber(pass.tier)} of ${formatNumber(SEASON_PASS_CONFIG.tierCount)}` },
        { label: 'Season XP', value: formatNumber(pass.seasonXp) },
      ],
      awardedAt: pass.endsAt < now ? pass.endsAt : now,
    });
  }

  const collectibles = await tx.seasonPassProgress.findMany({
    where: {
      seasonPass: { userId },
      unlockedAt: { not: null },
      rewardType: { in: ['TROPHY_ITEM', 'HALL_OF_FAME_COLLECTIBLE'] },
    },
    select: {
      tier: true, rewardKey: true, rewardName: true, rewardRarity: true, unlockedAt: true,
      seasonPass: { select: { id: true, year: true, quarter: true } },
    },
  });

  for (const row of collectibles) {
    const pass = row.seasonPass;
    const label = quarterLabel(pass.year, pass.quarter);
    const key = `season-pass:${pass.year}q${pass.quarter}:t${row.tier}`;
    if (heldTrophyKeys.has(key)) continue;
    await mintTrophy({
      key,
      name: row.rewardName,
      description: `A collectible from the ${label} season pass, earned at tier ${row.tier}.`,
      category: 'SEASON_PASS',
      // The rarity the tier was advertising, read from the stored row rather
      // than recomputed, so a rebalanced reward pool cannot restate what an
      // old collectible was worth.
      rarity: row.rewardRarity,
      iconKey: 'medal',
      sourceRef: row.rewardKey,
      details: [
        { label: 'Quarter', value: label },
        { label: 'Tier', value: String(row.tier) },
        { label: 'Rarity', value: titleCase(row.rewardRarity) },
      ],
      awardedAt: row.unlockedAt ?? now,
    });
  }
}

/**
 * Gather what a season trophy needs to say for itself.
 *
 * The collection engine reports that a set is complete and how many cards it
 * holds; it does not report hours, because hours are not its business. So the
 * set is re-read here, once, only when a trophy is actually going to be minted
 * — which happens a handful of times in a career.
 *
 * Returns `null` when the collection has vanished between the two engines,
 * which should not happen inside one transaction but is not worth throwing
 * over: a missing trophy is recoverable on the next run, a rolled-back stint
 * is not.
 */
async function gatherSeasonFacts(
  tx: Tx,
  userId: string,
  completed: CollectionOutcome['completedCollections'][number],
  now: Date,
): Promise<SeasonFacts | null> {
  const collection = await tx.collection.findUnique({
    where: { userId_key: { userId, key: completed.key } },
    select: {
      key: true, name: true, accentColor: true, completedAt: true,
      season: {
        select: {
          id: true, year: true, label: true,
          championship: { select: { name: true, shortName: true, accentColor: true } },
        },
      },
      items: {
        select: {
          storyComplete: true,
          race: { select: { runtimeSec: true, realViewingSec: true, storyCompletedAt: true } },
        },
      },
    },
  });
  if (collection === null) return null;

  let timelineSec = 0;
  let realSec = 0;
  let storyCompleteCount = 0;

  for (const item of collection.items) {
    const race = item.race;
    if (race === null) continue;
    // The season's own length: the races it contained, at their full runtime.
    timelineSec += race.runtimeSec;
    // What the user actually spent, including every re-watch and adjusted for
    // playback speed. A different quantity, deliberately kept apart.
    realSec += race.realViewingSec;
    if (race.storyCompletedAt !== null || item.storyComplete) storyCompleteCount += 1;
  }

  const season = collection.season;
  const championship = season?.championship ?? null;
  const shortName = championship?.shortName ?? championship?.name ?? null;
  const year = season?.year ?? null;

  const itemCount = collection.items.length;

  return {
    collectionKey: collection.key,
    displayName: collection.name,
    // "2027 WEC Season Completion Trophy" when the set belongs to a season of a
    // championship, and the set's own name when it somehow does not.
    trophyName:
      year !== null && shortName !== null
        ? `${year} ${shortName} Season Completion Trophy`
        : `${collection.name} Season Completion Trophy`,
    championshipName: championship?.name ?? null,
    seasonLabel: season ? seasonLabelOf(season) : null,
    year,
    itemCount,
    storyCompleteCount,
    timelineSec,
    realSec,
    isSweep: itemCount > 0 && storyCompleteCount >= itemCount,
    accentColor: championship?.accentColor ?? collection.accentColor,
    completedAt: collection.completedAt ?? now,
    seasonId: season?.id ?? null,
  };
}

/**
 * The facts printed on an opened season trophy.
 *
 * This is the list the design asks for, in the order it asks for it:
 *
 *     8/8 races Story Complete
 *     Total race timeline: 66 hours
 *     Actual viewing time: 49h 17m
 */
function seasonDetails(facts: SeasonFacts): AwardDetail[] {
  const details: AwardDetail[] = [
    {
      label: 'Story Complete',
      value: `${formatNumber(facts.storyCompleteCount)}/${formatNumber(facts.itemCount)} races`,
    },
    { label: 'Total race timeline', value: wholeHours(facts.timelineSec) },
    { label: 'Actual viewing time', value: hoursAndMinutes(facts.realSec) },
  ];
  if (facts.championshipName !== null) details.push({ label: 'Championship', value: facts.championshipName });
  if (facts.year !== null) details.push({ label: 'Season', value: String(facts.year) });
  return details;
}

// ---------------------------------------------------------------------------
// Reading the cabinet
// ---------------------------------------------------------------------------

/**
 * The whole trophy cabinet, grouped by what the trophies are for.
 *
 * Everything on this page comes from the database and only from the database.
 * Unlike the achievement board — which mixes live metrics into its progress
 * bars — a trophy has no progress and no live half: it was awarded, with a
 * name, a rarity and a set of frozen facts, and reading it back is a matter of
 * historical record rather than of recomputation. That is the reading-side
 * counterpart of "nothing here may ever be revoked".
 */
export async function getTrophyCabinet(userId: string, db: Tx = prisma): Promise<TrophyCabinetView> {
  const rows = await db.trophy.findMany({
    where: { userId },
    orderBy: [{ awardedAt: 'desc' }, { key: 'asc' }],
  });

  const entries: TrophyCabinetEntry[] = rows.map((row) => {
    const metadata = readTrophyMetadata(row.metadata);
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      rarity: row.rarity,
      iconKey: row.iconKey,
      accentColor: row.accentColor,
      awardedAt: row.awardedAt,
      details: metadata.details,
      snapshot: metadata.snapshot,
    };
  });

  const byRarity: TrophyRarityTally[] = RARITY_ORDER.map((rarity) => ({
    rarity,
    count: entries.filter((entry) => entry.rarity === rarity).length,
  })).filter((tally) => tally.count > 0);

  const categories: TrophyCabinetGroup[] = TROPHY_CATEGORY_ORDER.map((category) => ({
    category,
    label: TROPHY_CATEGORY_LABELS[category],
    blurb: TROPHY_CATEGORY_BLURBS[category],
    trophies: entries.filter((entry) => entry.category === category),
  })).filter((group) => group.trophies.length > 0);

  return {
    total: entries.length,
    byRarity,
    categories,
    mostRecent: entries[0] ?? null,
    headline: cabinetHeadline(entries.length, entries[0] ?? null),
  };
}

/**
 * The Hall of Fame, newest first and grouped by year.
 *
 * Both shapes are returned from one read: `entries` for anything that wants a
 * flat list, `years` for the timeline the page lays out. Grouping by the year
 * of `occurredAt` rather than of the row's creation is what makes a rebuilt or
 * back-filled career read correctly — the plaque belongs to the year the thing
 * happened in, not to the evening the engine caught up with it.
 */
export async function getHallOfFame(
  userId: string,
  opts?: { category?: HallOfFameCategory },
  db: Tx = prisma,
): Promise<HallOfFameView> {
  const rows = await db.hallOfFameEntry.findMany({
    where: { userId, ...(opts?.category ? { category: opts.category } : {}) },
    orderBy: [{ occurredAt: 'desc' }, { key: 'asc' }],
  });

  const entries: HallOfFameEntryView[] = rows.map((row) => ({
    key: row.key,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category,
    rarity: row.rarity,
    raceId: row.raceId,
    championshipName: row.championshipName,
    seasonLabel: row.seasonLabel,
    occurredAt: row.occurredAt,
    snapshot: readSnapshot(row.snapshot),
  }));

  const byYear = new Map<number, HallOfFameEntryView[]>();
  for (const entry of entries) {
    const year = entry.occurredAt.getFullYear();
    const bucket = byYear.get(year);
    if (bucket) bucket.push(entry);
    else byYear.set(year, [entry]);
  }

  const years: HallOfFameYear[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, yearEntries]) => ({ year, entries: yearEntries }));

  const byCategory: HallOfFameCategoryTally[] = HALL_OF_FAME_CATEGORY_ORDER.map((category) => ({
    category,
    label: HALL_OF_FAME_CATEGORY_LABELS[category],
    count: entries.filter((entry) => entry.category === category).length,
  })).filter((tally) => tally.count > 0);

  return {
    entries,
    years,
    byCategory,
    headline: hallHeadline(entries.length, years.length),
  };
}

// ---------------------------------------------------------------------------
// Copy
//
// Written to the rules in `copy/tone.ts`: an empty cabinet is a cabinet that
// has not been filled YET, never a cabinet that is behind on anything.
// ---------------------------------------------------------------------------

function cabinetHeadline(total: number, mostRecent: TrophyCabinetEntry | null): string {
  if (total === 0) {
    return 'The shelf is waiting. A completed season, a finished mastery tree or a rare achievement is the first thing to go on it.';
  }
  if (total === 1 || mostRecent === null) {
    return 'One trophy on the shelf, and it stays there for good.';
  }
  return `${formatNumber(total)} trophies on the shelf, the most recent from ${longDate(mostRecent.awardedAt)}. Nothing here can be taken back.`;
}

function hallHeadline(total: number, years: number): string {
  if (total === 0) {
    return 'The hall is waiting for its first plaque. Your first completed race earns it.';
  }
  if (total === 1) {
    return 'One moment recorded, with the career frozen exactly as it stood that day.';
  }
  return `${formatNumber(total)} moments recorded across ${countLabel(years, 'year', 'years')}, each one holding the career exactly as it stood at the time.`;
}

// ---------------------------------------------------------------------------
// Reading JSON back
//
// A JSON column is `unknown` as far as this file is concerned, whatever the
// generated types say it might be: the rows outlive the code that wrote them,
// and a plaque written by an older version must still render rather than throw
// a museum page away. Everything below therefore narrows defensively and falls
// back to an empty value rather than failing.
// ---------------------------------------------------------------------------

const EMPTY_METADATA: TrophyMetadata = { details: [], snapshot: null, sourceRef: null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTrophyMetadata(value: unknown): TrophyMetadata {
  const record = asRecord(value);
  if (record === null) return EMPTY_METADATA;
  return {
    details: readDetails(record.details),
    snapshot: readSnapshot(record.snapshot),
    sourceRef: typeof record.sourceRef === 'string' ? record.sourceRef : null,
  };
}

function readDetails(value: unknown): AwardDetail[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  const details: AwardDetail[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) continue;
    if (typeof record.label === 'string' && typeof record.value === 'string') {
      details.push({ label: record.label, value: record.value });
    }
  }
  return details;
}

/**
 * A stored snapshot, or null when the plaque has none.
 *
 * `capturedAt` is the one required field: a record with no captured instant is
 * an empty default rather than a frozen career, and rendering a column of zeros
 * beside a real plaque would be worse than rendering nothing.
 */
function readSnapshot(value: unknown): CareerSnapshot | null {
  const record = asRecord(value);
  if (record === null) return null;
  const capturedAt = record.capturedAt;
  if (typeof capturedAt !== 'string' || capturedAt.length === 0) return null;
  return {
    level: readNumber(record.level, 1),
    prestige: readNumber(record.prestige, 0),
    careerXp: readNumber(record.careerXp, 0),
    realHours: readNumber(record.realHours, 0),
    timelineHours: readNumber(record.timelineHours, 0),
    racesCompleted: readNumber(record.racesCompleted, 0),
    storyCompletes: readNumber(record.storyCompletes, 0),
    championships: readNumber(record.championships, 0),
    seasonsCompleted: readNumber(record.seasonsCompleted, 0),
    circuits: readNumber(record.circuits, 0),
    countries: readNumber(record.countries, 0),
    capturedAt,
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Formatting
//
// Local rather than imported from `lib/utils`: these strings are BAKED INTO a
// trophy's stored metadata at the moment it is awarded, so they have to stay
// stable for the life of the row. Sharing a formatter with the UI would mean a
// later tweak to how the dashboard renders hours silently disagreed with what
// every trophy already on the shelf says.
// ---------------------------------------------------------------------------

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-GB');
}

/** 237_600 -> "66 hours". The scale a race timeline is discussed at. */
function wholeHours(seconds: number): string {
  const hours = Math.max(0, Math.round(seconds / 3600));
  return `${formatNumber(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** 177_420 -> "49h 17m". Real viewing time, which is worth the minutes. */
function hoursAndMinutes(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${formatNumber(hours)}h ${minutes.toString().padStart(2, '0')}m`;
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** "LEGENDARY" -> "Legendary". */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** 10 -> "10th", 500 -> "500th". Used only in plaque prose. */
function ordinal(value: number): string {
  const n = Math.round(value);
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${formatNumber(n)}th`;
  switch (n % 10) {
    case 1: return `${formatNumber(n)}st`;
    case 2: return `${formatNumber(n)}nd`;
    case 3: return `${formatNumber(n)}rd`;
    default: return `${formatNumber(n)}th`;
  }
}

/** "WEC 2027 — Hypercar era" reduced to the part a plaque wants. */
function seasonLabelOf(season: { year: number; label: string | null } | null): string | null {
  if (season === null) return null;
  return season.label ? `${season.year} — ${season.label}` : String(season.year);
}

function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/**
 * Name the thing when it is known, and describe it when it is not.
 *
 * A first run over an existing library records "First Story Complete" without
 * being able to say which race it was, because the race in question was watched
 * long before the engine was there to see it. The generic sentence is written
 * to read as a complete thought rather than as a gap.
 */
function namedOr(name: string | null, fallback: string): string {
  return name === null ? fallback : name;
}
