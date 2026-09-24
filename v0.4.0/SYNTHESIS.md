# v0.4.0 architecture brief: Chronicle, Event Legacy, Expeditions, Career Statistics, Career Milestones

**One fact frames everything below.** 0.1.0 shipped on 2026-09-22 (`src/lib/changelog.ts:173-174`). The log form never sends `watchedAt` (`src/components/races/log-session-form.tsx:169-187`), so on real installs every session and ledger row is dated 2026-09-22 or later. Only `scripts/seed.ts` backdates, to 2025-07-21. No real user has a finished calendar year yet: the first real Wrapped is 2026. Today's backfill is small, but it has to be built for 10 years of data.

## A. The existing architecture

**Data model.** There are 28 Prisma models in one SQLite file (`prisma/schema.prisma`). The client uses the `PrismaBetterSqlite3` adapter and is created lazily in `src/lib/db/client.ts:43`. Every career table has `userId` with Cascade.
- DateTimes are stored as ISO TEXT (`…+00:00`), so range filters compare text. SQL `CURRENT_TIMESTAMP` writes a different format that compares wrongly.
- Calendar bucketing is done in JS using the server process's local time. `User.timezone` (schema:159) is never read.

**Canonical history.**
- `RaceViewingSession` (schema:390-428) is append-only. Each row has `start/endTimestampSec`, `playbackSpeed`, `timelineSeconds` and `realSeconds` (derived as timeline/speed, never measured), plus one instant, `watchedAt`, which is effectively the end of the stint (`session-engine.ts:93`). There is no edit path.
- `WatchedInterval` holds the merged coverage and is rewritten wholesale. Its `sessionId` is meaningless as provenance.
- Cached race aggregates come from `recomputeRaceAggregates` (`race-engine.ts:50-133`):
  - `storyCompletedAt` is the log `now` (line 87) and is cleared when coverage drops.
  - `completedAt` is sticky.
  - `startedAt` and `lastWatchedAt` are the first and last `watchedAt`.
- Stale snapshot fields: `newCoverageSeconds` and `coverageBefore/AfterSec` are never rebuilt after a delete, and `careerXpAwarded/seasonXpAwarded` are never written.

**Reward pipeline.** `logViewingSession` (`session-engine.ts:88-405`) is one transaction (`TRANSACTION_OPTIONS` 60 s, line 51) that runs, in order:
1. Append the session and re-merge intervals.
2. `recomputeRaceAggregates` (line 160).
3. Viewing XP (no dedupe key).
4. `story-complete:<raceId>` (line 212).
5. Momentum and streak.
6. `ensureMasteryTrees`, `ensureSeasonCollections`, `recomputeRaceMasteries`.
7. `syncCollections`, `syncMastery`, `evaluateChallenges`.
8. `computeCareerMetrics`, which loads all races and sessions.
9. `syncAchievements`, `syncMilestones`.
10. Season pass.
11. `syncAwards` (no XP).

All XP goes through `awardXp` (`xp-ledger.ts:58`), deduplicated on `@@unique([userId, dedupeKey])`. `createdAt` is always the insert time; there is no way to backdate. `rebuildCareerTotals` (`xp-ledger.ts:265-307`) replays the ledger and issues one UPDATE per re-stamped row.

The codified rule is "XP follows the data, landmarks stay earned" (`xp-ledger.ts:156-164`), and `tests/integration/session-flow.test.ts:501` enforces it:
- Deleting a stint revokes only VIEWING/REWATCH plus a no-longer-valid Story Complete bonus (`session-engine.ts:465-545`).
- `deleteRaceAction` (`actions.ts:266-279`) revokes nothing.

**Recompute.** `scripts/recompute.ts` is dev-only and is not shipped. It does not rebuild intervals, awards, momentum, challenges or the snapshot columns. All repair and backfill logic for users therefore has to live in the app.

**Migrations and upgrade hooks.**
- The desktop app takes a `VACUUM INTO` snapshot before an update (`desktop/src/main.ts:130-146`, packaged builds only). `desktop/src/migrate.ts` then applies `prisma/migrations/*` in sorted order, one transaction per migration, with FKs off and checksums written to `_prisma_migrations`.
- One-time logic runs in `src/instrumentation.ts` `register()`, which has to finish before `/api/health` answers. The desktop waits 60 s (`READY_TIMEOUT_MS`, `main.ts:40`).
- The 0.3.1 pattern to copy: a per-account `ConfigOverride` marker (`season-reset.ts:94-158`), one transaction per account, retry on failure, and pre-marking new accounts in `createAccount` (`src/lib/auth/accounts.ts:192-195`). `isSeasonResetApplied` checks only that the marker exists, not its value.

**UI shell.** `src/app/layout.tsx` renders SideNav/TopNav from a flat 14-item `NAV` array (`nav.tsx:110-125`), with prefix-match highlighting. Pages are async server components (`requireUserId()` + `force-dynamic`) with no Suspense or loading boundaries.
- Shared components come from `primitives.tsx`, `controls.tsx` and `dialog.tsx`. Recharts is used only in `statistics-view.tsx`, and `src/components/charts/` is empty.
- Celebrations are QUIET, NOTABLE or SPECTACULAR (`chooseCelebration`, `session-engine.ts:415`), rendered inline by StintSummary.

## B. The five systems

### 1. Career Chronicle / Year in Review / Wrapped
- **Exists:**
  - stats-engine: `yearWindow` (:630, local time), plus `getMonthlyBreakdown` (:1853) and `getActivityCalendar` (:1829), both exported but unused.
  - `monthlyXpSeries`/`getLevelHistory` (:1676/:1758, keyed on ledger `createdAt`) and `xpBySource(userId, from, to)` (`xp-ledger.ts:316`).
  - `YearStat[]` and `cadence.mostActiveDay/Year`, which are computed but not rendered.
  - Hall of Fame already grouped by year (`awards-engine.ts:1225-1235`).
  - Landmark timestamps: `AchievementProgress.unlockedAt`, `MilestoneProgress.reachedAt`, `Trophy.awardedAt`, `HallOfFameEntry.occurredAt`. All are log time.
- **Extend or build:** chapters are built on the stats-engine windows, with no second aggregation path. The Wrapped slideshow is a new full-screen client component; `Dialog` requires a title, caps height at 70vh and closes on a backdrop click. The "seen" flag follows the WhatsNew pattern (`whats-new.ts:15-36`).
- **Derived vs persisted:** derive the year-to-date view on read. Persist a frozen chapter per completed year in a new table, unique on `(userId, year)` with a Json snapshot, following `Trophy.metadata`/HoF `snapshot`. Story seen this year must come from session replay, not `uniqueCoverageSeconds` (lifetime per race) and not `newCoverageSeconds` (stale).
- **Integration points:** `stats-engine.ts` `loadScope` (:913) and `loadActivityBuckets` (:787). Memoizing the week key per day cuts about 300 ms to about 45 ms per 60k rows.

### 2. Event Legacy
- **Exists:** `RaceMastery` (schema:451-477) keyed by `Race.iconicKey`, with the `Race.raceMasteryId` FK. `recomputeRaceMasteries` (`mastery-engine.ts:769-849`) rebuilds it on every stint and overwrites `name` on each run (line 823). `RACE_EVENT` trees `event:<iconicKey>` carry the `raceEventNodes` (`economy.ts:380-389`: editions 1/3/5/10, consecutive 3/5, hours 50/150; 85k XP). Achievements `annual_pilgrimage` and `decade_of_devotion` also exist. No UI shows the `RaceMastery` figures.
- **Rule:** this is the existing recurring-event mastery mechanic, so extend it rather than add a `RecurringEvent` table.
  - `key` becomes immutable identity.
  - Add nullable columns (plain `ALTER TABLE ADD COLUMN`): `displayName`, `archivedAt`, `userManaged`, `aliases` Json.
  - Rename changes `displayName` only. Merge re-points races and records an alias.
  - Legacy milestones are extra `raceEventNodes`: `ensureMasteryTrees` inserts config-added nodes into existing trees (`mastery-engine.ts:557-567`) and `syncMastery` pays them once under `mastery:event:<key>:<node>`.
- **Derived:** per-event hours, coverage, rewatch (`timelineWatchedSec − coverageSec`), longest edition and current streak are folds over the event's races. Compute them on read; do not cache.
- **Fixes needed:**
  - `editionsStoryComplete` counts races, not distinct years (`mastery-engine.ts:248-256`).
  - `metrics.maxEditionsOfOneEvent` counts duplicate years (`metrics.ts:208-236`).
  - Edition year is read with local `getFullYear()` from a UTC-midnight `raceDate` (`metrics.ts:209`, `mastery-engine.ts:358-362`).
  - The iconicKey field is shown only when Major event is on (`edit-race-form.tsx:176`, `add-race-form.tsx:197`), and saving with it off nulls the key (`actions.ts:172`).
  - `updateRaceAction` does not re-run `ensureMasteryTrees`/`recomputeRaceMasteries`.

### 3. Race Expeditions
- **Exists:** `TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec` = 12h (`economy.ts:410-421`). It already switches the race page to long-race mode (`race-detail-view.tsx:48`, TwentyFourHourClock, RaceTimeline, GapList) and drives the SPECTACULAR celebration. Other pieces: `resumePoint`/`gapsIn` (`intervals.ts:133-166`), `estimateRemaining`/`suggestStints` (`playback.ts`), and the budget engine.
- **Build:**
  - A nullable `Race.expeditionMode Boolean?`. A NOT NULL default forces a RedefineTables of `races`.
  - A per-account threshold stored under a `ConfigOverride` key. The runtime config loader does not exist.
  - `EXPEDITION_CONFIG`/`EXPEDITION_SHAPE` in `economy.ts`, registered in `config/index.ts` DEFAULT_CONFIG and in `tests/domain/config.test.ts`'s `imported` map.
  - A new `XPSource` `EXPEDITION` in both `schema.prisma:84-99` and `domain/types.ts:21-24`; this needs no SQL.
  - Checkpoint XP via `awardXp` with dedupe key `expedition:<raceId>:<pct>` and `seasonAmount: 0`.
  - An `ExpeditionSummary` table with `raceId` SetNull and a frozen Json snapshot written at the first Story Complete, because `storyCompletedAt` can be cleared and re-stamped.
- **Hooks:**
  - Award after line 160 in `logViewingSession`.
  - Revoke with `revokeXpByDedupeKey` in `deleteViewingSession` next to line 524, and in a hardened `deleteRaceAction`.
  - The timeline comes from raw session windows, not `WatchedInterval.sessionId`.
  - Percentages must clamp intervals to runtime, because `fromRows` and `isStoryComplete` do not.
  - UI: `/races/[id]/expedition`, which highlights Race Library automatically. Add a new StintSummary group and extend `hasUnlocks()` (`stint-summary.tsx:320-331`).
  - Resolve the name clash with achievement `expedition` (`achievements.ts:42`).

### 4. Career Statistics / Personal Records
- **Exists:**
  - `getStatistics`/`StatsFilter` (`stats-engine.ts:86-100`) filters by year, championship, season, circuit, type, runtime, status and storyComplete. There is no event or race filter.
  - Per-year and per-month series, and championship/circuit breakdowns.
  - Longest session (:2176), plus most active day, month and year (:1205-1238).
  - Tabs are React state, not URL state (`statistics-view.tsx:43`).
- **Extend in place:**
  - Add `iconicKey`/`raceMasteryId` and `raceId` to `buildRaceScopeWhere` (:678).
  - Build year-vs-year from `YearStat`.
  - Put records in a pure `personalRecords()` fold in `src/lib/domain` (testable; stats-engine has no tests).
  - Add a `Records` tab and move the tab into the URL.
  - Move `ChartTooltip` into `src/components/charts/`.
- **Derived only.** "Most unique coverage in a day", "races/Story Completes per month/year" and "fastest completion" need a canonical replay (see 5). For fastest completion, `startedAt` is the end of the first stint; floor elapsed time at the sum of `realSeconds`.
- **Index:** add `@@index([userId, storyCompletedAt])` on `races`, a plain `CREATE INDEX`.

### 5. Career Milestones
- **Exists:** `MILESTONES` (`config/milestones.ts:31-45`) and `MilestoneProgress` (schema:563-579) pay under `milestone:<metric>:<threshold>` (`achievement-engine.ts:523-586`). Coverage already includes:
  - realHours 100…10,000, including a lifetime 336 rung;
  - storyCompletes and racesCompleted 1/5/10/25/50/100…1000;
  - stories12h/24h:1.

  HoF firsts cover `first:race-completed`, `first:story-complete`, `first:race-12h` and `first:race-24h` (`awards-engine.ts:624-656`). Achievements (48 definitions, `config/achievements.ts`) and global mastery nodes repeat the same moments. For example, 100 Story Completes already pays 6,120 + 50,000 + 40,000.
- **Missing:** first race started, a 6h tier (metrics use hard-coded 7.5/9.5/11.5/23h, `metrics.ts:200-204`), hours in one calendar year, and 5/25 editions of one event.
- **Extend `MilestoneProgress`:**
  - Add nullable `achievedAt`, `sessionId` and `raceId`.
  - Keep `reachedAt` as the recognition time, because `session-summary.ts:47` attributes unlocks by `reachedAt >= watchedAt − 5 min`.
  - Encode per-year rungs in the metric string (e.g. `realHoursYear:2026`) so the unique index stays.
  - Link to HoF firsts rather than minting new ones.
- **One canonical replay** in `src/lib/domain`: order sessions by `(watchedAt, createdAt, id)` (the delete path orders by `watchedAt`, the ledger by `(createdAt, id)`), replay per-race intervals with `addInterval`, and emit hour crossings, coverage crossings and Story Complete events. Interpolate crossings on a window of `[watchedAt − realSeconds, watchedAt]`. That one replay feeds milestone `achievedAt`, Chronicle, records and expedition checkpoints.
- **Backfill:** add a second `register()` step with marker `careerBackfill`, compared by **value**. Run one transaction per account and pre-mark new accounts in `createAccount`. Add the new syncs to `scripts/recompute.ts:74-89`.

## C. Hard constraints and risks

**Exploits (existing or inherited).**
- **Delete and recreate a race:** the race gets a new uuid, so `story-complete:<id>` pays again and orphaned viewing XP stays. Any `raceId`-keyed reward inherits this.
- **Tiny races:** the only duration check is > 0 (`schemas.ts`), so a 1-minute race earns a 500 XP Story Complete and counts toward milestones.
- **Speed inflation:** RANGE mode has no real-time cap. At 0.1x a 48h race logs 480h (`resolveSessionWindow`, `session-engine.ts:61-86`, which clamps timeline only); XP alone is guarded at 0.75x (`progression.ts:200`).
- **Manual `COMPLETED` status:** it counts in `metrics.racesCompleted` (`metrics.ts:187`) and in season completion until the next recompute (`deriveStatus`, `race-engine.ts:142`).
- **Shrinking the runtime:** stored intervals past the new runtime still count toward Story Complete.
- **Gap tolerance:** the 20 s gap tolerance is counted as coverage.
- **Renaming or re-casing an iconicKey:** this creates a fresh `event:<key>` tree that pays up to 85k again.
- **Backdating:** the action accepts an unbounded `watchedAt` (`actions.ts:294`).
- **Log then delete:** a stint that unlocks landmarks can be deleted and the landmark XP stays (this is by design).
- **User-set thresholds** (expedition threshold, a year's budget hours) become farming levers if XP depends on them.

**Time.**
- `watchedAt` ≈ the end of the stint. Everything else is log time.
- Local machine time zone. Changing it re-buckets history, and a stint at 23:30 on 31 Dec can move year.
- `dayPeriod().key` is UTC (`periods.ts:54`), unlike the local `localDayKey` (`stats-engine.ts:617`).
- `momentum` keys on `now`. `lifetimeActiveWeeks` ignores `User.weekStart` (`momentum-engine.ts:363`). Do not use either as a Chronicle source.

**Performance.**
- `computeCareerMetrics` loads every session on every stint.
- `rebuildCareerTotals` issues one UPDATE per row; inserting historically dated XP re-stamps most of the ledger.
- `getStatistics` runs about 50 queries, serialised on better-sqlite3.
- There are no Suspense boundaries.
- Missing indexes: `xp_transactions.sessionId`, `watched_intervals.sessionId`, `races.storyCompletedAt`.
- Keep the full replay out of the per-stint path: evaluate incrementally per stint, and replay fully only in the backfill and in the frozen-chapter builder.

**Migration safety.**
- Use nullable columns only.
- Name new migrations so they sort after `20260922203126`, and never edit an applied migration (a checksum change only warns).
- Put no data backfill in SQL.
- The runner runs no `foreign_key_check`.
- A new model bumps `EXPECTED_TABLES` (`tests/desktop/migrate.test.ts:147`).
- New `XPSource`/enum values mean 0.3.2 can no longer read the DB; only the pre-update snapshot restores it.
- `register()` plus migrations must fit the 60 s health budget and the 60 s transaction timeout.

**Account isolation.**
- New tables need `userId` with Cascade, and writes must use `updateMany`/`deleteMany` with `{id, userId}`.
- `recomputeRaceAggregates` takes no userId, so ownership is a precondition.
- `design-rules.test.ts` forbids hard-coded ids and requires `requireUserId()` and `force-dynamic` on every page.

**Season closure.**
- `isSeasonClosed` runs until local midnight on 2026-10-01 (`domain/season-closure.ts:23-31`).
- `rebuildSeasonXpFromLedger` sums `seasonAmount` by `createdAt`, so any backfilled or checkpoint row with a non-zero `seasonAmount` would feed the Q4 2026 pass. All new XP must be career-only.
- Engines take `now` injected.
- `tests/e2e/desktop.mjs:66` hard-codes the reopening date.

**Design-rule and test landmines.**
- The literal `336` is banned in engines, domain, components and app; read `BUDGET_CONFIG.annualHours` instead.
- The re-lock regex forbids `data:{…completedAt|unlockedAt|awardedAt: null}` anywhere.
- Trophies and HoF entries may be deleted only in `season-reset.ts`.
- Engines must import `@/lib/config`.
- No `Math.random` in engines; Wrapped ordering must be seeded.
- Forbidden copy includes "you missed", "catch up on", "falling behind", "overdue", "budget exceeded" and "warning". New tone functions must be registered in `periods-tone.test.ts`.
- `economy-balance.test.ts` is tight at 20h: viewing is 44.1% against a 40% floor, leaving about 8.3k XP of headroom. Challenges and `raceEventNodes` are not modelled.

**UI traps.**
- `text-base` sets a colour, not a size.
- `cn()` strips `text-timing(-lg)`/`text-label` (verified).
- Reduced motion is handled only in CSS, so the JS slideshow timers need a `matchMedia` check.
- The React Compiler lint rules flag `Date.now()` during render.

**Version bump to 0.4.0:** `package.json:3`, `package-lock.json:3,9`, `CHANGELOG[0]` in `src/lib/changelog.ts` (date ≥ 2026-09-24), and `CHANGELOG.md` via `npm run changelog`. Everything else derives from `package.json`.

## D. Decisions the owner must make (by priority)

1. **Should Career Milestones pay XP where existing systems already pay for the same moment?**
   - (a) XP-free timeline over the existing ladders and HoF firsts.
   - (b) Timeline, plus modest XP only for new rungs (first started, first 6h, hours in a calendar year, 5/25 editions) under the existing `milestone:` namespace.
   - (c) A parallel paying ladder.

   **Recommend (b).** Every other threshold already pays two or three times, and the 20h balance headroom is about 8.3k XP.

2. **How do Event Legacy milestones relate to event mastery?**
   - (a) Legacy milestones are the `RACE_EVENT` mastery nodes, with new nodes added (edition_25, consecutive_10, hours 25/100/250, Story Complete counts), and the legacy page shows `RaceMastery` plus that tree.
   - (b) XP-free legacy badges beside mastery.
   - (c) Replace mastery.

   **Recommend (a).** It is the only way to avoid duplicating the mechanic, and `ensureMasteryTrees` already back-inserts config-added nodes.

3. **May users rename, merge or split recurring events, and must events be decoupled from "Major event"?**
   - (a) Immutable `key`; rename changes `displayName`; merge re-points races and keeps both trees' unlocks; any race can join an event.
   - (b) Free rename by changing the key.
   - (c) No management UI.

   **Recommend (a).** Re-keying re-pays up to 85k per event today, and the toggle coupling silently erases the event link (`actions.ts:172`).

4. **Which deletes take XP back?**
   - (a) Expedition checkpoints follow the data like Story Complete (revoked when coverage drops, re-earnable once); milestones, legacy nodes and the Expedition Summary stay as landmarks with frozen `achievedAt`.
   - (b) Everything is permanent.
   - (c) Everything follows the data.

   **Recommend (a).** It applies the existing "XP follows the data, landmarks stay earned" rule (`xp-ledger.ts:156-164`), which a test enforces.

5. **Close the delete-and-recreate race exploit in 0.4.0?**
   - (a) `deleteRaceAction` revokes VIEWING/REWATCH (before the cascade), `story-complete:` and `expedition:` rows, then runs `rebuildCareerTotals`.
   - (b) Key new rewards by event and year instead of race id.
   - (c) Leave it.

   **Recommend (a).** It reuses the stint-delete path; otherwise every per-race checkpoint can be farmed without limit.

6. **Which real time counts toward hour milestones, the 336h year and Personal Records?**
   - (a) Raw `realSeconds`.
   - (b) Credited time: `timelineSeconds / max(speed, 0.75)`, capped at 24h per stint.

   **Recommend (b).** It matches the XP guard and stops a single 480-hour stint at 0.1x.

7. **What counts as a completed race or an edition?**
   - (a) Story Complete only; edition year = UTC `raceDate`, falling back to season year; one edition per (event, year).
   - (b) Also count manual `COMPLETED`.
   - (c) Count races per event.

   **Recommend (a).** Manual completion and duplicate-year counting are existing inflation paths (`metrics.ts:187`, `mastery-engine.ts:248`).

8. **Expedition threshold, eligibility and checkpoint XP.**
   - (a) Default to `longHaulThresholdSec` (12h), per-account override with a config floor of at least 6h, per-race on/off; checkpoint pool about 50% of the race's Story Complete band, split across the five checkpoints, paid retroactively when turned on.
   - (b) Flat 150–600 XP per checkpoint.
   - (c) Unbounded threshold.

   **Recommend (a).** Tying the pool to runtime keeps a low threshold or a short race from being a farm; with (a) a 24h race earns about 3,750 XP.

9. **When did a stint happen?**
   - (a) Define the stint window as `[watchedAt − credited realSeconds, watchedAt]`, add no field, and bound `watchedAt` to "now plus slack" on the server.
   - (b) Add an optional "watched at" time to the form (a new nullable column).
   - (c) Build a bulk import.

   **Recommend (a).** Backdating would also need `storyCompletedAt` and the ledger re-dated (`race-engine.ts:87`, `awardXp`), and no real user has data from before 2026-09-22 to import.

10. **Year attribution of XP, levels and backfilled rewards.**
    - (a) Use ledger `createdAt`; backfilled XP is stamped at upgrade time; milestone `achievedAt` is historical.
    - (b) Stamp backfilled rows historically and restamp the ledger.

    **Recommend (a).** Every real ledger row already falls in 2026, and (b) costs a full per-row `rebuildCareerTotals`.

11. **Wrapped: frozen or live?**
    - (a) Year-to-date is live; a completed year is frozen into a snapshot the first time it is viewed after 31 Dec, in machine-local time.
    - (b) Always recompute.
    - (c) Make `User.timezone` authoritative.

    **Recommend (a).** Deletions and time-zone changes would otherwise rewrite a finished year, and nothing reads `timezone` today.

12. **Which number defines "336 hours in a calendar year"?**
    - (a) `BUDGET_CONFIG.annualHours`.
    - (b) That year's editable `BudgetYear.annualBudgetHours`.

    **Recommend (a).** With (b) a user could lower the budget to farm the rung, and the literal 336 must come from config anyway.

13. **Does the upgrade backfill block startup?**
    - (a) Block in `register()`, with a value-compared marker and resumable per-phase work.
    - (b) Run in the background with an "Updating your chronicle" state.

    **Recommend (a).** Today's data is days old and blocking follows the 0.3.1 precedent, but the per-phase markers have to keep each account under the 60 s budget for future 10-year careers.

14. **Naming and navigation.**
    - (a) Nest the new pages: `/races/[id]/expedition`, `/stats?tab=records`, `/career/chronicle` (or a top-level Chronicle), `/mastery/events`. Rename the "Milestones" tab to "Lifetime ladders" and the `expedition` achievement.
    - (b) Four new top-level nav items.

    **Recommend (a).** The nav is already 14 flat items, and the names Milestones and Expedition are already taken.

15. **Wrapped presentation.**
    - (a) Paged and user-advanced in the existing instrument style, auto-opening once per completed year via a `ConfigOverride` flag, with Escape counting as not seen.
    - (b) A full-bleed, auto-advancing slideshow.

    **Recommend (a).** The design brief says "deliberately not a neon gaming UI" (`globals.css:9`), and reduced motion is handled only in CSS.