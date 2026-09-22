/**
 * Mastery trees.
 *
 * A mastery tree is the long view of the career: the thing that is still
 * interesting in year six, when the achievements cabinet has largely been
 * filled and the numbers have stopped being novel. Three kinds exist, and they
 * are deliberately different shapes:
 *
 *   * CHAMPIONSHIP — one per championship in the library, INCLUDING every
 *     custom championship the user invents. A championship the user made up
 *     last Tuesday gets exactly the same tree as the shipped WEC preset,
 *     generated for it automatically, because a library the user built is not
 *     a second-class library.
 *   * RACE_EVENT — one per iconic recurring event (`Race.iconicKey`). This is
 *     what turns "the 24 Hours of Le Mans" from a race into a collection that
 *     grows by one edition a year for as long as the user keeps watching.
 *   * GLOBAL — a single cross-championship career tree, the one that measures
 *     the whole library at once.
 *
 * Four rules run through the file and explain most of its shape:
 *
 *   1. A NODE ONCE UNLOCKED IS NEVER RE-LOCKED. Metrics can move downwards —
 *      a race deleted, a duplicate session corrected, a championship
 *      reorganised — and when they do, `value` follows them down and
 *      `unlockedAt` does not move at all. There is no branch in this file that
 *      writes `unlockedAt: null` over a date, and there must never be one.
 *   2. LOCKED NODES STILL HAVE PROGRESS ROWS. `MasteryProgress` is written for
 *      every node of every tree, unlocked or not, carrying `value` and
 *      `target`, so the mastery page can draw an honest bar towards every node
 *      in the tree rather than a wall of padlocks.
 *   3. EVERY THRESHOLD COMES FROM CONFIGURATION. The node templates live in
 *      `MASTERY_CONFIG`; the measurement tolerances live in `MASTERY_SHAPE`.
 *      Nothing in here decides what a node is worth.
 *   4. REAL TIME AND TIMELINE TIME ARE DIFFERENT QUANTITIES. `realHours` is
 *      wall-clock time in front of the screen and grows when a section is
 *      re-watched; the edition counts are about unique coverage and do not.
 *      They are never added together or swapped for one another.
 *
 * The write paths (`ensureMasteryTrees`, `syncMastery`,
 * `recomputeRaceMasteries`) take the caller's transaction client so that one
 * logged session remains one atomic write. The two view functions are
 * read-only and use the global client.
 */

import { MAJOR_EVENT_SUGGESTIONS, MASTERY_CONFIG, MASTERY_SHAPE } from '@/lib/config';
import { createManySkippingDuplicates, prisma, type Tx } from '@/lib/db/client';
import { RARITY_ORDER, type MasteryKind, type Rarity, type RaceStatus } from '@/lib/domain/types';
import type { MasteryUnlock } from '@/lib/engines/contracts';
import { longestRun } from '@/lib/engines/metrics';
import { awardXp } from '@/lib/engines/xp-ledger';

// ---------------------------------------------------------------------------
// Tree identity and presentation vocabulary
//
// Copy and keys rather than balance, so they live beside the code that builds
// the trees rather than in the economy configuration.
// ---------------------------------------------------------------------------

/**
 * Tree keys are built from the championship's ID rather than its slug, and
 * from the raw `iconicKey` rather than a prettified name. Both are the stable
 * identifiers: a user who renames "WEC" to "World Endurance" keeps the tree
 * they have been filling for three years instead of being handed a fresh empty
 * one beside it.
 */
const GLOBAL_TREE_KEY = 'global';

function championshipTreeKey(championshipId: string): string {
  return `championship:${championshipId}`;
}

function eventTreeKey(iconicKey: string): string {
  return `event:${iconicKey}`;
}

const GLOBAL_TREE_NAME = 'Endurance Career';
const GLOBAL_TREE_DESCRIPTION =
  'Everything you have watched, across every championship in your library.';

/**
 * Accent used when nothing better is available. It mirrors the column default
 * in `schema.prisma` so a tree created here and a tree created by a migration
 * look the same. Presentation, not balance.
 */
const FALLBACK_ACCENT = '#c8a45c';

/** Spacing between generated `sortOrder` values, so a node can be slotted in later. */
const SORT_ORDER_STEP = 10;

// ---------------------------------------------------------------------------
// Node templates
// ---------------------------------------------------------------------------

/**
 * The shape every node template shares. The three arrays in `MASTERY_CONFIG`
 * are `as const`, so this interface is what lets them be handled uniformly
 * without widening the configuration itself.
 */
interface MasteryNodeTemplate {
  key: string;
  name: string;
  description: string;
  metric: string;
  threshold: number;
  xpReward: number;
  tier: number;
  rarity: Rarity;
}

const CHAMPIONSHIP_NODES: readonly MasteryNodeTemplate[] = MASTERY_CONFIG.championshipNodes;
const RACE_EVENT_NODES: readonly MasteryNodeTemplate[] = MASTERY_CONFIG.raceEventNodes;
const GLOBAL_NODES: readonly MasteryNodeTemplate[] = MASTERY_CONFIG.globalNodes;

// ---------------------------------------------------------------------------
// Pure inputs and metrics
// ---------------------------------------------------------------------------

/**
 * One race, reduced to the facts mastery cares about.
 *
 * Declared as its own type rather than reusing a Prisma row so that the metric
 * arithmetic below is pure and can be tested without a database — the same
 * reason the budget and strategist engines keep a pure core.
 */
export interface MasteryRaceInput {
  id: string;
  championshipId: string | null;
  seasonId: string | null;
  /** Groups recurring editions of one event. Null for a one-off race. */
  iconicKey: string | null;
  circuitSlug: string | null;
  runtimeSec: number;
  /** Wall-clock seconds watched, re-watches included. */
  realViewingSec: number;
  /** Timeline seconds played, re-watches included. A different quantity. */
  timelineWatchedSec: number;
  isMajorEvent: boolean;
  /** True once timeline coverage crossed the Story Complete threshold. */
  storyComplete: boolean;
  /** Story Complete, or marked finished by hand. */
  completed: boolean;
  /** The year this edition belongs to, when it is known. */
  year: number | null;
}

/** One season of a championship, for the "complete a season" nodes. */
export interface MasterySeasonInput {
  id: string;
  championshipId: string;
  year: number;
  /** The user's own definition of the season's length. Null means "what I have". */
  plannedRaceCount: number | null;
}

/**
 * The metrics a mastery node can be measured against, computed per scope.
 *
 * The names are the `metric` field of the node templates. They mirror the
 * career-wide names in `CareerMetrics` on purpose — `realHours` means the same
 * thing inside a championship tree as it does on the statistics page, it is
 * simply measured over fewer races.
 *
 * `championships` is here because the global tree asks for it ("Story Complete
 * races in three championships"). Inside a championship tree it is 1 once
 * anything has been finished there, which is true and harmless.
 */
export interface MasteryMetrics {
  /** Races Story Completed within the scope. */
  storyCompletes: number;
  /** Real viewing hours within the scope, one decimal place. */
  realHours: number;
  /** Seasons whose every race is finished. */
  seasonsComplete: number;
  /** Story Completes of races tagged as major events. */
  majorEventStories: number;
  stories12h: number;
  stories24h: number;
  /** Distinct circuits among finished races. */
  circuits: number;
  /** Distinct championships among Story Completed races. */
  championships: number;
  /** Story Completed races belonging to a recurring event. */
  editionsStoryComplete: number;
  /** Longest run of consecutive years with a Story Complete edition. */
  consecutiveEditions: number;
}

const EMPTY_METRICS: MasteryMetrics = {
  storyCompletes: 0,
  realHours: 0,
  seasonsComplete: 0,
  majorEventStories: 0,
  stories12h: 0,
  stories24h: 0,
  circuits: 0,
  championships: 0,
  editionsStoryComplete: 0,
  consecutiveEditions: 0,
};

/**
 * Measure a set of races (and the seasons they belong to) against every
 * mastery metric.
 *
 * The scope is whatever the caller passes in: one championship's races, one
 * event's editions, or the whole library. That is the whole trick — a
 * championship tree and the global tree run identical arithmetic over
 * different slices, so "fifty hours" cannot come to mean two different things
 * in two different panels.
 */
function computeMetrics(
  races: readonly MasteryRaceInput[],
  seasons: readonly MasterySeasonInput[],
): MasteryMetrics {
  const circuits = new Set<string>();
  const championships = new Set<string>();
  const editionYears = new Map<string, number[]>();
  const racesBySeason = new Map<string, MasteryRaceInput[]>();

  const metrics: MasteryMetrics = { ...EMPTY_METRICS };
  let realSeconds = 0;

  for (const race of races) {
    // Real viewing time counts whatever the race's state: an unfinished race
    // watched for twenty hours was still twenty hours of your life.
    realSeconds += Math.max(0, race.realViewingSec);

    if (race.seasonId !== null) {
      const bucket = racesBySeason.get(race.seasonId);
      if (bucket) bucket.push(race);
      else racesBySeason.set(race.seasonId, [race]);
    }

    // Circuits follow "finished", not "Story Complete", so a race the user
    // marked done by hand still puts its circuit on the map.
    if (race.completed && race.circuitSlug !== null) circuits.add(race.circuitSlug);

    if (!race.storyComplete) continue;

    metrics.storyCompletes += 1;
    if (race.championshipId !== null) championships.add(race.championshipId);
    if (race.isMajorEvent) metrics.majorEventStories += 1;

    const hours = race.runtimeSec / 3600;
    if (hours >= MASTERY_SHAPE.stories12hMinHours) metrics.stories12h += 1;
    if (hours >= MASTERY_SHAPE.stories24hMinHours) metrics.stories24h += 1;

    if (race.iconicKey !== null) {
      metrics.editionsStoryComplete += 1;
      const years = editionYears.get(race.iconicKey);
      if (years) {
        if (race.year !== null) years.push(race.year);
      } else {
        editionYears.set(race.iconicKey, race.year !== null ? [race.year] : []);
      }
    }
  }

  metrics.realHours = round1(realSeconds / 3600);
  metrics.circuits = circuits.size;
  metrics.championships = championships.size;

  for (const season of seasons) {
    const seasonRaces = racesBySeason.get(season.id) ?? [];
    // The user owns the definition of a season's length. Absent one, the
    // season is however many races they have chosen to put in it.
    const target = season.plannedRaceCount ?? seasonRaces.length;
    if (target <= 0) continue;
    let finished = 0;
    for (const race of seasonRaces) if (race.completed) finished += 1;
    if (finished >= target) metrics.seasonsComplete += 1;
  }

  // Consecutive editions is always the best single event in the scope, never a
  // run stitched together out of different events. Inside an event tree there
  // is only one event to measure, which is the case the nodes are written for;
  // inside a championship or the global tree it answers "what is the longest
  // streak you have going anywhere", which is what the career metric of the
  // same name means too.
  for (const years of editionYears.values()) {
    metrics.consecutiveEditions = Math.max(metrics.consecutiveEditions, longestRun(years));
  }

  return metrics;
}

/**
 * Metrics for one championship's tree.
 *
 * Pure and exported so the balance of a championship tree can be tested
 * against a handful of literal races without touching a database.
 */
export function computeChampionshipMetrics(
  races: MasteryRaceInput[],
  seasons: MasterySeasonInput[],
): MasteryMetrics {
  return computeMetrics(races, seasons);
}

/**
 * Metrics for one recurring event's tree. `races` are the editions.
 *
 * There is no season argument because an event is not a season — the editions
 * of Le Mans are a collection that runs across championships and decades, so
 * `seasonsComplete` is zero here by definition rather than by omission.
 */
export function computeEventMetrics(races: MasteryRaceInput[]): MasteryMetrics {
  return computeMetrics(races, []);
}

/**
 * Read a named metric out of `MasteryMetrics`.
 *
 * Templates name their metric as a string, so the lookup is unavoidably
 * dynamic. An unknown name resolves to zero rather than throwing: a typo in a
 * future node definition should leave that one node quietly unreachable, not
 * take down the stint that was being logged when it was noticed.
 */
function metricValue(metrics: MasteryMetrics, metric: string): number {
  const record = metrics as unknown as Record<string, number | undefined>;
  const value = record[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Loading the inputs
// ---------------------------------------------------------------------------

interface RaceRow {
  id: string;
  championshipId: string | null;
  seasonId: string | null;
  iconicKey: string | null;
  circuitSlug: string | null;
  runtimeSec: number;
  realViewingSec: number;
  timelineWatchedSec: number;
  isMajorEvent: boolean;
  status: RaceStatus;
  storyCompletedAt: Date | null;
  raceDate: Date | null;
}

interface MasteryInputs {
  races: MasteryRaceInput[];
  seasons: MasterySeasonInput[];
}

/**
 * Which year an edition belongs to.
 *
 * The race's own date is authoritative. When it is missing — and it often is,
 * because nothing is imported and the user types what they feel like typing —
 * the season it was filed under supplies the year instead. An edition without
 * a date still happened in a year, and refusing to count it would quietly
 * break a consecutive-editions run on a technicality of data entry.
 */
function editionYear(race: { raceDate: Date | null; seasonId: string | null }, seasonYears: Map<string, number>): number | null {
  if (race.raceDate !== null) return race.raceDate.getFullYear();
  if (race.seasonId !== null) return seasonYears.get(race.seasonId) ?? null;
  return null;
}

function toRaceInput(row: RaceRow, seasonYears: Map<string, number>): MasteryRaceInput {
  const storyComplete = row.storyCompletedAt !== null;
  return {
    id: row.id,
    championshipId: row.championshipId,
    seasonId: row.seasonId,
    iconicKey: row.iconicKey,
    circuitSlug: row.circuitSlug,
    runtimeSec: row.runtimeSec,
    realViewingSec: row.realViewingSec,
    timelineWatchedSec: row.timelineWatchedSec,
    isMajorEvent: row.isMajorEvent,
    storyComplete,
    completed: storyComplete || row.status === 'COMPLETED',
    year: editionYear(row, seasonYears),
  };
}

/**
 * Read every race and season the mastery metrics are built from.
 *
 * `db` MUST be the active transaction client when this runs inside a logged
 * session, or the session that was just written would be invisible and every
 * tree would be evaluated one stint behind.
 */
async function loadMasteryInputs(db: Tx, userId: string): Promise<MasteryInputs> {
  const [raceRows, seasonRows] = await Promise.all([
    db.race.findMany({
      where: { userId },
      select: {
        id: true, championshipId: true, seasonId: true, iconicKey: true, circuitSlug: true,
        runtimeSec: true, realViewingSec: true, timelineWatchedSec: true, isMajorEvent: true,
        status: true, storyCompletedAt: true, raceDate: true,
      },
    }),
    db.championshipSeason.findMany({
      where: { championship: { userId } },
      select: { id: true, championshipId: true, year: true, plannedRaceCount: true },
    }),
  ]);

  const seasonYears = new Map(seasonRows.map((season) => [season.id, season.year]));

  return {
    races: raceRows.map((row) => toRaceInput(row, seasonYears)),
    seasons: seasonRows.map((season) => ({
      id: season.id,
      championshipId: season.championshipId,
      year: season.year,
      plannedRaceCount: season.plannedRaceCount,
    })),
  };
}

interface MasteryScopes {
  global: MasteryMetrics;
  byChampionship: Map<string, MasteryMetrics>;
  byEvent: Map<string, MasteryMetrics>;
}

/**
 * Compute every scope's metrics in one pass over the library.
 *
 * A user with eight championships and a dozen iconic events has twenty-one
 * trees; measuring each one with its own set of queries would turn a logged
 * stint into a small avalanche. One read, many slices.
 */
function computeScopes(inputs: MasteryInputs): MasteryScopes {
  const racesByChampionship = new Map<string, MasteryRaceInput[]>();
  const racesByEvent = new Map<string, MasteryRaceInput[]>();
  const seasonsByChampionship = new Map<string, MasterySeasonInput[]>();

  for (const race of inputs.races) {
    if (race.championshipId !== null) push(racesByChampionship, race.championshipId, race);
    if (race.iconicKey !== null) push(racesByEvent, race.iconicKey, race);
  }
  for (const season of inputs.seasons) push(seasonsByChampionship, season.championshipId, season);

  const byChampionship = new Map<string, MasteryMetrics>();
  const championshipIds = new Set([...racesByChampionship.keys(), ...seasonsByChampionship.keys()]);
  for (const championshipId of championshipIds) {
    byChampionship.set(
      championshipId,
      computeChampionshipMetrics(
        racesByChampionship.get(championshipId) ?? [],
        seasonsByChampionship.get(championshipId) ?? [],
      ),
    );
  }

  const byEvent = new Map<string, MasteryMetrics>();
  for (const [iconicKey, races] of racesByEvent) {
    byEvent.set(iconicKey, computeEventMetrics(races));
  }

  return {
    global: computeMetrics(inputs.races, inputs.seasons),
    byChampionship,
    byEvent,
  };
}

/**
 * The metrics a given tree measures itself against.
 *
 * A tree whose scope holds nothing yet — a championship created a minute ago —
 * gets the empty metrics rather than no metrics, so its nodes still get
 * progress rows and the page can draw the tree it is about to fill.
 */
function metricsForTree(
  scopes: MasteryScopes,
  tree: { kind: MasteryKind; championshipId: string | null; iconicKey: string | null },
): MasteryMetrics {
  if (tree.kind === 'CHAMPIONSHIP') {
    return (tree.championshipId !== null ? scopes.byChampionship.get(tree.championshipId) : undefined) ?? EMPTY_METRICS;
  }
  if (tree.kind === 'RACE_EVENT') {
    return (tree.iconicKey !== null ? scopes.byEvent.get(tree.iconicKey) : undefined) ?? EMPTY_METRICS;
  }
  return scopes.global;
}

// ---------------------------------------------------------------------------
// Tree generation
// ---------------------------------------------------------------------------

interface DesiredTree {
  key: string;
  kind: MasteryKind;
  name: string;
  description: string;
  accentColor: string;
  championshipId: string | null;
  iconicKey: string | null;
  nodes: readonly MasteryNodeTemplate[];
}

/**
 * A readable name for a recurring event.
 *
 * The suggested major events supply the proper name where one exists
 * ("le-mans-24" is the 24 Hours of Le Mans). Anything else — and the user is
 * free to invent any key they like — is titled from the key itself rather than
 * from a race name, because race names carry years and an event tree outlives
 * every one of its editions.
 */
function eventDisplayName(iconicKey: string): string {
  for (const suggestion of MAJOR_EVENT_SUGGESTIONS) {
    if (suggestion.key === iconicKey) return suggestion.name;
  }
  const words = iconicKey
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(' ') : iconicKey;
}

/**
 * The accent an event tree borrows.
 *
 * An event has no colour of its own, so it takes the accent of whichever
 * championship most of its editions were filed under — Le Mans reads as a WEC
 * event to somebody whose Le Mans races all sit in WEC. Ties are broken by
 * championship ID so the choice is deterministic and the colour does not
 * wander between runs.
 */
function eventAccent(
  iconicKey: string,
  eventChampionships: Map<string, Map<string, number>>,
  accents: Map<string, string>,
): string {
  const counts = eventChampionships.get(iconicKey);
  if (!counts) return FALLBACK_ACCENT;

  let bestId: string | null = null;
  let bestCount = 0;
  for (const [championshipId, count] of counts) {
    if (count > bestCount || (count === bestCount && bestId !== null && championshipId < bestId)) {
      bestId = championshipId;
      bestCount = count;
    }
  }
  return bestId === null ? FALLBACK_ACCENT : (accents.get(bestId) ?? FALLBACK_ACCENT);
}

/**
 * Create the mastery trees and nodes the library currently implies.
 *
 * Idempotent, and called on the session path for exactly that reason: a
 * championship the user invented ten seconds ago, or an `iconicKey` typed onto
 * a race for the first time, receives its tree automatically on the next
 * stint. Nothing here has to be seeded by hand.
 *
 * It also reconciles what already exists. Node templates that have been added
 * to configuration since a tree was created are inserted into it, and a tree or
 * node whose name, description, accent, reward or threshold has been
 * re-balanced is brought in line. Both comparisons happen in memory and write
 * nothing in the steady state, so the usual cost of this function inside a
 * logged session is three reads and no writes.
 *
 * What it never does is remove anything. A node template deleted from
 * configuration leaves its node and its unlock exactly where they are — an
 * economy re-balance is not a reason to take something out of somebody's
 * career.
 *
 * Returns the number of trees CREATED by this call, which is zero on every run
 * after the first until the library grows.
 */
export async function ensureMasteryTrees(tx: Tx, userId: string, now: Date = new Date()): Promise<number> {
  const [championships, iconicRaces, existingTrees] = await Promise.all([
    tx.championship.findMany({
      where: { userId },
      select: { id: true, name: true, accentColor: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    tx.race.findMany({
      where: { userId, iconicKey: { not: null } },
      select: { iconicKey: true, championshipId: true },
    }),
    tx.masteryTree.findMany({
      where: { userId },
      select: {
        id: true, key: true, name: true, description: true, accentColor: true,
        nodes: {
          select: {
            id: true, key: true, name: true, description: true, metric: true,
            threshold: true, xpReward: true, tier: true, sortOrder: true, rarity: true,
          },
        },
      },
    }),
  ]);

  const accents = new Map(championships.map((c) => [c.id, c.accentColor]));
  const eventChampionships = new Map<string, Map<string, number>>();
  const eventKeys = new Set<string>();

  for (const race of iconicRaces) {
    const iconicKey = race.iconicKey;
    if (iconicKey === null) continue;
    eventKeys.add(iconicKey);
    if (race.championshipId === null) continue;
    const counts = eventChampionships.get(iconicKey) ?? new Map<string, number>();
    counts.set(race.championshipId, (counts.get(race.championshipId) ?? 0) + 1);
    eventChampionships.set(iconicKey, counts);
  }

  const desired: DesiredTree[] = [
    {
      key: GLOBAL_TREE_KEY,
      kind: 'GLOBAL',
      name: GLOBAL_TREE_NAME,
      description: GLOBAL_TREE_DESCRIPTION,
      accentColor: FALLBACK_ACCENT,
      championshipId: null,
      iconicKey: null,
      nodes: GLOBAL_NODES,
    },
  ];

  for (const championship of championships) {
    desired.push({
      key: championshipTreeKey(championship.id),
      kind: 'CHAMPIONSHIP',
      name: championship.name,
      description: `Your career inside ${championship.name}.`,
      accentColor: championship.accentColor,
      championshipId: championship.id,
      iconicKey: null,
      nodes: CHAMPIONSHIP_NODES,
    });
  }

  for (const iconicKey of [...eventKeys].sort()) {
    const name = eventDisplayName(iconicKey);
    desired.push({
      key: eventTreeKey(iconicKey),
      kind: 'RACE_EVENT',
      name,
      description: `Every edition of ${name} in your library, however many years that comes to.`,
      accentColor: eventAccent(iconicKey, eventChampionships, accents),
      championshipId: null,
      iconicKey,
      nodes: RACE_EVENT_NODES,
    });
  }

  const existingByKey = new Map(existingTrees.map((tree) => [tree.key, tree]));
  let created = 0;

  for (const tree of desired) {
    const existing = existingByKey.get(tree.key);

    if (!existing) {
      const row = await tx.masteryTree.create({
        data: {
          userId,
          kind: tree.kind,
          championshipId: tree.championshipId,
          iconicKey: tree.iconicKey,
          key: tree.key,
          name: tree.name,
          description: tree.description,
          accentColor: tree.accentColor,
          createdAt: now,
        },
        select: { id: true },
      });
      await createManySkippingDuplicates(
        tx.masteryNode,
        tree.nodes.map((template, index) => nodeData(row.id, template, index)),
      );
      created += 1;
      continue;
    }

    if (
      existing.name !== tree.name ||
      existing.description !== tree.description ||
      existing.accentColor !== tree.accentColor
    ) {
      await tx.masteryTree.update({
        where: { id: existing.id },
        data: { name: tree.name, description: tree.description, accentColor: tree.accentColor },
      });
    }

    const nodesByKey = new Map(existing.nodes.map((node) => [node.key, node]));
    const missing: ReturnType<typeof nodeData>[] = [];

    for (let index = 0; index < tree.nodes.length; index += 1) {
      const template = tree.nodes[index];
      if (template === undefined) continue;
      const node = nodesByKey.get(template.key);
      const data = nodeData(existing.id, template, index);

      if (!node) {
        missing.push(data);
        continue;
      }
      if (
        node.name === data.name && node.description === data.description &&
        node.metric === data.metric && node.threshold === data.threshold &&
        node.xpReward === data.xpReward && node.tier === data.tier &&
        node.sortOrder === data.sortOrder && node.rarity === data.rarity
      ) {
        continue;
      }
      await tx.masteryNode.update({
        where: { id: node.id },
        data: {
          name: data.name, description: data.description, metric: data.metric,
          threshold: data.threshold, xpReward: data.xpReward, tier: data.tier,
          sortOrder: data.sortOrder, rarity: data.rarity,
        },
      });
    }

    if (missing.length > 0) {
      await createManySkippingDuplicates(tx.masteryNode, missing);
    }
  }

  return created;
}

function nodeData(treeId: string, template: MasteryNodeTemplate, index: number) {
  return {
    treeId,
    key: template.key,
    name: template.name,
    description: template.description,
    metric: template.metric,
    threshold: template.threshold,
    xpReward: template.xpReward,
    tier: template.tier,
    // Spaced so a template inserted between two others later does not
    // renumber the whole tree.
    sortOrder: index * SORT_ORDER_STEP,
    rarity: template.rarity,
  };
}

// ---------------------------------------------------------------------------
// Race mastery aggregates
// ---------------------------------------------------------------------------

/**
 * Rebuild the `RaceMastery` row behind every recurring event.
 *
 * Rebuilt from the `Race` rows rather than incremented, on exactly the same
 * reasoning as the race aggregates: a counter that is added to can drift, and
 * a figure derived from the races can be recomputed from scratch at any time
 * and come out the same. Editing a race's date or deleting a mis-added edition
 * therefore corrects the event's history rather than leaving it wrong forever.
 *
 * It also keeps `Race.raceMasteryId` pointing at the right row, which is what
 * lets the UI walk from an event straight to its editions.
 *
 * A `RaceMastery` row whose event no longer has any races is left exactly as
 * it is: emptied counters would read as a record being withdrawn, and nothing
 * in this application takes something back.
 *
 * Returns the number of events recomputed.
 */
export async function recomputeRaceMasteries(tx: Tx, userId: string, now: Date = new Date()): Promise<number> {
  const raceRows = await tx.race.findMany({
    where: { userId, iconicKey: { not: null } },
    select: {
      id: true, iconicKey: true, seasonId: true, raceDate: true, realViewingSec: true,
      timelineWatchedSec: true, storyCompletedAt: true, raceMasteryId: true,
    },
  });

  // Races that used to belong to an event and no longer do should not keep
  // pointing at it. Tidying the link is not the same as removing a record —
  // the event's own row keeps every figure it has earned.
  await tx.race.updateMany({
    where: { userId, iconicKey: null, raceMasteryId: { not: null } },
    data: { raceMasteryId: null },
  });

  if (raceRows.length === 0) return 0;

  const seasonIds = [...new Set(raceRows.map((row) => row.seasonId).filter((id): id is string => id !== null))];
  const seasonRows = seasonIds.length === 0
    ? []
    : await tx.championshipSeason.findMany({ where: { id: { in: seasonIds } }, select: { id: true, year: true } });
  const seasonYears = new Map(seasonRows.map((season) => [season.id, season.year]));

  const byEvent = new Map<string, typeof raceRows>();
  for (const row of raceRows) {
    if (row.iconicKey === null) continue;
    const bucket = byEvent.get(row.iconicKey);
    if (bucket) bucket.push(row);
    else byEvent.set(row.iconicKey, [row]);
  }

  for (const [iconicKey, editions] of byEvent) {
    let totalRealSec = 0;
    let totalTimelineSec = 0;
    let editionsStoryComplete = 0;
    const completedYears: number[] = [];

    for (const edition of editions) {
      totalRealSec += Math.max(0, edition.realViewingSec);
      // Timeline seconds PLAYED, the companion figure to real seconds. Unique
      // coverage is a different quantity and is deliberately not summed here.
      totalTimelineSec += Math.max(0, edition.timelineWatchedSec);
      if (edition.storyCompletedAt === null) continue;
      editionsStoryComplete += 1;
      const year = editionYear(edition, seasonYears);
      if (year !== null) completedYears.push(year);
    }

    const firstCompletedYear = completedYears.length === 0 ? null : Math.min(...completedYears);
    const latestCompletedYear = completedYears.length === 0 ? null : Math.max(...completedYears);

    const figures = {
      name: eventDisplayName(iconicKey),
      editionsTracked: editions.length,
      editionsStoryComplete,
      totalRealSec,
      totalTimelineSec,
      firstCompletedYear,
      latestCompletedYear,
      longestConsecutiveEditions: longestRun(completedYears),
    };

    const row = await tx.raceMastery.upsert({
      where: { userId_key: { userId, key: iconicKey } },
      create: { userId, key: iconicKey, ...figures, createdAt: now },
      update: figures,
      select: { id: true },
    });

    const toLink = editions.filter((edition) => edition.raceMasteryId !== row.id).map((edition) => edition.id);
    if (toLink.length > 0) {
      // The ids were derived from this account's races; repeating the userId
      // here makes the statement safe to read on its own.
      await tx.race.updateMany({ where: { id: { in: toLink }, userId }, data: { raceMasteryId: row.id } });
    }
  }

  return byEvent.size;
}

// ---------------------------------------------------------------------------
// Synchronising progress
// ---------------------------------------------------------------------------

interface PendingUnlock {
  treeId: string;
  treeKey: string;
  treeName: string;
  nodeKey: string;
  nodeName: string;
  description: string;
  rarity: Rarity;
  xpReward: number;
}

/**
 * Recompute every node's progress and unlock whatever has come true.
 *
 * Runs inside the caller's transaction, after the session that may have caused
 * an unlock has already been written, so the metrics it reads include that
 * session.
 *
 * Returns only the nodes that unlocked on THIS run, which is what the stint
 * summary celebrates. Re-running grants nothing further and returns an empty
 * list: the `unlockedAt` check is the logical guard and the
 * `mastery:<treeKey>:<nodeKey>` dedupe key on the XP ledger is the structural
 * one.
 *
 * A NODE IS NEVER RE-LOCKED. If a metric moves downwards, `value` follows it
 * and `unlockedAt` stays exactly where it was — the unlock happened, and an
 * edit to the library afterwards does not unhappen it. There is deliberately
 * no branch below that writes `unlockedAt: null` over a date.
 */
export async function syncMastery(tx: Tx, userId: string, now: Date = new Date()): Promise<MasteryUnlock[]> {
  const [trees, inputs] = await Promise.all([
    tx.masteryTree.findMany({
      where: { userId },
      select: {
        id: true, key: true, kind: true, name: true, championshipId: true, iconicKey: true,
        nodes: {
          select: {
            id: true, key: true, name: true, description: true, metric: true,
            threshold: true, xpReward: true, tier: true, sortOrder: true, rarity: true,
            progress: { where: { userId }, select: { id: true, value: true, target: true, unlockedAt: true } },
          },
        },
      },
    }),
    loadMasteryInputs(tx, userId),
  ]);

  const scopes = computeScopes(inputs);

  const creates: { userId: string; nodeId: string; value: number; target: number; unlockedAt: Date | null }[] = [];
  const updates: { id: string; value: number; target: number; unlockedAt: Date | null }[] = [];
  const pending: PendingUnlock[] = [];
  /** Nodes already unlocked per tree, so tree progress can be reported honestly. */
  const treeState = new Map<string, { unlocked: number; total: number }>();

  for (const tree of trees) {
    const metrics = metricsForTree(scopes, tree);
    const ordered = [...tree.nodes].sort(compareNodes);
    let unlockedAlready = 0;

    for (const node of ordered) {
      const existing = node.progress[0];
      const value = metricValue(metrics, node.metric);
      const target = node.threshold;
      const conditionMet = value >= target;
      const wasUnlocked = existing !== undefined && existing.unlockedAt !== null;
      if (wasUnlocked) unlockedAlready += 1;
      const newlyUnlocked = !wasUnlocked && conditionMet;

      if (newlyUnlocked) {
        pending.push({
          treeId: tree.id,
          treeKey: tree.key,
          treeName: tree.name,
          nodeKey: node.key,
          nodeName: node.name,
          description: node.description,
          rarity: node.rarity,
          xpReward: node.xpReward,
        });
      }

      if (existing === undefined) {
        // Created whether or not the condition holds: a locked node with a
        // visible bar is the entire point of the mastery page.
        creates.push({ userId, nodeId: node.id, value, target, unlockedAt: newlyUnlocked ? now : null });
        continue;
      }

      // Most nodes in most trees have not moved since the last stint, so the
      // write is skipped entirely when nothing changed.
      if (!newlyUnlocked && existing.value === value && existing.target === target) continue;

      updates.push({
        id: existing.id,
        value,
        target,
        // Whatever was there stays there. This is the "never re-locked" rule,
        // in code.
        unlockedAt: existing.unlockedAt ?? (conditionMet ? now : null),
      });
    }

    treeState.set(tree.id, { unlocked: unlockedAlready, total: tree.nodes.length });
  }

  if (creates.length > 0) {
    // `skipDuplicates` guards the one race worth guarding: two writers
    // creating the first progress row for the same node at once.
    await createManySkippingDuplicates(tx.masteryProgress, creates);
  }

  for (const update of updates) {
    await tx.masteryProgress.update({
      where: { id: update.id },
      data: { value: update.value, target: update.target, unlockedAt: update.unlockedAt },
    });
  }

  const unlocks: MasteryUnlock[] = [];

  for (const unlock of pending) {
    const award = await awardXp(tx, userId, {
      source: 'MASTERY_NODE',
      amount: unlock.xpReward,
      description: `Mastery — ${unlock.treeName}: ${unlock.nodeName}`,
      sourceRef: `${unlock.treeKey}:${unlock.nodeKey}`,
      // The structural double-award guard: unique in the database, stable
      // across re-balances, and the reason re-running this engine is safe.
      dedupeKey: `mastery:${unlock.treeKey}:${unlock.nodeKey}`,
    });

    // Several nodes of one tree can land in a single stint, so tree progress
    // is advanced as each one is granted. Only the node that actually finishes
    // the tree reports `treeCompleted`, which is what earns the full-screen
    // celebration upstream.
    const state = treeState.get(unlock.treeId) ?? { unlocked: 0, total: 0 };
    state.unlocked += 1;
    treeState.set(unlock.treeId, state);

    unlocks.push({
      treeKey: unlock.treeKey,
      treeName: unlock.treeName,
      nodeKey: unlock.nodeKey,
      nodeName: unlock.nodeName,
      description: unlock.description,
      rarity: unlock.rarity,
      xpAwarded: award.granted,
      treeProgress: state.total <= 0 ? 1 : Math.min(1, state.unlocked / state.total),
      treeCompleted: state.total > 0 && state.unlocked >= state.total,
    });
  }

  return unlocks.sort(compareUnlocksByImpact);
}

// ---------------------------------------------------------------------------
// Views — read-only
// ---------------------------------------------------------------------------

export interface MasteryNodeView {
  key: string;
  name: string;
  description: string;
  metric: string;
  /** Live metric value, so the bar is never stale. */
  value: number;
  target: number;
  /** 0-1, clamped. Present whether the node is locked or not. */
  progress: number;
  unlocked: boolean;
  unlockedAt: Date | null;
  rarity: Rarity;
  /** Visual row of the tree. */
  tier: number;
  xpReward: number;
}

/** One row of the tree, so the UI can draw it as a tree rather than a list. */
export interface MasteryTierGroup {
  tier: number;
  nodes: MasteryNodeView[];
  unlocked: number;
  total: number;
}

export interface MasteryTreeView {
  key: string;
  kind: MasteryKind;
  name: string;
  description: string | null;
  accentColor: string;
  championshipId: string | null;
  iconicKey: string | null;
  /** Every node, in tree order. */
  nodes: MasteryNodeView[];
  /** The same nodes grouped into rows by `tier`. */
  tiers: MasteryTierGroup[];
  nodeCount: number;
  unlockedCount: number;
  /** Nodes still ahead. Never framed as a list of things left undone. */
  nodesRemaining: number;
  /** 0-100, one decimal place. */
  completionPercent: number;
  completed: boolean;
  /** Career XP this tree has already contributed. */
  xpEarned: number;
  /** Career XP still sitting in the tree. Waiting, never owed. */
  xpWaiting: number;
  headline: string;
}

/**
 * Build the views for every tree matching an optional filter.
 *
 * Node values are recomputed live from the library rather than read out of
 * `MasteryProgress`, so a bar is never stale — but `unlocked` comes from the
 * stored row, because an unlock is a permanent fact recorded at a moment in
 * time and not something re-derived on every page load. A node whose value has
 * passed its target but whose unlock has not been written yet therefore shows
 * a full bar and no unlock, which is exactly what is true until the next stint
 * runs `syncMastery`.
 */
async function buildTreeViews(userId: string, championshipId?: string): Promise<MasteryTreeView[]> {
  const [trees, inputs] = await Promise.all([
    prisma.masteryTree.findMany({
      where: { userId, ...(championshipId === undefined ? {} : { championshipId }) },
      select: {
        id: true, key: true, kind: true, name: true, description: true, accentColor: true,
        championshipId: true, iconicKey: true,
        championship: { select: { sortOrder: true, name: true } },
        nodes: {
          select: {
            key: true, name: true, description: true, metric: true, threshold: true,
            xpReward: true, tier: true, sortOrder: true, rarity: true,
            progress: { where: { userId }, select: { unlockedAt: true } },
          },
        },
      },
    }),
    loadMasteryInputs(prisma, userId),
  ]);

  const scopes = computeScopes(inputs);

  const views = trees.map((tree) => {
    const metrics = metricsForTree(scopes, tree);
    const nodes: MasteryNodeView[] = [...tree.nodes].sort(compareNodes).map((node) => {
      const unlockedAt = node.progress[0]?.unlockedAt ?? null;
      const value = metricValue(metrics, node.metric);
      return {
        key: node.key,
        name: node.name,
        description: node.description,
        metric: node.metric,
        value,
        target: node.threshold,
        progress: progressTowards(value, node.threshold),
        unlocked: unlockedAt !== null,
        unlockedAt,
        rarity: node.rarity,
        tier: node.tier,
        xpReward: node.xpReward,
      };
    });

    const unlockedCount = nodes.filter((node) => node.unlocked).length;
    const tiers: MasteryTierGroup[] = [];
    for (const node of nodes) {
      let group = tiers.find((candidate) => candidate.tier === node.tier);
      if (!group) {
        group = { tier: node.tier, nodes: [], unlocked: 0, total: 0 };
        tiers.push(group);
      }
      group.nodes.push(node);
      group.total += 1;
      if (node.unlocked) group.unlocked += 1;
    }
    tiers.sort((a, b) => a.tier - b.tier);

    const view: MasteryTreeView = {
      key: tree.key,
      kind: tree.kind,
      name: tree.name,
      description: tree.description,
      accentColor: tree.accentColor,
      championshipId: tree.championshipId,
      iconicKey: tree.iconicKey,
      nodes,
      tiers,
      nodeCount: nodes.length,
      unlockedCount,
      nodesRemaining: nodes.length - unlockedCount,
      completionPercent: percent(unlockedCount, nodes.length),
      completed: nodes.length > 0 && unlockedCount === nodes.length,
      xpEarned: nodes.reduce((sum, node) => sum + (node.unlocked ? node.xpReward : 0), 0),
      xpWaiting: nodes.reduce((sum, node) => sum + (node.unlocked ? 0 : node.xpReward), 0),
      headline: treeHeadline(unlockedCount, nodes.length),
    };
    return { view, sortKey: treeSortKey(tree) };
  });

  // The career first, then the championships in the user's own order, then the
  // events. It reads outward from "everything" to "this one race, every year".
  views.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return views.map((entry) => entry.view);
}

/** Every tree, for the mastery page. */
export async function getMasteryOverview(userId: string): Promise<MasteryTreeView[]> {
  return buildTreeViews(userId);
}

/**
 * One championship's tree, or null when that championship has no tree yet.
 *
 * Null rather than a thrown error: the stint summary asks for this and a
 * championship whose tree has not been generated yet is an ordinary state, not
 * a fault.
 */
export async function getMasteryForChampionship(
  userId: string,
  championshipId: string,
): Promise<MasteryTreeView | null> {
  const views = await buildTreeViews(userId, championshipId);
  return views.find((view) => view.kind === 'CHAMPIONSHIP') ?? null;
}

// ---------------------------------------------------------------------------
// Ordering, arithmetic and copy
// ---------------------------------------------------------------------------

/** Tree order: the career, then championships by the user's order, then events. */
function treeSortKey(tree: {
  kind: MasteryKind;
  name: string;
  championship: { sortOrder: number; name: string } | null;
}): string {
  const kindRank = tree.kind === 'GLOBAL' ? 0 : tree.kind === 'CHAMPIONSHIP' ? 1 : 2;
  const order = (tree.championship?.sortOrder ?? 0).toString().padStart(6, '0');
  return `${kindRank}:${order}:${tree.name.toLowerCase()}`;
}

/** Node order inside a tree: up the tiers, then in configuration order. */
function compareNodes(
  a: { tier: number; sortOrder: number; key: string },
  b: { tier: number; sortOrder: number; key: string },
): number {
  return a.tier - b.tier || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
}

function rarityRank(rarity: Rarity): number {
  const index = RARITY_ORDER.indexOf(rarity);
  return index === -1 ? RARITY_ORDER.length : index;
}

/** Unlocks are reported rarest first, so the stint summary leads with the news. */
function compareUnlocksByImpact(a: MasteryUnlock, b: MasteryUnlock): number {
  return (
    rarityRank(b.rarity) - rarityRank(a.rarity) ||
    b.xpAwarded - a.xpAwarded ||
    a.nodeName.localeCompare(b.nodeName)
  );
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/** Progress towards a target, clamped to 0-1. A zero target is already there. */
function progressTowards(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, value / target));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : round1((part / whole) * 100);
}

/**
 * Positive framing for a tree. Never a count of what is undone — a tree with
 * two nodes unlocked is two nodes of career, not sixteen nodes of arrears.
 */
function treeHeadline(unlocked: number, total: number): string {
  if (total === 0) return 'This tree is still being drawn.';
  if (unlocked === 0) return `${total} nodes here, every one of them still ahead of you.`;
  if (unlocked >= total) return `All ${total} nodes unlocked. This tree is complete, and it stays that way.`;
  return `${unlocked} of ${total} unlocked, with ${total - unlocked} still to come.`;
}
