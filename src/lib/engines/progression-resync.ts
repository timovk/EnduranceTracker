/**
 * Putting progression back in step after something other than a stint
 * changed the history (0.4.0).
 *
 * A logged stint runs every engine in order. Other edits — a race's runtime or
 * event changed, the upgrade repairing a race, `db:recompute` — change what the
 * history says without going through that path, and this module is what they
 * call instead.
 *
 * The rule it follows is the one the whole economy follows: XP follows the
 * data, landmarks stay earned. Balances (the Story Complete bonus) follow an
 * edit at once, because an edit can always be undone and a balance can follow
 * it back. Landmarks — achievements, milestones, mastery nodes — are never
 * taken back, so they are reached only on an edit that cannot be a typo about
 * to be corrected.
 */

import { XP_CONFIG } from '@/lib/config';
import type { Tx } from '@/lib/db/client';
import { replayRace, type RaceHistory } from '@/lib/domain/career-timeline';
import { storyCompleteBonus } from '@/lib/domain/progression';
import { syncAchievements, syncMilestones } from './achievement-engine';
import { fillLandmarkDates, syncCareerMilestones } from './career-milestone-engine';
import { loadRaceTimelineInputs } from './career-timeline-engine';
import { ensureMasteryTrees, recomputeRaceMasteries, syncMastery } from './mastery-engine';
import { computeCareerMetricsWithHistory } from './metrics';
import { awardXp, revokeXpByDedupeKey, settleLedger, type XpRevocation } from './xp-ledger';

const NOTHING_REVOKED: XpRevocation = { transactions: 0, careerXp: 0, seasonXp: 0, earliest: null };

/** The Story Complete bonus's dedupe key: one per race, whatever completed it. */
export function storyBonusKey(raceId: string): string {
  return `story-complete:${raceId}`;
}

export interface StoryBonusReconciliation {
  /** Whether the race is Story Complete by its replay. */
  storyComplete: boolean;
  /** Career XP paid now; 0 when the bonus was already held or is not due. */
  awarded: number;
  /** What revoking an unsupported bonus took back. Settle the ledger with it. */
  revocation: XpRevocation;
}

/**
 * Make the Story Complete bonus exist exactly when the race is Story Complete.
 *
 * The race is replayed from its stints (`replayRace`), clamped to its current
 * runtime, unless the caller already holds its `RaceHistory` — the upgrade and
 * `db:recompute` pass the one from the career replay they built once.
 *
 * A complete race without its bonus is paid it: a runtime edit under 0.3.x
 * could complete a race without paying, and so can an edit now. The amount is
 * the ordinary bonus for the race's length, career XP only — only a live stint
 * pays season XP as well. The row names the stint that completed the story,
 * or `crossingSessionId` when a stint path passes its own.
 *
 * A bonus held by a race that is no longer complete is revoked, which also
 * frees its key so the race can earn it again. The caller settles the ledger
 * with the returned revocation (`settleLedger`) after its last award.
 *
 * A bonus that is held and still supported is left exactly as it was, never
 * re-sized. PRECONDITION: `raceId` belongs to `userId` when `history` is
 * passed; without it the race is looked up inside the account.
 */
export async function reconcileStoryBonus(
  tx: Tx,
  userId: string,
  raceId: string,
  options: { history?: RaceHistory; crossingSessionId?: string } = {},
): Promise<StoryBonusReconciliation> {
  let history = options.history;
  if (history === undefined) {
    const inputs = await loadRaceTimelineInputs(tx, userId, raceId);
    if (inputs === null) return { storyComplete: false, awarded: 0, revocation: NOTHING_REVOKED };
    history = replayRace(inputs.race, inputs.sessions);
  }

  const key = storyBonusKey(raceId);
  const held = await tx.xPTransaction.findFirst({ where: { userId, dedupeKey: key }, select: { id: true } });
  const storyComplete = history.storyCompletedAt !== null;

  if (storyComplete && held === null) {
    const race = history.race;
    const award = await awardXp(tx, userId, {
      source: 'STORY_COMPLETE',
      amount: storyCompleteBonus(race.runtimeSec, race.isMajorEvent, XP_CONFIG).careerXp,
      description: `Story Complete — ${race.name}`,
      sourceRef: raceId,
      sessionId: options.crossingSessionId ?? history.completingSessionId ?? undefined,
      dedupeKey: key,
    });
    return { storyComplete, awarded: award.granted, revocation: NOTHING_REVOKED };
  }

  if (!storyComplete && held !== null) {
    return { storyComplete, awarded: 0, revocation: await revokeXpByDedupeKey(tx, userId, key) };
  }

  return { storyComplete, awarded: 0, revocation: NOTHING_REVOKED };
}

export interface RaceEditResync {
  /** Career XP the edit paid: a Story Complete bonus, and what it unlocked. */
  xpAwarded: number;
  /** Career XP that came off because the edit no longer supports it. */
  xpRevoked: number;
  /** The Story Complete bonus's part in both. */
  storyBonus: { awarded: number; revoked: number };
}

/**
 * Bring progression in line after a race was edited, inside the edit's
 * transaction, after its intervals and aggregates were rebuilt.
 *
 *   1. The Story Complete bonus follows the edit (`reconcileStoryBonus`),
 *      and the ledger is settled at once for whatever came off
 *      (`settleLedger`), so anything paid below is stamped on the career as
 *      it now is and measured against it.
 *   2. The event caches follow it: trees for a new event, and every event's
 *      editions and hours (`ensureMasteryTrees`, `recomputeRaceMasteries`).
 *   3. Only when the runtime did NOT change: mastery nodes, achievements,
 *      milestone ladders and Career Milestones are synced, and any landmark
 *      still without a date is dated from the replay. A runtime edit is
 *      exactly the edit most likely to be a typo corrected a minute later,
 *      and a landmark can never be taken back, so after one the landmarks
 *      wait for the next stint, as they did before 0.4.0. Balances followed
 *      at step 1, because they can follow the correction back.
 *
 * So nothing permanent is ever written on the strength of a runtime edit
 * alone: a typo corrected a minute later leaves nothing behind.
 */
export async function resyncAfterRaceEdit(
  tx: Tx,
  userId: string,
  raceId: string,
  now: Date,
  options: { runtimeChanged: boolean },
): Promise<RaceEditResync> {
  const story = await reconcileStoryBonus(tx, userId, raceId);
  await settleLedger(tx, userId, [story.revocation]);
  let xpAwarded = story.awarded;

  await ensureMasteryTrees(tx, userId, now);
  await recomputeRaceMasteries(tx, userId, now);

  if (!options.runtimeChanged) {
    const mastery = await syncMastery(tx, userId, now);
    const { metrics, history } = await computeCareerMetricsWithHistory(userId, tx);
    const achievements = await syncAchievements(tx, userId, metrics, now);
    const milestones = await syncMilestones(tx, userId, metrics, now);
    const careerMilestones = await syncCareerMilestones(tx, userId, { metrics, history, now });
    await fillLandmarkDates(tx, userId, { history, now });
    for (const unlock of [...mastery, ...achievements, ...milestones]) xpAwarded += unlock.xpAwarded;
    xpAwarded += careerMilestones.xpAwarded;
  }

  return {
    xpAwarded,
    xpRevoked: story.revocation.careerXp,
    storyBonus: { awarded: story.awarded, revoked: story.revocation.careerXp },
  };
}
