/**
 * The quarterly season pass.
 *
 * Four passes a calendar year — Q1 to Q4 — each a hundred tiers long, and
 * every one of them free. There is no premium track, nothing to buy and no
 * tier behind a paywall, because the only thing this application is trying to
 * sell the user is their own viewing.
 *
 * Three ideas hold the whole thing together:
 *
 *  * SEASON XP IS A SEPARATE CURRENCY. Watching and challenges pay out in both
 *    career XP and season XP, but they are different quantities kept in
 *    different places: career XP accumulates forever in the XP ledger, season
 *    XP accumulates on `SeasonPass.seasonXp` and stops at the end of the
 *    quarter. Nothing here ever writes career XP except through `awardXp`.
 *
 *  * THE DEADLINE IS REAL. A quarter runs to its actual calendar end and is
 *    then PERMANENTLY ARCHIVED with whatever tiers were reached. Incomplete
 *    tiers stay incomplete. That is deliberate — the user asked for real
 *    deadlines, and a deadline that quietly extends itself is not one.
 *
 *  * WHICH IS ONLY ACCEPTABLE BECAUSE THE REWARDS ARE COSMETIC.
 *    Every reward on the track is cosmetic, statistical or collectible. None
 *    of them makes future progression objectively easier: there are no XP
 *    multipliers, no cost reductions, no unlocked shortcuts. `XP_BONUS`
 *    rewards are ONE-OFF grants of career XP, paid once through the ledger and
 *    then inert — never a rate. This is the constraint that lets a quarter
 *    expire without damaging the permanent career, and any future reward type
 *    added to `config/rewards.ts` has to honour it.
 *
 * Archival is therefore neutral information, not a loss. `ARCHIVED_PASS_NOTE`
 * is the sentence the UI shows, and nothing in this file deducts, resets or
 * reduces anything at any point.
 *
 * The write paths (`getOrCreateCurrentPass`, `addSeasonXp`) take the caller's
 * transaction client so that one logged stint remains one atomic write. The
 * read paths go through `prisma` by default.
 */

import type { SeasonPass } from '@/generated/prisma/client';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import type { RewardDef } from '@/lib/config';
import { MILESTONE_REWARDS, SEASON_PASS_CONFIG, SEASON_PASS_SHAPE, STANDARD_REWARDS } from '@/lib/config';
import { ARCHIVED_PASS_NOTE } from '@/lib/copy/tone';
import { quarterBounds, quarterOf } from '@/lib/domain/periods';
import type { Rarity, RewardType } from '@/lib/domain/types';
import type { SeasonPassTierUnlock } from './contracts';
import { awardXp } from './xp-ledger';

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The curve parameters, named as an interface so the pure functions below can
 * be exercised against a hypothetical rebalance without touching the shipped
 * configuration. `SEASON_PASS_CONFIG` is the default for all of them.
 */
export interface SeasonPassCurveConfig {
  tierCount: number;
  baseTierCost: number;
  tierCostGrowth: number;
  milestoneEvery: number;
}

/** Where `seasonXp` sits on the track. Pure, and the basis of every view. */
export interface TierState {
  /** Tiers fully paid for. Zero until the first tier is bought outright. */
  tier: number;
  /** Season XP accumulated towards the NEXT tier, beyond the ones paid for. */
  intoTier: number;
  /** What that next tier costs in full. */
  tierCost: number;
  /** 0-1 progress towards the next tier; 1 at the end of the track. */
  progress: number;
}

/** One tier of the track, as the season-pass page renders it. */
export interface SeasonPassTierView {
  tier: number;
  /** Cumulative season XP at which this tier opens. */
  xpRequired: number;
  /** Season XP this tier costs on its own. */
  tierCost: number;
  rewardKey: string;
  rewardName: string;
  rewardType: RewardType;
  rarity: Rarity;
  isMilestone: boolean;
  isUnlocked: boolean;
  unlockedAt: Date | null;
  /** Season XP still to go before this tier opens. Zero once it has. */
  xpRemaining: number;
}

/** A pass in full: the headline figures and the whole hundred-tier track. */
export interface SeasonPassView {
  id: string;
  year: number;
  quarter: number;
  /** "Q3 2026". */
  label: string;
  startsAt: Date;
  endsAt: Date;

  tier: number;
  tierCount: number;
  seasonXp: number;
  /** Season XP banked towards the next tier, and what that tier costs. */
  intoTier: number;
  tierCost: number;
  /** 0-1 towards the next tier, for the progress bar. */
  progress: number;

  /** Whole days left in the quarter. Zero once it has been archived. */
  daysRemaining: number;
  isArchived: boolean;
  archivedAt: Date | null;
  /** True once every tier on the track has been unlocked. */
  isComplete: boolean;

  tiersUnlocked: number;
  milestonesUnlocked: number;

  /** Every tier, in order, so the whole track is browsable from tier 1. */
  track: SeasonPassTierView[];
  /** The next few tiers still to open, for the "next up" preview. */
  nextTiers: SeasonPassTierView[];

  /** `ARCHIVED_PASS_NOTE` once archived, and null while the quarter is open. */
  note: string | null;
}

/** One quarter as the history list shows it. */
export interface SeasonPassSummary {
  id: string;
  year: number;
  quarter: number;
  label: string;
  startsAt: Date;
  endsAt: Date;
  tier: number;
  tierCount: number;
  seasonXp: number;
  tiersUnlocked: number;
  milestonesUnlocked: number;
  isComplete: boolean;
  isArchived: boolean;
  archivedAt: Date | null;
  /** True for the quarter currently running. */
  isCurrent: boolean;
  note: string | null;
}

/**
 * A cosmetic the career has earned from a pass and may now display.
 *
 * Unlocking a cosmetic makes it AVAILABLE; it never changes what the user is
 * currently wearing. See `getAvailableCosmetics`.
 */
export interface UnlockedCosmetic {
  /** The reward key, e.g. `theme_midnight`. */
  key: string;
  /** The key the career profile stores, e.g. `midnight`. */
  selectionKey: string;
  name: string;
  type: RewardType;
  rarity: Rarity;
  /** The quarter it came from, e.g. "Q3 2026". */
  passLabel: string;
  tier: number;
  unlockedAt: Date;
  /** True when this is the one currently displayed on the profile. */
  isSelected: boolean;
}

/** Optional context describing what generated the season XP, for the ledger. */
export interface SeasonXpMeta {
  description?: string;
  sourceRef?: string;
}

// ---------------------------------------------------------------------------
// The curve — pure, deterministic, testable
// ---------------------------------------------------------------------------

/**
 * Season XP to go from `tier - 1` to `tier`.
 *
 *     tierCost(n) = round(baseTierCost * (1 + tierCostGrowth * (n - 1)))
 *
 * Linear growth rather than the exponential curve the career levels use, and
 * deliberately so: a quarterly track has a fixed length and a fixed deadline,
 * so a curve that steepened would make the last tiers unreachable rather than
 * merely expensive. Tier 1 costs 550 and tier 100 costs 1,748 — the later
 * tiers ask for about three times as much as the first, which is enough to
 * make tier 100 an achievement without making tier 90 a wall.
 *
 * Tiers below 1 cost nothing: tier 0 is where every pass starts.
 *
 * The length is set against the viewing budget rather than against a feeling.
 * A hundred tiers cost 114,897 season XP in total. A quarter of the 336-hour
 * annual budget is 84 real hours, which at `seasonXpPerRealMinute` is 50,400
 * season XP, and the Story Complete bonuses on the races that fills add a few
 * thousand more — so watching alone, even at full budget, reaches about tier
 * 60. Challenges carry the rest. Tier 100 is therefore genuinely reachable in
 * a dedicated quarter that uses both, and out of reach for a quarter that only
 * drifts, which is exactly the shape a free pass with a real deadline wants.
 */
export function tierCost(tier: number, config: SeasonPassCurveConfig = SEASON_PASS_CONFIG): number {
  const n = Math.floor(tier);
  if (n < 1) return 0;
  return Math.round(config.baseTierCost * (1 + config.tierCostGrowth * (n - 1)));
}

/**
 * Cumulative season XP needed to reach `tier` from zero.
 *
 * Summed from the rounded per-tier costs rather than integrated in closed
 * form, so that this and `tierCost` can never disagree by a rounding unit —
 * the number stored in `SeasonPassProgress.xpRequired` has to be exactly the
 * number `tierForXp` will later compare against.
 *
 * Clamped to the length of the track: there is nothing beyond the last tier.
 */
export function cumulativeXpForTier(tier: number, config: SeasonPassCurveConfig = SEASON_PASS_CONFIG): number {
  const target = Math.min(Math.floor(tier), config.tierCount);
  let total = 0;
  for (let n = 1; n <= target; n += 1) total += tierCost(n, config);
  return total;
}

/**
 * Resolve a season XP total into a position on the track.
 *
 * At the end of the track the final tier reads as complete — `intoTier` and
 * `tierCost` both report the last tier's cost, so the bar fills rather than
 * emptying. Surplus season XP beyond tier 100 buys nothing and is not
 * presented as if it might; the raw total stays visible on the pass itself.
 */
export function tierForXp(seasonXp: number, config: SeasonPassCurveConfig = SEASON_PASS_CONFIG): TierState {
  const xp = Math.max(0, Math.floor(seasonXp));

  let tier = 0;
  let consumed = 0;
  while (tier < config.tierCount) {
    const next = tierCost(tier + 1, config);
    if (consumed + next > xp) break;
    consumed += next;
    tier += 1;
  }

  if (tier >= config.tierCount) {
    const finalCost = tierCost(config.tierCount, config);
    return { tier: config.tierCount, intoTier: finalCost, tierCost: finalCost, progress: 1 };
  }

  const cost = tierCost(tier + 1, config);
  const intoTier = xp - consumed;
  return { tier, intoTier, tierCost: cost, progress: cost > 0 ? intoTier / cost : 0 };
}

/** Index into a reward pool, with a clear error if a pool is ever emptied. */
function pick(pool: readonly RewardDef[], index: number, poolName: string): RewardDef {
  if (pool.length === 0) {
    throw new Error(`Season pass reward pool ${poolName} is empty; check src/lib/config/rewards.ts.`);
  }
  const reward = pool[((index % pool.length) + pool.length) % pool.length];
  if (reward === undefined) {
    throw new Error(`Season pass reward pool ${poolName} has no entry at index ${index}.`);
  }
  return reward;
}

/**
 * The reward a tier carries.
 *
 * Entirely deterministic: tier 42 of every pass ever generated holds the same
 * thing, in this quarter and in any quarter that follows. Nothing is rolled.
 * That matters for more than tidiness — the whole track is materialised and
 * browsable from tier 1, so the user can see what tier 90 holds while standing
 * on tier 12, and a reward that shifted between renders would make that a lie.
 *
 * Milestone tiers — every `milestoneEvery`-th — draw from `MILESTONE_REWARDS`
 * in order, so the ten milestones of a hundred-tier pass are the ten milestone
 * rewards. Ordinary tiers cycle through `STANDARD_REWARDS`, indexed by how
 * many ordinary tiers came before them rather than by the tier number, so
 * inserting or removing milestone tiers in configuration does not scramble the
 * ordinary ones.
 */
export function rewardForTier(tier: number, config: SeasonPassCurveConfig = SEASON_PASS_CONFIG): RewardDef {
  const n = Math.max(1, Math.floor(tier));
  const every = Math.max(1, Math.floor(config.milestoneEvery));

  if (n % every === 0) {
    return pick(MILESTONE_REWARDS, n / every - 1, 'MILESTONE_REWARDS');
  }

  const ordinaryBefore = n - 1 - Math.floor((n - 1) / every);
  return pick(STANDARD_REWARDS, ordinaryBefore, 'STANDARD_REWARDS');
}

/** Whether a tier gets the larger milestone presentation. */
export function isMilestoneTier(tier: number, config: SeasonPassCurveConfig = SEASON_PASS_CONFIG): boolean {
  const every = Math.max(1, Math.floor(config.milestoneEvery));
  return Math.floor(tier) % every === 0;
}

/** "Q3 2026". The one place the quarter label is spelled. */
export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/**
 * Reward keys carry their own type as a prefix (`theme_midnight`), while the
 * career profile stores the bare key the config lists (`midnight`). Stripping
 * a known prefix is how the two meet; a key without one is its own identity.
 */
const SELECTION_PREFIXES: Partial<Record<RewardType, string>> = {
  THEME: 'theme_',
  RACE_CARD: 'card_',
  TITLE: 'title_',
  BANNER: 'banner_',
  BADGE: 'badge_',
};

export function selectionKeyFor(reward: { key: string; type: RewardType }): string {
  const prefix = SELECTION_PREFIXES[reward.type];
  if (prefix !== undefined && reward.key.startsWith(prefix)) return reward.key.slice(prefix.length);
  return reward.key;
}

// ---------------------------------------------------------------------------
// Creating a pass
// ---------------------------------------------------------------------------

interface TierRowSeed {
  seasonPassId: string;
  tier: number;
  xpRequired: number;
  rewardKey: string;
  rewardType: RewardType;
  rewardName: string;
  rewardRarity: Rarity;
  isMilestone: boolean;
}

function tierRowSeed(seasonPassId: string, tier: number): TierRowSeed {
  const reward = rewardForTier(tier);
  return {
    seasonPassId,
    tier,
    xpRequired: cumulativeXpForTier(tier),
    rewardKey: reward.key,
    rewardType: reward.type,
    rewardName: reward.name,
    rewardRarity: reward.rarity,
    isMilestone: isMilestoneTier(tier),
  };
}

/**
 * Materialise any tier rows a pass is missing.
 *
 * Creating a pass writes all hundred rows up front so the entire track is
 * browsable from the first minute of the quarter, rather than materialising
 * each tier as it is reached — a track you can only see the already-earned
 * part of is a receipt, not a season pass.
 *
 * Written as "fill in what is missing" rather than "create the set" so it is
 * idempotent, and so that raising `tierCount` in configuration extends an
 * already-running pass instead of leaving it short. Returns how many rows it
 * had to add, which is of interest to a maintenance script and to nobody else.
 */
async function ensureTierRows(tx: Tx, seasonPassId: string): Promise<number> {
  // The overwhelmingly common case is a pass that is already complete, and it
  // is reached from the top of every logged stint, so settle it with a count
  // before reading a hundred rows to find out the same thing.
  const presentCount = await tx.seasonPassProgress.count({ where: { seasonPassId } });
  if (presentCount >= SEASON_PASS_CONFIG.tierCount) return 0;

  const existing = await tx.seasonPassProgress.findMany({
    where: { seasonPassId },
    select: { tier: true },
  });
  const present = new Set(existing.map((row) => row.tier));

  const missing: TierRowSeed[] = [];
  for (let tier = 1; tier <= SEASON_PASS_CONFIG.tierCount; tier += 1) {
    if (present.has(tier)) continue;
    missing.push(tierRowSeed(seasonPassId, tier));
  }
  if (missing.length === 0) return 0;

  const result = await tx.seasonPassProgress.createMany({ data: missing, skipDuplicates: true });
  return result.count;
}

/**
 * The pass for the quarter containing `now`, creating it if it does not exist.
 *
 * Quarter bounds come from `quarterBounds`, so the pass runs to the real
 * calendar end of the quarter in the user's local time — not to a rolling
 * ninety days from whenever they happened to start playing. The upsert is what
 * makes this safe to call from the top of every session write.
 */
export async function getOrCreateCurrentPass(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<SeasonPass> {
  const year = now.getFullYear();
  const quarter = quarterOf(now);
  const { start, end } = quarterBounds(year, quarter);

  const pass = await tx.seasonPass.upsert({
    where: { userId_year_quarter: { userId, year, quarter } },
    update: {},
    create: { userId, year, quarter, startsAt: start, endsAt: end },
  });

  await ensureTierRows(tx, pass.id);
  return pass;
}

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

/**
 * Apply one unlocked tier's reward.
 *
 * Every branch here is cosmetic, statistical or collectible — see the file
 * header. Nothing in this function can make future progression easier.
 */
async function applyTierReward(
  tx: Tx,
  userId: string,
  pass: SeasonPass,
  tier: number,
  reward: RewardDef,
  meta?: SeasonXpMeta,
): Promise<void> {
  if (reward.type === 'XP_BONUS') {
    const amount = Math.max(0, Math.round(reward.amount ?? 0));
    if (amount === 0) return;

    // A ONE-OFF grant, never a rate: the career XP lands once, through the
    // ledger, and the pass has no further effect on anything earned later.
    // The dedupeKey is unique in the database, so however many times this
    // engine re-runs over the same tier, the bonus is paid exactly once.
    const context = meta?.description ? ` (${meta.description})` : '';
    await awardXp(tx, userId, {
      source: 'SEASON_PASS_TIER',
      amount,
      description: `Season pass ${quarterLabel(pass.year, pass.quarter)} — tier ${tier}${context}`,
      sourceRef: meta?.sourceRef ?? pass.id,
      seasonPassId: pass.id,
      dedupeKey: `pass-tier:${pass.id}:${tier}`,
    });
    return;
  }

  if (reward.type === 'THEME' || reward.type === 'RACE_CARD' || reward.type === 'TITLE') {
    // Availability is the unlock itself: `getAvailableCosmetics` reads the
    // stamped tier rows, so a theme, race card or title becomes selectable the
    // moment it is earned. The engine deliberately does NOT write it onto the
    // profile — the user's chosen look is theirs, and a pass that redressed
    // the dashboard every ten tiers would be taking that choice away. (Titles
    // additionally must not touch `careerProfile.titleKey`, which belongs to
    // the level ladder.)
    return;
  }

  if (reward.type === 'BANNER' || reward.type === 'BADGE') {
    // Banners and badges start empty, and an empty slot is not a choice. The
    // first one earned fills it so the profile has something to show; anything
    // already selected — by the user or by an earlier unlock — is left alone.
    const profile = await tx.careerProfile.findUnique({
      where: { userId },
      select: { bannerKey: true, badgeKey: true },
    });
    if (profile === null) return;

    const selectionKey = selectionKeyFor(reward);
    if (reward.type === 'BANNER' && profile.bannerKey === null) {
      await tx.careerProfile.update({ where: { userId }, data: { bannerKey: selectionKey } });
    }
    if (reward.type === 'BADGE' && profile.badgeKey === null) {
      await tx.careerProfile.update({ where: { userId }, data: { badgeKey: selectionKey } });
    }
    return;
  }

  // PATCH, EMBLEM, POSTER, TROPHY_ITEM, HALL_OF_FAME_COLLECTIBLE: the stamped
  // `SeasonPassProgress` row IS the collectible. It is a permanent record of a
  // quarter, it survives archival, and the awards engine is free to read these
  // rows when it decides what belongs in the trophy cabinet.
}

/**
 * Add season XP to the quarter in progress and open whatever it reaches.
 *
 * Returns the tiers newly unlocked by this call, in order, which is exactly
 * what the stint summary screen wants to show. Idempotent in the way that
 * matters: a tier already stamped is never returned or paid for twice, and a
 * tier at or below the reached tier that somehow has no stamp is picked up on
 * the next call rather than staying unstamped.
 *
 * `amount` is floored at zero. There is no negative season XP, no mechanic
 * that takes a tier back, and no state in which this function reduces
 * anything.
 */
export async function addSeasonXp(
  tx: Tx,
  userId: string,
  amount: number,
  now: Date = new Date(),
  meta?: SeasonXpMeta,
): Promise<SeasonPassTierUnlock[]> {
  const granted = Math.max(0, Math.round(amount));
  const pass = await getOrCreateCurrentPass(tx, userId, now);

  // An archived quarter is finished. Season XP earned after it closed belongs
  // to the quarter that is running, and `getOrCreateCurrentPass` has already
  // chosen that one — so this only fires if the current quarter was archived
  // early, in which case there is nothing to add and nothing is taken away.
  if (pass.isArchived) return [];

  const after = pass.seasonXp + granted;
  const stateAfter = tierForXp(after);

  if (granted > 0) {
    await tx.seasonPass.update({
      where: { id: pass.id },
      data: { seasonXp: after, tier: stateAfter.tier },
    });
  }

  // Everything at or below the reached tier that has not been stamped yet.
  const crossed = await tx.seasonPassProgress.findMany({
    where: { seasonPassId: pass.id, tier: { lte: stateAfter.tier }, unlockedAt: null },
    orderBy: { tier: 'asc' },
  });
  if (crossed.length === 0) return [];

  await tx.seasonPassProgress.updateMany({
    where: { id: { in: crossed.map((row) => row.id) } },
    data: { unlockedAt: now },
  });

  const unlocks: SeasonPassTierUnlock[] = [];
  for (const row of crossed) {
    // The reward is read from the stored row, not recomputed, so a tier
    // unlocks the reward it was advertising all quarter even if the reward
    // pools were rebalanced underneath it. `amount` is the one field rows do
    // not carry, and it comes from the definition the key names.
    const definition = rewardForTier(row.tier);
    const reward: RewardDef = {
      key: row.rewardKey,
      name: row.rewardName,
      type: row.rewardType,
      rarity: row.rewardRarity,
      amount: definition.key === row.rewardKey ? definition.amount : undefined,
    };

    await applyTierReward(tx, userId, pass, row.tier, reward, meta);

    unlocks.push({
      tier: row.tier,
      rewardKey: row.rewardKey,
      rewardName: row.rewardName,
      rewardType: row.rewardType,
      rarity: row.rewardRarity,
      isMilestone: row.isMilestone,
    });
  }

  return unlocks;
}

// ---------------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------------

/**
 * Archive every pass whose quarter has ended.
 *
 * This is bookkeeping and nothing else. Tiers that were not reached stay
 * unreached, no XP moves, no statistic changes, no streak is affected and
 * nothing is deducted — the pass is simply marked as finished, exactly as it
 * finished, and `ARCHIVED_PASS_NOTE` is the sentence shown beside it. The
 * rewards were cosmetic precisely so this could be true.
 *
 * Returns the number of passes archived, for the caller's logs.
 */
export async function archiveExpiredPasses(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<number> {
  const result = await db.seasonPass.updateMany({
    where: { userId, isArchived: false, endsAt: { lte: now } },
    data: { isArchived: true, archivedAt: now },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface StoredTierRow {
  tier: number;
  xpRequired: number;
  rewardKey: string;
  rewardName: string;
  rewardType: RewardType;
  rewardRarity: Rarity;
  isMilestone: boolean;
  unlockedAt: Date | null;
}

function toTierView(row: StoredTierRow, seasonXp: number): SeasonPassTierView {
  return {
    tier: row.tier,
    xpRequired: row.xpRequired,
    tierCost: tierCost(row.tier),
    rewardKey: row.rewardKey,
    rewardName: row.rewardName,
    rewardType: row.rewardType,
    rarity: row.rewardRarity,
    isMilestone: row.isMilestone,
    isUnlocked: row.unlockedAt !== null,
    unlockedAt: row.unlockedAt,
    xpRemaining: Math.max(0, row.xpRequired - seasonXp),
  };
}

/** Whole days left in a quarter. Zero for a quarter that has finished. */
function daysRemainingIn(endsAt: Date, now: Date, isArchived: boolean): number {
  if (isArchived) return 0;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * One pass in full, ready to render.
 *
 * Defaults to the quarter containing `now`; pass `year` and `quarter` to open
 * an archived one. Returns null when that quarter has no pass — reading is not
 * a reason to create one, and a quarter the user was not here for should read
 * as absent rather than as a hundred unearned tiers.
 *
 * Headline figures are derived from `seasonXp` through the live curve rather
 * than trusted from the cached `tier` column, so a rebalance shows through
 * immediately. Unlocked tiers are read from their stamps and are never
 * recomputed: an unlock, once given, is permanent.
 */
export async function getSeasonPassView(
  userId: string,
  opts: { year?: number; quarter?: number; now?: Date } = {},
  db: Tx = prisma,
): Promise<SeasonPassView | null> {
  const now = opts.now ?? new Date();
  const year = opts.year ?? now.getFullYear();
  const quarter = opts.quarter ?? quarterOf(now);

  const pass = await db.seasonPass.findUnique({
    where: { userId_year_quarter: { userId, year, quarter } },
    include: { tiers: { orderBy: { tier: 'asc' } } },
  });
  if (pass === null) return null;

  const state = tierForXp(pass.seasonXp);
  const track = pass.tiers.map((row) => toTierView(row, pass.seasonXp));
  const tiersUnlocked = track.filter((row) => row.isUnlocked).length;

  return {
    id: pass.id,
    year: pass.year,
    quarter: pass.quarter,
    label: quarterLabel(pass.year, pass.quarter),
    startsAt: pass.startsAt,
    endsAt: pass.endsAt,

    tier: state.tier,
    tierCount: SEASON_PASS_CONFIG.tierCount,
    seasonXp: pass.seasonXp,
    intoTier: state.intoTier,
    tierCost: state.tierCost,
    progress: state.progress,

    daysRemaining: daysRemainingIn(pass.endsAt, now, pass.isArchived),
    isArchived: pass.isArchived,
    archivedAt: pass.archivedAt,
    isComplete: track.length > 0 && tiersUnlocked >= track.length,

    tiersUnlocked,
    milestonesUnlocked: track.filter((row) => row.isMilestone && row.isUnlocked).length,

    track,
    nextTiers: track.filter((row) => !row.isUnlocked).slice(0, SEASON_PASS_SHAPE.upcomingTierCount),

    note: pass.isArchived ? ARCHIVED_PASS_NOTE : null,
  };
}

/**
 * Every quarter the career has had, newest first.
 *
 * The quarter currently running is included and flagged `isCurrent`, so the
 * page reads as one continuous record rather than as a gap where this quarter
 * ought to be. Each entry keeps the figures it finished with — a pass that
 * reached tier 61 says tier 61 for good, and says it neutrally.
 */
export async function getPassHistory(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<SeasonPassSummary[]> {
  const passes = await db.seasonPass.findMany({
    where: { userId },
    orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
    include: {
      tiers: {
        where: { unlockedAt: { not: null } },
        select: { tier: true, isMilestone: true },
      },
    },
  });

  return passes.map((pass): SeasonPassSummary => {
    const tiersUnlocked = pass.tiers.length;
    return {
      id: pass.id,
      year: pass.year,
      quarter: pass.quarter,
      label: quarterLabel(pass.year, pass.quarter),
      startsAt: pass.startsAt,
      endsAt: pass.endsAt,
      tier: tierForXp(pass.seasonXp).tier,
      tierCount: SEASON_PASS_CONFIG.tierCount,
      seasonXp: pass.seasonXp,
      tiersUnlocked,
      milestonesUnlocked: pass.tiers.filter((row) => row.isMilestone).length,
      isComplete: tiersUnlocked >= SEASON_PASS_CONFIG.tierCount,
      isArchived: pass.isArchived,
      archivedAt: pass.archivedAt,
      isCurrent: !pass.isArchived && pass.startsAt <= now && pass.endsAt > now,
      note: pass.isArchived ? ARCHIVED_PASS_NOTE : null,
    };
  });
}

/**
 * Every cosmetic the passes have made available, and which one is in use.
 *
 * This is the other half of "unlocking makes it available": the tier rows are
 * the record of what has been earned, and this turns them into a list the
 * settings page can offer. Cosmetics repeat across the track — the standard
 * pool cycles — so an item earned in two quarters is listed once, dated from
 * the first time it arrived.
 *
 * Archived quarters count. A cosmetic earned in Q1 is still wearable in Q4,
 * because archival ends the earning and nothing else.
 */
export async function getAvailableCosmetics(
  userId: string,
  db: Tx = prisma,
): Promise<UnlockedCosmetic[]> {
  const COSMETIC_TYPES: readonly RewardType[] = ['THEME', 'TITLE', 'RACE_CARD', 'BANNER', 'BADGE'];

  const [rows, profile] = await Promise.all([
    db.seasonPassProgress.findMany({
      where: {
        seasonPass: { userId },
        unlockedAt: { not: null },
        rewardType: { in: [...COSMETIC_TYPES] },
      },
      orderBy: { unlockedAt: 'asc' },
      select: {
        tier: true,
        rewardKey: true,
        rewardName: true,
        rewardType: true,
        rewardRarity: true,
        unlockedAt: true,
        seasonPass: { select: { year: true, quarter: true } },
      },
    }),
    db.careerProfile.findUnique({
      where: { userId },
      select: { themeKey: true, raceCardKey: true, bannerKey: true, badgeKey: true, titleKey: true },
    }),
  ]);

  const selected: Partial<Record<RewardType, string | null>> = {
    THEME: profile?.themeKey ?? null,
    RACE_CARD: profile?.raceCardKey ?? null,
    BANNER: profile?.bannerKey ?? null,
    BADGE: profile?.badgeKey ?? null,
    TITLE: profile?.titleKey ?? null,
  };

  const byKey = new Map<string, UnlockedCosmetic>();
  for (const row of rows) {
    if (row.unlockedAt === null) continue;
    if (byKey.has(row.rewardKey)) continue;
    const selectionKey = selectionKeyFor({ key: row.rewardKey, type: row.rewardType });
    byKey.set(row.rewardKey, {
      key: row.rewardKey,
      selectionKey,
      name: row.rewardName,
      type: row.rewardType,
      rarity: row.rewardRarity,
      passLabel: quarterLabel(row.seasonPass.year, row.seasonPass.quarter),
      tier: row.tier,
      unlockedAt: row.unlockedAt,
      isSelected: selected[row.rewardType] === selectionKey,
    });
  }

  return [...byKey.values()];
}
