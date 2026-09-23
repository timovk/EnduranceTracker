/**
 * The 0.3.1 season reset — the one place this application takes back what it
 * gave.
 *
 * Everywhere else the rule holds: nothing revokes an unlock, a trophy or a Hall
 * of Fame entry (`tests/domain/design-rules.test.ts` enforces it). 0.3.1 breaks
 * it ONCE, at the user's explicit request: the season pass and seasonal
 * challenges close until the reopening date in `SEASON_CLOSURE_CONFIG`, and the
 * rewards they had already given are removed from every existing account. The
 * exception is kept in this one module, outside `src/lib/engines/`, and a
 * design rule asserts that reward deletion appears nowhere else, so it cannot
 * quietly spread.
 *
 * What goes, per account — and only what belongs to a pass that started, or a
 * seasonal challenge whose period started, BEFORE the reopening:
 *
 *   * the season passes themselves (their tier rows cascade), and with them
 *     every theme, race card, badge, banner, title and collectible they
 *     unlocked;
 *   * the SEASONAL challenges (their progress rows cascade);
 *   * the career XP those paid: `SEASON_PASS_TIER` bonuses and the seasonal
 *     challenges' `CHALLENGE` awards;
 *   * the trophies and Hall of Fame entries made from those passes.
 *
 * What stays: achievements, milestones, mastery, collections, daily, weekly
 * and monthly challenges and their XP, races, stints and viewing XP.
 * (`awards-engine` pays no XP for a trophy or an entry — its idea 5 — so
 * there is no award XP to remove with them.)
 *
 * Scoping by the reopening rather than by "whatever exists" is the second
 * safety: even if the per-account marker were lost and this ran again in
 * December, it could not touch the Q4 pass or anything earned from it. Passes
 * are scoped by the quarter they are FOR, not by the instant they start: a
 * pass's `startsAt` is local midnight in whatever time zone it was created in,
 * so after a time zone change the Q4 pass can start a few hours before this
 * machine's idea of the reopening. The instants that remain (a seasonal
 * challenge's `periodStart`, a stranded tier bonus's `createdAt`) are compared
 * against a cut-off a week before the reopening, far more than any time zone
 * difference and far less than a quarter.
 *
 * Nothing that survives is recomputed but the career totals. Every pass the
 * reset reaches is deleted outright, and the only season XP it removes is
 * dated inside those passes' quarters, so no surviving pass's total changes.
 * (`rebuildSeasonXpFromLedger` is deliberately NOT called: it sums the
 * ledger's unboosted `seasonAmount`, and would strip a Q4 pass of the momentum
 * bonus `addSeasonXp` added on top.)
 *
 * Everything is DELETED and then REBUILT — no negative XP is written, exactly
 * as deleting a stint works. The desktop shell takes a pre-update snapshot of
 * the database before the server starts (0.3.0), so a backup exists before
 * this runs.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { DEFAULT_RACE_CARD_KEY, DEFAULT_THEME_KEY } from '@/lib/config';
import { DISPLAY_TITLE_KEY, PASS_TITLE_PREFIX } from '@/lib/domain/cosmetics';
import { reopeningSeason, seasonReopensAt } from '@/lib/domain/season-closure';
import type { RewardType } from '@/lib/domain/types';
import { selectionKeyFor } from '@/lib/engines/season-pass-engine';
import { rebuildCareerTotals } from '@/lib/engines/xp-ledger';

/** The per-account `ConfigOverride` key recording that the reset has run. */
export const SEASON_RESET_KEY = 'seasonReset';

/** The value written under `SEASON_RESET_KEY`: the release that did it. */
export const SEASON_RESET_VERSION = '0.3.1';

/**
 * How far before the reopening an instant must fall to be in scope. A week:
 * wider than the largest gap between two time zones (26 hours), far narrower
 * than a quarter, so the start of Q3 and the start of Q4 can never be confused
 * whichever zone either was stamped in.
 */
const INSTANT_SLACK_MS = 7 * 24 * 60 * 60 * 1000;

/** One account's worth of reset writes deserves room, as a logged stint does. */
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

const COSMETIC_TYPES: RewardType[] = ['THEME', 'RACE_CARD', 'BADGE', 'BANNER', 'TITLE'];

/** What the reset did to one account. Logged, and returned for tests. */
export interface SeasonResetSummary {
  userId: string;
  /** True when the account was already marked and nothing was done. */
  skipped: boolean;
  passesRemoved: number;
  /** Unlocked tiers among the removed passes: the rewards that went with them. */
  unlockedTiersRemoved: number;
  seasonalChallengesRemoved: number;
  xpTransactionsRemoved: number;
  careerXpRemoved: number;
  trophiesRemoved: number;
  hallOfFameEntriesRemoved: number;
  /** Whether the account's look was put back to the defaults. */
  lookReset: boolean;
  careerXpBefore: number;
  careerXpAfter: number;
  levelBefore: number;
  levelAfter: number;
}

export interface SeasonResetOptions {
  /**
   * Ignore the marker and run again. For tests and deliberate maintenance: the
   * scope is still bounded by the reopening, so a forced re-run finds nothing
   * dated at or after it, and leaves a Q4 pass, its totals and its look alone.
   */
  force?: boolean;
}

/** Record that an account has had (or never needs) the reset. */
export async function markSeasonResetApplied(userId: string, db: Tx = prisma): Promise<void> {
  await db.configOverride.upsert({
    where: { userId_key: { userId, key: SEASON_RESET_KEY } },
    update: { value: SEASON_RESET_VERSION },
    create: { userId, key: SEASON_RESET_KEY, value: SEASON_RESET_VERSION },
  });
}

/** Whether an account already carries the marker. */
export async function isSeasonResetApplied(userId: string, db: Tx = prisma): Promise<boolean> {
  const row = await db.configOverride.findUnique({
    where: { userId_key: { userId, key: SEASON_RESET_KEY } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Reset one account inside the caller's transaction.
 *
 * Runs the whole reset or, if anything throws, none of it — including the
 * marker, so a failure is simply retried on the next start.
 */
export async function resetSeasonRewardsInTx(
  tx: Tx,
  userId: string,
  options: SeasonResetOptions = {},
): Promise<SeasonResetSummary> {
  const profile = await tx.careerProfile.findUnique({ where: { userId }, select: { careerXp: true, level: true } });
  const careerXpNow = Number(profile?.careerXp ?? 0);
  const levelNow = profile?.level ?? 1;

  const summary: SeasonResetSummary = {
    userId,
    skipped: false,
    passesRemoved: 0,
    unlockedTiersRemoved: 0,
    seasonalChallengesRemoved: 0,
    xpTransactionsRemoved: 0,
    careerXpRemoved: 0,
    trophiesRemoved: 0,
    hallOfFameEntriesRemoved: 0,
    lookReset: false,
    careerXpBefore: careerXpNow,
    careerXpAfter: careerXpNow,
    levelBefore: levelNow,
    levelAfter: levelNow,
  };

  if (!options.force && (await isSeasonResetApplied(userId, tx))) {
    return { ...summary, skipped: true };
  }

  const reopening = reopeningSeason();
  const cutoff = new Date(seasonReopensAt().getTime() - INSTANT_SLACK_MS);

  // -- 1. The scope: strictly before the reopening --------------------------
  //
  // Passes by the quarter they belong to; see the module comment for why not
  // by `startsAt`.
  const passes = await tx.seasonPass.findMany({
    where: {
      userId,
      OR: [
        { year: { lt: reopening.year } },
        { year: reopening.year, quarter: { lt: reopening.quarter } },
      ],
    },
    select: {
      id: true, year: true, quarter: true, endsAt: true,
      _count: { select: { tiers: { where: { unlockedAt: { not: null } } } } },
    },
  });
  const seasonal = await tx.challenge.findMany({
    where: { userId, scope: 'SEASONAL', periodStart: { lt: cutoff } },
    select: { id: true },
  });
  const passIds = passes.map((pass) => pass.id);
  const challengeIds = seasonal.map((challenge) => challenge.id);

  // -- 2. The XP they paid, BEFORE their owners go ---------------------------
  //
  // `XPTransaction.seasonPassId` is `onDelete: SetNull`: deleting a pass first
  // would strand its tier bonuses with a null id. A `SEASON_PASS_TIER` row
  // that is already stranded and dated before the reopening can only have
  // come from a pass in this scope, so it goes too.
  const xpScope = [
    ...(passIds.length > 0
      ? [
          { source: 'SEASON_PASS_TIER' as const, seasonPassId: { in: passIds } },
          ...passIds.map((id) => ({ source: 'SEASON_PASS_TIER' as const, dedupeKey: { startsWith: `pass-tier:${id}:` } })),
        ]
      : []),
    { source: 'SEASON_PASS_TIER' as const, seasonPassId: null, createdAt: { lt: cutoff } },
    ...(challengeIds.length > 0
      ? [{ source: 'CHALLENGE' as const, dedupeKey: { in: challengeIds.map((id) => `challenge:${id}`) } }]
      : []),
  ];
  const xpRows = await tx.xPTransaction.findMany({
    where: { userId, OR: xpScope },
    select: { id: true, amount: true },
  });
  if (xpRows.length > 0) {
    await tx.xPTransaction.deleteMany({ where: { id: { in: xpRows.map((row) => row.id) } } });
  }
  summary.xpTransactionsRemoved = xpRows.length;
  summary.careerXpRemoved = xpRows.reduce((sum, row) => sum + row.amount, 0);

  // -- 3. The trophies and Hall of Fame entries made from those passes -------
  //
  // Matched by the keys `awards-engine` mints them under, which name the
  // quarter, so only the scoped quarters' awards can match.
  if (passes.length > 0) {
    const keyScope = passes.flatMap((pass) => [
      { key: `season-pass-complete:${pass.year}q${pass.quarter}` },
      { key: { startsWith: `season-pass:${pass.year}q${pass.quarter}:` } },
    ]);
    const trophies = await tx.trophy.deleteMany({
      where: { userId, category: 'SEASON_PASS', OR: keyScope },
    });
    // `first:season-pass` is filed under FIRST, but made from a completed pass
    // all the same. It is minted by the stint that completes the pass, which
    // is before that pass ends, so a stored `endsAt` bounds it exactly —
    // whatever time zone either was stamped in.
    const lastScopedEnd = new Date(Math.max(...passes.map((pass) => pass.endsAt.getTime())));
    const entries = await tx.hallOfFameEntry.deleteMany({
      where: {
        userId,
        OR: [
          { category: 'SEASON_PASS', OR: keyScope },
          { key: 'first:season-pass', occurredAt: { lt: lastScopedEnd } },
        ],
      },
    });
    summary.trophiesRemoved = trophies.count;
    summary.hallOfFameEntriesRemoved = entries.count;
  }

  // -- 4. The seasonal challenges, then the passes ---------------------------
  if (challengeIds.length > 0) {
    await tx.challenge.deleteMany({ where: { id: { in: challengeIds } } });
  }
  if (passIds.length > 0) {
    await tx.seasonPass.deleteMany({ where: { id: { in: passIds } } });
  }
  summary.seasonalChallengesRemoved = challengeIds.length;
  summary.passesRemoved = passIds.length;
  summary.unlockedTiersRemoved = passes.reduce((sum, pass) => sum + pass._count.tiers, 0);

  // -- 5. The look, back to the defaults -------------------------------------
  //
  // Only for an account that had a pass in scope: the look only ever came
  // from a pass, and an account without one has nothing of the season's on
  // show. A choice still earned by a pass that survives — one dated after the
  // reopening, if 0.3.1 first starts late — is left alone.
  if (passes.length > 0) {
    await resetLook(tx, userId);
    summary.lookReset = true;
  }

  // -- 6. Rebuild the career totals from what remains -------------------------
  //
  // Career XP, level, prestige and title only. Season pass totals are left
  // alone on purpose: see the module comment. An account with no career
  // profile (an account whose creation was interrupted before `ensureCareer`)
  // has no career to rebuild; `ensureCareer` builds one later, and the account
  // is still marked, rather than failing — and being retried — on every start.
  if (profile !== null) {
    const ledger = await rebuildCareerTotals(tx, userId);
    summary.careerXpBefore = ledger.careerXpBefore;
    summary.careerXpAfter = ledger.careerXpAfter;
    summary.levelBefore = ledger.levelBefore;
    summary.levelAfter = ledger.levelAfter;
  }

  // -- 7. The marker -----------------------------------------------------------
  await markSeasonResetApplied(userId, tx);

  return summary;
}

/** Put theme, race card, badge, banner and displayed title back to their defaults. */
async function resetLook(tx: Tx, userId: string): Promise<void> {
  const surviving = await tx.seasonPassProgress.findMany({
    where: { seasonPass: { userId }, unlockedAt: { not: null }, rewardType: { in: COSMETIC_TYPES } },
    select: { rewardKey: true, rewardType: true },
  });
  const still = (type: RewardType) =>
    new Set(surviving.filter((row) => row.rewardType === type).map((row) => selectionKeyFor({ key: row.rewardKey, type })));
  const keep = (chosen: string | null | undefined, type: RewardType): boolean =>
    chosen !== null && chosen !== undefined && still(type).has(chosen);

  const profile = await tx.careerProfile.findUnique({
    where: { userId },
    select: { themeKey: true, raceCardKey: true, badgeKey: true, bannerKey: true },
  });
  if (profile !== null) {
    await tx.careerProfile.update({
      where: { userId },
      data: {
        themeKey: keep(profile.themeKey, 'THEME') ? profile.themeKey : DEFAULT_THEME_KEY,
        raceCardKey: keep(profile.raceCardKey, 'RACE_CARD') ? profile.raceCardKey : DEFAULT_RACE_CARD_KEY,
        badgeKey: keep(profile.badgeKey, 'BADGE') ? profile.badgeKey : null,
        bannerKey: keep(profile.bannerKey, 'BANNER') ? profile.bannerKey : null,
      },
    });
  }

  // The displayed title goes back to Automatic by deleting its row.
  // `resolveDisplayTitle` honours any pass title that names a real reward, so
  // leaving the row would keep showing a title whose pass no longer exists.
  const title = await tx.configOverride.findUnique({
    where: { userId_key: { userId, key: DISPLAY_TITLE_KEY } },
    select: { value: true },
  });
  if (title !== null) {
    const survivingTitles = new Set(surviving.filter((row) => row.rewardType === 'TITLE').map((row) => row.rewardKey));
    const value = typeof title.value === 'string' ? title.value : '';
    const stillEarned = value.startsWith(PASS_TITLE_PREFIX) && survivingTitles.has(value.slice(PASS_TITLE_PREFIX.length));
    if (!stillEarned) {
      await tx.configOverride.delete({ where: { userId_key: { userId, key: DISPLAY_TITLE_KEY } } });
    }
  }
}

/** Reset one account in its own transaction. */
export async function resetSeasonRewardsFor(
  userId: string,
  options: SeasonResetOptions = {},
): Promise<SeasonResetSummary> {
  return prisma.$transaction((tx) => resetSeasonRewardsInTx(tx as Tx, userId, options), TRANSACTION_OPTIONS);
}

/** One line per account, for the server log the desktop shell keeps. */
export function describeSeasonReset(summary: SeasonResetSummary, name?: string): string {
  const who = name ? `${name} (${summary.userId})` : summary.userId;
  if (summary.skipped) return `[season-reset] ${who}: already reset, nothing to do`;
  return (
    `[season-reset] ${who}: removed ${summary.passesRemoved} season pass(es) ` +
    `(${summary.unlockedTiersRemoved} unlocked tiers), ${summary.seasonalChallengesRemoved} seasonal challenge(s), ` +
    `${summary.trophiesRemoved} trophy(ies), ${summary.hallOfFameEntriesRemoved} Hall of Fame entry(ies), ` +
    `${summary.xpTransactionsRemoved} XP award(s) worth ${summary.careerXpRemoved} career XP; ` +
    `career XP ${summary.careerXpBefore} -> ${summary.careerXpAfter}, level ${summary.levelBefore} -> ${summary.levelAfter}` +
    `${summary.lookReset ? '; look reset to defaults' : ''}`
  );
}

/**
 * Reset every account on this machine that has not been reset yet.
 *
 * Each account is its own transaction, so one account's failure is logged and
 * leaves that account unmarked for the next start, without holding back the
 * others. Never throws for a single account; the caller still guards the
 * whole call, since listing the accounts can fail too.
 */
export async function resetSeasonRewards(
  log: { info: (line: string) => void; error: (line: string, error: unknown) => void } = {
    info: (line) => console.log(line),
    error: (line, error) => console.error(line, error),
  },
): Promise<SeasonResetSummary[]> {
  const users = await prisma.user.findMany({
    where: { configOverrides: { none: { key: SEASON_RESET_KEY } } },
    select: { id: true, name: true },
  });

  const summaries: SeasonResetSummary[] = [];
  for (const user of users) {
    try {
      const summary = await resetSeasonRewardsFor(user.id);
      summaries.push(summary);
      log.info(describeSeasonReset(summary, user.name));
    } catch (error) {
      log.error(`[season-reset] ${user.name} (${user.id}): failed, will retry on the next start`, error);
    }
  }
  return summaries;
}
