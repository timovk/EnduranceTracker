# SPEC.md v0.4.0: engineering, performance, time and test review

**Lens:** replay correctness, local-time bucketing, the query and index plan at 10-year scale, caching and freezing, TypeScript strictness, design-rules and economy-test impact, WP sequencing, and test coverage.

**Method:**
- Every claim below was checked against `release/v0.4.0` @ 4c59efc. The repository was not modified.
- Measurements were run against scratch copies of the test database, with `work/migration.sql` applied and the synthetic "Large" career from SPEC §1.3 loaded: 5,000 races, about 60,000 stints and 180,000 ledger rows.
- The scripts are in `scratchpad/v040/eng/`: `fkbench.cjs`, `ledger-bench.ts`, `batch-bench.ts`, `replay-bench.ts` and `upd.ts`.
- "SPEC l.N" means a line of SPEC.md.

**Verdict:** there are **no blockers**, **8 major** findings and **24 minor** findings.
- The replay core is sound. `creditedSeconds` equals the XP guard, the fold reuses `addInterval`, the runtime clamp is right, and the checkpoint comparison uses integers.
- The majors sit around it:
  - two scale problems I measured (FK child scans, and the ledger re-stamp);
  - a year-freeze rule that loses the very stints the brief says to test (31 Dec 23:30, spanning midnight);
  - two ways the "exact" milestone instants come out wrong or permanently undated;
  - a rate that can exceed 100%;
  - backfill phases that are not truly bounded;
  - an upgrade test that never sees data written by the real 0.3.2 code.

---

## Major

### E1. The new sessionId index cannot serve SQLite's FK actions. Deleting a race costs 3.3 s at Large scale (SPEC §2.1 l.226-227, l.360; §2.2 l.457)

**What is wrong**
- `XPTransaction.sessionId` (schema:494-495) and `WatchedInterval.sessionId` (schema:441-442) are FKs to `race_viewing_sessions` with `ON DELETE SET NULL`.
- better-sqlite3 opens connections with `foreign_keys = 1` (verified: `pragma('foreign_keys')` returns 1). So every deleted stint makes SQLite search both child tables with `WHERE sessionId = ?`.
- That search needs an index whose **leftmost** column is `sessionId`. The SPEC's `xp_transactions(userId, sessionId)` cannot serve it, and `watched_intervals` has no such index at all.

**Evidence (`eng/fkbench.cjs`, Large data)**

| Operation | Current indexes | With `(sessionId)` indexes |
|---|---|---|
| `DELETE FROM races` for a race with 200 stints (cascade) | **3,266 ms** | 16 ms |
| Deleting one stint | 19.7 ms | 1.6 ms |

D4 (`deleteRace`) makes this a routine user path.

**Fix (WP1, before the migration file is committed; SPEC l.367 forbids editing it afterwards)**
- Change `XPTransaction` to `@@index([sessionId])`. It also serves `revokeSessionsXp`'s `userId = ? AND sessionId IN (…)`. Keep the composite as well if you like.
- Add `WatchedInterval @@index([sessionId])`.
- Both are plain `CREATE INDEX`, so they are still additive.
- Update §2.2, the `migrate-040.test.ts` index assertions (l.503) and §2.1's "each index backs a query" note. Add one line: "an FK child column needs a leftmost index".

### E2. `rebuildCareerTotals` takes 29.6 s at 180k ledger rows, and 0.4.0 puts it on several new user paths with no performance target (SPEC §4.6 step 8 l.1955; §4.3.4 step 5 l.1513; §4.0 resync step 5 l.1107; §1.3 l.135-144)

**What is wrong**
- `rebuildCareerTotals` (`xp-ledger.ts:265-307`) reads the whole ledger and issues **one UPDATE per re-stamped row** (`:278-285`).
- Removing an early row re-stamps nearly every later row.
- Measured with `eng/ledger-bench.ts` (Prisma, Large ledger):

| Rebuild | Time |
|---|---|
| Full re-stamp | **29,554 ms** (180,564 rows) |
| Steady state, nothing to re-stamp | 1,772 ms |

- D4 `deleteRace` of a race from year 1, Expedition Mode off, a runtime edit that revokes, and merges now all end in this call.
- Add E1's FK scan and a year-1 race deletion is **about 33 s** inside a 60 s transaction (`TRANSACTION_OPTIONS`, `session-engine.ts:51`). With "10+ years" it will time out and the delete will become impossible.
- §1.3 has no row for any delete or revoke path.

**Fix (WP2)**
- Re-stamp in batches. Compute `{id, running, level}` in JS as today, then write chunks of about 400 rows with one `UPDATE xp_transactions SET careerXpAfter = CASE id WHEN ? THEN ? … END, levelAfter = CASE … END WHERE id IN (…)` through `$executeRaw`.
- Measured with `eng/batch-bench.ts`: the same 180,564-row re-stamp takes **6.9 s in total** (2.1 s read and compute, 4.8 s write).
- Optionally, start from the earliest revoked row's `(createdAt, id)` with the running total taken from the row before it.
- Add §1.3 targets:
  - `deleteRace`, a race from year 1: < 10 s Large;
  - `deleteViewingSession`: < 5 s Large;
  - `setExpeditionModeAction`: < 5 s Large.
- Add them to the WP2 performance harness (see m24).

### E3. The "no grace period" year freeze permanently drops stints that span midnight on 31 December (SPEC §4.5.2 l.1828; §4.0 l.1112-1114; R6 l.79-83; §5.4)

**What is wrong**
- R6 places a stint's time in `[watchedAt − credited, watchedAt]`, backwards from the log instant.
- The log action calls `ensureChroniclesFrozen` **before** its write (l.1113). So the brief's own case ("31 Dec 23:30", watched 22:30–00:30 and logged at 00:31 with the app open) goes like this:
  1. 2026 freezes first.
  2. Then the stint is written, and 1.5 h of it falls in 2026.
- That time is missing from the frozen 2026 chapter and Wrapped forever. `/stats?year=2026` still counts it, which breaks the SPEC's own tests "a live chapter equals the frozen chapter built at year end" and "statistics filtered to a year equal that year's chapter" (l.2228).
- The justification at l.1828 ("the UI cannot backdate stints, so nothing can legitimately be added to a finished year") is false because of the backwards window.
- A window can reach back up to **64 h**:
  - runtime is at most 48 h (`schemas.ts:49`);
  - credited time is `timeline/0.75` (`economy.ts:35`);
  - RANGE mode has no real-time cap (`resolveSessionWindow`, `session-engine.ts:61-86`; `maxSessionRealHours` applies only to DURATION, `schemas.ts:150`).

**Fix (WP1 config, WP7 engine)**
- Add `CHRONICLE_SHAPE.freezeGraceHours: 72`, with a comment deriving it from 48 h / `xpMinSpeed`.
- Freeze year Y only when `now ≥ yearWindow(Y).end + grace`, in `register()`, on pages and in actions alike.
- Until then, year Y renders live with a "Complete — finalising until 4 January" badge, and `pendingWrapped` waits.
- Document the 64 h maximum window in R6.
- Replace the test "a year is frozen at the first start after it ends" (l.2225) with:
  - `a stint logged at 00:31 on 1 January that began on 31 December is in the frozen 2026 chapter`;
  - `nothing freezes before the grace period ends`.

### E4. Ladder rounding and exact replay crossings disagree, so about 2–5% of hour rungs are dated "RECOGNISED" forever (SPEC §3.2.5 table l.731-733; §4.1.4 l.1236-1239; R11 l.123)

**What is wrong**
- Rungs are created from **rounded** values:
  - `m.realHours = round1(…)` (`metrics.ts:165`);
  - `m.timelineHours = round1(…)` (`:217`);
  - mastery `realHours = round1(…)` (`mastery-engine.ts:259`);
  - compared with `value < threshold` (`achievement-engine.ts:547`, `mastery-engine.ts:919`).
- `round1(x) ≥ T` holds from `x ≥ T − 0.05 h`, which is 180 s early.
- The replay crosses the exact `T·3600`. So a rung recognised in those last 180 s gets `cumulativeCrossing = null`, and `fillLandmarkDates` writes `RECOGNISED`.
- Because dates are write-once, that rung never gets its time.
- It also drops out of the stint's "Career milestones" group, because `listStintCareerMilestones` matches on `sessionId`.
- The chance per rung is about `180 s / stint length`. Over about 20 hour rungs plus the event-hour nodes, a real career will lose several.

**Fix (WP1 `landmarks.ts`, WP3)**
- For the rounded metrics (`realHours`, `timelineHours`, event `realHours`), `milestoneInstant`/`eventStepInstant` must cross at `T·3600 − 180`. Put that in a named helper, `recognitionThresholdSeconds(T)`, with a comment tying it to `round1`.
- `syncCareerMilestones` uses the same predicate for `hours-250`.
- Add tests:
  - `a rung recognised at 99.96 h gets an INTERPOLATED date inside the stint that recognised it`;
  - `recognition and replay agree at every HOUR_STEPS rung`.

### E5. Interpolated instants can go backwards when stint windows overlap, and overlap is the normal batch-logging case under D1 (SPEC §3.2.2 l.657-660; R6)

**What is wrong**
- The log form stamps `watchedAt = now` (SYNTHESIS §A). Two sittings logged a minute apart therefore get windows that overlap almost completely.
- `cumulativeCrossing` interpolates inside each stint's own window. A threshold crossed in stint k can land **before** `watchedAt(k−1)`, even though stint k−1's hours were counted "before" it.
- The result is inverted dates:
  - a higher rung dated earlier than a lower one;
  - `realHours` versus `timelineHours` versus `realHoursYear` out of order;
  - "Reached at about 20:47" for a moment the history cannot place.
- The brief says "Do not silently invent precision". The label claims minute precision for a window that is only a guess.

**Fix (WP1 `career-timeline.ts`)**
- Interpolate on the effective segment `[max(startsAt_k, watchedAt_{k−1}), watchedAt_k]`, where k−1 is the previous stint in career canonical order.
- When that truncation removes more than half of the window, downgrade the precision to `STINT` (`at = watchedAt_k`).
- This makes every landmark instant non-decreasing in canonical order and in threshold.
- Add tests:
  - `two stints logged a minute apart never date a later threshold before an earlier one`;
  - `a batch-logged stint's crossing is STINT, not INTERPOLATED`;
  - a property test: milestone instants are monotone in threshold for random logs.

### E6. `storyCompleteRate` mixes two cohorts, so a year can show over 100% (SPEC §3.2.6 l.766; used at l.1710, l.1776 and in Compare l.793)

**What is wrong**
- `storyCompletes / racesStarted` for a window divides the Story Complete events **in the window** by the races whose **first stint** is in the window.
- In 2027, finishing three races started in 2026 plus five new ones out of five started gives 8/5 = **160%**. The ≥5-races guard does not prevent it.
- This is a fabricated statistic. The brief says "careful with percentages".

**Fix (WP1 `window-summary.ts`)**
- For a window: `rate = |races started in window that are SC by window.end| / |races started in window|`.
- Lifetime is unchanged, because SC races are a subset of started races.
- Label it "Of the races you started in {year}, N% are complete stories".
- Add the test `a year that finishes last year's races never shows a rate above 100%`.

### E7. Backfill and recompute phases are not bounded, so at scale one phase can outrun the 60 s transaction and the health gate on every start (SPEC §5.2 l.2040-2055; §4.3.6 l.1609; §4.5.3 l.1882-1883; §4.5.2 `buildChapterData` l.1810)

**What is wrong**
- Each phase is **one** transaction, and the deadline is checked **only between phases** (l.2041).
- **P4** calls `writeExpeditionSummary` once per completed expedition. Each call builds its records "from the replayed career timeline", which means a full load, replay and `computeRecordProgression` per race. That is quadratic.
- **P5** calls `buildChapterData(userId, Y, now, tx)` once per year. Inside a transaction that function reloads and replays the whole career every time (l.1883).
- `recompute` step 4 and `ensureChroniclesFrozen` share the same pattern.
- On a Large career:
  - P4 or P5 exceeds 60 s, the transaction times out, and the account stays unmarked;
  - the next start repeats it;
  - with `register()` blocking (Next docs: `register` "must complete before the server is ready"), the desktop's 60 s `READY_TIMEOUT_MS` (`desktop/src/main.ts:40`) fails on every launch.
- The "every phase < 20 s" claim (l.2054) is not backed by anything in the design. Even a 20 s phase that starts at 39.9 s overruns the 40 s budget.

**Fix**
- **One build per account per phase.** Build `timeline`, `progression` (records) and an `xpBySession` sum map once, and pass them in:
  - `buildChapterData(userId, year, now, { db, timeline, progression })`;
  - `writeExpeditionSummary(…, { timeline, progression, xpSums })`.
- **Chunk P4 by race and P5 by year.** Each chunk gets its own transaction and stays idempotent. Check the deadline between chunks, and do not start a chunk when `Date.now() + lastChunkMs > deadline`.
- **Budget the start-up.** Set `CAREER_BACKFILL_BUDGET_MS` to about 30 s so the Next boot has room.
- **Measure when each phase lands.** Put the Large DB performance assertions for P1–P5 into WP3/WP5/WP7's acceptance, not WP8 (see m24).

### E8. No test upgrades data that the real 0.3.2 code wrote (SPEC §2.5 l.490-509; §8.2 l.2250; WP8 e2e l.2654)

**What is wrong**
- `migrate-040.test.ts` inserts hand-written "0.3.2-shaped" rows with raw SQL.
- `career-backfill.test.ts` runs on the already-migrated test DB with Prisma-inserted rows.
- Neither sees what 0.3.2 actually persisted:
  - ledger re-stamps and `careerXpAfter` BigInt text;
  - Json `ConfigOverride` values;
  - interval rows built in insertion order;
  - achievement, mastery and HoF rows produced by the real engines.
- The only faithful check is the optional e2e, which needs Electron and xvfb. It "seeds one with the 0.3.2 migrations", which gives an empty career unless there is a fixture.
- The Definition of Done is "upgrade without losing data".

**Fix (the first task of WP1, while the tree is still 0.3.2)**
1. Run `npm run db:seed` at 4c59efc into `tests/fixtures/career-0.3.2.db`. Add a `!tests/fixtures/*.db` exception, because `.gitignore:60` ignores `*.db`.
2. Add `tests/integration/upgrade-from-0.3.2.test.ts`:
   - copy the fixture;
   - `runMigrations(copy, MIGRATIONS)`;
   - set `process.env.DATABASE_URL` to the copy before the first query (the client is lazy, `client.ts:32-37`, and each file runs in its own fork);
   - run `runCareerBackfill`.
3. Assert:
   - stints, intervals and statuses are byte-identical;
   - I1–I5 hold;
   - every milestone row has `achievedPrecision` set;
   - the seeded 2025 chapter is frozen;
   - a second run changes nothing.

   The seed backdates to 2025 (`scripts/seed.ts:173-174, 289-301`), so P5 is exercised too.

---

## Minor

- **m1. TS strictness: snapshots declared as `interface` (l.1835, l.1578).**
  - An interface lacks the implicit index signature `Prisma.InputJsonValue` needs, so `snapshot: chapter` fails to compile. That invites broad casts.
  - The repository convention is `type` aliases for Json shapes (`awards-engine.ts:77-81`, `challenge-engine.ts:94-96`).
  - Fix: declare `ChronicleChapterV1` and `ExpeditionSummarySnapshotV1` as `type`, or as `z.infer` of the zod schema that `upgradeChapterSnapshot` already needs.
- **m2. The §3.2.10 snippet does not type-check (l.895).**
  - `mergeIntervals(rows.map(r => normalizeInterval(r, runtimeSec)).filter(Boolean))` fails for two reasons: `rows` are `{startSec, endSec}`, and `.filter(Boolean)` does not narrow `Interval | null` in TS 5.9.3.
  - Fix: map to `{start, end}` and filter with `(iv): iv is Interval => iv !== null`, as `intervals.ts:42` does.
- **m3. The stint-path reconcile can break I2 (l.1490-1494).**
  - Step 4 deletes held rows whose amount differs from the current schedule, for example after a future re-balance of `EXPEDITION_CONFIG`. `logViewingSession` never calls `rebuildCareerTotals`, so the profile total stops matching the ledger.
  - Fix: either rebuild when `revoked.length > 0` on every caller, or give reconcile an `awardOnly` mode for the stint path.
- **m4. P4 uses the cached `race.coverageSec` without re-deriving it (P1 l.2046, P4 l.2049, reconcile precondition l.1487).**
  - Legacy races whose runtime shrank keep unclamped `coverageSec`/`storyCompletedAt`, and the unclamped WatchedInterval rows keep feeding `addInterval` in `logViewingSession`. Checkpoints and the SC bonus then disagree with the replay.
  - Fix: in backfill and recompute, reconcile from replay coverage. In P1, run `rebuildRaceIntervals` plus a status-preserving refresh of `coverageSec`/`storyCompletedAt`, followed by `reconcileStoryBonus`, for races with any interval end greater than `runtimeSec`. Intervals are derived data (R1), so R11 should allow this.
- **m5. `eventStepCredit.findMany({ where: { userId } })` runs on every sync, which means every stint (l.1423).**
  - That can be about 17 nodes × editions × events rows, loaded every time.
  - Fix: load it lazily, only when a RACE_EVENT node is newly unlocked.
  - Also pass a `filter` to `createManySkippingDuplicates`. Without one, a conflict logs `prisma:error` (`client.ts:92-97`).
- **m6. `fillLandmarkDates` builds the replay whenever any row is undated (l.1234-1235), even when every undated row is non-replayable.**
  - Fix: build only if some undated row `isReplayableMilestoneMetric`.
- **m7. `computeCareerMetricsWithHistory` keeps two full race scans per stint (l.908).**
  - Fix: merge the two selects into one query.
- **m8. `repairXpLedger` has an N+1 (`session-engine.ts:589-603`), and the SPEC extends it to `expedition:*` rows (l.1971).**
  - Fix: use one `race.findMany({ where: { userId }, select: { id, storyCompletedAt } })` map.
- **m9. Timeline cache (l.885-888).**
  - Store the cache on `globalThis`, like the Prisma client (`client.ts:19`). Next compiles server actions and RSC into separate layers, and a module-level Map can be instantiated once per layer. Clearing from an action then does nothing and memory doubles. Correctness still holds through the fingerprint.
  - De-duplicate concurrent misses with an in-flight promise.
  - The fingerprint is sound: I verified that `updateMany` bumps `@updatedAt` in this Prisma 7 build (`eng/upd.ts`). It assumes no edit path for a season's year; state that assumption in the code comment.
- **m10. The time-zone guard is weak (l.2218).** `new Date(2026,0,1).getTimezoneOffset()` is 0 for Europe/London, the same as a UTC CI box. A platform that ignores `process.env.TZ` would pass the London block by accident. Also assert a July offset (−60).
- **m11. Frozen `records[].since` goes stale (l.1861, l.1785).** A 2026 record beaten in 2028 keeps `since: null` forever. Compute "since beaten" live at render from the current progression, and keep only the record itself in the snapshot.
- **m12. The `year-plan` dedupe key includes the threshold (l.2172: `milestone:realHoursYear:<Y>:<annualHours>`).** If `BUDGET_CONFIG.annualHours` is ever re-tuned, the same year pays twice. Fix: check "reached" by the metric `realHoursYear:<Y>` alone, and key the XP `milestone:realHoursYear:<Y>`.
- **m13. §6 row 18 understates the one-race-per-event farm (l.2142).**
  - 0.4.0 makes "New event…" available on every race. Each race given its own event collects:
    - `edition_1` 1,000 (existing, `economy.ts:381`);
    - `watched_1` 150;
    - `event_hours_25` 500 whenever one race has ≥ 25 credited hours (a 24 h race at 0.75–0.95×).
  - That is up to 1,650 XP per race, not 150.
  - Fix: new event steps pay XP only once the event has ≥ 2 distinct editions (otherwise they are recorded only). Correct the row, and add the test `a one-race event pays no new event-step XP`.
- **m14. The economy model under-counts checkpoints (§7.3 l.2182, l.2201).**
  - The model pays expedition XP only for Story-Completed ≥ 10 h races, but checkpoints pay on coverage.
  - A new career whose first 20 h are one 24 h race earns 2,250 checkpoint XP. The model counts 0 at 20 h, where the headroom is 7,640.
  - I reproduced the SPEC's figures exactly (`work/econ-model.ts`). The assertion `new sources / viewing < 0.04` is a property of the model, not of the economy.
  - Fix: add a long-race-heavy profile (≥ 60% of hours on ≥ 10 h races, checkpoints by coverage), assert viewing share > 0.4 for it, and replace the 0.04 bound with a per-race bound (checkpoints ≤ 9% of that race's viewing XP).
- **m15. URL tabs recompute everything (l.1648).** A `router.replace` on a `force-dynamic` page re-renders on the server. Compute only the active tab's view model: records only for `tab=records`, compare only for `tab=compare`.
- **m16. The Chronicle index parses every frozen snapshot in full (l.1855, l.1938).** `storyComplete.list` is unbounded. Store a small `card` Json (or columns) with the index figures.
- **m17. `EventStepCredit @@index([userId, nodeKey])` is redundant (l.338).** The unique `(userId, nodeKey, raceId)` prefix already serves it.
- **m18. `stintUnlockWindow` overlaps for stints logged close together (l.952).** With ± 5 min, two stints logged within 5 min share unlocks. Bound the top by `min(watchedAt + 5 min, next stint's watchedAt)`.
- **m19. `freezeAllChronicles` reads the clock from an engine (l.1814, l.2085).** It checks `Date.now() < deadline` inside `src/lib/engines`, which contradicts R9. Move it to `server/upgrades`, or inject a `shouldContinue()`.
- **m20. "A unique-violation race is caught and ignored" (l.1821) logs `prisma:error` in the user's log.** Use create-if-missing inside a transaction, or an `upsert` with an empty update.
- **m21. A week that straddles the new year is labelled with out-of-year dates (l.1764, l.1846).** The chapter's most active week can read "29 Dec – 4 Jan" while it counts only the in-year days. Clip the label, or say "(days in 2026)".
- **m22. §8.2 row "Career-year boundaries" (l.2225) encodes E3's bug.** Update it as described in E3.
- **m23. §6 row 6 claim is wrong for major-event trophies (l.2130).** It says trophies are "not re-paid because their rows and keys persist". The `major-event:<raceId>` trophy and HoF keys (`awards-engine.ts:812, 825`) change with the race id, so a re-created major race mints a second plaque. It carries no XP. Correct the wording, or key by edition fingerprint.
- **m24. DB performance is first measured in WP8 (l.2409, l.2655).** Create the Large DB harness in WP2, when the loader exists. Each later WP then adds its own hot path: `logViewingSession`, `deleteRace`, P1–P5, `/stats`, `/chronicle/[year]`.

---

## Test-plan coverage: the gaps

The brief's TESTING items are all mapped (§8.2). These scenarios are missing:

| Brief item | Missing scenario |
|---|---|
| Career-year boundaries | A 31 Dec 23:30 stint that spans midnight and is logged after it (E3). |
| Exact time-based milestone timestamps | The 180 s rounding boundary (E4), and batch-logged overlapping windows (E5). |
| Year-to-year comparisons and year-in-review | A rate cohort that exceeds 100% (E6). |
| Database migration from the current production schema | A real fixture written by 0.3.2 (E8). |
| Deleted sessions | Delete and re-stamp at scale (E1, E2). |
| Timezone-sensitive attribution | The July offset guard (m10). |
| Performance | Per-WP DB harness (m24). |

## Sequencing corrections

| Fix | WP |
|---|---|
| E1 | WP1. It is a migration change, and the migration is immutable once committed. |
| E8 fixture | Must be generated **before** WP1 changes the schema. The 0.3.2 seed code disappears from the tree after that; otherwise use a `git worktree` of 4c59efc. |
| E4, E5, E6 | WP1, because they are pure domain changes. |
| E3 config | WP1. |
| E2 | WP2, where `deleteRace` is introduced. |
| E7 | WP3 (framework), WP5 (P4) and WP7 (P5). |
| E3 behaviour | WP7. |

The rest of the WP order is sound. Each WP can be green on its own; the notes above only move work earlier.

---

## Verified correct: do not change

- **Credited seconds (R7) equal the XP-credited real time.**
  - `realSeconds = round(t/speed)` (`playback.ts:22-24`).
  - For `speed ≥ 0.75`, `round(t/speed) ≤ round(t/0.75)`, so the min returns `realSeconds`. Below that, the min returns `t/0.75`. That is exactly `progression.ts:200`.
- **The replay fold reuses `addInterval(… { limit: runtime, gapTolerance })`.**
  - Gap-tolerant merging is a monotone closure, so the final set does not depend on order. The canonical-order rebuild in `deleteViewingSession` is therefore safe.
  - Σ `addedCoverageSeconds` equals the final coverage.
  - Story Complete uses the same `isStoryComplete` and 20 s tolerance as `race-engine.ts`, and the clamp closes the runtime-shrink false completion.
- **The details that were right:**
  - integer checkpoint comparison;
  - the `completesStory` instant is unique, because coverage never decreases;
  - UTC edition years (`race-day.ts` convention);
  - distinct edition identities.
- **One calendar module.**
  - DST-safe splitting walks `new Date(y, m, d + 1)`.
  - Week keys come from `viewingWeek` with the user's `weekStart`, which is unique per viewing week for any start day.
  - The UTC `dayPeriod().key` is avoided.
- **Migration safety.**
  - Additive-only migration with nullable columns: no RedefineTables and no data backfill in SQL.
  - Sorted after `20260922203126`.
  - The runner keeps FKs off and applies each migration in its own transaction.
  - The `migrate-040` design and `EXPECTED_TABLES` = 31.
- **Landmark safety.**
  - Write-once dates through `updateMany … achievedPrecision: null`.
  - The `acceptInstant` guard.
  - Revoking before the cascade in `deleteRace`.
  - One transaction per phase, the value-compared marker, and pre-marking in `createAccount`.
- **Replay cost is realistic** (`eng/replay-bench.ts`, 60k stints):

  | Step | Time |
  |---|---|
  | Load sessions (9 columns, canonical order) | 471 ms |
  | Load races with joins | 73 ms |
  | `addInterval` + `isStoryComplete` fold | 87 ms |
  | Day split with memoised week keys | 84 ms |

  Folding the metrics session load into `loadTimelineInputs` does not worsen the per-stint path.
- **The cache fingerprint approach** (see m9 for placement), and "inside a transaction, never use the cache".
- **Design-rule compliance (R10)** matches every rule in `tests/domain/design-rules.test.ts`:
  - the banned `336` and `1.35` literals;
  - the re-lock regex;
  - engines importing `@/lib/config`;
  - `requireUserId` and `force-dynamic` on every page;
  - no `Math.random`;
  - no DB access or `awardXp` in components.
- **The economy figures in §7.3 reproduce exactly.** The balance test still passes, with 7,640 XP of headroom at 20 h.
