/**
 * Championship collections.
 *
 * A championship season is a COLLECTIBLE SET and every race in it is a card.
 * Finishing a race fills its card, a Story Complete race earns the special
 * border, and filling every card in the set is SEASON COMPLETE — one of the
 * few occasions this application considers worth the full-screen treatment.
 *
 * Three ideas shape the whole file.
 *
 *   1. THE USER DECIDES WHAT THE SEASON IS. Races are entered by hand and no
 *      calendar is ever imported, so there is no authoritative race list to
 *      measure anybody against. `ChampionshipSeason.plannedRaceCount` is the
 *      user's own declaration of how long the season runs; when it is null the
 *      set is simply "whatever I have added" and its target is the number of
 *      races present. A six-race personal selection out of a twelve-race
 *      championship is therefore a complete set in its own right, and nothing
 *      here may suggest otherwise — a part-season is a shelf, not a gap.
 *   2. NOTHING IS EVER UN-COLLECTED. A card that has been filled stays filled
 *      and a border once earned stays earned. There is no code path in this
 *      file that clears `filledAt` or turns `storyComplete` back off, and
 *      there must never be one: the race was watched, and that happened.
 *   3. THE SET FOLLOWS THE LIBRARY. Races are added to seasons — and moved
 *      between them — long after the fact, so `ensureSeasonCollections`
 *      RECONCILES: it adds cards for races that have appeared and removes
 *      cards for races that now live somewhere else, rather than building the
 *      set once and never looking again.
 *
 * Division of labour. This engine owns `Collection`, `CollectionItem` and the
 * completion flags on `ChampionshipSeason`, and it grants the Season Complete
 * career XP through the ledger. It does NOT write trophies or Hall of Fame
 * rows: it reports each completed set in `CollectionOutcome` and the awards
 * engine mints those from there, so both of those tables keep exactly one
 * owner.
 *
 * The two write functions take the caller's transaction client and never open
 * their own, so a logged session and the cards it fills move together or not
 * at all. The two read functions are read-only and use the global client.
 */

import type { Prisma } from '@/generated/prisma/client';
import { XP_CONFIG } from '@/lib/config';
import { prisma, type Tx } from '@/lib/db/client';
import type { CollectionKind } from '@/lib/domain/types';
import type { CollectionOutcome } from '@/lib/engines/contracts';
import { awardXp } from '@/lib/engines/xp-ledger';

// ---------------------------------------------------------------------------
// Keys
//
// Collection keys are stable, readable and unique per user, so a page can link
// to `/collections/<key>` and keep working across a rebuild.
// ---------------------------------------------------------------------------

/** The key of the collectible set for one season of one championship. */
export function seasonCollectionKey(championshipSlug: string, year: number): string {
  return `season:${championshipSlug}-${year}`;
}

/**
 * The key of one card.
 *
 * Keyed by race id rather than by name so that renaming a race — which people
 * do, once they learn what the race was actually called — moves the card's
 * label without losing the card, and with it the moment it was filled.
 */
function cardKey(raceId: string): string {
  return `race:${raceId}`;
}

// ---------------------------------------------------------------------------
// Pure evaluation
// ---------------------------------------------------------------------------

/** One race as the completion maths sees it. Deliberately tiny and pure. */
export interface SeasonRaceInput {
  /** The race this card stands for. Carried for tracing; unused by the maths. */
  id: string;
  /**
   * The card is filled once the race is finished — Story Complete, or marked
   * Completed by hand after watching it in a way the tracker never saw.
   */
  completed: boolean;
  /** Story Complete. The card with the border. */
  storyComplete: boolean;
}

/** Where a collectible set stands. Every figure here is non-negative. */
export interface SeasonCompletionState {
  /** Cards that exist, i.e. races actually added to the season. */
  presentCount: number;
  /** What the user declared the season to be, or null for "whatever I add". */
  declaredTarget: number | null;
  /** The number the set is measured against: the declaration, or what is here. */
  target: number;
  filledCount: number;
  storyCompleteCount: number;
  /** 0-100, one decimal place. */
  percent: number;
  /** Every card of the declared set is filled. */
  isComplete: boolean;
  /** ...and every one of them is Story Complete. The Season Sweep. */
  isSeasonSweep: boolean;
  /** Cards still to fill. What is still to come, never what is owing. */
  remaining: number;
  /** Races of a declared season not yet entered into the library. */
  notYetAdded: number;
}

/**
 * Measure a collectible set against the user's own definition of the season.
 *
 * Pure, and the only place the completion condition is expressed — the engine,
 * the collections page and the tests all read it from here, so a set cannot be
 * complete in one part of the application and not in another.
 *
 * Two decisions worth stating.
 *
 * A declared count below one is treated as no declaration at all. The form
 * cannot produce one, but old or hand-edited data can, and "the season has
 * zero races in it" is not something a user ever means; "whatever I have
 * added" is.
 *
 * A set with no cards in it is never complete, however it is counted. An empty
 * season is a season nobody has started, and announcing Season Complete over
 * it would be the one thing this system must never do — celebrate nothing.
 * `engines/metrics.ts` counts `seasonsCompleted` the same way, deliberately.
 */
export function evaluateSeasonCompletion(
  races: readonly SeasonRaceInput[],
  plannedRaceCount: number | null,
): SeasonCompletionState {
  const declaredTarget =
    plannedRaceCount !== null && Number.isFinite(plannedRaceCount) && plannedRaceCount >= 1
      ? Math.floor(plannedRaceCount)
      : null;

  const presentCount = races.length;
  // Story Complete implies finished. A caller that sets one flag and forgets
  // the other gets the generous reading rather than an inconsistent set.
  const filledCount = races.filter((race) => race.completed || race.storyComplete).length;
  const storyCompleteCount = races.filter((race) => race.storyComplete).length;

  const target = declaredTarget ?? presentCount;
  const isComplete = target > 0 && filledCount >= target;

  return {
    presentCount,
    declaredTarget,
    target,
    filledCount,
    storyCompleteCount,
    percent: percentOf(filledCount, target),
    isComplete,
    isSeasonSweep: isComplete && storyCompleteCount >= target,
    remaining: Math.max(0, target - filledCount),
    notYetAdded: declaredTarget === null ? 0 : Math.max(0, declaredTarget - presentCount),
  };
}

// ---------------------------------------------------------------------------
// Copy
//
// Presentation rather than balance, so it lives beside the code that decides
// which sentence applies. The rules are the ones in `copy/tone.ts`: a set that
// is not finished is a set with racing still in it, and a part-season is never
// described as lacking anything.
// ---------------------------------------------------------------------------

function raceCount(n: number): string {
  return `${n} ${n === 1 ? 'race' : 'races'}`;
}

function cardCount(n: number): string {
  return `${n} ${n === 1 ? 'card' : 'cards'}`;
}

/** The stored description of a set, rewritten whenever the declaration moves. */
function collectionDescription(declaredTarget: number | null): string {
  if (declaredTarget === null) {
    return 'Every race you add to this season becomes a card in this set.';
  }
  return `A set of ${raceCount(declaredTarget)}, as you defined this season.`;
}

/**
 * One neutral sentence about where the set stands, for the collections page.
 *
 * `recordedComplete` is the set's own history: once a season has been
 * completed it stays completed, even if a race is later re-filed under a
 * different season and the cards present no longer add up to the target. The
 * sentence says so plainly rather than quietly demoting something that
 * happened.
 */
function collectionNote(state: SeasonCompletionState, recordedComplete: boolean): string {
  if (state.isSeasonSweep) {
    return 'Season Sweep. Every race in this set is Story Complete, start to finish.';
  }
  if (state.isComplete) {
    return 'Season Complete. Every card in the set is filled.';
  }
  if (recordedComplete) {
    return 'Season Complete. The set has been re-filed since it was finished.';
  }
  if (state.presentCount === 0) {
    return 'No races here yet. Anything you add to this season becomes a card in the set.';
  }
  if (state.declaredTarget !== null && state.notYetAdded > 0) {
    return `${state.filledCount} of ${cardCount(state.target)} filled, with ${raceCount(state.notYetAdded)} of the season still to be added.`;
  }
  if (state.declaredTarget === null) {
    return `${state.filledCount} of ${cardCount(state.target)} filled. This set is whatever you add to it — a season you watched part of is a set in its own right.`;
  }
  return `${state.filledCount} of ${cardCount(state.target)} filled. The rest are waiting for you.`;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const SEASON_SELECT = {
  id: true,
  year: true,
  label: true,
  plannedRaceCount: true,
  championship: { select: { id: true, name: true, shortName: true, slug: true, accentColor: true } },
  races: { select: { id: true, name: true, raceDate: true } },
} satisfies Prisma.ChampionshipSeasonSelect;

const RECONCILE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  accentColor: true,
  seasonId: true,
  items: { select: { id: true, key: true, name: true, sortOrder: true } },
} satisfies Prisma.CollectionSelect;

const SYNC_SELECT = {
  id: true,
  key: true,
  name: true,
  completedAt: true,
  season: { select: { id: true, plannedRaceCount: true, isComplete: true, completedAt: true } },
  items: {
    select: {
      id: true,
      name: true,
      filledAt: true,
      storyComplete: true,
      race: { select: { id: true, status: true, storyCompletedAt: true, completedAt: true } },
    },
  },
} satisfies Prisma.CollectionSelect;

const VIEW_SELECT = {
  id: true,
  kind: true,
  key: true,
  name: true,
  description: true,
  accentColor: true,
  completedAt: true,
  season: {
    select: {
      id: true,
      year: true,
      label: true,
      plannedRaceCount: true,
      championship: { select: { name: true, shortName: true, accentColor: true, sortOrder: true } },
    },
  },
  items: {
    select: {
      key: true,
      name: true,
      filledAt: true,
      storyComplete: true,
      race: {
        select: {
          id: true, name: true, circuit: true, country: true, raceDate: true,
          runtimeSec: true, coverageSec: true, realViewingSec: true, sessionCount: true,
          status: true, storyCompletedAt: true, isMajorEvent: true,
        },
      },
    },
  },
} satisfies Prisma.CollectionSelect;

type ViewRow = Prisma.CollectionGetPayload<{ select: typeof VIEW_SELECT }>;
type ViewItem = ViewRow['items'][number];

/**
 * Whether a race counts as finished, and so fills its card.
 *
 * Story Complete is the real thing, but a race the user marked Completed by
 * hand counts too. Somebody who watched a race on a television in another room
 * and ticked it off afterwards has still watched it, and a collection that
 * refused to acknowledge that would be tracking the tracker rather than the
 * racing. `engines/metrics.ts` counts a completed race the same way.
 */
function raceIsFinished(race: { status: string; storyCompletedAt: Date | null }): boolean {
  return race.storyCompletedAt !== null || race.status === 'COMPLETED';
}

/**
 * Card order: by race date, then by name.
 *
 * A race with no date sits after the dated ones rather than at the front. A
 * missing date means "not written down yet", not "the beginning of time".
 */
function compareByDateThenName(
  a: { raceDate: Date | null; name: string },
  b: { raceDate: Date | null; name: string },
): number {
  const left = a.raceDate?.getTime() ?? null;
  const right = b.raceDate?.getTime() ?? null;
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }
  return a.name.localeCompare(b.name, 'en-GB');
}

/** A percentage on the 0-100 scale, one decimal, never above 100. */
function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((value / total) * 1000) / 10);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Make sure every championship season has its collectible set, and that the
 * set holds exactly one card per race currently in the season.
 *
 * Idempotent, and safe to run as often as anything likes — it is called before
 * every `syncCollections`, because the race that was just watched may be the
 * first one ever filed under its season.
 *
 * It reconciles rather than merely creates: cards appear for races that have
 * been added, and cards for races that have moved to another season (or lost
 * their season entirely) are removed, because those races are no longer part
 * of this set. That is the one case where a card disappears, and it is the
 * user's own filing decision rather than anything the engine took away.
 *
 * Returns the number of sets in place afterwards.
 */
export async function ensureSeasonCollections(tx: Tx, userId: string, now: Date = new Date()): Promise<number> {
  const seasons = await tx.championshipSeason.findMany({
    where: { championship: { userId } },
    select: SEASON_SELECT,
    orderBy: [{ year: 'asc' }],
  });

  const existing = await tx.collection.findMany({
    where: { userId, kind: 'SEASON' },
    select: RECONCILE_SELECT,
  });

  const bySeason = new Map<string, (typeof existing)[number]>();
  /** key -> the collection holding it, so a rename can never collide. */
  const keyHolders = new Map<string, string>();
  for (const collection of existing) {
    if (collection.seasonId !== null) bySeason.set(collection.seasonId, collection);
    keyHolders.set(collection.key, collection.id);
  }

  for (const season of seasons) {
    const current = bySeason.get(season.id) ?? null;
    const key = availableKey(seasonCollectionKey(season.championship.slug, season.year), current?.id ?? null, season.id, keyHolders);
    const name = seasonCollectionName(season);
    const description = collectionDescription(season.plannedRaceCount);
    const accentColor = season.championship.accentColor;

    let collectionId: string;
    if (current === null) {
      const created = await tx.collection.create({
        data: {
          userId,
          kind: 'SEASON',
          key,
          name,
          description,
          accentColor,
          seasonId: season.id,
          // Threaded from the caller's clock so a rebuild run by
          // `scripts/recompute.ts` agrees with the rest of that rebuild.
          createdAt: now,
        },
        select: { id: true },
      });
      collectionId = created.id;
      keyHolders.set(key, created.id);
    } else {
      collectionId = current.id;
      if (
        current.key !== key ||
        current.name !== name ||
        current.description !== description ||
        current.accentColor !== accentColor
      ) {
        await tx.collection.update({ where: { id: current.id }, data: { key, name, description, accentColor } });
        keyHolders.delete(current.key);
        keyHolders.set(key, current.id);
      }
    }

    await reconcileCards(tx, collectionId, current?.items ?? [], season.races);
  }

  return seasons.length;
}

/**
 * Add the cards that are missing, remove the ones whose race has gone, and
 * keep names and order in step with the library.
 *
 * `filledAt` and `storyComplete` are never touched here. Reconciliation is
 * about which races are in the set, not about what has been watched.
 */
async function reconcileCards(
  tx: Tx,
  collectionId: string,
  currentItems: readonly { id: string; key: string; name: string; sortOrder: number }[],
  races: readonly { id: string; name: string; raceDate: Date | null }[],
): Promise<void> {
  const ordered = [...races].sort(compareByDateThenName);
  const desired = ordered.map((race, index) => ({
    key: cardKey(race.id),
    name: race.name,
    raceId: race.id,
    sortOrder: index,
  }));

  const byKey = new Map(currentItems.map((item) => [item.key, item]));
  const desiredKeys = new Set(desired.map((card) => card.key));

  const missing = desired.filter((card) => !byKey.has(card.key));
  if (missing.length > 0) {
    await tx.collectionItem.createMany({
      data: missing.map((card) => ({ collectionId, ...card })),
    });
  }

  // Anything left over belongs to a race that has been re-filed or removed —
  // including, defensively, a card with no race behind it at all.
  const orphans = currentItems.filter((item) => !desiredKeys.has(item.key)).map((item) => item.id);
  if (orphans.length > 0) {
    await tx.collectionItem.deleteMany({ where: { id: { in: orphans } } });
  }

  for (const card of desired) {
    const item = byKey.get(card.key);
    if (item !== undefined && (item.name !== card.name || item.sortOrder !== card.sortOrder)) {
      await tx.collectionItem.update({
        where: { id: item.id },
        data: { name: card.name, sortOrder: card.sortOrder },
      });
    }
  }
}

/** "WEC 2023", or "WEC 2023 — Hypercar era" when the user labelled the season. */
function seasonCollectionName(season: {
  year: number;
  label: string | null;
  championship: { name: string; shortName: string | null };
}): string {
  const championship = season.championship.shortName ?? season.championship.name;
  const base = `${championship} ${season.year}`;
  return season.label ? `${base} — ${season.label}` : base;
}

/**
 * The wanted key, or a suffixed variant if another set already holds it.
 *
 * `Collection.key` is unique per user. A clash is close to impossible — a
 * championship's slug is unique and a season's year is unique within it — but
 * "close to impossible" is not good enough here: this runs inside the
 * transaction that is logging a stint, and a unique-constraint violation would
 * roll back somebody's viewing session over a naming detail.
 */
function availableKey(
  wanted: string,
  ownId: string | null,
  seasonId: string,
  keyHolders: ReadonlyMap<string, string>,
): string {
  const holder = keyHolders.get(wanted);
  if (holder === undefined || holder === ownId) return wanted;
  return `${wanted}-${seasonId.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Filling cards
// ---------------------------------------------------------------------------

/**
 * Fill the cards whose races are finished, and award any set that is now
 * complete.
 *
 * Call `ensureSeasonCollections` first: this function works from the cards
 * that exist, and the race that was just watched may have arrived since the
 * sets were last built. The session engine and `scripts/recompute.ts` both do.
 *
 * Idempotent in the strongest sense available: a card is only ever turned on,
 * and the Season Complete bonus is guarded by a unique `dedupeKey`, so running
 * this a hundred times over the same library grants the bonus exactly once.
 */
export async function syncCollections(tx: Tx, userId: string, now: Date = new Date()): Promise<CollectionOutcome> {
  const collections = await tx.collection.findMany({
    where: { userId, kind: 'SEASON', seasonId: { not: null } },
    select: SYNC_SELECT,
  });

  const outcome: CollectionOutcome = { completedCollections: [], filledItems: [] };

  for (const collection of collections) {
    const season = collection.season;
    if (season === null) continue;

    const cards: SeasonRaceInput[] = [];

    for (const item of collection.items) {
      const race = item.race;
      if (race === null) continue;

      const storyComplete = race.storyCompletedAt !== null;
      const finished = raceIsFinished(race);

      const fills = finished && item.filledAt === null;
      // A card filled earlier by a hand-marked Completed earns its border the
      // day the story is actually finished. That is a visible change to the
      // card, so it is reported even though the card was already filled.
      const earnsBorder = storyComplete && !item.storyComplete;

      if (fills || earnsBorder) {
        await tx.collectionItem.update({
          where: { id: item.id },
          data: {
            // The card remembers when the race was finished, not when the
            // engine got round to noticing — which keeps a rebuild honest.
            ...(fills ? { filledAt: race.storyCompletedAt ?? race.completedAt ?? now } : {}),
            ...(earnsBorder ? { storyComplete: true } : {}),
          },
        });
        outcome.filledItems.push({
          collectionKey: collection.key,
          collectionName: collection.name,
          itemName: item.name,
          storyComplete,
        });
      }

      cards.push({
        id: race.id,
        // Once filled, always filled — see the file header. A card that was
        // filled before keeps counting even if its race is somehow no longer
        // finished, because it was watched and that cannot be taken back.
        completed: finished || item.filledAt !== null,
        storyComplete: storyComplete || item.storyComplete,
      });
    }

    const state = evaluateSeasonCompletion(cards, season.plannedRaceCount);
    if (!state.isComplete || collection.completedAt !== null) continue;

    // -- Season Complete ---------------------------------------------------
    const award = await awardXp(tx, userId, {
      source: 'SEASON_COMPLETE',
      amount: XP_CONFIG.seasonCompleteBonus,
      seasonAmount: XP_CONFIG.seasonCompleteSeasonXp,
      description: `Season Complete — ${collection.name}`,
      sourceRef: season.id,
      // The structural guard. One season, one bonus, for the life of the
      // career, however many times any of this is re-run.
      dedupeKey: `season-complete:${season.id}`,
    });

    await tx.collection.update({ where: { id: collection.id }, data: { completedAt: now } });
    await tx.championshipSeason.update({
      where: { id: season.id },
      // `?? now` rather than `now`: if the season was already flagged complete
      // at some earlier moment, that moment is the one worth keeping.
      data: { isComplete: true, completedAt: season.completedAt ?? now },
    });

    outcome.completedCollections.push({
      key: collection.key,
      name: collection.name,
      // The size of the set as it stands. Someone who declared eight races and
      // added nine has a nine-card set, and the trophy should say so.
      itemCount: state.presentCount,
      storyCompleteCount: state.storyCompleteCount,
      xpAwarded: award.granted,
    });
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** One card as the collections page draws it. */
export interface CollectionCardView {
  key: string;
  raceId: string | null;
  /** The race's current name; the stored card label if the race has gone. */
  name: string;
  circuit: string | null;
  country: string | null;
  raceDate: Date | null;
  filled: boolean;
  filledAt: Date | null;
  /** Story Complete. The card with the border. */
  storyComplete: boolean;
  runtimeSec: number;
  /** Unique timeline seconds covered. Re-watching never increases this. */
  coverageSec: number;
  /** 0-100, one decimal, of the race timeline. */
  coveragePercent: number;
  /**
   * Real seconds in front of the screen, re-watches included. A different
   * quantity from coverage, and never to be added to or compared with it.
   */
  realViewingSec: number;
  sessionCount: number;
  isMajorEvent: boolean;
}

/** One collectible set, ready to render. */
export interface CollectionView {
  key: string;
  name: string;
  description: string | null;
  kind: CollectionKind;
  accentColor: string;

  seasonId: string | null;
  championshipName: string | null;
  championshipShortName: string | null;
  year: number | null;
  label: string | null;

  /** Ordered by race date, then by name. */
  cards: CollectionCardView[];

  presentCount: number;
  filledCount: number;
  storyCompleteCount: number;
  /** What the user declared the season to be, or null for "whatever I add". */
  declaredTarget: number | null;
  target: number;
  /**
   * 0-100, one decimal. `completionPercent` is the name every other board in
   * the application uses for this figure and is what the collections grid
   * reads; `percent` is the same number under the name the engine contract
   * gives it. Both are kept so neither side has to translate.
   */
  completionPercent: number;
  percent: number;
  remaining: number;
  notYetAdded: number;

  isComplete: boolean;
  /** Every card in the set is Story Complete — the Season Sweep. */
  allStoryComplete: boolean;
  /** The same state, under the name the engine contract gives it. */
  isSeasonSweep: boolean;
  /** When the set was recorded as complete, if it has been. */
  completedAt: Date | null;

  /** One neutral sentence about where the set stands. Safe to render as-is. */
  note: string;
}

/**
 * Every collectible set, newest season first.
 *
 * Read-only: a page render must never be able to fill a card or grant a bonus.
 * The counts below are therefore computed from live race state as well as from
 * the stored card, so a race marked Completed a moment ago on the race page
 * already reads as filled here. The stored `filledAt` is what the engine
 * writes; this is what the user can see, and the two converge the next time
 * `syncCollections` runs.
 */
export async function getCollections(userId: string): Promise<CollectionView[]> {
  const rows = await prisma.collection.findMany({ where: { userId }, select: VIEW_SELECT });
  return rows.map(toCollectionView).sort(compareCollections);
}

/** One set by its key, or null if the user has no such set. */
export async function getCollection(userId: string, key: string): Promise<CollectionView | null> {
  const row = await prisma.collection.findUnique({
    where: { userId_key: { userId, key } },
    select: VIEW_SELECT,
  });
  return row === null ? null : toCollectionView(row);
}

/**
 * Newest season first, then by the championship's own order, then by name.
 *
 * A set with no season behind it (a future major-event or circuit collection)
 * sorts after the seasons rather than above them, so the shelf still reads
 * chronologically once those exist.
 */
function compareCollections(a: CollectionView, b: CollectionView): number {
  const left = a.year ?? Number.NEGATIVE_INFINITY;
  const right = b.year ?? Number.NEGATIVE_INFINITY;
  if (left !== right) return right - left;
  return a.name.localeCompare(b.name, 'en-GB');
}

function toCollectionView(row: ViewRow): CollectionView {
  const cards = row.items.map(toCardView).sort(compareByDateThenName);
  const state = evaluateSeasonCompletion(
    cards.map((card) => ({ id: card.raceId ?? card.key, completed: card.filled, storyComplete: card.storyComplete })),
    row.season?.plannedRaceCount ?? null,
  );

  return {
    key: row.key,
    name: row.name,
    description: row.description,
    kind: row.kind as CollectionKind,
    // The season's championship is the accent of record; the stored colour is
    // the fallback for a set that has no championship behind it.
    accentColor: row.season?.championship.accentColor ?? row.accentColor,

    seasonId: row.season?.id ?? null,
    championshipName: row.season?.championship.name ?? null,
    championshipShortName: row.season?.championship.shortName ?? null,
    year: row.season?.year ?? null,
    label: row.season?.label ?? null,

    cards,

    presentCount: state.presentCount,
    filledCount: state.filledCount,
    storyCompleteCount: state.storyCompleteCount,
    declaredTarget: state.declaredTarget,
    target: state.target,
    completionPercent: state.percent,
    percent: state.percent,
    remaining: state.remaining,
    notYetAdded: state.notYetAdded,

    // A completed set stays completed. `completedAt` is the record of when it
    // happened; the live evaluation can only ever add to that, never undo it.
    isComplete: state.isComplete || row.completedAt !== null,
    // The sweep, by contrast, reads the cards currently in the set. The
    // permanent record of having swept a season is the `season_sweep`
    // achievement, which nothing in the application can take back.
    allStoryComplete: state.isSeasonSweep,
    isSeasonSweep: state.isSeasonSweep,
    completedAt: row.completedAt,

    note: collectionNote(state, row.completedAt !== null),
  };
}

function toCardView(item: ViewItem): CollectionCardView {
  const race = item.race;
  const runtimeSec = race?.runtimeSec ?? 0;
  // Coverage is clamped to the runtime for the same reason the race engine
  // clamps it: a race shortened after it was watched must not read as 103%.
  const coverageSec = race === null ? 0 : Math.min(race.coverageSec, runtimeSec);

  return {
    key: item.key,
    raceId: race?.id ?? null,
    name: race?.name ?? item.name,
    circuit: race?.circuit ?? null,
    country: race?.country ?? null,
    raceDate: race?.raceDate ?? null,
    // The union of what was recorded and what is true now. Never less than the
    // stored card: a filled card stays filled.
    filled: item.filledAt !== null || (race !== null && raceIsFinished(race)),
    filledAt: item.filledAt,
    storyComplete: item.storyComplete || (race?.storyCompletedAt ?? null) !== null,
    runtimeSec,
    coverageSec,
    coveragePercent: percentOf(coverageSec, runtimeSec),
    realViewingSec: race?.realViewingSec ?? 0,
    sessionCount: race?.sessionCount ?? 0,
    isMajorEvent: race?.isMajorEvent ?? false,
  };
}
