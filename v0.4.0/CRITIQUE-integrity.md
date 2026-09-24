# SPEC.md critique: integrity and migration

Lens: XP is never paid twice, the ledger and its rebuilds, "landmarks stay earned", account isolation, migration safety, backfill idempotency and time budgets, and recompute completeness.

Verdict: the migration is safe, and the dedupe-key design is mostly sound. Seven major problems remain:
1. Event steps can be paid again by moving races between events.
2. Throw-away races can farm the new per-race rungs.
3. The stint path can revoke XP without rebuilding the totals, and the upgrade awards checkpoints from stale coverage.
4. The backfill time budget and its resumability do not hold.
5. A paused backfill leaves the account in an unsafe in-between state.
6. A runtime typo writes a permanent Expedition Summary.
7. `rebuildCareerTotals` is too slow for the new revoke paths at 10-year scale.

None of these is a blocker for the owner's current database, which only goes back to 22 September. All seven should be fixed before WP2 to WP5 start.

## What I verified myself

- **Migration SQL.** `prisma migrate diff` from `4c59efc:prisma/schema.prisma` to `work/schema.v040.prisma` gives output byte-identical to `work/migration.sql`.
- **Applying the migration.** I applied it with the real desktop runner (`desktop/src/migrate.ts`) to a copy of `endurance.db`:
  - only `20260924120000_career_history` was applied, in 18 ms;
  - `PRAGMA foreign_key_check` returned `[]` and `integrity_check` returned `ok`;
  - row counts were unchanged, and the new columns were NULL.
- **Economy model.** `work/econ-model.ts` reproduces every figure in the §7.3 table: 0.4371 / 0.4996 / … / 0.5957, 7,640 XP headroom, 0.275 windfall. The sources ratio is 0.025 at 3,360 h.
- **Cost of `rebuildCareerTotals`.** On this container, re-stamping 20,109 ledger rows took 4,270 ms, which is **0.212 ms per row**. That result feeds finding M7.

---

## Major findings

### M1. Event-step credits are written only when a step pays, so a reorganised event pays the same steps again (§4.2.5, §6 rows 6/7/18, §5.2 P2)

**What is wrong**

- `syncMastery` would write `EventStepCredit` rows only "when a node becomes newly unlocked… and pays". The contributors are the member races *at that moment* (§4.2.5 step 3).
- `writeMissingEventStepCredits`, which credits every current contributor of every unlocked step, runs only in the upgrade (P2) and in recompute (§5.5).
- In live play, an edition added *after* a step unlocked is never credited for that step. `computeEventMetrics` counts every SC member (`mastery-engine.ts:236-256`), and `syncMastery` pays per unlock (`mastery-engine.ts:884-1000`).

**Example**

- Le Mans 2020–2029 is watched live in event A. Every edition is Story Complete, and every step unlocked along the way.
- The user creates event B and moves 2025–2029 into it. None of those five races is credited for `edition_1`/`_3`/`_5`, `consecutive_3`/`_5`, `event_hours_50` or `watched_1`/`_3`/`_5`.
- B therefore pays those steps again: 1,000 + 4,000 + 9,000 + 6,000 + 15,000 + 5,000 + 150 + 300 + 500 + 500 (`event_hours_25`) = **about 41k XP** for the same ten editions of the same real event.
- Merging B back into A then keeps everything (the carry-over is XP-free).

§6 row 18 says the leftover risk is "150 XP (`watched_1`)". The real bound is "every race can help pay every step once, in any event". On top of that:
- `createEvent` lets two active events have the same name. The spec only makes it append `-2` (§4.2.2 Keys), while rename rejects a duplicate normalised name.
- The delete-and-recreate tombstone (`editionFingerprint`) is defeated by changing the runtime by one second or retyping the circuit.

**Fix**

1. In `syncMastery`, for every `RACE_EVENT` tree, run the `writeMissingEventStepCredits` logic on every sync, before `payable` is computed. For each **unlocked** node (paid or XP-free), insert a credit for every current contributor that has none.
   - Use the credit set already loaded in step 1, so the steady state costs no writes.
   - This also closes M5(b).
2. Rewrite the label on an XP-free step as "Recorded: these editions were already counted in another event". The race did not necessarily pay the step itself.
3. `createEvent` must reuse or reject an active event whose `normaliseEventKey(displayName ?? name)` matches, as `resolveEventForRaceInput` and rename already do.
4. Restate §6 row 18 honestly. Races that were never in an event with that step unlocked can each pay it once. Add the test `moving later editions of an event into a fresh event pays none of the steps the original event had unlocked`.
5. Put the trade-off to the owner explicitly: after this change, an honestly mis-linked race that is later moved no longer pays the steps its wrong event had already unlocked.

### M2. Throw-away races can farm the new per-race rewards without limit (§4.1.2, §3.3 `watched_*`, §6 rows 15/18)

**What is wrong**

- The only duration check is > 0 (`schemas.ts:19-49`, positive seconds, up to 48 h).
- A stint can be 1 s long at 8× (`schemas.ts:140-176`, `playback.ts:13-14`).
- Under the spec, a race is "watched" or "started" as soon as it has one stint (§3.1).

**Consequences**

- Each dummy race placed in its own new event (the race form's "New event…") pays `watched_1` once: 150 XP for a few clicks. That is several times the 30 XP per minute that viewing earns, and the brief forbids exactly this kind of repeatable exploit.
- The `races-100/250/500/1000` rungs (3,750 XP in total) can be reached the same way.
- The spec's leftover-risk rows count this as bounded "per race". The number of races is unbounded.

**Fix**

1. Add an eligibility floor, in config (`CAREER_STATS_SHAPE.minimumCountedRaceHours`, for example 1 h), used for `editionsWatched`, `racesStarted` rungs, and the "races watched" figures.
2. A race counts as watched only when its **replay coverage** reaches the first checkpoint share of its runtime (10%) **and** its credited time reaches `meaningfulSessionMinutes`.
3. Make `watched_1` XP-free, or fold it into `watched_3`.
4. Add exploit tests: `a hundred 1-minute races with 1-second stints reach no races-watched rung`, and `a dummy race in its own event pays no editions-watched step`.
5. Keep the SC-bonus farm on tiny races, which already exists, named as out of scope in §6 row 15.

### M3. The stint path can revoke without rebuilding totals, and P4 awards checkpoints from stale, unclamped coverage (§4.0 steps 5–6, §4.3.3 steps 1–2 and 6, §5.2 P1/P4)

**What is wrong**

1. `reconcileExpedition` reads the **cached** `race.coverageSec` (§4.3.3 step 1).
   - In 0.3.2 that value is `min(unclamped merged coverage, runtime)` (`race-engine.ts:72-80`), and `isStoryComplete` is unclamped (`intervals.ts:177-186`).
   - Shortening a race after logging near its end is possible today: `updateRaceAction` writes the new runtime and recomputes without clamping (`actions.ts:168-182`).
   - P1 deliberately never calls `recomputeRaceAggregates`, so P4 awards checkpoints and keeps `story-complete:` on inflated coverage. The replay-based Expedition page (§4.3.5) then shows fewer checkpoints than the ledger holds.
2. WP2 adds the runtime clamp to `recomputeRaceAggregates`. The next stint on such a race therefore **lowers** coverage and can clear `storyCompletedAt`. After that:
   - reconcile step 4 deletes checkpoint rows, but §4.3.3 step 6 says "logViewingSession never revokes here", so nobody rebuilds the totals;
   - `awardXp` keeps computing `after = before + amount` from the stale profile (`xp-ledger.ts:86-88`), so **I2 breaks** (careerXp ≠ Σ ledger);
   - the stint path also never revokes a held `story-complete:` (§4.0 step 5 is "Unchanged", `session-engine.ts:200`), which breaks "the bonus exists exactly when the race is complete" (`xp-ledger.ts:193-202`).

The same revoke-without-rebuild happens in the stint path whenever a checkpoint amount changes because of a config re-balance: reconcile step 4 deletes rows whose amount differs.

**Fix**

1. `reconcileExpedition` computes coverage from `replayRace(loadRaceTimelineInputs(tx, userId, raceId))`, which is one race's stints and cheap. It never reads `race.coverageSec`. Define I3 on replay coverage.
2. Make reconcile self-contained: whenever it revoked anything, it calls `rebuildCareerTotals` itself (EXPEDITION rows carry no season XP). Alternatively, `logViewingSession` must check `expedition.revoked.length`.
3. In `logViewingSession`, when `aggregates.storyCompletedAt === null` and `story-complete:<id>` is held, revoke it, then run `rebuildCareerTotals`, then `rebuildSeasonXpFromLedger` if `seasonAmount > 0`. In practice, call `reconcileStoryBonus` there too.
4. Add an exploit scenario: a 0.3.2-shaped race with intervals past a shortened runtime. Assert I2 and I3 after the backfill and again after one more stint.

### M4. The backfill's time budget and resumability do not hold (§5.2, §5.4, §1.3)

**What is wrong**

1. The marker is written only in the last phase (P5). Nothing records which phases finished, so "the next start runs the remaining phases" is false: every start re-runs P1 to P4 in full. "Re-running a finished phase is cheap" is not established either:
   - P1 loads every stint;
   - P4 reconciles every Expedition race;
   - P4 builds retrospective summaries, and each one calls `computeRecordProgression` over the whole career (§4.3.6 "records … computed from the replayed career timeline").
2. The deadline is checked only **before** a phase starts. With the spec's own target of "every phase < 20 s large", a phase that starts at 39.9 s ends at about 60 s. Add Next's boot time, then the freeze pass, and the start overruns the desktop's 60 s health gate (`main.ts:40`). The shell then stops the server (`server.ts:195-201`), the phase's transaction rolls back, and the next start repeats the same work. That is the "app never opens" failure MAPS warned about.
3. One shared deadline across accounts, re-run from P1 every start, can starve the second account forever.

**Fix**

1. Record progress per phase. Either use a JSON marker `{version:'0.4.0', done:['P1','P2',…]}`, or use keys such as `careerBackfill:P1`, written in each phase's own transaction.
2. Break each phase into bounded chunks (races or years per chunk) and check the deadline inside the loops.
3. Budget = 60 s − boot margin − the largest chunk (for example 30 s), and process accounts round-robin.
4. Build the timeline and the record progression **once per account** in P4 and pass them to `writeExpeditionSummary`.
5. Add a test with a tiny injected deadline. It asserts progress on every run, completion after N runs, and an identical ledger to a single uninterrupted run.

### M5. A paused backfill leaves the account in an unsafe in-between state (§5.2, §4.5.2, §4.0)

With per-phase pausing, the app opens while P2 to P5 are still pending. The spec says nothing about what is safe in that state.

**What goes wrong**

- **(a) Chapters freeze too early.** `ensureChroniclesFrozen` runs on every Chronicle page and at the start of every mutating action. It will freeze a completed year **before** P3 has dated the landmarks and P4 has written the summaries, so the chapter permanently lacks dates, event steps and Expeditions. Only a manual rebuild fixes it.
- **(b) Credits are missing before P2.** Unlocked pre-0.4.0 event steps have no credits until P2 runs, so a link, unlink or merge in that window re-pays them. This is the 85k re-key exploit the spec claims to close.
- **(c) Stints pay new steps too early.** A stint pays new steps (WP4 appends nodes, and `ensureMasteryTrees` runs per stint) before those credits exist.

**Fix**

1. `ensureChroniclesFrozen` and `freezeAllChronicles` do nothing unless `isCareerBackfillApplied(userId)`.
2. The M1 fix (credits in every `syncMastery`) closes (b) and (c).
3. The event-management actions check the marker. If it is not set, they refuse with a plain message, or run P2 first.

### M6. A runtime typo writes a permanent Expedition Summary and blocks the real one (§4.0 `resyncAfterRaceEdit` step 6, §4.3.6, §2.1 `@@unique([userId, raceId])`)

**Example**

1. A 24 h race has 12 h watched.
2. The user types 12:00:00 by mistake. The race becomes Story Complete and is an Expedition (≥ 10 h), so resync step 6 writes a retrospective summary.
3. The user corrects the runtime. The bonus and the checkpoints are revoked, but the summary is "never rewritten" and stays.
4. When the race is genuinely finished, no summary can be written, because `(userId, raceId)` is already taken.

The same resync immediately mints milestone and achievement landmarks from the typo, such as `first-12h`, with a replay `achievedAt`. In 0.3.2 this did not happen until the next stint.

**Fix**

1. Remove step 6 from `resyncAfterRaceEdit`.
2. Write missing summaries in `logViewingSession` whenever the race is an Expedition, Story Complete and has no summary. Today that happens only on `becameStoryComplete`.
3. Also write them in `setExpeditionModeAction`, the backfill and recompute.
4. Optional: let resync reconcile balances and caches only, and leave landmark syncs to the next stint.
5. Test: `a mistyped runtime that is corrected leaves no summary, and the real completion writes one`.

### M7. The new revoke paths call `rebuildCareerTotals`, which is O(ledger) and does not fit the 60 s transaction at 10-year scale (§4.6 step 8, §4.3.4 step 5, §4.0 resync step 5, §1.3)

**What is wrong**

- `rebuildCareerTotals` re-stamps every row after the earliest removed one, with one UPDATE per row (`xp-ledger.ts:265-307`).
- I measured 0.212 ms per row. At the spec's Large ledger of 180,000 rows, deleting an early race re-stamps about 90% of them: roughly 34–38 s before loading and the other steps.
- That runs inside the same 60 s `TRANSACTION_OPTIONS`, and on a slower Windows PC it is likely to time out and roll back.

`deleteRace`, `setExpeditionModeAction` (off), `resyncAfterRaceEdit` and `deleteViewingSession` all have no performance target in §1.3.

**Fix**

1. Re-stamp only from the earliest affected `(createdAt, id)`. Seed `running` with the sum of the rows before it.
2. Write the new values in batched raw statements, for example 500 rows per `UPDATE … SET careerXpAfter = CASE id …`.
3. Add Large-scale targets and `PERF=1` tests for `deleteRace`, `deleteViewingSession` and the Expedition Mode off switch.

---

## Minor findings

1. **§2.5, test 3 cannot pass as written.**
   - It asserts that the file contains no `UPDATE`, but the migration's foreign keys contain `ON UPDATE CASCADE` (`work/migration.sql:36,37,52,64`).
   - Its statement regex also has to skip the `-- AlterTable` / `-- CreateTable` comment lines that start each chunk.
   - Fix: strip `--` lines, split on `;`, and assert `!/^\s*(DROP|INSERT|UPDATE|DELETE|PRAGMA|VACUUM)\b/im` per statement.
2. **§7.2, the `year-plan` dedupe key includes the threshold** (`milestone:realHoursYear:<Y>:<annualHours>`), and "already reached" is checked by `(metric, threshold)`.
   - If `BUDGET_CONFIG.annualHours` is ever re-balanced, every past year pays again.
   - Fix: key it `milestone:realHoursYear:<Y>` and test "reached" by metric alone.
   - Also note under R4 that in a first year whose hours alone pass `annualHours`, this rung fires on the same stint as the ladder rung `realHours:336`.
3. **§4.6, step 3, `deleteRace` misses orphaned viewing XP.**
   - It revokes VIEWING/REWATCH by session id only. Viewing XP for this race whose `sessionId` is already NULL (stints deleted before XP followed the data) carries `sourceRef = raceId` (`session-engine.ts:188`) and survives.
   - Fix: also delete `{userId, source in [VIEWING, REWATCH], sourceRef: raceId}`.
   - Decide explicitly, and log, whether the upgrade purges XP left by races deleted under 0.3.x: `story-complete:<missing race>` and null-session viewing rows.
4. **§4.3.3 step 5, retroactive checkpoint rows point at an old stint.**
   - They carry the *historical* crossing stint as `sessionId`. `buildOutcomeForSession` sums a stint's rows through that relation (`session-summary.ts:37-39, 84`), so reopening that old stint would show XP granted weeks later.
   - Fix: retrospective awards use `sessionId: null`. The crossing stint for display already comes from `coverageCrossing`.
5. **§4.3.3, a config change breaks I3.**
   - The stint path's cheap exit trusts I3, but raising `autoThresholdHours` or changing the checkpoint shares leaves rows held that no longer fit, until someone runs recompute.
   - Fix: store a hash of `EXPEDITION_CONFIG` and `EXPEDITION_SHAPE` next to the marker, and re-run P4 whenever it changes.
6. **§4.2.2, merge chains are not guarded.**
   - "Unarchive is always allowed", including for merged events, so a `mergedIntoId` cycle becomes possible, and chain-following has no guard.
   - Fix:
     - forbid unarchiving an event whose `mergedIntoId` is set;
     - cap chain-following at N hops;
     - resolve every `mergedIntoId` with `findFirst({ where: { id, userId } })`, because the column has no foreign key.
7. **§4.5.2, "no grace period" rests on a false premise.**
   - A stint logged at 00:30 on 1 January covers 31 December by its own window (R6).
   - `ensureChroniclesFrozen` runs *before* that write, so the frozen chapter permanently lacks time that Statistics does count for the year. The test `statistics filtered to a year equal that year's chapter` can then fail.
   - Fix: freeze year Y only once `now ≥ 1 Jan (Y+1) + the longest possible stint window`, or document the difference.
8. **§4.4.5 and §4.5.3, XP by year cannot be tested with an injected `now`.**
   - XP by year uses the ledger's `createdAt`, which is always the real clock: `awardXp` never sets it (`xp-ledger.ts:97-111`). Engines that are handed an injected `now` still stamp the wall clock.
   - Fix: tests seed the ledger's `createdAt` explicitly, or `awardXp` takes an optional `at`.
9. **§5.5, recompute does not rebuild everything derived.**
   - It never awards a missing `story-complete:` bonus, which 0.3.2 runtime edits could skip.
   - It never rebuilds `WatchedInterval` from sessions, although R1 calls intervals derived.
   - Fix: add `rebuildRaceIntervals` and `reconcileStoryBonus` for each race in step 1.
10. **§2.6 is inaccurate.** `MilestonePrecision` cannot break 0.3.2: the old client never selects the new column. Only rows with `source = 'EXPEDITION'` do.
11. **§5.2, P2 says "credits use `skipDuplicates`".** SQLite has no `skipDuplicates` (`db/client.ts:84-92`). Use `createManySkippingDuplicates` with a filter so the log stays clean.
12. **§2.1, a deleted race's summary does not block a second one.** Once a race is deleted, its summary's `raceId` is NULL, and SQLite unique indexes ignore NULLs. A re-created race therefore gets a second summary, and the Chronicle counts the Expedition twice. Store an `editionFingerprint` on the summary and skip if one already matches, or document the behaviour.
13. **§6 row 2 covers slow playback only.** Checkpoints pay the same at 8×, so a 10 h race logged at 8× earns 1,200 checkpoint XP against about 2,250 viewing XP. Either cap checkpoint XP at a share of the race's held viewing XP, or name this in §6.
14. **§1.2 R4 overrides a binding owner decision.** Owner decision 2 names "first race started" as a new milestone that pays a little, and R4 pays it 0. That is right for "never twice", but it has to be put to the owner, not settled in the spec.
15. **§3.2.9, the fingerprint queries are not scoped.** Each of the four fingerprint aggregates must include `where: { userId }` (championship included). State it, and add it to the isolation test.

---

## What the spec does well (do not change)

- **Migration.** One additive migration: nullable `ADD COLUMN`, new tables and indexes, no RedefineTables, no SQL backfill, no SQL-written dates. It is identical to `prisma migrate diff` and applies cleanly through the desktop runner.
- **Career-only XP.** Every new source keeps `seasonAmount = 0`, so the Q4 2026 pass and `rebuildSeasonXpFromLedger` cannot be fed by it. `deleteRace` rebuilds season XP only when the revoked season XP is above 0.
- **Shared `milestone:` namespace.** Career rungs reuse the `milestone:<metric>:<threshold>` namespace, with the config-test invariant that career pairs never duplicate ladder pairs. If a ladder later adds the same rung, the shared dedupe key protects it.
- **Write-once landmark dates.** `achievedAt` is written only while `achievedPrecision IS NULL`, the `acceptInstant` guard is in place, and history that cannot be placed is marked `RECOGNISED`. This dates old rows honestly and never moves a date.
- **Event identity.** The event `key` is immutable and `displayName` is separate. Names typed in another case resolve to the existing event, and a merge carries steps over XP-free with their dates.
- **Following the data.** `reconcileExpedition` deletes rows to free their keys and never writes negative XP. `deleteRace` revokes by session ids and exact keys **before** the cascade. The I1–I5 invariants are asserted after every exploit scenario.
- **Credited seconds.** The definition is identical to the XP speed guard, and the budget stays on raw time.
- **Time and markers.** The server guards against future `watchedAt`, the marker is compared by value, and new accounts are pre-marked.
- **Frozen chapters.** `ChronicleYear` snapshots are rebuilt only on an explicit request.
