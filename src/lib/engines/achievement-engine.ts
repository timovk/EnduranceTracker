/**
 * Achievements and milestones.
 *
 * Two systems that look similar and are deliberately not the same thing:
 *
 *   * An ACHIEVEMENT is a discrete, named accomplishment with a rarity — one
 *     row, one moment, one story. Its definitions live in
 *     `config/achievements.ts`.
 *   * A MILESTONE is a rung on a numerical ladder that runs decades into the
 *     future — the thousandth hour, the hundredth race. Its ladders live in
 *     `config/milestones.ts`.
 *
 * Both measure themselves against `CareerMetrics`, which is the only place a
 * lifetime number is computed, so every system in the application agrees about
 * what "one hundred hours" means.
 *
 * Two principles run through the whole file and explain most of its shape:
 *
 *   1. NOTHING HERE IS EVER LOST. An achievement that has unlocked stays
 *      unlocked and a milestone that has been reached stays reached, whatever
 *      any later number does. There is no code path that clears `unlockedAt`
 *      or `reachedAt`, and there must never be one.
 *   2. PROGRESS IS VISIBLE BEFORE THE UNLOCK. `AchievementProgress` stores the
 *      current value and the target even while an achievement is locked, so
 *      the UI can draw an honest progress bar rather than a row of question
 *      marks. Secret achievements withhold their name and description until
 *      they happen, but they still track progress underneath.
 *
 * The write paths take the caller's transaction client, so one logged session
 * is one atomic write. The two board functions are read-only and may use the
 * global client.
 */

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BOARD_CONFIG,
  MILESTONES,
  MILESTONE_CONFIG,
  type AchievementDef,
  type MilestoneDef,
} from '@/lib/config';
import { prisma, type Tx } from '@/lib/db/client';
import { RARITY_ORDER, type Rarity } from '@/lib/domain/types';
import type { AchievementUnlock, MilestoneUnlock } from '@/lib/engines/contracts';
import { computeCareerMetrics, type CareerMetrics } from '@/lib/engines/metrics';
import { awardXp } from '@/lib/engines/xp-ledger';

// ---------------------------------------------------------------------------
// Presentation vocabulary
//
// Copy rather than balance, so it lives beside the code that groups by it.
// ---------------------------------------------------------------------------

export type AchievementCategory = AchievementDef['category'];

/** The order the cabinet reads in: how you started, then how far you went. */
export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'firsts',
  'dedication',
  'endurance',
  'variety',
  'collection',
  'mastery',
  'career',
];

export const ACHIEVEMENT_CATEGORY_LABELS: Readonly<Record<AchievementCategory, string>> = {
  firsts: 'Firsts',
  dedication: 'Dedication',
  endurance: 'Endurance',
  variety: 'Variety',
  collection: 'Collection',
  mastery: 'Mastery',
  career: 'Career',
};

/**
 * What a secret achievement says about itself before it happens.
 *
 * It is not a taunt and not a puzzle to be solved — the secrets in this
 * application are small, warm things (picking a race back up after months
 * away, watching an entire race at 1.0x) that are far nicer discovered than
 * pursued. The placeholder is written to be read once and then forgotten.
 */
const SECRET_PLACEHOLDER = {
  name: 'Not Yet Introduced',
  description: 'Something here is waiting to happen on its own. It will say hello when it does.',
} as const;

// ---------------------------------------------------------------------------
// Board types
// ---------------------------------------------------------------------------

export interface AchievementBoardRow {
  key: string;
  /** Withheld for a secret that has not unlocked yet — see `revealed`. */
  name: string;
  description: string;
  category: AchievementCategory;
  rarity: Rarity;
  iconKey: string;
  isSecret: boolean;
  /** False only for a secret still to come. The UI styles those differently. */
  revealed: boolean;
  metric: string;
  /** Live metric value, so the bar is never stale. */
  value: number;
  target: number;
  /** 0-1, clamped. Present whether locked or not. */
  progress: number;
  unlocked: boolean;
  unlockedAt: Date | null;
  xpReward: number;
}

export interface AchievementCategoryGroup {
  category: AchievementCategory;
  label: string;
  total: number;
  unlocked: number;
  completionPercent: number;
  rows: AchievementBoardRow[];
}

export interface AchievementRarityTally {
  rarity: Rarity;
  total: number;
  unlocked: number;
  completionPercent: number;
}

export interface AchievementBoard {
  total: number;
  unlocked: number;
  /** 0-100, one decimal place. */
  completionPercent: number;
  /** Career XP these achievements have already contributed. */
  xpEarned: number;
  /** Career XP still sitting in the cabinet. Framed as waiting, not as owed. */
  xpWaiting: number;
  byRarity: AchievementRarityTally[];
  categories: AchievementCategoryGroup[];
  /** Most recent unlocks first. The shelf, not a feed. */
  recentlyUnlocked: AchievementBoardRow[];
  /** Locked achievements that happen to be close. Never a to-do list. */
  nearlyThere: AchievementBoardRow[];
  headline: string;
  nearlyThereNote: string;
}

export interface MilestoneThresholdRow {
  threshold: number;
  /** Zero-based rung of the ladder. Decides what the rung is worth. */
  index: number;
  reached: boolean;
  reachedAt: Date | null;
  /** The metric value at the moment of reaching, kept as a memento. */
  valueAtReach: number | null;
  /** XP granted on reach, or what this rung is worth if it is still ahead. */
  xp: number;
  /** 0-1 progress towards this rung, measured from the rung below it. */
  progress: number;
}

export interface MilestoneBoardRow {
  metric: string;
  label: string;
  unit: string;
  format: MilestoneDef['format'];
  iconKey: string;
  /** Live metric value. */
  value: number;
  reached: number;
  total: number;
  completionPercent: number;
  /** Highest rung reached so far, or null before the first one. */
  lastReached: number | null;
  /** The rung currently in view, or null once the whole ladder is climbed. */
  next: { threshold: number; progress: number; remaining: number; xp: number } | null;
  thresholds: MilestoneThresholdRow[];
}

export interface MilestoneBoard {
  rows: MilestoneBoardRow[];
  reached: number;
  total: number;
  completionPercent: number;
  /** Career XP milestones have contributed, read from the progress rows. */
  xpEarned: number;
  headline: string;
}

// ---------------------------------------------------------------------------
// Pure evaluation
// ---------------------------------------------------------------------------

/**
 * Read a named metric out of `CareerMetrics`.
 *
 * Configuration names metrics as strings because the definitions are data, so
 * the lookup is unavoidably dynamic. A name that is not a metric resolves to
 * zero rather than throwing: a typo in a future achievement definition should
 * leave that one achievement quietly unreachable, not take down the session
 * that was being logged when it was noticed.
 */
function metricValue(metrics: CareerMetrics, metric: string): number {
  const record: Record<string, number | undefined> = metrics as unknown as Record<string, number | undefined>;
  const value = record[metric];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // No career metric is ever legitimately negative, and a negative one would
  // render as a backwards progress bar. Clamping here keeps every consumer of
  // this function honest without each of them having to remember.
  return Math.max(0, value);
}

/**
 * Measure one achievement against the metrics. Pure, and the only place the
 * unlock condition is expressed.
 *
 * Note what this does NOT do: it reports whether the condition currently
 * holds, not whether the achievement is unlocked. Unlock state lives in the
 * database and is permanent; this function is only ever allowed to turn it on.
 */
export function evaluateAchievement(
  def: AchievementDef,
  metrics: CareerMetrics,
): { value: number; target: number; unlocked: boolean } {
  const value = metricValue(metrics, def.metric);
  const target = def.threshold;
  return { value, target, unlocked: value >= target };
}

/** Progress towards a target, clamped to 0-1. A zero target is already there. */
function progressTowards(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, value / target));
}

/**
 * The rung of a milestone ladder currently in view, with progress towards it.
 *
 * Progress is measured from the rung BELOW rather than from zero. Once the
 * hundredth hour has passed, a bar that reads "100 of 200" would sit frozen
 * near the middle for the next fifty hours of watching; measured from the
 * previous rung it moves visibly for every hour. Returns null when the whole
 * ladder has been climbed — which is a fine thing to be, not a gap to fill.
 */
export function nextMilestoneFor(
  def: MilestoneDef,
  value: number,
): { threshold: number; progress: number } | null {
  let previous = 0;
  for (const threshold of def.thresholds) {
    if (value >= threshold) {
      previous = threshold;
      continue;
    }
    const span = threshold - previous;
    const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (value - previous) / span));
    return { threshold, progress };
  }
  return null;
}

/**
 * What one rung of a milestone ladder is worth.
 *
 * Later rungs are worth more, on the linear curve documented in
 * `MILESTONE_CONFIG`. The ramp starts below one so that the opening weeks of a
 * career — when the first rung of every ladder falls at once — do not out-earn
 * the watching that produced them. Exported so the board can show the value of
 * a rung still ahead using exactly the arithmetic that will eventually grant it.
 */
export function milestoneXpFor(def: MilestoneDef, index: number): number {
  const multiplier = Math.min(
    MILESTONE_CONFIG.baseMultiplier + MILESTONE_CONFIG.indexScaling * Math.max(0, index),
    MILESTONE_CONFIG.maxIndexMultiplier,
  );
  return Math.round(def.xpPerThreshold * multiplier);
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function categoryRank(category: AchievementCategory): number {
  const index = ACHIEVEMENT_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? ACHIEVEMENT_CATEGORY_ORDER.length : index;
}

function rarityRank(rarity: Rarity): number {
  const index = RARITY_ORDER.indexOf(rarity);
  return index === -1 ? RARITY_ORDER.length : index;
}

/**
 * Display order for the cabinet: category, then rarity ascending, then name.
 *
 * Common first inside a category on purpose — read top to bottom, a category
 * then tells the story of how far the thing goes, starting somewhere the user
 * has almost certainly already been.
 */
function compareForDisplay(a: AchievementDef, b: AchievementDef): number {
  return (
    categoryRank(a.category) - categoryRank(b.category) ||
    rarityRank(a.rarity) - rarityRank(b.rarity) ||
    a.name.localeCompare(b.name)
  );
}

/** Unlocks are reported rarest first, so the summary screen leads with the news. */
function compareUnlocksByImpact(a: AchievementUnlock, b: AchievementUnlock): number {
  return rarityRank(b.rarity) - rarityRank(a.rarity) || b.xpAwarded - a.xpAwarded || a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// Definition sync — a seeding path, not a session path
// ---------------------------------------------------------------------------

/**
 * Write the achievement definitions from configuration into the database.
 *
 * `AchievementProgress` carries a foreign key to `Achievement.key`, so these
 * rows have to exist before any progress can be tracked. Idempotent: it is an
 * upsert per definition, so running it after a re-balance updates names,
 * descriptions, rarities, rewards and thresholds in place without disturbing a
 * single unlock — progress rows are untouched here, by design.
 *
 * Called from `scripts/seed.ts` and from migrations, NEVER from the session
 * path: definitions change when the application is deployed, not when somebody
 * watches a race, and fifty upserts have no business inside a stint log.
 *
 * This is the one writer in this file that opens its own transaction, because
 * it has no session to belong to and a half-written definition table would be
 * a genuinely confusing thing to inherit.
 *
 * Returns the number of definitions written.
 */
export async function syncAchievementDefinitions(): Promise<number> {
  const ordered = [...ACHIEVEMENTS].sort(compareForDisplay);

  await prisma.$transaction(
    ordered.map((def, index) => {
      const row = {
        name: def.name,
        description: def.description,
        category: def.category,
        rarity: def.rarity,
        metric: def.metric,
        threshold: def.threshold,
        xpReward: def.xpReward,
        iconKey: def.iconKey,
        isSecret: def.isSecret ?? false,
        // Spaced by ten so a later definition can be slotted between two
        // existing ones without renumbering the whole cabinet.
        sortOrder: index * 10,
      };
      return prisma.achievement.upsert({
        where: { key: def.key },
        create: { key: def.key, ...row },
        update: row,
      });
    }),
  );

  return ordered.length;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

interface PendingProgressUpdate {
  id: string;
  value: number;
  target: number;
  unlockedAt: Date | null;
}

/**
 * Bring every achievement's progress up to date and unlock anything whose
 * condition has come true.
 *
 * Runs inside the caller's transaction, after the session that may have caused
 * an unlock has already been written — `metrics` must therefore have been
 * computed through the same transaction client, or the whole cabinet would be
 * evaluated one session behind.
 *
 * Returns only the achievements that unlocked on THIS run, which is what the
 * stint summary celebrates. Re-running grants nothing further and returns an
 * empty list: the `unlockedAt` check below is the logical guard and the
 * `achievement:<key>` dedupe key on the XP ledger is the structural one.
 *
 * AN ACHIEVEMENT CAN NEVER BE LOST. If a metric somehow moves downwards — a
 * race deleted, a mis-logged session corrected — `unlockedAt` is left exactly
 * as it was. Only `value` and `target` follow the metrics down. There is
 * deliberately no branch anywhere in this function that writes
 * `unlockedAt: null`.
 */
export async function syncAchievements(
  tx: Tx,
  userId: string,
  metrics: CareerMetrics,
  now: Date = new Date(),
): Promise<AchievementUnlock[]> {
  // Progress rows point at `Achievement` rows by foreign key. If the
  // definitions have not been seeded yet, writing progress would fail and take
  // the user's logged session down with it — so the keys that actually exist
  // are read first and anything else is simply left for the next seed. One
  // cheap indexed read is a fair price for a stint that can never be undone by
  // a deployment ordering problem.
  const [definitionRows, existingRows] = await Promise.all([
    tx.achievement.findMany({ select: { key: true } }),
    tx.achievementProgress.findMany({
      where: { userId },
      select: { id: true, achievementKey: true, value: true, target: true, unlockedAt: true },
    }),
  ]);

  const known = new Set(definitionRows.map((row) => row.key));
  const existing = new Map(existingRows.map((row) => [row.achievementKey, row]));

  const creates: { userId: string; achievementKey: string; value: number; target: number; unlockedAt: Date | null }[] = [];
  const updates: PendingProgressUpdate[] = [];
  const unlocked: AchievementDef[] = [];

  for (const def of ACHIEVEMENTS) {
    if (!known.has(def.key)) continue;

    const { value, target, unlocked: conditionMet } = evaluateAchievement(def, metrics);
    const row = existing.get(def.key);

    if (!row) {
      // A brand-new tracking row. It is created whether or not the condition
      // holds, because a locked achievement with a visible bar is the point.
      creates.push({
        userId,
        achievementKey: def.key,
        value,
        target,
        unlockedAt: conditionMet ? now : null,
      });
      if (conditionMet) unlocked.push(def);
      continue;
    }

    const newlyUnlocked = row.unlockedAt === null && conditionMet;
    if (newlyUnlocked) unlocked.push(def);

    // Skip the write entirely when nothing moved. Fifty achievements share a
    // handful of metrics, so most sessions change only a few rows.
    if (!newlyUnlocked && row.value === value && row.target === target) continue;

    updates.push({
      id: row.id,
      value,
      target,
      // Whatever was there stays there. This is the "never lost" rule, in code.
      unlockedAt: row.unlockedAt ?? (conditionMet ? now : null),
    });
  }

  if (creates.length > 0) {
    // `skipDuplicates` guards the one race worth guarding: two writers
    // creating the first progress row for the same achievement at once.
    await tx.achievementProgress.createMany({ data: creates, skipDuplicates: true });
  }

  for (const update of updates) {
    await tx.achievementProgress.update({
      where: { id: update.id },
      data: { value: update.value, target: update.target, unlockedAt: update.unlockedAt },
    });
  }

  const unlocks: AchievementUnlock[] = [];
  for (const def of unlocked) {
    const result = await awardXp(tx, userId, {
      source: 'ACHIEVEMENT',
      amount: def.xpReward,
      description: `Achievement — ${def.name}`,
      sourceRef: def.key,
      // The structural double-award guard. Unique in the database, stable
      // across re-balances, and the reason re-running this engine is safe.
      dedupeKey: `achievement:${def.key}`,
    });

    unlocks.push({
      key: def.key,
      // An unlock reveals a secret, so the real name travels with it.
      name: def.name,
      description: def.description,
      rarity: def.rarity,
      iconKey: def.iconKey,
      xpAwarded: result.granted,
    });
  }

  return unlocks.sort(compareUnlocksByImpact);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * Reach every milestone rung the current numbers have passed.
 *
 * A ladder can be climbed several rungs at a time — importing a back catalogue
 * of races crosses a dozen at once — so every threshold at or below the
 * current value that has no `reachedAt` is reached here, each with its own
 * award and its own `milestone:<metric>:<threshold>` dedupe key. Later rungs
 * are worth more, on the curve in `MILESTONE_CONFIG`.
 *
 * Rows are written only when a rung is reached. Unreached rungs are not stored
 * as empty rows: the ladders live in configuration and can be extended at any
 * time, so a table of placeholders would only ever be an out-of-date copy of
 * `MILESTONES`.
 *
 * Like achievements, a reached milestone is permanent. `reachedAt` is only
 * ever written, never cleared.
 */
export async function syncMilestones(
  tx: Tx,
  userId: string,
  metrics: CareerMetrics,
  now: Date = new Date(),
): Promise<MilestoneUnlock[]> {
  const existingRows = await tx.milestoneProgress.findMany({
    where: { userId },
    select: { metric: true, threshold: true, reachedAt: true },
  });

  const reachedAlready = new Set(
    existingRows.filter((row) => row.reachedAt !== null).map((row) => `${row.metric}:${row.threshold}`),
  );

  const reached: MilestoneUnlock[] = [];

  for (const def of MILESTONES) {
    const value = metricValue(metrics, def.metric);

    for (let index = 0; index < def.thresholds.length; index += 1) {
      const threshold = def.thresholds[index];
      if (threshold === undefined) continue;
      // Ladders are ascending, so the first rung above the value ends this one.
      if (value < threshold) break;
      if (reachedAlready.has(`${def.metric}:${threshold}`)) continue;

      const xp = milestoneXpFor(def, index);
      const result = await awardXp(tx, userId, {
        source: 'MILESTONE',
        amount: xp,
        description: `Milestone — ${def.label}: ${threshold}${def.unit}`,
        sourceRef: `${def.metric}:${threshold}`,
        dedupeKey: `milestone:${def.metric}:${threshold}`,
      });

      // `upsert` rather than `create`: a row may exist with `reachedAt` null
      // from an earlier version of this table, and it should be filled in
      // rather than duplicated.
      await tx.milestoneProgress.upsert({
        where: { userId_metric_threshold: { userId, metric: def.metric, threshold } },
        create: {
          userId,
          metric: def.metric,
          threshold,
          reachedAt: now,
          valueAtReach: value,
          xpAwarded: result.granted,
        },
        update: { reachedAt: now, valueAtReach: value, xpAwarded: result.granted },
      });

      reached.push({
        metric: def.metric,
        label: def.label,
        threshold,
        value,
        xpAwarded: result.granted,
      });
    }
  }

  return reached;
}

// ---------------------------------------------------------------------------
// Boards — read-only
// ---------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : round1((part / whole) * 100);
}

/** Positive framing for the cabinet as a whole. Never a count of what is undone. */
function achievementHeadline(unlockedCount: number, total: number): string {
  if (total === 0) return 'The cabinet is being built.';
  if (unlockedCount === 0) {
    return `${total} achievements in the cabinet, every one of them still ahead of you.`;
  }
  if (unlockedCount >= total) {
    return `All ${total} achievements found. The cabinet is complete — and it stays that way.`;
  }
  return `${unlockedCount} of ${total} found so far, with ${total - unlockedCount} still out there to run into.`;
}

function milestoneHeadline(reached: number, total: number, ladders: number): string {
  if (reached === 0) {
    return `${ladders} counters, all of them running. The first milestone on each is closer than it looks.`;
  }
  if (reached >= total) {
    return `Every milestone on every ladder reached. ${ladders} counters, all the way up.`;
  }
  return `${reached} milestones reached across ${ladders} counters. Each one is permanent.`;
}

/**
 * The whole achievement cabinet, with live progress.
 *
 * Deliberately mixed sources: the DEFINITIONS come from configuration (so a
 * newly added achievement appears immediately, seeded or not), the VALUES come
 * from freshly computed metrics (so a bar is never stale), and UNLOCK STATE
 * comes from the database and only from the database — because an unlock is a
 * historical fact about a moment, not a re-derivable property of today's
 * numbers. That separation is what makes "an achievement can never be lost"
 * true on the reading side as well as the writing side.
 */
export async function getAchievementBoard(userId: string, db: Tx = prisma): Promise<AchievementBoard> {
  const [metrics, progressRows] = await Promise.all([
    computeCareerMetrics(userId, db),
    db.achievementProgress.findMany({
      where: { userId },
      select: { achievementKey: true, unlockedAt: true },
    }),
  ]);

  const unlockedAtByKey = new Map(
    progressRows.filter((row) => row.unlockedAt !== null).map((row) => [row.achievementKey, row.unlockedAt]),
  );

  const rows: AchievementBoardRow[] = [...ACHIEVEMENTS].sort(compareForDisplay).map((def) => {
    const { value, target } = evaluateAchievement(def, metrics);
    const unlockedAt = unlockedAtByKey.get(def.key) ?? null;
    const unlocked = unlockedAt !== null;
    const isSecret = def.isSecret ?? false;
    // A secret withholds its name and description, never its progress bar.
    const revealed = unlocked || !isSecret;

    return {
      key: def.key,
      name: revealed ? def.name : SECRET_PLACEHOLDER.name,
      description: revealed ? def.description : SECRET_PLACEHOLDER.description,
      category: def.category,
      rarity: def.rarity,
      iconKey: def.iconKey,
      isSecret,
      revealed,
      metric: def.metric,
      value,
      target,
      progress: unlocked ? 1 : progressTowards(value, target),
      unlocked,
      unlockedAt,
      xpReward: def.xpReward,
    };
  });

  const unlockedRows = rows.filter((row) => row.unlocked);

  const categories: AchievementCategoryGroup[] = ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const inCategory = rows.filter((row) => row.category === category);
    const done = inCategory.filter((row) => row.unlocked).length;
    return {
      category,
      label: ACHIEVEMENT_CATEGORY_LABELS[category],
      total: inCategory.length,
      unlocked: done,
      completionPercent: percent(done, inCategory.length),
      rows: inCategory,
    };
  }).filter((group) => group.total > 0);

  const byRarity: AchievementRarityTally[] = RARITY_ORDER.map((rarity) => {
    const inRarity = rows.filter((row) => row.rarity === rarity);
    const done = inRarity.filter((row) => row.unlocked).length;
    return {
      rarity,
      total: inRarity.length,
      unlocked: done,
      completionPercent: percent(done, inRarity.length),
    };
  }).filter((tally) => tally.total > 0);

  const recentlyUnlocked = [...unlockedRows]
    .sort((a, b) => (b.unlockedAt?.getTime() ?? 0) - (a.unlockedAt?.getTime() ?? 0))
    .slice(0, ACHIEVEMENT_BOARD_CONFIG.recentlyUnlockedCount);

  // Close enough to be pleasant to notice, and nothing at zero — see
  // `nearlyThereMinProgress`. This is a shelf of things within arm's reach,
  // not a list of tasks, and the copy below says so in as many words.
  const nearlyThere = rows
    .filter((row) => !row.unlocked && row.progress >= ACHIEVEMENT_BOARD_CONFIG.nearlyThereMinProgress)
    .sort((a, b) => b.progress - a.progress || rarityRank(b.rarity) - rarityRank(a.rarity))
    .slice(0, ACHIEVEMENT_BOARD_CONFIG.nearlyThereCount);

  return {
    total: rows.length,
    unlocked: unlockedRows.length,
    completionPercent: percent(unlockedRows.length, rows.length),
    xpEarned: unlockedRows.reduce((sum, row) => sum + row.xpReward, 0),
    xpWaiting: rows.filter((row) => !row.unlocked).reduce((sum, row) => sum + row.xpReward, 0),
    byRarity,
    categories,
    recentlyUnlocked,
    nearlyThere,
    headline: achievementHeadline(unlockedRows.length, rows.length),
    nearlyThereNote:
      'The ones you happen to be closest to. Nothing here needs doing — they arrive on their own if you keep watching what you enjoy.',
  };
}

/**
 * Every milestone ladder, with the rungs already reached and the one in view.
 *
 * Same split as the achievement board: ladders and rung values from
 * configuration, current values from live metrics, reached-state from the
 * database. A rung that has been reached shows the value it was reached at,
 * which is a nicer memento than the threshold itself — "the hundredth hour,
 * reached at 100.4".
 */
export async function getMilestoneBoard(userId: string, db: Tx = prisma): Promise<MilestoneBoard> {
  const [metrics, progressRows] = await Promise.all([
    computeCareerMetrics(userId, db),
    db.milestoneProgress.findMany({
      where: { userId },
      select: { metric: true, threshold: true, reachedAt: true, valueAtReach: true, xpAwarded: true },
    }),
  ]);

  const reachedRows = new Map(
    progressRows
      .filter((row) => row.reachedAt !== null)
      .map((row) => [`${row.metric}:${row.threshold}`, row]),
  );

  let totalReached = 0;
  let totalRungs = 0;
  let xpEarned = 0;

  const rows: MilestoneBoardRow[] = MILESTONES.map((def) => {
    const value = metricValue(metrics, def.metric);
    let previous = 0;
    let lastReached: number | null = null;
    let reachedCount = 0;

    const thresholds: MilestoneThresholdRow[] = def.thresholds.map((threshold, index) => {
      const stored = reachedRows.get(`${def.metric}:${threshold}`);
      // The database decides whether a rung has been reached. A value that has
      // moved downwards since does not un-reach anything.
      const reached = stored !== undefined;
      if (stored !== undefined) {
        reachedCount += 1;
        lastReached = threshold;
        xpEarned += stored.xpAwarded;
      }

      const span = threshold - previous;
      const progress = reached
        ? 1
        : span <= 0
          ? 1
          : Math.min(1, Math.max(0, (value - previous) / span));
      previous = threshold;

      return {
        threshold,
        index,
        reached,
        reachedAt: stored?.reachedAt ?? null,
        valueAtReach: stored?.valueAtReach ?? null,
        xp: stored !== undefined ? stored.xpAwarded : milestoneXpFor(def, index),
        progress,
      };
    });

    totalReached += reachedCount;
    totalRungs += thresholds.length;

    const upcoming = nextMilestoneFor(def, value);
    const nextIndex = upcoming === null ? -1 : def.thresholds.indexOf(upcoming.threshold);

    return {
      metric: def.metric,
      label: def.label,
      unit: def.unit,
      format: def.format,
      iconKey: def.iconKey,
      value,
      reached: reachedCount,
      total: thresholds.length,
      completionPercent: percent(reachedCount, thresholds.length),
      lastReached,
      next:
        upcoming === null
          ? null
          : {
              threshold: upcoming.threshold,
              progress: upcoming.progress,
              remaining: round1(Math.max(0, upcoming.threshold - value)),
              xp: milestoneXpFor(def, Math.max(0, nextIndex)),
            },
      thresholds,
    };
  });

  return {
    rows,
    reached: totalReached,
    total: totalRungs,
    completionPercent: percent(totalReached, totalRungs),
    xpEarned,
    headline: milestoneHeadline(totalReached, totalRungs, rows.length),
  };
}
