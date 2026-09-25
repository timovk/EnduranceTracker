# HANDOFF — WP2 (engine plumbing, ledger settlement, deleting a race takes its XP back)

Branch `release/v0.4.0`, working tree only (not committed, per instructions). WP2 was resumed from an unfinished working tree.
I reviewed that work against SPEC §1, §3.2.9, §3.2.10, §4.0, §4.6, §4.7.4, §5.5 and §10 WP2, kept what was correct, and fixed or finished the rest.
Changes made in this session:
- the batched re-stamp statement (the old one was too slow; see deviation 1);
- `repairXpLedger` corrects drift anywhere in the ledger;
- `deleteAccountAction` clears the replay cache;
- a DB test that a node with `xpReward` 0 writes no ledger row;
- a stronger first-year re-stamp assertion in `delete-race.test.ts`.

## What was built (files)

**New**
- `src/lib/engines/career-timeline-engine.ts`: the loader, fingerprint and cache (§3.2.9).
- `src/lib/engines/progression-resync.ts`: `storyBonusKey`, `reconcileStoryBonus`, `resyncAfterRaceEdit`.
- `src/lib/server/recompute.ts`: `recomputeCareer`, with §5.5 steps 1–3 as far as they exist today.
- `src/components/races/removal-notice.tsx`: the library's one-line notice. It is a client component that removes `?removed&xp` from the URL with `history.replaceState`.
- Test helpers:
  - `tests/helpers/career-db.ts`
  - `tests/helpers/large-career-db.ts`
- New integration tests:
  - `tests/integration/delete-race.test.ts`
  - `tests/integration/credited-time.test.ts`
  - `tests/integration/timeline-cache.test.ts`
  - `tests/integration/ledger-settle.test.ts`
  - `tests/integration/recompute.test.ts`

**Modified**
- `src/lib/engines/xp-ledger.ts`:
  - `XpRevocation.earliest` and `LedgerPosition`;
  - `combineRevocations`, `revokeSessionsXp`, `revokeRaceViewingXp`, `revokeXpByDedupeKeys`;
  - `rebuildCareerTotals(tx, userId, { from? })`, batched;
  - `settleLedger`.
- `src/lib/engines/race-engine.ts`:
  - `rebuildRaceIntervals`;
  - the runtime clamp;
  - `creditedViewingSec`;
  - `recomputeRaceAggregates(tx, raceId, now, { preserveStatus? })`.
- `src/lib/engines/session-engine.ts`:
  - `InvalidStintError` and `latestAcceptedWatchedAt`;
  - the future guard;
  - the stint path revokes an unsupported Story Complete bonus and settles;
  - `deleteViewingSession` now uses `rebuildRaceIntervals` and `settleLedger`;
  - `deleteRace`;
  - `repairXpLedger` no longer runs a query per bonus, and ends by settling the ledger.
- `src/lib/engines/metrics.ts`:
  - credited figures;
  - the `MASTERY_SHAPE` thresholds;
  - `stories6h`, `racesExperienced`, `maxEditionsExperiencedOfOneEvent`;
  - distinct UTC editions;
  - `computeCareerMetricsWithHistory` (one race query);
  - `longestRun` now delegates to `longestConsecutiveRun`.
- `src/lib/engines/mastery-engine.ts`:
  - `editionYear` from `domain/edition` (UTC, with the season fallback);
  - `experienced?` and `name?` on `MasteryRaceInput`;
  - `editionsExperienced`;
  - distinct editions;
  - credited hours;
  - merge-chain resolution in `recomputeRaceMasteries`;
  - `ensureMasteryTrees` takes the union of race keys and active events, and uses `displayName`;
  - `masteryUnlockAward`, so a node with `xpReward` 0 writes no ledger row;
  - `eventDisplayName` is now exported.
- `src/lib/engines/contracts.ts`:
  - `RaceRemoval`;
  - `SessionOutcome.coverageBeforeSec`, `coverageAfterSec` and `runtimeSec`.
- `src/lib/server/actions.ts`:
  - `updateRaceAction`: when the runtime changed it rebuilds the intervals, then recomputes the aggregates and calls `resyncAfterRaceEdit`, all in a 60 s transaction. Its message comes from `raceSavedMessage`.
  - `deleteRaceAction` returns `data: { raceName, xpRemoved }`.
  - `deleteSessionAction` has its new message.
  - `logSessionAction` catches `InvalidStintError`.
  - `clearCareerTimelineCache` runs after every write to races, sessions, championships or seasons.
  - `revalidatePathsAfterSession` adds `/chronicle`, `/events`, `/career/milestones` and `/races/${id}/expedition`.
- `src/lib/server/account-actions.ts`: `deleteAccountAction` clears the account's cached replay.
- `src/lib/server/races.ts`: `getRaceDetail` returns `creditedViewingSec`.
- `src/lib/server/session-summary.ts`: fills the three new `SessionOutcome` fields from the stint's snapshot.
- `src/components/races/race-detail-view.tsx`:
  - the confirm text;
  - after the action, navigates to `/races?removed=<name>&xp=<n>`;
  - "Real viewing" shows `creditedViewingSec ?? realViewingSec`.
- `src/app/races/page.tsx`: reads the two parameters and renders `RemovalNotice`. The name is cut to 200 characters; a non-positive or unparsable xp reads as 0.
- `src/components/races/stint-summary.tsx` and `race-timeline.tsx` (`describeCoverage`): use `formatCoveragePercent`.
- `src/lib/copy/tone.ts`: `raceRemovedNotice(name, xp)`.
- `scripts/recompute.ts`: now a thin wrapper (argument parsing and printing only).
- Tests:
  - `tests/engines/mastery.test.ts`
  - `tests/integration/session-flow.test.ts`. It now mocks `requireUserId` and `next/cache` so it can call actions. The spec's two cases were added, plus cases for the future guard and the edit message.
  - `tests/auth/account-isolation.test.ts`, with the three §8.2 names.
  - `tests/domain/design-rules.test.ts`: the forbidden-phrase and "you cannot watch" scans now cover `SERVER_FILES`.
  - `tests/domain/periods-tone.test.ts`
  - `tests/perf/career-scale.test.ts`: the DB part.

## Deviations (smallest sound change, with reasons)

1. **Batched re-stamp uses `UPDATE "xp_transactions" SET … FROM (VALUES (id, xp, level), …) AS "restamp" WHERE id = restamp.column1`, not `CASE "id" WHEN … END`.**
   - Why: the CASE form compares every id of the batch against every row it updates.
   - Measured on the Large DB (182,147 rows):
     - full re-stamp: CASE 5.1 s, VALUES join 1.1 s;
     - deleting the first stint of the career: 5.75 s before, 1.70 s now. With CASE, the perf test ran at 9.4 s against its 10 s limit.
   - Unchanged: the batch size is still `LEDGER_RESTAMP_BATCH = 400`, and values are still stored as SQLite integers (asserted).
   - `UPDATE … FROM` needs SQLite 3.33 or later. The bundled SQLite is 3.53.2.
2. **The Story Complete revocation is settled immediately, not at the end.**
   - This applies to the stint path (§4.0 step 5 / 16a) and to `resyncAfterRaceEdit` (step 5.5).
   - `settleLedger` runs right after the revoke and before any award. `awardXp` then stamps new rows from the settled profile, so I2 holds the same way.
   - Achievements, milestones and the level are measured against the settled career. The outcome's `levelBefore` is the level after the revocation.
3. **Merge chains are resolved in memory.** `recomputeRaceMasteries` reads all of the account's `RaceMastery` rows once (`where: { userId }`) and follows `mergedIntoId` in memory, at most `EVENT_SHAPE.maxMergeHops` hops. The spec asked for one `findFirst({ id, userId })` per hop. The scoping is identical and it runs fewer queries.
4. **Events are grouped by `Race.iconicKey`** (`TimelineRaceRow.eventKey`), in metrics' edition counts as well as in the replay and landmarks, not by `raceMasteryId ?? iconicKey`.
   - After every `recomputeRaceMasteries` the two are the same identity, and one key keeps metrics and the replay agreeing.
   - `eventId` and `eventName` come from the `raceMastery` link only when `raceMastery.key === iconicKey`. Otherwise the name is `eventDisplayName(iconicKey)`.
5. **The Expedition parts wait for WP5.** `RaceRemoval` has no `expeditionXpRemoved` yet, and `deleteRace` revokes no `expedition:*` keys. The confirm text says "…the XP it earned — viewing and Story Complete. …"; WP5 adds "expedition checkpoints" once checkpoints exist, so the copy never promises something that does not exist yet.
6. **`recomputeAllRaces` was removed from `race-engine.ts`.** Its only caller was the script. `recomputeCareer` step 1 replaces it.
7. **`repairXpLedger` settles, then replays the whole ledger** (`rebuildCareerTotals` with no `from`).
   - This keeps its old role of correcting drift anywhere, and keeps "recompute twice changes nothing" true.
   - Season XP is rebuilt only when a removed row carried season XP (the `settleLedger` rule). 0.3.2 always rebuilt it.
8. **`loadMasteryInputs` reads season years through a separate flat query, not the `season.year` relation select.**
   - Why: the stint summary calls `getMasteryForChampionship` through the global client while the stint's transaction is still open.
   - With a relation select, Prisma runs several statements in a transaction of its own, which waits on the open one.
9. **`eventAccent` returns null when an event has no races filed under a championship.** The tree then keeps its current colour, or falls back to `FALLBACK_ACCENT`, so an active event with no races does not flicker.
10. **`RecomputeOptions` is only `{ now?: Date }`.** `rebuildChronicleYears` (WP7) and `rebuildMilestoneDates` (WP3) are hooks for later WPs, so they are not stubbed here.
11. **Wider revalidation.**
    - `deleteRaceAction` also revalidates `/mastery` and `/hall-of-fame`: event caches change, and a plaque loses its link.
    - `updateRaceAction` uses `revalidatePathsAfterSession`, because the resync can unlock mastery nodes and achievements.

## Facts later WPs must know

**Signatures (as built)**
- `career-timeline-engine.ts`:
  - `TimelineInputs`
  - `TIMELINE_SESSION_SELECT`, `TIMELINE_RACE_SELECT`
  - `TimelineRaceSource`, `toTimelineRaceRow(row)`
  - `loadTimelineSessions(db, userId)`
  - `loadTimelineInputs(db, userId)`
  - `loadRaceTimelineInputs(db, userId, raceId) → { race, sessions } | null`
  - `timelineFingerprint(userId, db = prisma)`
  - `getCareerTimeline(userId)`
  - `clearCareerTimelineCache(userId?)`
- The cache lives on `globalThis.careerTimelines` and `careerTimelineBuilds`, is LRU with `CAREER_STATS_SHAPE.timelineCacheEntries`, and de-duplicates in-flight builds per fingerprint.
- **Never call `getCareerTimeline` (or any global-client relation select) inside a transaction.** It cannot see the transaction's writes, and it waits until that transaction times out. Inside a transaction, use `buildCareerTimeline(...(await loadTimelineInputs(tx, userId)))`.
- The fingerprint does not watch seasons. A season's year is part of its identity.
- `progression-resync.ts`:
  - `storyBonusKey(raceId)` returns `story-complete:<id>`. Use it rather than the literal.
  - `reconcileStoryBonus(tx, userId, raceId, { history?, crossingSessionId? }) → { storyComplete, awarded, revocation }`. It pays with `seasonAmount` 0 and never re-sizes a bonus.
  - `resyncAfterRaceEdit(tx, userId, raceId, now, { runtimeChanged }) → { xpAwarded, xpRevoked, storyBonus: { awarded, revoked } }`. Its current order:
    1. `reconcileStoryBonus`, then `settleLedger([story.revocation])`;
    2. `ensureMasteryTrees` and `recomputeRaceMasteries`;
    3. only if the runtime did not change: `syncMastery`, `computeCareerMetricsWithHistory`, `syncAchievements`, `syncMilestones`.
  - Where later WPs hook in:
    - **WP5** adds `reconcileExpedition(…, { resize: runtimeChanged })` right after `reconcileStoryBonus`, and puts its revocation in the same `settleLedger` call, which must still come before the landmark syncs.
    - **WP3** adds `syncCareerMilestones` and `fillLandmarkDates` inside the `!runtimeChanged` block. It needs `history`: destructure it from `computeCareerMetricsWithHistory`.
- `xp-ledger.ts`:
  - `XpRevocation = { transactions, careerXp, seasonXp, earliest: LedgerPosition | null }`
  - `LedgerPosition = { createdAt, id }`
  - `combineRevocations(list)`
  - `revokeSessionsXp(tx, userId, ids)`: looks up by `sessionId` alone in chunks of 500, filters by `userId` in memory, and deletes by primary key.
  - `revokeRaceViewingXp(tx, userId, raceId)`: VIEWING and REWATCH rows by `sourceRef`.
  - `revokeXpByDedupeKeys(tx, userId, keys)`
  - `rebuildCareerTotals(tx, userId, { from? })`
  - `settleLedger(tx, userId, revocations) → LedgerRebuild | null`: null when nothing was removed. It calls `rebuildSeasonXpFromLedger` only if some removed row carried season XP.
  - `xp-ledger` now imports `rebuildSeasonXpFromLedger` from `season-pass-engine`, which imports `awardXp` from `xp-ledger`. The cycle is harmless because both are only called at run time; keep it that way.
- `race-engine.ts`:
  - `rebuildRaceIntervals(tx, raceId) → Interval[]`: canonical order, limit `actualDurationSec ?? scheduledDurationSec`, rows written with no `sessionId`.
  - `recomputeRaceAggregates(tx, raceId, now, { preserveStatus })`: clamps first. `preserveStatus` keeps `status` and `completedAt`, but `storyCompletedAt` still follows coverage. This is for WP3's P1.
  - `RaceAggregates.creditedViewingSec`.
- `session-engine.ts`:
  - `InvalidStintError` (with `.reason: 'future-watched-at'`) and `latestAcceptedWatchedAt(now)`.
  - `deleteRace(userId, raceId, now) → RaceRemoval | null`. Its order:
    1. find the race inside the account;
    2. read the stint ids;
    3. `revokeSessionsXp`, then `revokeRaceViewingXp`, then `revokeXpByDedupeKeys([storyBonusKey])`;
    4. `race.deleteMany`;
    5. `recomputeRaceMasteries`;
    6. `settleLedger`.
  - Where later WPs hook into `deleteRace`:
    - **WP5** adds the held `expedition:*` keys to the `revokeXpByDedupeKeys` call and `expeditionXpRemoved` to the result.
    - **WP4** adds `writeMissingEventStepCredits` and the tombstone `updateMany` before `race.deleteMany`. It must also widen the race `select` to `runtimeSec`, `raceDate`, `circuitSlug` and `season.year`.
  - `logViewingSession` step 10 is `const { metrics } = await computeCareerMetricsWithHistory(userId, db)`. **WP3** destructures `history`.
  - **WP5**: on the stint path, the Story Complete revocation has already been settled at step 5. Only an expedition revocation would need a settle at 16a, and on this path there is none.
- `metrics.ts`:
  - `computeCareerMetricsWithHistory(userId, db) → { metrics, history: TimelineInputs }`
  - new `CareerMetrics` fields: `racesExperienced`, `stories6h`, `maxEditionsExperiencedOfOneEvent`
  - `realHours`, `longestSessionHours` and `averageSessionMinutes` are credited.
- `mastery-engine.ts`:
  - `MasteryMetrics.editionsExperienced`. Node metrics are looked up by name, so WP4's `experienced_*` nodes can use the metric `'editionsExperienced'` with no further change.
  - `masteryUnlockAward(unlock) → XpAward | null`: null for a reward of 0 or less, in which case `syncMastery` records the unlock with `xpAwarded` 0 and writes no ledger row.
  - `eventDisplayName(key)` is exported.
- `recompute.ts`:
  - `recomputeCareer(userId, { now? }) → RecomputeReport`, with fields `racesRebuilt`, `storyBonusesAwarded`, `storyBonusesRevoked`, `ledger: LedgerRepair`, `collectionCardsFilled`, `masteryNodesUnlocked`, `achievementsUnlocked`, `milestonesReached`, and `totals { races, coverageSec, creditedViewingSec }`.
  - Step 1 builds the replay once with the global client, before any chunk, then processes races sorted by id in chunks of 500 (60 s transactions), settling per chunk.
  - Step 3 is a 120 s transaction.
  - **WP3** adds `syncCareerMilestones`, `fillLandmarkDates`, `markCareerBackfillApplied` and `rebuildMilestoneDates`. **WP5** adds step 4. **WP7** adds steps 5 and 6.
- Actions:
  - `deleteRaceAction(raceId) → ActionResult<{ raceName; xpRemoved }>`.
  - The `updateRaceAction` message is built by `raceSavedMessage`, with the runtime in `formatTimestamp` (`06:30:00`). Examples:
    - "Saved."
    - "Saved. The Story Complete bonus came off because the race now runs to 06:30:00."
    - "… At 06:00:00 the race is a complete story, so its Story Complete bonus of N XP was added."
    - "… The change also earned N XP."
- The spec's `ensureChroniclesFrozen` calls in actions are not stubbed (WP7).

**Test helpers**
- `career-db.ts`:
  - `createCareerUser(id, name)` replaces any account with the same id or name.
  - `addRace(userId, { name, hours = 6, isMajorEvent, iconicKey, championshipId, seasonId, raceDate })` stores `raceType` `H6`.
  - `logStint(userId, raceId, { from, to, speed, watchedAt, now })` logs in RANGE mode, positions in seconds.
  - `ledgerProblems(userId) → string[]` checks I2; an empty list means the ledger is settled.
  - `backdateLedgerRows(userId, ids, createdAt)`
  - `insertLegacyShortenedRace(userId, { hours, stints, storyCompleted, bonusPaid, name? })` builds a 0.3.2-shaped race with unclamped intervals and a null `creditedViewingSec`. Its XP is written through `awardXp`.
  - `H = 3600`
- `large-career-db.ts`:
  - `createLargeCareerDatabase() → { file, large, real, cleanup }`. Call it before the first query in the file. It takes about 60 s.
  - `SeededCareer` has `userId`, `races`, `stints`, `ledgerRows`, `now`, `firstStintId`, `lastStintId`, `lastRaceId`, `bigRaceId` (a first-year 24 h race with 200 stints), and `openRaceId`.
  - Large has 60,200 stints, 5,001 races and 182,147 ledger rows. Real has 3,200 stints.
- A built copy of the Large DB, useful for profiling scripts, is at `scratchpad/v040/wp2/large.db`. `wp2/time-all.ts` shows how to run the engines against a copy with `tsx`.

**Measured (this container, tsx, Large DB, after the change)**

| Path | Real (ms) | Large (ms) |
|---|---|---|
| `loadTimelineInputs` + `buildCareerTimeline` | 207 | 498 |
| `getCareerTimeline`, cold | 48 | 497 |
| `getCareerTimeline`, warm | 3 | 17 |
| `logViewingSession` | 124 | 588 |
| `deleteViewingSession`, last month | 21 | 89 |
| `deleteRace`, last month | 36 | 161 |
| `deleteViewingSession`, first stint of the career | 100 | 1,703 |
| `deleteRace`, first-year race with 199 stints | 128 | 1,819 |

## Check results (final run, after the last edit)

- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 problems.
- `npx vitest run`: 53 files passed, 1 skipped (perf); **933 tests passed**, 12 skipped.
- WP2 targeted tests: 20 files, 372 tests passed. The command:
  ```
  npx vitest run tests/integration/session-flow.test.ts tests/integration/delete-race.test.ts \
    tests/integration/credited-time.test.ts tests/integration/timeline-cache.test.ts \
    tests/integration/ledger-settle.test.ts tests/integration/recompute.test.ts tests/engines tests/auth
  ```
- `PERF=1 npx vitest run tests/perf`: 12/12 passed (pure and database parts).
  - The two first-year delete tests take about 5 s each. Most of that is the `ledgerProblems` check over 182k rows, not the delete itself.

## Review fixes

An independent review raised one major and four minor issues. All five were verified against the code and all were valid; each is fixed, with a test. There are no rejections, and the reviewer listed no spec gaps.

1. **Major: nothing tested the `runtimeChanged` guard in `resyncAfterRaceEdit`.**
   - New `session-flow.test.ts › what a race edit writes, and when › pays the bonus at once after a runtime edit, and leaves the landmarks for the next save`. It goes through `updateRaceAction`: a 7 h race is watched 0:00–6:00 in three stints, then:
     1. The runtime is saved as 06:00:00. The bonus row exists (`amount` = `storyCompleteBonus(6 h).careerXp`, `seasonAmount` 0). The number of unlocked achievements, reached milestones and unlocked mastery nodes is unchanged, and `first_story` is still locked.
     2. A name-only save follows. Those counts go up and `first_story` unlocks.
     3. The runtime is set back to 07:00:00. The bonus is gone, the landmark counts equal those after step 2, and I2 holds.
   - Mutation check: `if (true)` fails the test, and `if (false)` fails it and the legacy test below.
2. **Minor: the stint path's coverage snapshot and outcome were wrong on a legacy race.**
   - New pure helper `clampIntervals(intervals, limit)` in `src/lib/domain/intervals.ts`, with unit tests in `tests/domain/intervals.test.ts`. `recomputeRaceAggregates` now uses it too, with the same result as before.
   - `logViewingSession` now measures `coverageBefore` on the existing set clamped to the runtime. The stored `coverageBeforeSec`, `coverageBeforePercent` and the outcome's `coverageBeforeSec` all use that value, and the stored `coverageAfterSec` is `coverageSeconds(clampIntervals(mergedIntervals, runtime))`. The `Math.min` is gone.
   - Interval merging is unchanged, as §4.0 step 2 requires. `addInterval` still merges into the stored set, and what is stored is the unclamped merge. P1 (WP3) repairs a legacy race's stored intervals.
   - `ledger-settle.test.ts › a stint that finds its race's Story Complete bonus no longer supported` now logs 1:00–1:10. Both the live outcome and `buildOutcomeForSession` must give 5 h → 5 h 10 min, which is 83.3% → 86.1%. Undoing either half of the fix fails the test.
3. **Minor: the fingerprint's event aggregate was untested.**
   - `timeline-cache.test.ts › replays again after a race, its championship or its event is edited` now renames the event with `raceMastery.displayName` and asserts a new replay that carries the new `eventName`.
   - `account-isolation.test.ts › the timeline fingerprint changes only with this account's data` now gives Alex an event, made by the stint on an `iconicKey` race and then renamed, and asserts that Sam's fingerprint is unchanged.
   - Mutation check: removing the event aggregate fails the cache test, and dropping its `userId` scope fails the isolation test.
4. **Minor: three `raceSavedMessage` sentences were never asserted.**
   - The major test asserts the exact "At 06:00:00 … bonus of N XP was added." message, and "Saved. The change also earned N XP." with N the career-XP delta.
   - New test `… takes back a bonus a 0.3.x race no longer supports on any save, and says why`. A name-only `updateRaceAction` on an `insertLegacyShortenedRace` race gives exactly "Saved. The Story Complete bonus came off because the race is no longer a complete story. The change also earned N XP." Here N is the landmarks the legacy stints reached, which is the delta plus the revoked bonus.
5. **Minor: the race page's stint rows labelled raw real time "Real viewing".**
   - `RaceDetail.sessions[]` gains `creditedSeconds`, which `getRaceDetail` fills with `creditedSeconds(session)` from `domain/career-timeline`. The row shows it, so the rows add up to the race's "Real viewing" figure. The field is computed on the server so that the client bundle does not pull in the replay module.
   - Tested in `credited-time.test.ts`: a 0.1× stint's row is 80 min, and rows at 0.75× and faster equal their real time.

Left as it was, and noted for WP3: `getRaceDetail` and the dashboard's current-stint query (`races.ts`) still read the stored intervals without clamping. A legacy race whose intervals run past a shortened runtime shows coverage past its end there until P1 repairs it at start-up. `clampIntervals` is the helper to use if that ever needs to be covered before P1.

### Check results (after the review fixes)
- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 problems.
- `npx vitest run`: 53 files passed, 1 skipped (perf); **937 tests passed**, 12 skipped.
- WP2 targeted tests: 20 files, 374 tests passed.
- `PERF=1 npx vitest run tests/perf`: 12/12 passed.
