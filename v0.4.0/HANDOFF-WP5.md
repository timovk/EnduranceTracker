# HANDOFF — WP5 (Race Expeditions)

Branch `release/v0.4.0`, working tree only (not committed, per instructions), on top of WP4's `8a9e8fa`.
44 files modified (+2 357 / −151) plus 6 new paths. No migration, schema or `prisma/` change: WP1's `expeditionMode`
column and `ExpeditionSummary` model are used as they are.
Built against SPEC §3.2.5, §4.0 (step 5a/11a), §4.3 (all), §4.4, §4.5, §5 (P4, recompute), §6 rows 1–6/8/9/13–17/21/22,
§7, §8 and §10 WP5.

## What was built (files)

**New (source)**
- `src/lib/engines/expedition-engine.ts`
  - `reconcileExpedition(tx, userId, raceId, { crossingSessionId?, resize?, history?, award? }) → ExpeditionReconcile`
    `{ isExpedition, coverageSec, runtimeSec, awarded: {percent,xp,sessionId}[], revoked: {percent,xp}[],
    resized: {percent,fromXp,toXp}[], revocation, storyCompleted, began, nextCheckpoint, history }`.
    Held rows read by `{ userId, source: 'EXPEDITION', sourceRef: raceId }` (no LIKE). Revokes unsupported checkpoints
    (each judged by the percent in its own key, `coverageReaches`), re-sizes only with `resize` (and only percents the
    schedule lists), pays reached/unheld only while `isExpedition && checkpointsPayXp` and `award !== false`. The caller
    settles with `revocation`.
  - `heldExpeditionKeys(tx, userId, raceId)`, `expeditionModeOf(bool|null) → 'auto'|'on'|'off'`, `ExpeditionModeSetting`.
  - `writeExpeditionSummary(tx, userId, raceId, now, { retrospective, history?, unlocks?, timeline?, progression?, inputs?,
    championshipMastery? }) → { id, snapshot } | null` — null unless Expedition + Story Complete + no summary yet.
    Retrospective ⇒ championship mastery `null`; missing `unlocks` are reconstructed (`reconstructStintUnlocks` +
    `listStintCareerMilestones`), marked `unlocks: 'reconstructed'`.
  - `setExpeditionMode(tx, userId, raceId, mode, now) → ExpeditionModeChange | null` (writes the column, reconciles,
    writes a retrospective summary if due, settles).
  - `careerRecordProgression(db, userId, timeline)`, `LiveStintUnlocks`, `expeditionOutcomeOf(...)`,
    `stintExpeditionOutcome(db, userId, {id, raceId})`, `getExpeditionSummaryForRace(userId, raceId, db?)`,
    `getExpeditionSummary(userId, summaryId)`, `ExpeditionSummaryView`, `getExpeditionView(userId, raceId, now)`,
    `ExpeditionView`.
- `src/app/races/[id]/expedition/page.tsx` (force-dynamic, `requireUserId` + `ensureCareer`, `generateMetadata`
  "<race> — Expedition", `notFound()` for another account's or a missing race).
- `src/components/expeditions/`: `coverage-meter.tsx` (`CoverageMeter`), `expedition-mode-control.tsx` (client; toggle,
  "Reset to automatic", role=status message), `expedition-summary-card.tsx` (`ExpeditionSummaryCard`, server-compatible,
  props `snapshot, retrospective, accent?, raceHref?`), `expedition-view.tsx` (client; all eight page sections, log-a-stint
  dialog with the stint summary, thin/non-Expedition states).
- `src/components/ui/accent.ts` — `accentVars(color)` sets `--accent` and `--accent-soft` together.
- `src/lib/domain/stint-lanes.ts` — `stintLanes(stints, laneLimit) → { lanes, hidden }` (zod-free for client bundles).
- `tests/integration/expeditions.test.ts` (23 tests after the review fixes).

**Modified (source)**
- `src/lib/domain/expedition.ts`: `checkpointOfKey`, `checkpointsCrossedBy`, `checkpointTicks`, `nextCheckpoint`,
  `EXPEDITION_SUMMARY_SCHEMA_VERSION = 1`, `expeditionSummarySnapshotSchema`, `ExpeditionSummarySnapshotV1`,
  `parseExpeditionSummarySnapshot`, `ExpeditionSummaryInput`, `ExpeditionSummaryUnlocks`, `eventStandingAt`,
  `buildExpeditionSummarySnapshot` (throws if the story is not complete).
- `src/lib/engines/session-engine.ts`: step 5a (reconcile with `crossingSessionId`, breakdown
  "Expedition — N% of the story"), step 11a (summary), `expeditionCompleted` → SPECTACULAR celebration;
  `deleteViewingSession` reconciles (`expeditionXpRemoved`, `checkpointsRemoved`); `deleteRace` revokes
  `heldExpeditionKeys` (`expeditionXpRemoved`); `repairXpLedger` → `LedgerRepair.staleExpeditionCheckpoints`.
- `src/lib/engines/progression-resync.ts`: reconcile with `resize: runtimeChanged`; `RaceEditResync.checkpoints
  { awarded, revoked, resized }`; never writes a summary.
- `src/lib/engines/contracts.ts`: `ExpeditionOutcome`, `SessionOutcome.expedition`, `SessionRemoval.expeditionXpRemoved /
  checkpointsRemoved`, `RaceRemoval.expeditionXpRemoved`.
- `src/lib/engines/xp-ledger.ts`: `awardXp` stamps a monotonic `createdAt` (deviation 4).
- `src/lib/server/career-actions.ts`: `setExpeditionModeAction(raceId, mode)`.
- `src/lib/server/actions.ts`: race-edit messages for revoked / re-sized / newly reached checkpoints.
- `src/lib/server/session-summary.ts`, `src/lib/server/races.ts` (`RaceDetail.expedition`, card `isExpedition`,
  `CurrentStintData.expedition`, sessions' `newCoverageSeconds` from the replay).
- `src/lib/server/upgrades/career-backfill.ts`: P4, `EXPEDITION_CHUNK = 25`, `expeditionRaceIds`, `backfillExpeditions`,
  `PhaseContext.progression`, summary/log fields. `src/lib/server/recompute.ts` step 4 (`RecomputeReport.expeditions`);
  `scripts/recompute.ts` prints them.
- `src/lib/copy/tone.ts`: `describeFragments`, `expeditionBudgetNote`, `expeditionModeMessage`, `milestoneLabel` (moved).
- Domain helpers: `localDaysSpanned` (calendar), `careerRecordOptions` (records), `formatElapsed` (time),
  `celebrationView` `expedition` input (celebration).
- UI: `race-timeline.tsx` (`ExpeditionTimeline`, markers + legend, exported `gapsBetween`/`describeCoverage`),
  `race-detail-view.tsx`, `race-card.tsx`, `current-stint.tsx`, `stint-summary.tsx`, `controls.tsx` (Toggle `disabled`),
  `primitives.tsx` (TimingBar `valueText`, `children`), `identity.ts`, `appearance-picker.tsx`, events views.
- `src/lib/config/achievements.ts`: display name of `expedition` → "Around the Clock, Three Times" (key unchanged).
  `strategist-engine.ts`: "is a long race of about".

**Tests modified**: xp-exploits (I3/I4 for EXPEDITION in `afterEach`; rows 1–6, 8, 9, 13–17, 21, 22), career-backfill,
ledger-settle (award stamping, review fix 8),
upgrade-from-0.3.2 (P4), recompute, account-isolation, domain expedition/calendar/periods-tone/time-playback/config,
engines celebration/strategist, perf career-scale; helper `expeditionProblems(userId)` (I3) in `tests/helpers/career-db.ts`.

## Deviations (with reasons)

1. `reconcileExpedition` has no `now` parameter (it used none: `awardXp` stamps its own time); options add `history`
   (P4/recompute pass the context's replay); the result adds `resized`, `history`, and `sessionId` on `awarded`.
2. `ExpeditionOutcome.checkpointsReached` = checkpoints the stint crossed in the replay while an Expedition (0 XP when
   already held or unpaid) ∪ its own EXPEDITION rows; the same builder serves live and reopened summaries.
   `summaryId` only when `completed`.
3. The live summary is written when `becameStoryComplete` and the replay's completing stint is this one; otherwise a
   retrospective one (e.g. backdated completion). `ExpeditionSummary.createdAt = now`.
4. `awardXp` stamps `createdAt = max(now, latest row's createdAt + 1 ms)` when the latest row is less than 1 s ahead of
   the clock: two awards in the same millisecond were ordered by random id and broke I2 (WP4 had flagged the flake).
   A row more than 1 s ahead (a clock once set ahead) is not followed: the award is stamped on the clock (after any burst
   before it) and the running totals are re-stamped from it (`ledgerStamp`, review fix 8). Spec said awardXp unchanged;
   this is the smallest fix.
5. `backfillExpeditions(tx, ctx, chunk, { resize })` takes `tx` first like `backfillRaces`; `PhaseContext.progression`
   added; recompute step 4 reloads the timeline after steps 1–3.
6. Summary `startedAt` = first stint's `nominalStartsAt`; `records` = latest record per kind held by `completedAt`,
   `valueText` via `formatElapsed`/counts.
7. Additive extras: `setExpeditionMode` engine function, `getExpeditionSummary[ForRace]`, `RaceEditResync.checkpoints`,
   `LedgerRepair.staleExpeditionCheckpoints`, `RecomputeReport.expeditions`, `formatElapsed`, `localDaysSpanned`,
   `careerRecordOptions`, `stint-lanes.ts`, `milestoneLabel` moved to tone.ts.
8. `race-detail-view` root sets `accentVars` only with a championship colour (a self-referential `--accent: var(--accent)`
   blanked it); event views switched to `accentVars`; their Expedition badge links to `/races/[id]/expedition`.
9. A non-Expedition race's page still lists checkpoints ("Reached — switch Expedition Mode on to count it").
10. Chronicle parts of exploit rows 13/16 (frozen chapter) and `ensureChroniclesFrozen` are left to WP7.

## Facts later WPs must know

- Ledger `createdAt` is the real clock, bumped by 1 ms per award only inside a burst (the latest row < 1 s ahead). A
  row stamped ahead of the clock never pins later awards; group ledger XP by month/year on `createdAt` safely.
- `reconcileExpedition(..., { award: false })` revokes/re-sizes only (used by `deleteViewingSession`). Held checkpoints
  are supported by their own key's percent (`coverageReaches` in `domain/expedition.ts`), not by the configured list.
- `expeditionFigures(history, speed, now, held)` takes `held: ReadonlyMap<percent, amount>`; a held checkpoint's `xp`
  is the ledger amount.

- `CAREER_BACKFILL_PHASES = ['P1','P2','P3','P4']`; P5 appends after P4. `PhaseContext` has `timeline`, `history`,
  `progression`. Recompute steps are 1–5 (4 = expeditions, 5 = mark); WP7 adds Chronicle steps.
- WP7 Chronicle: render `ExpeditionSummaryCard` from `ExpeditionSummary` rows, parsing with
  `parseExpeditionSummarySnapshot` (null on a bad/other-version snapshot). The chapter year is the local year of
  `snapshot.completedAt`. Summary rows survive race deletion (`raceId` SetNull) and are never rewritten.
- WP6: `careerRecordOptions(weekStartsOn)` and `careerRecordProgression` give record options/progression.
- Invariant I3 checker: `expeditionProblems(userId)`; use it in any new ledger test's `afterEach`.
- Keep `zod` out of client components: import `stint-lanes.ts`, not `domain/expedition.ts`, from `'use client'` files.
- Revalidate `/races/${id}/expedition` whenever a race's stints/runtime/mode change.
- `accentVars` must set both `--accent` and `--accent-soft`; never write `--accent: var(--accent)`.

## Check results (final run, 2026-09-26)

- `npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && npx vitest run`:
  all exit 0; tsc clean, eslint clean; vitest 59 files passed, 1 skipped; 1118 tests passed, 23 skipped (124 s).
  (The only `prisma:error` output is the expected refusal in account-isolation.)
- Targeted `npx vitest run tests/integration/expeditions.test.ts tests/integration/xp-exploits.test.ts
  tests/integration/session-flow.test.ts tests/domain/expedition.test.ts tests/integration/upgrade-from-0.3.2.test.ts`:
  5 files, 131 passed (21 + 37 + 40 + 21 + 12).
- `PERF=1 npx vitest run tests/perf`: 23/23 passed (125 s). P4 large 17.6 s total, each chunk < 5 s; mode switch with
  summary 757 ms (both scales); completing stint 1.3 s (both scales).
- Real/large timings (scratch copies of the WP2 DBs): real 65 Expedition races, 302 checkpoints, 15 summaries, P4
  slowest chunk 398 ms; large 1 670 races, 7 831 checkpoints, 526 summaries, P4 slowest chunk 285 ms; Expedition page
  86/43 ms real, 120/94 ms large (cold/warm).
- Mutation checks (15, each restored and md5-verified): every mutation was caught by at least one test.
- Dev server + headless Electron against a copy of the 0.3.2 fixture: every page 200, no console errors; start-up log
  "18 expedition checkpoints (+6,900 XP), 3 summaries".

## Review fixes (2026-09-26)

Every reviewer issue was verified against the code and found valid; all nine are fixed, each with a test. The three spec
gaps: two are closed by the new tests, one is rejected (below).

1. **P4 cursor/resume untested (major).** New test `career-backfill.test.ts › the start-up budget › carries the
   Expeditions on after the last race a paused start reached, and ends as one uninterrupted run does`: 30 ten-hour
   Expeditions (`EXPEDITION_CHUNK + 5`; a third watched whole, the rest to 30%/60%), `oneChunkPerStart()`. Asserts the
   phases `['P2','P3','P4','P4',null]`, the P4 pause cursor is the 25th race id in id order, the log line names it, at
   the pause the races ≤ cursor hold every reached checkpoint and the rest none, each start's checkpoints/summaries equal
   its own races' (no repeat, no skip), totals 100 checkpoints / 21,000 XP / 10 summaries equal an uninterrupted run,
   held rows by race name match, `outcome()` matches, I2 and I3 hold. The `last = true` mutation now fails it.
2. **§4.3.4 step 4 untested.** New test `expeditions.test.ts › switching Expedition Mode on for a race whose story is
   complete writes its summary, once`: 9 h race completed in auto mode, then on → message "… 5 checkpoints were already
   behind you: +1,200 XP. The story is already complete, so its Expedition Summary is ready.", one row, retrospective,
   `unlocks: 'reconstructed'`, `mastery.championship` null; off ("… Its Expedition Summary stays.") and on again add
   no row.
3. **Retrospective championship mastery vacuous.** `a race edit never writes a summary; …` now puts the race in a
   championship and keeps it through the edit (the edit form posts `championshipId`; without it the edit had cleared
   it, which is why the old assertion was vacuous). Asserts `snapshot.race.championshipName` and
   `mastery.championship: null`.
4. **Retrospective XP not cut at the completing stint.** Same test asserts `sessions: 1`, `rewatchSeconds: 0`,
   `creditedSeconds: 9 h`, `xp.viewing` = the completing stint's VIEWING sum and `xp.rewatch: 0` (a REWATCH row exists
   for the later stint).
5. **`deleteViewingSession` could pay unheld checkpoints.** `reconcileExpedition` gained `award?: boolean` (default
   true); `deleteViewingSession` passes `{ award: false }`, matching §4.0 ("nothing new can qualify on this path"). Test
   `expeditions.test.ts › deleting a stint pays no checkpoint the upgrade has yet to pay, and says only what came off`
   (account put back as 0.3.2 left it; the removal reports only the re-watch XP; the backfill then pays the three
   checkpoints with `sessionId` null).
6. **"6 hours" hard-coded in copy.** `expedition-view.tsx` (two places) and `race-detail-view.tsx` now interpolate
   `EXPEDITION_SHAPE.checkpointXpMinimumHours` (config was already in client bundles via `expedition-mode-control.tsx`).
   Copy only; no test.
7. **Page showed scheduled XP for held checkpoints.** `getExpeditionView` selects `amount`; `expeditionFigures` takes
   `held: ReadonlyMap<percent, amount>` and a held checkpoint's `xp` is the held amount; the view shows it even on a
   race now under 6 h. Tests: domain `the live figures` (10% held at 250), and `xp-exploits › row 22 › a checkpoint paid
   under an older schedule …` (page shows 250 for 10%).
8. **Monotonic stamp pinned by a future row.** `awardXp` now uses `ledgerStamp`: bump by 1 ms only when the latest row
   is < 1 s (`LEDGER_BURST_SLACK_MS`) ahead of the clock; otherwise stamp on the clock after the latest row within that
   window, then `rebuildCareerTotals` from the new row (reads only the rows after it; the common path is still one
   query). Tests in `ledger-settle.test.ts › stamping an award`: a 5-award burst in one frozen millisecond is stamped
   +0…+4 ms in write order; a row moved a day ahead does not hold later awards (they land before it, totals re-stamped,
   I2 holds).
9. **Held checkpoints judged by the configured list.** New pure `coverageReaches(coverageSec, runtimeSec, percent)`
   (`checkpointsSatisfied` is built on it). `reconcileExpedition` revokes a held row only when its own percent is not
   reached; `resize` skips percents the schedule no longer lists (no amount to re-size to, R2/§6 row 22). The I3 checker
   `expeditionProblems` uses the same rule. Tests: domain `judges any percentage the same way, listed or not`;
   `xp-exploits › row 22 › a checkpoint the configuration no longer lists stays held while the coverage reaches it`
   (a stint, off/on and a `resize` reconcile keep a 33% row; deleting the stint that reached it revokes it).

**Rejected spec gap.** "Chronicle parts of §6 rows 13/16 and `ensureChroniclesFrozen` before `setExpeditionModeAction`":
not done here. `ensureChroniclesFrozen` and `ChronicleYear` freezing do not exist before WP7, §10 says a hook added by a
later WP is added by that WP and never stubbed earlier, and WP5's "Do not touch" names the Chronicle. WP7 must add the
`ensureChroniclesFrozen(userId, new Date()).catch(log)` call before `setExpeditionModeAction`'s transaction and the
frozen-chapter assertions to xp-exploits rows 13 and 16.

**Mutation checks** (each applied to the working tree, the named file run, then restored and md5-verified): P4
`last = true`; `setExpeditionMode` summary → `null`; retrospective mastery kept; journey not sliced; delete path
awarding; page showing scheduled XP; ledger always bumping; ledger not re-stamping; support by configured list; resize
of unlisted percents to 0. All ten fail at least one of the new tests.

**Checks after the fixes (2026-09-26).**
- `npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && npx vitest run`: exit 0;
  tsc and eslint clean; vitest 59 files passed, 1 skipped; 1125 tests passed, 23 skipped (126 s). The one
  `prisma:error` line is the expected refusal in account-isolation.
- Targeted (`expeditions`, `xp-exploits`, `session-flow`, domain `expedition`, `upgrade-from-0.3.2`): 5 files, 135
  passed. `career-backfill`: 16 passed. `ledger-settle`: 15 passed.
- `PERF=1 npx vitest run tests/perf`: 23/23 passed (119 s).
