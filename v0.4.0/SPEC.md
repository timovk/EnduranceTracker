# EnduranceTracker v0.4.0 — Implementation Specification

Status: binding design for the v0.4.0 work packages, **revision 2**. Revision 2 folds in the three reviews (`CRITIQUE-integrity.md`, `CRITIQUE-product.md`, `CRITIQUE-engineering.md`). Every review point was checked against the code; Appendix A records, one line per point, whether it was accepted and why. Where the text below and Appendix A seem to disagree, the text below is the design.

Inputs: `BRIEF.md` (owner's brief and decisions), `SYNTHESIS.md`, `MAPS.json`, and the code of `release/v0.4.0` at the 0.3.2 release (commit `4c59efc`). File:line references were checked against that commit. If a line has moved, find it by the symbol name given. Where this document disagrees with SYNTHESIS.md, this document wins. Where it disagrees with the owner's decisions, the decisions win. In the four places where an example in the brief or in decision D2 would pay one moment twice, the owner's own rule "never twice" wins; §1.2 R4 lists them and WP8 hands them to the owner in plain words (§9.4).

Reference artifacts, written next to this file:

| File | What it is |
|---|---|
| `work/schema.v040.prisma` | The complete target `prisma/schema.prisma`. It passes `prisma validate`. Copy it over the repository schema in WP1. |
| `work/migration.sql` | The exact output of `prisma migrate diff` between the 0.3.2 schema and the target (regenerated for revision 2). It was applied with the real desktop runner (`desktop/src/migrate.ts`) to a copy of the repository's seeded `endurance.db`: only the new migration was applied (11 ms), every row count was unchanged, `foreign_key_check` was empty, `integrity_check` returned ok, a second run applied nothing, and `EXPLAIN QUERY PLAN` shows the FK searches using the new `sessionId` indexes. Script: `verify/run.ts`. |
| `work/econ-model.ts` | The extended economy-balance model used in §7, including the long-race profile and the per-race checkpoint bound. It runs with `./node_modules/.bin/tsx --tsconfig tsconfig.json <path>` from the repository root. |
| `verify/fkbench.cjs` | Deleting a race with 200 stints from the synthetic Large career (60,188 stints, 180,564 ledger rows) with this migration applied: **11.6 ms** (3,266 ms without the `sessionId` indexes). |

Glossary: **stint** = `RaceViewingSession` row. **Event** = `RaceMastery` row (a recurring event). **Edition** = one year of an event. **Landmark** = a recorded moment that is never revoked. **Balance** = XP that follows the data. **Replay** = the career timeline defined in §3.2. **WP** = work package (§10). **Settle** = rebuild the ledger totals after rows were removed (§1.2 R13).

---

## 1. Principles and binding decisions

### 1.1 The owner's decisions, restated

- **D1 — no past-viewing entry.** Do not add a "when did you watch this" field or any import feature. The Chronicle starts from the first real data (22 September 2026). The engine's optional `watchedAt` input stays. `scripts/seed.ts` and the tests use it to backdate stints, so the replay must handle backdated stints correctly.
- **D2 — "A little, never twice".** Genuinely new moments pay modest XP. Moments that already pay today keep paying exactly as now and are never paid a second time by a new system.
- **D3 — Expeditions.** A race of **10 hours or longer** is an Expedition automatically. The user can switch Expedition Mode on or off for **any** individual race. (Checkpoint XP is paid only on races of 6 hours or more; the presentation works for every race. §4.3.1.)
- **D4 — deleting a race takes its XP back.** That means its viewing XP, re-watch XP, Story Complete bonus and expedition XP, exactly as if its stints had been deleted one by one. Totals are then rebuilt. Achievements, milestones and other landmarks already reached stay.

The announced defaults are also binding:

- **A1.** MilestoneProgress plus `config/milestones.ts` is upgraded into Career Milestones rather than duplicated.
- **A2.** Event Legacy is built on `Race.iconicKey` / `RaceMastery` / `RACE_EVENT` trees. Any race can join an event, and joining is decoupled from "Major event". Each event has an immutable key and a separate display name. Rename and merge never pay again.
- **A3.** "XP follows the data, landmarks stay earned." Milestones and Expedition Summaries are permanent. Expedition checkpoint XP follows the data, like the Story Complete bonus: it goes when the viewing (or the race) that earned it is deleted or corrected. **Switching Expedition Mode off is a preference, not a data change, so it never takes XP back** (§4.3.3).
- **A4.** Hours used for milestones and records are credited hours, counted the way XP counts them.
- **A5.** Years follow the computer's local clock. A completed year's chapter is frozen.
- **A6.** New XP is career XP only (`seasonAmount` 0).
- **A7.** Navigation gets new top-level **Chronicle** and **Events** items. Statistics becomes **Career Statistics** with a **Records** tab. Expeditions live on each race's page.
- **A8.** Wrapped is a set of cards the user clicks through, never auto-playing. A year-to-date preview is always available and is clearly marked as incomplete.

### 1.2 Rules every work package obeys

**R1 — Canonical history is the source of truth.**
- The sources are `RaceViewingSession` rows, the `Race` metadata they belong to, and the `XPTransaction` ledger (for XP).
- `WatchedInterval`, the aggregates on `Race`, the `RaceMastery` counters, `Race.creditedViewingSec`, `MasteryProgress.value` and every statistic are **derived**. They must be rebuildable from the sources (§5.5 rebuilds all of them).
- Nothing new reads `RaceViewingSession.newCoverageSeconds`, `coverageBeforeSec` or `coverageAfterSec` for history: they go stale after a delete. (The existing stint summary keeps showing them as the snapshot taken at the time.) Nothing new reads `careerXpAwarded` or `seasonXpAwarded`: they are never written. Nothing new reads `Race.completedAt` either, because it is sticky.

**R2 — XP follows the data, landmarks stay earned** (see `xp-ledger.ts:156-164`).

*Balances* exist exactly when the data says so. When the data stops saying so, they are deleted (never written as a negative) and the ledger is settled (R13):
- VIEWING and REWATCH, per stint (and, for a deleted race, every such row whose `sourceRef` is that race);
- STORY_COMPLETE, `story-complete:<raceId>`;
- **EXPEDITION**, `expedition:<raceId>:<pct>`. Revoked only when coverage (a stint or race deletion) or the race's runtime (an edit) no longer supports it; never by the Expedition Mode switch or a configuration change (§4.3.3).

*Landmarks* are written once and never revoked or re-paid:
- achievements;
- MilestoneProgress rows, including the new career rungs;
- MasteryProgress unlocks, including event steps;
- trophies and Hall of Fame entries;
- `ExpeditionSummary`;
- `ChronicleYear`.

`tests/integration/session-flow.test.ts:501` ("never revokes a landmark, only a balance") keeps passing unchanged.

**R3 — Career-only XP.** Every new `awardXp` call omits `seasonAmount`, so it takes the default 0 (`xp-ledger.ts:60`) and never calls `addSeasonXp`. A test asserts `seasonAmount = 0` for every EXPEDITION row, every new MILESTONE rung, every new event-step row and every Story Complete bonus paid by `reconcileStoryBonus`.

**R4 — Never pay twice.** Each moment has exactly one payer (§7.1).
- Dedupe keys are per account (`@@unique([userId, dedupeKey])`), and every new key is stable across re-balances (it never contains a configurable number).
- Event steps also carry `EventStepCredit` rows, written for **every** unlocked step's current contributors on every mastery sync and before every operation that moves a race between events, so moving, merging or re-creating races cannot re-pay a step (§4.2.5).
- Counted races and editions must be **experienced** (§3.1): a glimpse of a throw-away race counts for nothing that pays.
- When a new system shows a moment that another system already pays, the new system shows it with **0 XP** and names the payer.

The rule overrides four examples from the brief and decision D2. Each is shown, dated and celebrated, with 0 new XP, and §9.4 tells the owner why:
- "first race started" is the same instant as the first stint, which already pays through `sessions:1` and the *Green Flag* achievement ("Log your first viewing session", `achievements.ts:32`);
- "5 / 10 / 25 editions of one event" as a career milestone is paid by that event's own new steps (`experienced_5/10/25`), once per event;
- "2,500 career hours" is paid by *The Archive* (`achievements.ts:50`, 120,000 XP);
- the new event step "First Edition Experienced" pays 0, because a single race placed in an event of its own would otherwise earn a step for a few clicks (§6 row 18).

Two different milestones may fall on the same stint: "{annualHours} hours in {year}" and the lifetime ladder rung `realHours:336` coincide only in a first year that holds every hour of the career. They are different moments (a calendar year versus a lifetime), so both pay.

**R5 — The local-time calendar.**
- All day, week, month and year bucketing uses the Node server process's local time, through `src/lib/domain/calendar.ts` only.
- The week start is `User.weekStart`, with JS `getDay` semantics (0–6; validated by `schemas.ts:211`). Week keys come from `viewingWeek(date, weekStartsOn).key` (`periods.ts:30`), so they agree with the budget engine.
- `User.timezone` stays unused.
- Completed years are frozen in `ChronicleYear` after a grace period (§4.5.2), so a later edit or a time-zone change never rewrites a finished year.

**R6 — The stint instant and window.**
- A stint's **instant** is its `watchedAt`, which the log form sets to "when the stint was logged" (effectively its end).
- Its **nominal window** is `[watchedAt − creditedSeconds, watchedAt]`. Its **window** is the nominal window cut at the previous stint's instant in career canonical order: `[max(watchedAt − credited, previous watchedAt), watchedAt]`. Two stints logged a minute apart (batch logging) therefore never overlap, and every interpolated instant is non-decreasing in canonical order.
- A window is **reliable** when it keeps at least `TIMELINE_SHAPE.reliableWindowShare` (0.5) of the nominal window.
- Facts attached to a stint happen at its instant: race started, race experienced, Story Complete reached, a checkpoint crossed, a session counted, the longest-session record.
- Quantities (credited seconds, new coverage, re-watch) are spread over the window in proportion to time. A zero-length window puts everything on the instant's day.
- The longest possible window is 64 hours: a race is at most 48 h (`schemas.ts:49`), RANGE mode has no real-time cap (`resolveSessionWindow`, `session-engine.ts:61-86`), and credited time is capped at `timeline / 0.75`. This is why a finished year is frozen only after 72 hours (§4.5.2).

**R7 — Credited real seconds** (the single definition, `creditedSeconds()` in §3.2.2):
```
creditedSeconds = max(0, min(realSeconds, round(timelineSeconds / XP_CONFIG.xpMinSpeed)))
```
- It uses the existing XP speed guard constant (`XP_CONFIG.xpMinSpeed = 0.75`, `economy.ts:35`), so it matches the real time XP credits (`progression.ts:200`).
- For every speed of 0.75× or above it equals `realSeconds`.
- It applies to every hour figure introduced in 0.4.0: milestones, the calendar-year rung, records, Chronicle, Career Statistics, Event Legacy and Expedition figures.
- It also applies to `CareerMetrics.realHours`, `longestSessionHours` and `averageSessionMinutes`, to mastery `realHours` (through `Race.creditedViewingSec`), and to the race page's "Real viewing" figure, so every screen shows one number for one idea.
- The viewing budget keeps raw `realSeconds`, because it measures time actually spent (§4.4.7).

**R8 — Determinism.**
- Canonical order is `(watchedAt asc, createdAt asc, id asc)`, used everywhere.
- In records, ties go to the earliest holder: a later value must be strictly greater to replace it.
- No `Math.random` anywhere (design rule).
- Wrapped card order is fixed.

**R9 — Time inputs.**
- Engines take `now` and never read the clock. Only pages, server actions and the start-up upgrade code (`src/lib/server/upgrades/*`, which owns the start-up deadline) read the clock.
- `logViewingSession` rejects `input.watchedAt > now + TIMELINE_SHAPE.futureWatchedAtSlackMinutes` with an `InvalidStintError`.
- Backdated stints stay accepted through the engine API (D1). The form still has no field for them.

**R10 — Design-rule compliance** (see `tests/domain/design-rules.test.ts`):
- The literal `336` is banned. Use `BUDGET_CONFIG.annualHours`.
- The literal `1.35` is banned.
- Never write `data: {… unlockedAt|awardedAt|completedAt: null}`.
- Trophies and Hall of Fame entries are never deleted.
- Every new engine file imports `@/lib/config`.
- Every new page calls `requireUserId()` and exports `dynamic = 'force-dynamic'`.
- Components never import the database client or `awardXp`.
- No forbidden phrases in user-visible strings. Use "still to watch", never "missed". Budget copy is neutral and never says "exceeded". WP2 extends the forbidden-phrase scan to `src/lib/server` (`SERVER_FILES`), because the new action messages live there.
- New tone functions are registered in `tests/domain/periods-tone.test.ts` `everyUserFacingString()`.
- UI traps: `text-base` sets a colour, so use `text-[1rem]`. `cn()` drops the `text-timing`/`text-label` sizes, so put them in raw `className` strings. An accent-tinted surface uses `accentVars(color)` (§4.7.2), which sets both `--accent` and `--accent-soft`. Recharts elements never pass `isAnimationActive={true}`: the default `'auto'` is what honours reduced motion (`recharts/lib/animation/JavascriptAnimate.js:44-45`).

**R11 — Data safety.**
- The migration only adds nullable columns, new tables and indexes.
- The upgrade never modifies a stint. Its writes to existing race rows are: filling `creditedViewingSec`; the `raceMasteryId` link maintenance that `recomputeRaceMasteries` already does; and, only for a legacy race whose stored intervals run past its current runtime (a runtime shortened under 0.3.x), rebuilding its derived intervals and coverage aggregates **with its status kept** (§5.2 P1).
- The upgrade does not remove XP that races deleted under 0.3.x left behind (orphaned viewing rows, `story-complete:` of a missing race). It counts and logs them; `db:recompute` removes them, as it does today (`repairXpLedger`).
- Every upgrade step is idempotent and runs in bounded transactions (§5).
- The desktop's pre-update `VACUUM INTO` snapshot runs before migrations (`desktop/src/main.ts:130-146`).
- A `MilestoneProgress` or `MasteryProgress` landmark date is written only while `achievedPrecision` is null: `updateMany({ where: { id, userId, achievedPrecision: null } })`.

**R12 — Account isolation.**
- Every new table has `userId` with `onDelete: Cascade`.
- Every read and write is scoped by `userId`, including every aggregate of the cache fingerprint (§3.2.9) and every `mergedIntoId` hop (`findFirst({ where: { id, userId } })`, because that column has no foreign key).
- Every entity id from the browser (race id, event key, year, summary id) is resolved inside the account (`findFirst({ where: { id, userId } })`) before use.
- Caches are keyed by `userId`.

**R13 — One way to settle the ledger.** Every transaction that deletes an `XPTransaction` row ends with `settleLedger(tx, userId, revocations)` (§3.2.10): a batched `rebuildCareerTotals` from the earliest removed row, plus `rebuildSeasonXpFromLedger` only when the removed rows carried season XP. It runs after the last award of the transaction, so any award made after a removal is re-stamped too. This makes invariant I2 (career XP equals the ledger sum) structural rather than a per-caller duty. `awardXp` itself is unchanged.

### 1.3 Performance targets

"Large" means the synthetic career in `tests/perf/` (§8.1): 10 years, 5,000 races, 60,000 stints and 180,000 ledger rows. "Real" means ≤ 3,000 stints. The DB part of the harness is built in WP2, and each later WP adds its hot paths (§10).

| Operation | Real | Large (cold / warm) |
|---|---|---|
| `buildCareerTimeline` (pure) | < 50 ms | < 1,500 ms |
| `logViewingSession` (whole transaction) | < 1 s | < 6 s (the transaction timeout is 60 s) |
| `deleteViewingSession`, a stint from year 1 | < 1 s | < 10 s |
| `deleteRace`, a race from year 1 with 200 stints | < 1 s | < 10 s |
| `deleteRace` / `deleteViewingSession`, a subject from the last month | < 1 s | < 2 s |
| `setExpeditionModeAction` (never revokes) | < 500 ms | < 2 s |
| Event actions (link, unlink, merge, rename) | < 1 s | < 6 s |
| `/chronicle` index (20 frozen years) | < 300 ms | < 500 ms |
| `/chronicle/[year]`, year to date | < 800 ms | < 4 s / < 1 s |
| `/chronicle/[year]`, frozen | < 300 ms | < 500 ms |
| `/stats`, core tabs | < 1 s | < 5 s / < 1.5 s |
| `/stats?tab=records` or `compare` | < 1 s | < 5 s / < 2 s |
| `/events/[key]` | < 500 ms | < 3 s / < 800 ms |
| `/races/[id]/expedition` | < 500 ms | < 1 s (reads one race's stints) |
| Upgrade backfill | < 5 s per account | each chunk < 5 s; everything shares a 30 s start-up budget and resumes on the next start (§5) |

Where the Large figures come from:
- The FK-driven child scans on stint deletion are served by the new `sessionId` indexes (11.6 ms to delete a 200-stint race, `verify/fkbench.cjs`).
- A full ledger re-stamp of 180,564 rows takes 29.6 s with one UPDATE per row and **6.9 s** with batched `CASE` updates of 400 rows (`eng/ledger-bench.ts`, `eng/batch-bench.ts`). R13's batched, from-the-earliest-row settle is therefore required, not optional.

"Warm" means the career-timeline cache (§3.2.9) was hit. No page loads the whole database into React: every page gets pre-aggregated view models from `src/lib/engines` or `src/lib/server`.

---

## 2. Data model changes

### 2.1 Prisma schema diff

Apply the diff below to `prisma/schema.prisma`; `work/schema.v040.prisma` is the result. Doc comments are part of the change.

```diff
 enum XPSource {
   …
   HALL_OF_FAME
   MANUAL_ADJUSTMENT
+  /// Race Expedition checkpoint (0.4.0). Career XP only; seasonAmount is always 0.
+  EXPEDITION
 }
+
+/// How exactly a landmark's `achievedAt` is known (0.4.0).
+///   INTERPOLATED  a running total crossed its threshold inside a stint; the
+///                 instant is interpolated along that stint's wall-clock window.
+///   STINT         a count reached its threshold with a stint; the instant is
+///                 that stint's `watchedAt`.
+///   RECOGNISED    history cannot say when; the date shown is when the app
+///                 recorded it (`reachedAt` / `unlockedAt`).
+enum MilestonePrecision {
+  INTERPOLATED
+  STINT
+  RECOGNISED
+}

 model User {
   …
   raceMasteries     RaceMastery[]
   configOverrides   ConfigOverride[]
+  expeditionSummaries ExpeditionSummary[]
+  chronicleYears      ChronicleYear[]
+  eventStepCredits    EventStepCredit[]
 }

 model Race {
   …
   storyCompletedAt  DateTime?
+  /// Sum of credited real seconds over this race's stints (0.4.0). A cache,
+  /// rebuilt by recomputeRaceAggregates; null only until the 0.4.0 upgrade
+  /// has filled it. See creditedSeconds() in domain/career-timeline.
+  creditedViewingSec Int?
+
+  /// Expedition Mode (0.4.0): null = automatic by runtime, true = switched on,
+  /// false = switched off. The user's choice, so it is persisted.
+  expeditionMode Boolean?
   …
   raceMastery     RaceMastery?         @relation(fields: [raceMasteryId], references: [id], onDelete: SetNull)
+  expeditionSummaries ExpeditionSummary[]
   …
   @@index([userId, raceDate])
+  @@index([userId, raceMasteryId])
   @@map("races")
 }

 model WatchedInterval {
   …
   @@index([raceId, startSec])
+  /// 0.4.0. Serves SQLite's ON DELETE SET NULL search when a stint is deleted.
+  @@index([sessionId])
   @@map("watched_intervals")
 }

 model RaceMastery {
   …
   longestConsecutiveEditions Int @default(0)
+
+  // -- Event Legacy (0.4.0). `key` is the event's permanent identity and is
+  // never rewritten; everything the user can change lives below.
+  /// The user's name for the event. Null = `name` (derived from the key).
+  displayName   String?
+  /// True when the user created the event on the Events page.
+  createdByUser Boolean?
+  /// Hidden from the Events list. Only an event with no races can be archived.
+  archivedAt    DateTime?
+  /// Set when this event was merged into another; its races now belong there.
+  mergedIntoId  String?
   …
 }

 model XPTransaction {
   …
   @@index([userId, source])
+  /// 0.4.0. Leftmost `sessionId` on purpose: SQLite's ON DELETE SET NULL
+  /// searches this table by sessionId for every deleted stint, and only an
+  /// index that starts with the FK column serves that search. It also serves
+  /// the per-stint revocations and the Expedition Summary XP sums.
+  @@index([sessionId])
   @@map("xp_transactions")
 }

 model MilestoneProgress {
   …
   xpAwarded Int @default(0)
+
+  // -- Career Milestones (0.4.0). Written once, when achievedPrecision is
+  // null, and never again: a milestone keeps its date whatever happens to the
+  // history later. No foreign keys on purpose — a landmark outlives the stint,
+  // race or event it points at.
+  achievedAt        DateTime?
+  achievedPrecision MilestonePrecision?
+  sessionId         String?
+  raceId            String?
+  eventId           String?
+  /// Race or event name at the moment it was reached, for when it is gone.
+  subjectName       String?
   …
 }

 model MasteryProgress {
   …
   unlockedAt DateTime?
+
+  /// Event Legacy steps (0.4.0): when the step was reached in viewing history.
+  /// Same write-once rule as MilestoneProgress.
+  achievedAt        DateTime?
+  achievedPrecision MilestonePrecision?
+  achievedSessionId String?
   …
 }

+// ===========================================================================
+// Career history (0.4.0)
+// ===========================================================================
+
+/// The permanent record of a completed Race Expedition. Written once, the
+/// first time a stint, the upgrade, recompute or switching Expedition Mode on
+/// finds the race Story Complete while it is an Expedition, and never
+/// rewritten. Survives the race being deleted (raceId SetNull).
+model ExpeditionSummary {
+  id     String @id @default(uuid())
+  userId String
+  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+  raceId   String?
+  race     Race?   @relation(fields: [raceId], references: [id], onDelete: SetNull)
+  raceName String
+
+  /// Wall-clock start of the first stint, and `watchedAt` of the completing stint.
+  startedAt   DateTime
+  completedAt DateTime
+  /// True when written after the fact (the 0.4.0 upgrade, recompute,
+  /// Expedition Mode switched on later) rather than by a stint.
+  retrospective Boolean @default(false)
+  schemaVersion Int
+  /// ExpeditionSummarySnapshotV1 — see src/lib/domain/expedition.ts.
+  snapshot      Json
+
+  createdAt DateTime @default(now())
+
+  @@unique([userId, raceId])
+  @@index([userId, completedAt])
+  /// Serves SQLite's ON DELETE SET NULL search when a race is deleted.
+  @@index([raceId])
+  @@map("expedition_summaries")
+}
+
+/// A completed calendar year of the Career Chronicle, frozen. The current
+/// year is never stored: it is derived on every read.
+model ChronicleYear {
+  id     String @id @default(uuid())
+  userId String
+  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+  year          Int
+  schemaVersion Int
+  /// ChronicleChapterV1 — see src/lib/domain/chronicle.ts.
+  snapshot      Json
+  frozenAt      DateTime
+  /// Set only when the user explicitly rebuilt the chapter.
+  rebuiltAt     DateTime?
+  /// When the year's Endurance Wrapped was clicked through to its last card.
+  wrappedSeenAt DateTime?
+
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+
+  @@unique([userId, year])
+  @@map("chronicle_years")
+}
+
+/// "This race has already helped pay this kind of event step" (0.4.0).
+/// Stops the same editions paying the same Event Legacy step twice when races
+/// are moved between events, events are merged, or a race is deleted and added
+/// again. raceId has no foreign key on purpose: the credit must outlive the race.
+model EventStepCredit {
+  id     String @id @default(uuid())
+  userId String
+  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+  /// A RACE_EVENT mastery node key, e.g. "edition_5".
+  nodeKey  String
+  raceId   String
+  /// The event whose step it helped pay (audit only).
+  eventKey String
+  /// Set when the race is deleted: the edition's fingerprint (year, rounded
+  /// hours, circuit slug, name signature) as JSON — see domain/edition.ts.
+  fingerprint String?
+
+  createdAt DateTime @default(now())
+
+  @@unique([userId, nodeKey, raceId])
+  @@map("event_step_credits")
+}
```

Why the design is shaped this way:

**Nullable columns only.**
- A NOT NULL column with a default on `races` makes Prisma generate a RedefineTables. Verified: that is a full copy of `races`, with FK cascades in play.
- `expeditionMode Boolean?` encodes "automatic" as null, so no default is needed.

**No foreign keys on the new columns of existing tables.**
- Adding a relation column to an existing SQLite table also forces a RedefineTables. Verified with `prisma migrate diff`.
- The provenance pointers (`sessionId`, `raceId`, `eventId`, `achievedSessionId`, `mergedIntoId`) are plain strings, which is correct for landmarks that outlive their subject.
- New tables may have foreign keys, because they are created, not redefined.

**Per-year rungs encode the year in `MilestoneProgress.metric`** (`realHoursYear:2027`), so the existing `@@unique([userId, metric, threshold])` still holds. Widening it would need a DROP INDEX, which this migration does not allow. "Already reached" for a year is decided by the metric alone, so a future change to `BUDGET_CONFIG.annualHours` can never create a second row for the same year (§4.1.3).

**No new index on `races.storyCompletedAt`.** No 0.4.0 query filters on it: Story Complete instants come from the replay.

**Every foreign-key child column has an index that starts with it.** better-sqlite3 opens connections with `foreign_keys = 1`, so every `ON DELETE SET NULL`/`CASCADE` makes SQLite search the child table by the FK column. A composite index whose leftmost column is `userId` cannot serve that search. The rule gives:
- `xp_transactions(sessionId)` and `watched_intervals(sessionId)`: deleting a stint (and a race's cascade of stints). It also serves `revokeSessionsXp` and the Expedition Summary XP sums.
- `expedition_summaries(raceId)`: deleting a race.

**The other new indexes each back a specific query:**
- `races(userId, raceMasteryId)`: the editions of an event, and the event page.
- `expedition_summaries(userId, completedAt)`: the chapter's Expeditions section.
- `event_step_credits` needs only its unique index: its `(userId, …)` prefix serves the one read (`findMany({ where: { userId } })`).

**Enum values are stored as TEXT without a CHECK constraint.** Adding `EXPEDITION` needs no SQL.

### 2.2 The migration (exactly one)

- Directory: `prisma/migrations/20260924120000_career_history/migration.sql`. It sorts after `20260922203126_xp_dedupe_per_account`.
- Content: exactly `work/migration.sql`, reproduced below. To verify it, run `git show 4c59efc:prisma/schema.prisma > "$TMPDIR/schema-0.3.2.prisma"`, then `./node_modules/.bin/prisma migrate diff --from-schema "$TMPDIR/schema-0.3.2.prisma" --to-schema prisma/schema.prisma --script`, and check that it prints the same statements. Never use `npx prisma` (`docs/releasing.md:77`). Never hand-edit the file after the first commit, because the checksum is recorded (`desktop/src/migrate.ts:132`).
- It uses only `ALTER TABLE … ADD COLUMN` (nullable), `CREATE TABLE`, `CREATE INDEX` and `CREATE UNIQUE INDEX`. There is no RedefineTables, no data backfill, no PRAGMA and no VACUUM.
- `DEFAULT CURRENT_TIMESTAMP` appears only on `createdAt` of the three new tables. Prisma is emitting the same pattern it used in `20260922181417_init`. Prisma always supplies these values itself, as ISO text `YYYY-MM-DDTHH:MM:SS.sss+00:00` through the adapter, so the SQL default is never used. No SQL in this release writes a date.

```sql
-- AlterTable
ALTER TABLE "races" ADD COLUMN "creditedViewingSec" INTEGER;
ALTER TABLE "races" ADD COLUMN "expeditionMode" BOOLEAN;

-- AlterTable
ALTER TABLE "race_masteries" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "race_masteries" ADD COLUMN "createdByUser" BOOLEAN;
ALTER TABLE "race_masteries" ADD COLUMN "displayName" TEXT;
ALTER TABLE "race_masteries" ADD COLUMN "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "milestone_progress" ADD COLUMN "achievedAt" DATETIME;
ALTER TABLE "milestone_progress" ADD COLUMN "achievedPrecision" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "eventId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "raceId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "subjectName" TEXT;

-- AlterTable
ALTER TABLE "mastery_progress" ADD COLUMN "achievedAt" DATETIME;
ALTER TABLE "mastery_progress" ADD COLUMN "achievedPrecision" TEXT;
ALTER TABLE "mastery_progress" ADD COLUMN "achievedSessionId" TEXT;

-- CreateTable
CREATE TABLE "expedition_summaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "raceId" TEXT,
    "raceName" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "retrospective" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expedition_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expedition_summaries_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chronicle_years" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "frozenAt" DATETIME NOT NULL,
    "rebuiltAt" DATETIME,
    "wrappedSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chronicle_years_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_step_credits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "fingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_step_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "expedition_summaries_userId_completedAt_idx" ON "expedition_summaries"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "expedition_summaries_raceId_idx" ON "expedition_summaries"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "expedition_summaries_userId_raceId_key" ON "expedition_summaries"("userId", "raceId");

-- CreateIndex
CREATE UNIQUE INDEX "chronicle_years_userId_year_key" ON "chronicle_years"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "event_step_credits_userId_nodeKey_raceId_key" ON "event_step_credits"("userId", "nodeKey", "raceId");

-- CreateIndex
CREATE INDEX "races_userId_raceMasteryId_idx" ON "races"("userId", "raceMasteryId");

-- CreateIndex
CREATE INDEX "watched_intervals_sessionId_idx" ON "watched_intervals"("sessionId");

-- CreateIndex
CREATE INDEX "xp_transactions_sessionId_idx" ON "xp_transactions"("sessionId");
```

No unique index can be violated by existing data: every unique index is on a brand-new, empty table.

### 2.3 Persisted versus derived

| State | Kind | Why |
|---|---|---|
| `Race.expeditionMode` | Persisted user choice | The per-race override (D3) cannot be derived. |
| `Race.creditedViewingSec` | Persisted cache | Mastery trees measure credited hours per stint from race rows (`mastery-engine.ts:389-398`). Without the column, every stint would need a second full session scan. `recomputeRaceAggregates` rebuilds it. |
| `RaceMastery.displayName`, `createdByUser`, `archivedAt`, `mergedIntoId` | Persisted user metadata | Renames, created events, archives and merges are user decisions. `key` stays the immutable identity. |
| `MilestoneProgress.achievedAt`, `achievedPrecision`, `sessionId`, `raceId`, `eventId`, `subjectName` | Persisted landmark facts | A milestone keeps its date even if the history is later edited (A3). The replay would drift, so the date must be stored. |
| `MasteryProgress.achievedAt`, `achievedPrecision`, `achievedSessionId` | Persisted landmark facts | The same rule, for Event Legacy steps. |
| `ExpeditionSummary` | Persisted snapshot | "A permanent Expedition Summary". Its figures would change if stints were later deleted, so it must be frozen. |
| `ChronicleYear` | Persisted snapshot plus `wrappedSeenAt` | A finished year must not be rewritten by later edits or a time-zone change (A5). |
| `EventStepCredit` | Persisted anti-double-pay memory | It must survive race moves, merges and deletions (§4.2.5). |
| `XPTransaction` rows with source EXPEDITION, the new MILESTONE rungs and the new MASTERY_NODE steps | Ledger | This is the XP source of truth. |
| `ConfigOverride` key `careerBackfill` | Persisted | The upgrade's progress: JSON `{ version: '0.4.0', done: PhaseKey[], cursors: { P1?: string; P4?: string }, lastRunAt: string }` (§5.1). |
| `ConfigOverride` key `dismissedEventSuggestions` | Persisted | Per-account UI state: a JSON array of suggestion ids, at most 500. |
| The career timeline (replay), all statistics, records, the year-to-date chapter, Wrapped cards, Event Legacy figures, live Expedition figures, suggestions, year comparisons, the career-year number and "since beaten" notes | **Derived on read** | All of these are deterministic folds over the canonical history. The replay is cached in memory, keyed by a data fingerprint (§3.2.9), never in the database. |

### 2.4 Type mirrors

In `src/lib/domain/types.ts`:
- add `'EXPEDITION'` to the `XPSource` union (`types.ts:21-24`);
- add `export type MilestonePrecision = 'INTERPOLATED' | 'STINT' | 'RECOGNISED';`.

Both must match the Prisma enums, and a test asserts it (§8.3, `config.test.ts` addition).

### 2.5 Desktop migration tests

`tests/desktop/migrate.test.ts:147`: change `expect(EXPECTED_TABLES.length).toBe(28)` to `toBe(31)`. `EXPECTED_TABLES` is already read from the `@@map` lines of the schema. Add a comment naming the three new tables.

Add `tests/desktop/migrate-040.test.ts` (real SQLite, the runner in `desktop/src/migrate.ts`, no Prisma):

1. `'applies 0.4.0 to a 0.3.2 database without losing a row'`.
   - Apply only the three existing migrations to a fresh file, using the "first only" pattern at `migrate.test.ts:274-292`.
   - Insert a 0.3.2-shaped career with raw SQL, using ISO `+00:00` text dates: one user; a career profile; a championship and season; three races (one with `iconicKey = 'le-mans-24'`, one 24h); six sessions; merged intervals; eight XP rows including `story-complete:<id>` and `milestone:realHours:1`; two `milestone_progress` rows; one `race_masteries` row; one mastery tree with a node and a progress row; and the `config_overrides` `seasonReset` and `lastSeenVersion`.
   - Run `runMigrations(file, MIGRATIONS)`.
   - Assert:
     - the applied list is `['20260924120000_career_history']`;
     - every table's row count is unchanged;
     - the new columns exist and are NULL on every old row;
     - the three new tables exist and are empty;
     - `PRAGMA foreign_key_check` returns `[]`;
     - `PRAGMA integrity_check` returns `ok`;
     - the indexes `races_userId_raceMasteryId_idx`, `xp_transactions_sessionId_idx`, `watched_intervals_sessionId_idx` and `expedition_summaries_raceId_idx` exist;
     - `EXPLAIN QUERY PLAN SELECT 1 FROM xp_transactions WHERE sessionId = ?` (and the same for `watched_intervals`) uses the `sessionId` index.
2. `'is a no-op the second time'`. Run the migrations again and assert `applied` is `[]`.
3. `'uses only additive statements'`.
   - Read the 0.4.0 `migration.sql`, remove every line that starts with `--`, and split the rest on `;` into trimmed, non-empty statements.
   - Assert every statement matches `/^(ALTER TABLE "\w+" ADD COLUMN|CREATE TABLE|CREATE (UNIQUE )?INDEX)/`.
   - Assert no statement matches `/^\s*(DROP|INSERT|UPDATE|DELETE|PRAGMA|VACUUM)\b/im` (the foreign keys' `ON UPDATE CASCADE` inside `CREATE TABLE` is therefore allowed).
   - Assert no `ADD COLUMN` statement contains `NOT NULL`.

The upgrade of data that the real 0.3.2 code wrote is tested separately, against a committed fixture, in `tests/integration/upgrade-from-0.3.2.test.ts` (§8.2, created in WP1 and extended by WP3, WP4, WP5 and WP7).

### 2.6 Compatibility notes (for the docs)

- A database that 0.4.0 has written to may not be readable by 0.3.2: an `XPTransaction` row with `source = 'EXPEDITION'` is an enum value the old client cannot parse. (The new columns and tables are invisible to 0.3.2, whose client never selects them.) Going back means restoring the pre-update snapshot `backups/pre-update-0.4.0-<date>.db`.
- Restoring any older backup into 0.4.0 is safe. The migration is applied, and the upgrade runs again because the marker is missing or incomplete.

---

## 3. Shared domain foundation

### 3.1 Definitions

These are used verbatim by code, docs and tests.

| Term | Definition |
|---|---|
| **Canonical order** | Stints sorted by `watchedAt` asc, then `createdAt` asc, then `id` asc (`compareCanonical`). Every replay and every "which stint crossed it" question uses this order. `deleteViewingSession`'s interval rebuild switches to it too. The merged set does not depend on order, so its result is unchanged. |
| **Credited seconds** | See R7. `creditedSeconds({realSeconds, timelineSeconds})`. |
| **Stint instant / window** | See R6. `nominalStartsAt = watchedAt − creditedSeconds·1000 ms`; `startsAt = max(nominalStartsAt, previous stint's watchedAt)` in career canonical order; `endsAt = watchedAt`; `windowReliable = (endsAt − startsAt) ≥ reliableWindowShare × credited`. |
| **Coverage (replay)** | Per race, stints are folded in canonical order with the existing `addInterval(existing, {start, end}, { limit: race.runtimeSec, gapTolerance: STORY_CONFIG.gapToleranceSeconds })` (`intervals.ts:72-88`). `limit` is the race's **current** runtime, which is the runtime clamp: timeline beyond the runtime counts neither as coverage nor as re-watch. A stint's `addedCoverageSeconds` is the `addedSeconds` of that call. **Invariant:** the added coverage of a race's stints sums to its final replay coverage. The 20 s gap tolerance is the same one Story Complete uses, so the replay agrees with the race page. |
| **Story Complete / race completed** | A race is completed if and only if its replay coverage satisfies the existing `isStoryComplete(intervals, runtimeSec, STORY_CONFIG thresholds)` (`intervals.ts:177`), with intervals already clamped. Its **completion instant** is the `watchedAt` of the first stint, in canonical order, after which that holds. Replay coverage never decreases, so the instant is unique. "Races completed" and "Story Completes" are the same number everywhere in 0.4.0, and the UI shows it once, labelled "Races completed (Story Complete)". |
| **Manual `COMPLETED` status** | A library label meaning "I consider this done". In 0.3.2 no screen can set it: `setRaceStatusAction` (`actions.ts:246`) has no caller and the Add Race status list omits it (`add-race-form.tsx:232-238`); the engine sets `COMPLETED` itself when a story completes (`deriveStatus`, `race-engine.ts:142`). Where a legacy row carries it, it still counts where it counts today: `CareerMetrics.racesCompleted` (`metrics.ts:187`), collections and circuits, because "moments that already pay keep paying exactly as now". It counts in **no** 0.4.0 figure: Chronicle, Career Statistics, Records, Event Legacy, Expeditions or the new Career Milestone rungs. The README says this in one sentence, so the owner knows why "races completed" and "Story Completes" are one number. |
| **Race started** | A race with at least one stint. Its **start instant** is its first stint's `watchedAt` (R6); the Expedition start date shown is that stint's `startsAt`. **Races started in a period** = races whose first stint's instant falls in the period. |
| **Race experienced** | A race whose replay has reached both: credited seconds ≥ `CAREER_STATS_SHAPE.experiencedMinimumCreditedMinutes` (10) × 60, **and** coverage ≥ `min(ceil(runtimeSec × experiencedCoverageShare), experiencedCoverageEnoughMinutes × 60)` (10% of the race, or one hour for races over 10 h). Its **experienced instant** is the `watchedAt` of the first stint, in canonical order, after which both hold. The same predicate is `isRaceExperienced({ coverageSec, runtimeSec, creditedSec })` in `career-timeline.ts`, so race rows (mastery, metrics) and the replay agree. A glimpse of a race is "started" but not "experienced"; nothing that pays XP counts started-only races. |
| **Races experienced (period)** | Distinct races with at least one stint whose `watchedAt` is in the period **and** whose experienced instant is at or before the period's end. Lifetime: all experienced races. |
| **Races watched (period)** | Distinct races with at least one stint whose `watchedAt` is in the period. Used only as the denominator of completion percentages, never shown as a count. |
| **Edition year** | `editionYear(race) = raceDate !== null ? raceDate.getUTCFullYear() : season?.year ?? null`. The UTC parts are used because `raceDate` is stored as UTC midnight of the typed day (`race-day.ts:1-12`). This fixes the local `getFullYear()` used at `metrics.ts:209` and `mastery-engine.ts:358-362`. |
| **Edition identity** | `` year !== null ? `${year}` : `race:${id}` ``. Two races of one event in the same year are **one** edition, which fixes `mastery-engine.ts:248-256` and `metrics.ts:208-236`. An undated race is its own edition: it is counted, but it cannot join a consecutive run. |
| **Editions experienced / Story Complete** | For an event: the distinct edition identities among its experienced races, and among its races that are Story Complete in the replay. |
| **Consecutive complete editions** | The longest run of consecutive **dated** edition years with at least one Story Complete race. This is the existing node semantics (`consecutive_3/5`). The Event Legacy page also shows the longest run of consecutive experienced editions, for information only; neither is ever shown as a live "current streak". |
| **Rewatch seconds (per stint)** | `timelineInRuntime = max(0, min(end, runtime) − min(start, runtime))`. Then `rewatch = timelineSeconds > 0 ? credited × max(0, timelineInRuntime − min(added, timelineInRuntime)) / timelineSeconds : 0`. |
| **New (unique) coverage in a period** | The sum of `addedCoverageSeconds`, spread over the stint windows. This is the story seen for the first time in that period. |
| **Completion percentage (set)** | Runtime-weighted: `100 × Σ min(coverageAt(periodEnd), runtime) / Σ runtime` over the races watched in the scope. It is null when the denominator is 0. It is shown in the Chronicle and Wrapped. |
| **Average race completion** | The unweighted mean of per-race completion percentage (`coverageAt(periodEnd) / runtime`) over the races watched in the scope. It is shown in Statistics. |
| **Story Complete rate (period)** | `|races started in the period that are Story Complete by the period's end| / |races started in the period|`. Lifetime: Story Completes / races started (a subset, so never above 100%). Shown only when the denominator is at least `CAREER_STATS_SHAPE.rateMinimumRaces` (5), with the wording "Of the races you started in {year}, N% are complete stories". |
| **Active day** | A local day with more than 0 credited seconds after splitting stint windows across midnight. |
| **Long race** (records) | Runtime ≥ `EXPEDITION_SHAPE.autoThresholdHours`, which is 10 h, by runtime alone. It does not depend on the Expedition toggle. |
| **Meaningful session** | Credited seconds ≥ `CAREER_STATS_SHAPE.meaningfulSessionMinutes` (10) × 60. |
| **Duration class** | The first entry of `DURATION_CLASSES` (§3.3) whose `maxHours` is above the runtime in hours. Labels describe what the band holds ("Up to 3 hours", "4 hours", "6 hours", "8 hours", "10 hours", "12 hours", "13 to 20 hours", "24 hours"), so a 10-hour race is a "10 hours" race. It is exposed as `durationClassOf(runtimeSec)` in `window-summary.ts` and used by every length breakdown and by the Statistics length filter, so one page never shows two length taxonomies. It is unrelated to the Story Complete bonus bands, which stay as they are. |

### 3.2 Modules

Pure modules live in `src/lib/domain/` and do no database I/O. They may import `@/lib/config` for defaults, as `progression.ts` does. Database modules live in `src/lib/engines/` (which must import `@/lib/config`) or `src/lib/server/`. Json snapshot shapes are declared as zod schemas with `type X = z.infer<typeof xSchema>` (never `interface`), because a Prisma `Json` input needs the implicit index signature of a type alias; this is also the repository convention (`awards-engine.ts:77-81`).

#### 3.2.1 `src/lib/domain/calendar.ts` (new, pure)

This is the only local-time bucketing code in 0.4.0.

```ts
export interface LocalWindow { start: Date; end: Date }            // half-open [start, end)
export function localDayKey(at: Date): string;                      // 'YYYY-MM-DD' from local parts
export function localMonthKey(at: Date): string;                    // 'YYYY-MM'
export function dayKeyToLocalDate(key: string): Date;               // local midnight of that day
export function yearWindow(year: number): LocalWindow;              // new Date(y,0,1) → new Date(y+1,0,1)
export function monthWindow(year: number, month1to12: number): LocalWindow;
export function isLeapYear(year: number): boolean;
export function daysInYear(year: number): number;                   // 365 | 366
export function weekKeyForDay(dayKey: string, weekStartsOn: number, memo?: Map<string, string>): string;
export function weekLabel(weekKey: string, weekStartsOn: number, clipTo?: LocalWindow): { label: string; start: Date; end: Date; clipped: boolean };
export interface TimeSlice { dayKey: string; fraction: number }     // fractions of one stint sum to 1
export function splitAcrossLocalDays(startsAt: Date, endsAt: Date): TimeSlice[];
export function clipToWindow(startsAt: Date, endsAt: Date, window: LocalWindow): { startsAt: Date; endsAt: Date; fraction: number } | null;
export function samePeriodEnd(targetYear: number, reference: Date): Date; // same month/day/time in targetYear; 29 Feb → 28 Feb 23:59:59.999
export function localTimeZoneName(): string;                        // Intl.DateTimeFormat().resolvedOptions().timeZone
```

Invariants:
- `splitAcrossLocalDays` walks local midnights with `new Date(y, m, d + 1)`. It never adds 86,400,000 ms, so DST days of 23 or 25 hours split correctly.
- A zero-length window (credited 0, or a window cut to nothing by R6) returns `[{ dayKey: localDayKey(endsAt), fraction: 1 }]`.
- `weekKeyForDay` returns `viewingWeek(dayKeyToLocalDate(key), weekStartsOn).key` (`periods.ts:30`). It is memoised per day key; the memo cuts ~300 ms to ~45 ms per 60,000 rows, as measured in MAPS.
- `weekLabel(…, clipTo)` clips the label to the window, so a chapter's most active week that straddles New Year reads "Mon 29 – Wed 31 Dec" and sets `clipped: true` (the chapter then adds "the days in 2026").
- `stats-engine.ts` `localDayKey`/`yearWindow` are deleted and re-exported from here, so there is exactly one definition. Do **not** use `dayPeriod().key` (`periods.ts:54`), which is UTC.

#### 3.2.2 `src/lib/domain/career-timeline.ts` (new, pure) — the canonical career replay

```ts
export interface TimelineSessionRow {
  id: string; raceId: string;
  startTimestampSec: number; endTimestampSec: number;
  playbackSpeed: number; timelineSeconds: number; realSeconds: number;
  watchedAt: Date; createdAt: Date;
}
export interface TimelineRaceRow {
  id: string; name: string; runtimeSec: number; scheduledDurationSec: number;
  raceDate: Date | null; seasonYear: number | null; editionYear: number | null; // editionYear precomputed by the loader
  championshipId: string | null; championshipName: string | null; championshipAccent: string | null;
  eventId: string | null; eventKey: string | null; eventName: string | null;     // RaceMastery id, key, displayName ?? name
  circuit: string | null; circuitSlug: string | null; country: string | null;
  raceType: RaceType; isMajorEvent: boolean; expeditionMode: boolean | null;
}
export interface TimelineOptions {
  gapToleranceSeconds: number;                                      // STORY_CONFIG.gapToleranceSeconds
  storyThresholds: { coverageRatio: number; maxUncoveredSeconds: number };
  xpMinSpeed: number;                                               // XP_CONFIG.xpMinSpeed
  experienced: { minimumCreditedSeconds: number; coverageShare: number; coverageEnoughSeconds: number };
  reliableWindowShare: number;                                      // TIMELINE_SHAPE.reliableWindowShare
}
export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions;

export function creditedSeconds(row: { realSeconds: number; timelineSeconds: number }, xpMinSpeed?: number): number;
export function isRaceExperienced(race: { coverageSec: number; runtimeSec: number; creditedSec: number }, options?: TimelineOptions['experienced']): boolean;
export function compareCanonical(a: { watchedAt: Date; createdAt: Date; id: string }, b: typeof a): number;

export interface StintEvent {
  sessionId: string; raceId: string;
  ordinal: number;            // 0-based position in the career's canonical order
  raceOrdinal: number;        // 0-based position within its race
  watchedAt: Date; startsAt: Date; nominalStartsAt: Date; windowReliable: boolean;   // R6
  playbackSpeed: number; startTimestampSec: number; endTimestampSec: number;
  creditedSeconds: number; timelineSeconds: number; timelineInRuntimeSeconds: number;
  addedCoverageSeconds: number; rewatchCreditedSeconds: number;
  coverageBeforeSeconds: number; coverageAfterSeconds: number;      // race coverage, clamped
  raceCreditedAfterSeconds: number;                                  // race credited seconds up to and including this stint
  cumulativeCreditedBefore: number;                                  // career credited seconds before this stint
  cumulativeCoverageBefore: number;                                  // career Σ race coverage before this stint
  startsRace: boolean;                                               // raceOrdinal === 0
  experiencesRace: boolean;                                          // this stint made the race experienced
  completesStory: boolean;                                           // this stint made the race Story Complete
}
export interface RaceHistory {
  race: TimelineRaceRow;
  stints: readonly StintEvent[];                                     // canonical order
  intervals: Interval[];                                             // final merged, clamped
  coverageSeconds: number; creditedSeconds: number; rewatchCreditedSeconds: number;
  timelineSeconds: number; sessionCount: number; longestStintSeconds: number;
  startedAt: Date | null;                                            // first stint startsAt
  firstStintAt: Date | null; lastStintAt: Date | null;               // watchedAt
  experiencedAt: Date | null; experiencingSessionId: string | null;
  storyCompletedAt: Date | null; completingSessionId: string | null;
}
export interface TimelineEvent { at: Date; sessionId: string; raceId: string; ordinal: number }
export interface InstantResult { at: Date; precision: 'INTERPOLATED' | 'STINT'; sessionId: string; raceId: string }
export interface CareerTimeline {
  stints: readonly StintEvent[];
  races: ReadonlyMap<string, RaceHistory>;                           // every race with ≥ 0 stints
  racesById: ReadonlyMap<string, TimelineRaceRow>;
  totalCreditedSeconds: number;
}

export function replayRace(race: TimelineRaceRow, sessions: readonly TimelineSessionRow[], options?: TimelineOptions): RaceHistory;
export function buildCareerTimeline(sessions: readonly TimelineSessionRow[], races: readonly TimelineRaceRow[], options?: TimelineOptions): CareerTimeline;
export function coverageAt(history: RaceHistory, at: Date): number;  // coverage after the last stint with watchedAt ≤ at
export function storyCompleteEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[];
export function raceStartEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[];
export function raceExperiencedEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[];
export function nthEvent(events: readonly TimelineEvent[], n: number): InstantResult | null;       // precision STINT
export function cumulativeCrossing(
  stints: readonly StintEvent[], thresholdSeconds: number,
  amountOf: (s: StintEvent) => number,
  within?: LocalWindow,                                              // only the part of each window inside it counts
): InstantResult | null;                                             // INTERPOLATED, or STINT when the window is not reliable
export function coverageCrossing(history: RaceHistory, percent: number): { at: Date; sessionId: string } | null;
```

Algorithm and invariants:
- `buildCareerTimeline` sorts the sessions with `compareCanonical`, groups them by race, and runs `replayRace` for each race. It then walks the global order to fill `ordinal`, `startsAt`/`windowReliable` (R6, which needs the previous stint across races), `cumulativeCreditedBefore` and `cumulativeCoverageBefore`. The cost is O(n log n) plus the per-race merges. `replayRace` on its own (the Expedition paths) sets `startsAt` from the previous stint of the same race only, which the Expedition figures do not use for dating anything.
- A session whose `raceId` has no race row is skipped. Cascades make that impossible, but the replay must never throw.
- `completesStory` is computed with the existing `isStoryComplete` on the clamped merged set after that stint; `experiencesRace` with `isRaceExperienced` on the coverage and race credited seconds after that stint.
- `cumulativeCrossing` interpolation: for the stint `s` with `before < T ≤ before + A` (where `A = amountOf(s)`, or its fraction inside `within`):
  - when `s.windowReliable`, `at = segStart + ((T − before) / A) × (segEnd − segStart)` with precision INTERPOLATED, where `[segStart, segEnd]` is the stint's window (R6) clipped to `within`;
  - otherwise `at = s.watchedAt` with precision STINT;
  - stints with `A = 0` are skipped, and a zero-length segment gives `at = segEnd`.
  - Because windows never overlap (R6), instants are non-decreasing in canonical order and in `T`. A property test asserts this for random logs.
- `coverageCrossing` compares with integers: `coverageAfterSeconds × 100 ≥ percent × runtimeSec`. It returns the first such stint.
- The functions are pure, deterministic and never throw on empty input. An empty career gives an empty timeline.

#### 3.2.3 `src/lib/domain/edition.ts` (new, pure)

```ts
export function editionYear(race: { raceDate: Date | null; seasonYear: number | null }): number | null;
export function editionIdentity(race: { id: string; raceDate: Date | null; seasonYear: number | null }): string;
export interface Run { length: number; fromYear: number; toYear: number }
export function longestConsecutiveRun(years: readonly number[]): Run | null;   // dedupes; ties → earliest run
export function missingEditionYears(years: readonly number[]): number[];      // years strictly between min and max with no edition
export function normaliseEventKey(text: string): string;  // NFD, strip diacritics, lowercase, [^a-z0-9]+ → '-', trim '-'
export function eventNameSignature(raceName: string): string;
export function eventNameFromRaceName(raceName: string): string;              // the race's own name with standalone years removed, trimmed
export interface EditionFingerprint { year: number | null; hours: number; circuit: string | null; signature: string }
export function editionFingerprint(race: { editionYear: number | null; circuitSlug: string | null; name: string; runtimeSec: number }): EditionFingerprint;
export function serialiseFingerprint(f: EditionFingerprint): string;           // stable JSON, keys sorted
export function fingerprintMatches(stored: string, race: EditionFingerprint): boolean;
```

- `eventNameSignature` works as follows:
  - lowercase and strip diacritics;
  - remove standalone 4-digit years `(19|20|21)\d\d`;
  - remove ordinals `\b\d+(st|nd|rd|th)\b`;
  - remove the words `edition|annual|the`;
  - collapse non-alphanumerics to single spaces and trim.

  Example: "2026 24 Hours of Le Mans" → "24 hours of le mans". It is used only for matching, never shown.
- `eventNameFromRaceName("2026 24 Hours of Nürburgring")` → "24 Hours of Nürburgring": the user's own casing and diacritics are kept. Suggestions use it for the proposed event name.
- `editionFingerprint` returns `{ year: editionYear, hours: Math.round(runtimeSec / 3600), circuit: circuitSlug, signature: eventNameSignature(name) }`. `fingerprintMatches` is true when `year` and `hours` are equal **and** either the circuits are equal and non-null or the signatures are equal and non-empty. Rounding the hours means a runtime changed by a few seconds still matches, and matching on circuit **or** name means the user must change both to evade it.
- `metrics.ts` `longestRun` stays: its tests are existing. It delegates to `longestConsecutiveRun(...)?.length ?? 0`.

#### 3.2.4 `src/lib/domain/event-association.ts` (new, pure) — suggestions only, never auto-links

```ts
export interface AssociationRace { id: string; name: string; circuitSlug: string | null; runtimeSec: number; championshipId: string | null; eventKey: string | null; raceDate: Date | null; seasonYear: number | null }
export interface AssociationEvent { key: string; name: string; memberCount: number; createdAt: Date; active: boolean }
export type EventSuggestion =
  | { id: string; kind: 'link'; raceId: string; eventKey: string; strength: 'strong' | 'likely'; reason: 'name' | 'name-and-circuit' | 'circuit-and-length' }
  | { id: string; kind: 'create'; name: string; raceIds: string[] }
  | { id: string; kind: 'merge'; fromKey: string; intoKey: string };
export function suggestEventLinks(races: readonly AssociationRace[], events: readonly AssociationEvent[], dismissed: ReadonlySet<string>): EventSuggestion[];
```

The rules below are deterministic. Nothing is hard-coded: `MAJOR_EVENT_SUGGESTIONS` is **not** consulted.

- A signature counts only if it has at least 2 tokens and at least 6 characters.
- **Link** (only races with no event): the candidate events are active events with a member race whose signature equals the race's signature.
  - `strength 'strong'`, with reason `'name-and-circuit'` when the circuit slugs are also equal and non-null, and `'name'` otherwise.
  - Otherwise, the candidate events are those with a member that has the same non-null `circuitSlug`, the same `Math.round(runtimeSec/3600)`, and an equal championship (or a null championship on either side). These give `strength 'likely'`, `'circuit-and-length'`.
  - Each race gets at most one link suggestion: the strongest. Ties go to the event with the most members, then the lowest key.
- **Create**: unlinked races without a link suggestion are grouped by signature. A group needs at least 2 races with pairwise-distinct edition identities. The proposed `name` is `eventNameFromRaceName` of the group's most recent race (by edition year, then name); the create dialog lets the user edit it. `raceIds` are sorted by edition year.
- **Merge**: two active events whose `normaliseEventKey(key)` or `normaliseEventKey(name)` are equal. The event with fewer members merges into the other; on a tie, the later-created merges into the earlier. A merge suggestion is never applied in one click: its button opens the same confirm `Dialog` as the event page (§4.2.4).
- The ids are `link:<raceId>:<eventKey>`, `create:<signature>` and `merge:<fromKey>:<intoKey>`. Dismissed ids are filtered out.
- Output order: merge, then link-strong, link-likely, create, each by id.

#### 3.2.5 `src/lib/domain/landmarks.ts` (new, pure) — when a landmark happened

```ts
export function isReplayableMilestoneMetric(metric: string): boolean;
export function recognitionThresholdSeconds(metric: string, threshold: number): number;
export function milestoneInstant(
  timeline: CareerTimeline, metric: string, threshold: number,
  shapes?: { masteryShape: typeof MASTERY_SHAPE },
): (InstantResult & { eventId?: string; subjectName?: string }) | null;
export function eventStepInstant(timeline: CareerTimeline, eventKey: string, metric: string, threshold: number): InstantResult | null;
export function acceptInstant(instant: { at: Date }, recognisedAt: Date, slackMinutes: number): boolean;  // at ≤ recognisedAt + slack
export function creditedSecondsByLocalYear(timeline: CareerTimeline): Map<number, number>;
export function editionsExperiencedByEvent(timeline: CareerTimeline): Map<string /*eventKey*/, number>;
```

**Recognition and replay must agree on the threshold.** The engines recognise hour rungs from rounded values (`round1(seconds / 3600)`: `metrics.ts:165`, `:217`, `mastery-engine.ts:259`) compared with `value < threshold` (`achievement-engine.ts:547`, `mastery-engine.ts:919`). `round1(x) ≥ T` holds from `x ≥ T − 0.05 h`, which is 180 s early. So `recognitionThresholdSeconds(metric, T)` is `T × 3600 − 180` for the metrics recognised through `round1` of hours (`realHours`, `timelineHours`, event `realHours`), with a comment tying it to `round1`, and exactly `T × 3600` for `realHoursYear:<Y>`, which `syncCareerMilestones` compares in whole seconds. The replay crosses the same threshold the app recognised, so a rung recognised in the last three minutes of a stint is still dated inside that stint.

What `milestoneInstant` returns for each replayable metric:

| Metric | Instant | Precision |
|---|---|---|
| `realHours` T | `cumulativeCrossing(all stints, recognitionThresholdSeconds('realHours', T), s => s.creditedSeconds)` | INTERPOLATED (STINT if the window is not reliable) |
| `timelineHours` T | `cumulativeCrossing(all, recognitionThresholdSeconds('timelineHours', T), s => s.addedCoverageSeconds)` | INTERPOLATED / STINT |
| `realHoursYear:<Y>` T | `cumulativeCrossing(all, T·3600, credited, yearWindow(Y))` | INTERPOLATED / STINT |
| `sessions` N | the N-th stint | STINT |
| `storyCompletes` N | `nthEvent(storyCompleteEvents(t), N)` | STINT |
| `racesStarted` N | `nthEvent(raceStartEvents(t), N)` | STINT |
| `racesExperienced` N | `nthEvent(raceExperiencedEvents(t), N)` | STINT |
| `stories6h` / `stories8h` / `stories10h` / `stories12h` / `stories24h` N | `nthEvent(storyCompleteEvents(t, r => r.runtimeSec ≥ MASTERY_SHAPE.storiesXhMinHours·3600), N)` | STINT |
| `majorEventStories` N | as above, filtered by `isMajorEvent` | STINT |
| `eventEditions` N | For each event, the stint at which its N-th distinct **experienced** edition identity was first reached. The earliest across events wins, and `eventId` and `subjectName` are set to that event. | STINT |

- Every other metric is non-replayable: `racesCompleted` (it includes manual marks), `championshipsCompleted`, `seasonsCompleted`, `circuits`, `countries`, `careerXpMillions` and `level`. For these, `milestoneInstant` returns null.
- `eventStepInstant` uses the same rules inside one event's races: `editionsStoryComplete` (distinct SC edition identities), `editionsExperienced`, `consecutiveEditions` (the first SC event after which the dated SC years contain a run of at least N) and `realHours` (event credited, with the 180 s recognition threshold).
- When `raceId` is set, `subjectName` is the race name.

#### 3.2.6 `src/lib/domain/window-summary.ts` (new, pure) — the core shared by Chronicle, Statistics and Compare

```ts
export interface WindowOptions {
  weekStartsOn: number;
  include?: (race: TimelineRaceRow) => boolean;         // Statistics filters
  meaningfulSessionSeconds: number;
  rateMinimumRaces: number;
}
export interface Bucket { creditedSeconds: number; newCoverageSeconds: number; rewatchSeconds: number; sessions: number; storyCompletes: number }
export interface StintRef { sessionId: string; raceId: string; raceName: string; at: Date; creditedSeconds: number; playbackSpeed: number }
export interface RaceRef { raceId: string; name: string; runtimeSec: number }
export interface GroupRow { id: string | null; name: string; accent: string | null; creditedSeconds: number; racesExperienced: number; storyCompletes: number; share: number }
export interface WindowSummary {
  window: LocalWindow | null;                            // null = lifetime
  activeFrom: Date | null;                               // first stint instant inside the window
  creditedSeconds: number; newCoverageSeconds: number; rewatchSeconds: number; timelineSeconds: number;
  sessions: number; activeDays: number;
  racesStarted: number; racesExperienced: number; storyCompletes: number;
  championshipsWatched: number; eventsWatched: number;
  longestSession: StintRef | null; shortestMeaningfulSession: StintRef | null; averageSessionSeconds: number | null;
  longestRace: RaceRef | null;                           // max runtime among races experienced
  completionPercent: number | null; averageRaceCompletionPercent: number | null;
  storyCompleteRate: number | null;                      // the cohort rate of §3.1, null below rateMinimumRaces
  days: Map<string, Bucket>; weeks: Map<string, Bucket>; months: Map<string, Bucket>; years: Map<number, Bucket>;
  weekdays: Bucket[];                                    // index 0 = Sunday, as Date.getDay()
  byChampionship: GroupRow[]; byEvent: GroupRow[]; byCircuit: GroupRow[]; byDurationClass: GroupRow[];
  storyCompleteList: { raceId: string; name: string; at: Date; runtimeSec: number }[];
  raceIdsWatched: string[];
}
export function durationClassOf(runtimeSec: number): { key: string; label: string };
export function summariseWindow(timeline: CareerTimeline, window: LocalWindow | null, options: WindowOptions): WindowSummary;

export type CompareRowKey =
  | 'hours' | 'newCoverage' | 'rewatch' | 'sessions' | 'activeDays' | 'averageSession' | 'longestSession'
  | 'racesExperienced' | 'racesStarted' | 'storyCompletes' | 'storyCompleteRate' | 'completion'
  | 'xp' | 'levelsGained' | 'championshipsWatched' | 'eventsWatched';
export const COMPARE_ROW_ORDER: readonly CompareRowKey[];   // exactly the keys above, in this order
export interface CompareRow { key: CompareRowKey; label: string; unit: 'seconds' | 'count' | 'xp' | 'percent-points';
  a: number | null; b: number | null; difference: number | null; percentChange: number | null; note: string | null }
export interface CompareSide extends WindowSummary { year: number; xpEarned: number; levelsGained: number; careerBeganInYear: Date | null }
export function compareSummaries(
  a: CompareSide, b: CompareSide, rules?: typeof CAREER_STATS_SHAPE,
): { rows: CompareRow[]; championships: CompareRow[]; events: CompareRow[]; months: { month: number; a: number; b: number }[]; partialNote: string | null };
```

Attribution rules inside `summariseWindow`:
- Time quantities (credited, new coverage, re-watch, timeline) are split over the stint windows (R6) with `splitAcrossLocalDays`, and only the slices inside `window` count.
- Stint facts (`sessions`, `longestSession`, SC events, race starts, races experienced) count when the stint's `watchedAt` is in `window`.
- `completionPercent` and `averageRaceCompletionPercent` use `coverageAt(history, window.end)` over the races watched in the window.
- A GroupRow's `share` is its credited seconds divided by the window's credited seconds, or 0.

`compareSummaries` rules (from `CAREER_STATS_SHAPE`):
- `difference = b − a` is always shown.
- `percentChange` appears only when the base is large enough: at least `percentChangeMinimumBase.hours × 3600` for seconds, `count` for counts and `xp` for XP. Otherwise it is null and the note reads "Too little in {a-year} for a percentage to mean much".
- **A career that began inside a compared year** (`careerBeganInYear` set, i.e. the first stint of the whole career falls after 1 January of that year) gets `percentChange: null` on every row, and `partialNote` reads "Your {year} chapter began on {date}". The Compare tab and Wrapped card 14 lead with that sentence, so a 100-day first year is never compared with a full year as if they were alike.
- Rates (the SC rate) are compared only when both years have `racesStarted ≥ rateMinimumRaces`. Otherwise `a`/`b` are null and the note says so.
- Championship and event rows compare **shares in percentage points**, and only when both years have at least `percentChangeMinimumBase.hours` hours. Otherwise they show absolute hours only.
- `rows` contains exactly `COMPARE_ROW_ORDER`, in that order; a test asserts the set.

#### 3.2.7 `src/lib/domain/records.ts` (new, pure) — Personal Records

```ts
export type RecordKind =
  | 'longest-session' | 'most-in-a-day' | 'most-in-seven-days' | 'most-in-a-month'
  | 'most-completions-in-a-month' | 'most-story-completes-in-a-year'
  | 'longest-race-story-completed' | 'fastest-long-race-completion' | 'longest-start-to-finish'
  | 'most-new-coverage-in-a-day' | 'longest-edition-streak';
export const RECORD_ORDER: readonly RecordKind[];            // the order above; Wrapped picks the first N set in a year
export interface RecordEvent {
  kind: RecordKind; label: string; value: number; unit: 'seconds' | 'count' | 'editions';
  at: Date; periodKey: string | null; raceId: string | null; eventKey: string | null;
  detail: string; previousValue: number | null;
  basis: 'logged-time' | 'history';    // logged-time = depends on when stints were logged (R6)
}
export interface RecordOptions { weekStartsOn: number; longRaceThresholdSec: number; rollingDays: number; include?: (race: TimelineRaceRow) => boolean; within?: LocalWindow }
export function computeRecordProgression(timeline: CareerTimeline, options: RecordOptions): RecordEvent[]; // chronological
export function currentRecords(progression: readonly RecordEvent[]): RecordEvent[];                       // latest per kind, RECORD_ORDER order
export function recordsSetIn(progression: readonly RecordEvent[], window: LocalWindow): RecordEvent[];
export function beatenAfter(progression: readonly RecordEvent[], record: Pick<RecordEvent, 'kind' | 'at' | 'value'>): RecordEvent | null;
```

| Kind | Value | `at` | Basis |
|---|---|---|---|
| longest-session | max credited of one stint | stint `watchedAt` | logged-time |
| most-in-a-day | max day bucket of credited, capped at that day's length in seconds | local midnight of that day | logged-time |
| most-in-seven-days | max over days d of Σ days [d−6, d] (`rollingDays`), using calendar days with 0-filled gaps | local midnight of day d | logged-time |
| most-in-a-month | max month bucket of credited | month start | logged-time |
| most-completions-in-a-month | max SC events per local month | month start | history |
| most-story-completes-in-a-year | max SC events per local year | Jan 1 | history |
| longest-race-story-completed | max runtime among SC races | the SC instant | history |
| fastest-long-race-completion | min `elapsed` among SC races with runtime ≥ `longRaceThresholdSec`, where `elapsed = max(scAt − startedAt, Σ credited of the race's stints up to and including the completing one)` | the SC instant | logged-time |
| longest-start-to-finish | max `elapsed` (same formula) among all SC races | the SC instant | logged-time |
| most-new-coverage-in-a-day | max day bucket of added coverage | local midnight | logged-time |
| longest-edition-streak | max over events of the longest dated SC-edition run | the SC instant that completed the run | history |

- Progression is built in chronological order. A period-based record emits an event when a **completed** period's total beats the best so far; the current, unfinished period is also compared at the end.
- Replacing a record needs a strictly greater value, or strictly smaller for "fastest". Ties stay with the earlier holder.
- `within` restricts the fold to stints whose `watchedAt` is in the window (the Statistics year filter: "best within 2027"). Without it, records are career records.
- `beatenAfter` returns the first later event of the same kind that replaced the given value. The Chronicle uses it at render time for "since beaten on …", so frozen chapters never carry a stale note.

#### 3.2.8 `src/lib/domain/expedition.ts` (new, pure)

```ts
export function isExpedition(race: { scheduledDurationSec: number; expeditionMode: boolean | null }): boolean;
//   true → true (any race);  false → false;  null → scheduledDurationSec ≥ autoThresholdHours·3600
export function checkpointsPayXp(runtimeSec: number): boolean;              // runtimeSec ≥ checkpointXpMinimumHours·3600
export function checkpointSchedule(runtimeSec: number): { percent: number; xp: number }[];
//   xp = 0 for every entry when !checkpointsPayXp(runtimeSec); otherwise
//   pool = storyCompleteBonus(runtimeSec, false).careerXp × EXPEDITION_CONFIG.checkpointPoolShare
//   xp   = round(pool × poolShare / roundingStep) × roundingStep, per EXPEDITION_CONFIG.checkpoints
export function checkpointsSatisfied(coverageSec: number, runtimeSec: number): number[]; // integer compare, as coverageCrossing
export function expeditionDedupeKey(raceId: string, percent: number): string;          // `expedition:${raceId}:${percent}`
export interface ExpeditionFigures {
  runtimeSec: number; coverageSec: number; completionPercentText: string; remainingTimelineSec: number;
  remainingRealSec: number; resumeAtSec: number; creditedSeconds: number; rewatchSeconds: number;
  sessions: number; startedAt: Date | null; elapsedSeconds: number | null; storyCompletedAt: Date | null;
  checkpoints: { percent: number; xp: number; reachedAt: Date | null; sessionId: string | null; held: boolean }[];
  fragments: { watched: Interval[]; gaps: Interval[]; furthestSec: number };
}
export function expeditionFigures(history: RaceHistory, avgSpeed: number, now: Date): ExpeditionFigures;
export const EXPEDITION_SUMMARY_SCHEMA_VERSION = 1;
export const expeditionSummarySnapshotSchema: z.ZodType<…>;   // §4.3.6
export type ExpeditionSummarySnapshotV1 = z.infer<typeof expeditionSummarySnapshotSchema>;
export function buildExpeditionSummarySnapshot(input: ExpeditionSummaryInput): ExpeditionSummarySnapshotV1;
```

- Eligibility uses the **scheduled** length, so a 10-hour race cut to 9h50 by a red flag (`actualDurationSec`) is still an Expedition; checkpoint amounts and percentages use the runtime, which is what coverage is measured against.
- `storyCompleteBonus` lives in `domain/progression.ts`. The strategist never imports this module, so the rule that the strategist cannot see XP (design rules) is untouched.

`src/lib/domain/time.ts` gains the one coverage formatter every screen uses:

```ts
export function formatCoveragePercent(coverageSec: number, runtimeSec: number): string;
// floors to one decimal ("99.9%"); returns "100%" only when coverageSec ≥ runtimeSec; "0%" for runtime 0
```

Story Complete allows up to 120 s uncovered (`STORY_CONFIG.maxUncoveredSeconds`, `economy.ts:159`), so a rounding formatter would show a race with a gap as "100%". Every Expedition surface, `describeFragments`, the summary snapshot's text, the Event Legacy edition rows and the existing stint-summary "Completion" figure (`stint-summary.tsx:63`, which today uses `toFixed(0)`) and `describeCoverage` (`race-timeline.tsx:162-165`) use it.

#### 3.2.9 `src/lib/engines/career-timeline-engine.ts` (new, database) — the loader and cache

```ts
export interface TimelineInputs { sessions: TimelineSessionRow[]; races: TimelineRaceRow[] }
export async function loadTimelineInputs(db: Tx, userId: string): Promise<TimelineInputs>;
export async function loadRaceTimelineInputs(db: Tx, userId: string, raceId: string): Promise<{ race: TimelineRaceRow; sessions: TimelineSessionRow[] } | null>; // one race, for expedition paths
export async function timelineFingerprint(userId: string, db?: Tx): Promise<string>;
export async function getCareerTimeline(userId: string): Promise<CareerTimeline>;        // global client, cached
export function clearCareerTimelineCache(userId?: string): void;
```

`loadTimelineInputs` runs exactly two queries:
1. `raceViewingSession.findMany({ where: { userId }, orderBy: [{ watchedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: {id, raceId, startTimestampSec, endTimestampSec, playbackSpeed, timelineSeconds, realSeconds, watchedAt, createdAt} })`. It uses the `(userId, watchedAt)` index.
2. `race.findMany({ where: { userId }, select: { id, name, runtimeSec, scheduledDurationSec, raceDate, championshipId, raceMasteryId, iconicKey, circuit, circuitSlug, country, raceType, isMajorEvent, expeditionMode, season: { select: { year } }, championship: { select: { name, accentColor } }, raceMastery: { select: { key, name, displayName } } } })`.

It maps these rows to `TimelineRaceRow`, computing `editionYear` with `edition.ts`.

The fingerprint is four aggregate queries, **each with `where: { userId }`** (the championship one included), joined into one JSON string:
- sessions: `_count`, `_max.createdAt`, `_sum.realSeconds/timelineSeconds/startTimestampSec`;
- races: `_count`, `_max.updatedAt`;
- raceMastery: `_count`, `_max.updatedAt`;
- championship: `_count`, `_max.updatedAt`.

Sessions are immutable and every race or event edit bumps `updatedAt` (Prisma `@updatedAt` also applies to `updateMany`; verified in this Prisma 7 build, `eng/upd.ts`). A season's year feeds `editionYear` but is part of the season's identity (`@@unique([championshipId, year])`, upserted, never edited in place); moving a race to another season updates the race row. The code comment states this assumption. So any change to the history changes the fingerprint.

The cache:
- It lives on `globalThis` (`globalForTimeline.careerTimelines`), like the Prisma client (`client.ts:19`), because Next compiles server actions and server components into separate layers and a module-level `Map` could exist twice.
- It is an LRU `Map<userId, { fingerprint, timeline }>` with at most `CAREER_STATS_SHAPE.timelineCacheEntries` (4) entries, plus a `Map<userId, Promise<CareerTimeline>>` of in-flight builds, so concurrent misses for one account build once.
- A hit costs the four aggregates. A miss costs both loads and a build.
- Inside a transaction, never use the cache: call `buildCareerTimeline(await loadTimelineInputs(tx, userId))` directly, or use a timeline the caller already built (§5).
- Every mutating server action calls `clearCareerTimelineCache(userId)` after it commits. The fingerprint already guarantees correctness; clearing only frees memory sooner.

#### 3.2.10 Changes to existing engines (shared plumbing, WP2)

**`race-engine.ts`**
- Add `export async function rebuildRaceIntervals(tx: Tx, raceId: string): Promise<Interval[]>`. It replays that race's sessions in canonical order with `addInterval(… { limit: race.runtimeSec, gapTolerance })` and rewrites `WatchedInterval` (deleteMany + createMany, `sessionId` null). This is the code at `session-engine.ts:484-512`, moved, and `deleteViewingSession` calls it.
- `recomputeRaceAggregates(tx, raceId, now, options?: { preserveStatus?: boolean })`:
  1. Clamp the intervals to `runtimeSec` before `isStoryComplete`, `coverageSeconds` and `furthestPoint`:
     ```ts
     const clamped = mergeIntervals(
       rows.map((r) => normalizeInterval({ start: r.startSec, end: r.endSec }, runtimeSec))
           .filter((iv): iv is Interval => iv !== null),
     );
     ```
     (the same narrowing as `intervals.ts:42`; `.filter(Boolean)` does not narrow in TS 5.9).
  2. Also compute `creditedViewingSec = Σ creditedSeconds(session)`: select `timelineSeconds` (already selected) and write it with the other aggregates.
  3. Return `creditedViewingSec` in `RaceAggregates`.
  4. With `preserveStatus: true` (the upgrade's legacy repair only), `status` and `completedAt` are written back unchanged, so `deriveStatus` (`race-engine.ts:142-156`) cannot overwrite a status the user chose.
  5. The runtime-shrink false Story Complete (SYNTHESIS §C) is fixed by step 1.

**`metrics.ts`**
- `computeCareerMetrics(userId, db)` keeps its signature. Internally, the session query becomes `loadTimelineInputs(db, userId).sessions` (one scan instead of two), and the separate `raceViewingSession.aggregate` is removed. Then:
  - `realHours = round1(Σ creditedSeconds / 3600)`;
  - `longestSessionHours = round2(max credited / 3600)`;
  - `averageSessionMinutes = round1(Σ credited / n / 60)`;
  - `playedTimelineHours = Σ timelineSeconds`;
  - `averagePlaybackSpeed = Σ timeline / Σ realSeconds`, unchanged (it is about playback, not credit).
- `countLongBreakReturns` receives the sessions already loaded.
- Add `export async function computeCareerMetricsWithHistory(userId, db): Promise<{ metrics: CareerMetrics; history: TimelineInputs }>`. It runs **one** race query whose `select` is the union of the metrics fields and the timeline fields, and maps it to both; `computeCareerMetrics` becomes `(await computeCareerMetricsWithHistory(userId, db)).metrics`.
- Replace the hard-coded `7.5/9.5/11.5/23` (`metrics.ts:201-204`) with `MASTERY_SHAPE.stories8hMinHours/stories10hMinHours/stories12hMinHours/stories24hMinHours`.
- Add `stories6h` (≥ `MASTERY_SHAPE.stories6hMinHours`), `racesExperienced` (races with `isRaceExperienced({ coverageSec, runtimeSec, creditedSec })`, where `creditedSec` is summed from the sessions already loaded) and `maxEditionsExperiencedOfOneEvent` (the largest number of distinct experienced edition identities in one event, keyed by `raceMasteryId ?? iconicKey`) to `CareerMetrics` and `EMPTY`.
- `maxEditionsOfOneEvent` and `longestConsecutiveEditions` use `editionIdentity`/`editionYear` from `edition.ts` with the season fallback (add `season: { select: { year } }` to the race select). They count **distinct** SC edition identities per event, keyed by `raceMasteryId ?? iconicKey`.

**`mastery-engine.ts`**
- `editionYear` delegates to `domain/edition.ts` (UTC).
- `MasteryRaceInput` gets optional fields, so existing fixtures still compile: `experienced?: boolean` (default `storyComplete`) and `name?: string`.
- `realViewingSec` is populated from `row.creditedViewingSec ?? row.realViewingSec`, and the doc comment says "credited real seconds".
- `loadMasteryInputs` adds `creditedViewingSec`, `coverageSec`, `name` and `season.year`, and sets `experienced = storyComplete || isRaceExperienced({ coverageSec, runtimeSec, creditedSec: creditedViewingSec ?? realViewingSec })`.
- In `computeMetrics`:
  - `editionsStoryComplete` counts **distinct** `editionIdentity` among SC races;
  - a new metric `editionsExperienced` counts distinct identities among experienced races (add it to `MasteryMetrics` and `EMPTY_METRICS`);
  - `consecutiveEditions` is unchanged: dated SC years, via `longestRun`.
- `recomputeRaceMasteries`:
  - it follows `mergedIntoId` chains (at most `EVENT_SHAPE.maxMergeHops` = 10 hops, each hop `findFirst({ where: { id, userId } })`), so a race carrying a merged key is re-pointed to the surviving event (both `iconicKey` and `raceMasteryId`);
  - `editionsStoryComplete` counts distinct identities;
  - `totalRealSec` sums credited seconds;
  - it never writes `displayName`.
- `ensureMasteryTrees`:
  - the desired event keys are the union of race `iconicKey` values and the keys of active events (`archivedAt: null, mergedIntoId: null`);
  - the tree name is `displayName ?? eventDisplayName(key)`;
  - trees of merged or archived events are left untouched, never removed.
- `syncMastery` gains the event-step credit logic (§4.2.5, WP4). It also skips `awardXp` for a node whose `xpReward` is 0 (the unlock is recorded, `MasteryUnlock.xpAwarded = 0`), so no zero-amount ledger row is ever written.

**`xp-ledger.ts`**
- `XpRevocation` gains `earliest: { createdAt: Date; id: string } | null`, the earliest removed row in ledger order. `revokeSessionXp`, `revokeXpByDedupeKey` and `purgeOrphanedSessionXp` fill it.
- Add `revokeSessionsXp(tx, userId, sessionIds: readonly string[]): Promise<XpRevocation>`. It deletes VIEWING/REWATCH rows for those sessions in chunks of 500 ids and uses the new `sessionId` index.
- Add `revokeRaceViewingXp(tx, userId, raceId): Promise<XpRevocation>`: every VIEWING/REWATCH row with `sourceRef = raceId` (the viewing award always carries it, `session-engine.ts:188`), which also catches rows whose `sessionId` was nulled by a stint deleted under an old version.
- Add `revokeXpByDedupeKeys(tx, userId, keys: readonly string[]): Promise<XpRevocation>`, which uses `dedupeKey: { in: keys }` and so the unique index.
- `rebuildCareerTotals(tx, userId, options?: { from?: { createdAt: Date; id: string } })`:
  - with `from`, the running total starts at `Σ amount` of the rows strictly before `(from.createdAt, from.id)` in `(createdAt, id)` order (one `aggregate`), and only the rows at or after it are loaded; without `from`, every row is loaded, as today;
  - changed rows are written in batches of `LEDGER_RESTAMP_BATCH` (400) with one statement per batch through `tx.$executeRaw` and `Prisma.join`: `UPDATE "xp_transactions" SET "careerXpAfter" = CASE "id" WHEN ? THEN ? … END, "levelAfter" = CASE "id" WHEN ? THEN ? … END WHERE "id" IN (…)`;
  - the profile is updated from the final running total, as today. The measured cost of a full re-stamp at 180,564 rows falls from 29.6 s to 6.9 s.
- Add `settleLedger(tx, userId, revocations: readonly XpRevocation[]): Promise<LedgerRebuild | null>` (R13): `null` when nothing was removed; otherwise `rebuildCareerTotals(tx, userId, { from: earliest of all revocations })`, then `rebuildSeasonXpFromLedger(tx, userId)` only if any revocation removed season XP (that avoids the momentum side-effect noted at `season-reset.ts:44-46`).

**`session-engine.ts`**
- `logViewingSession` throws `InvalidStintError('future-watched-at')` when `input.watchedAt` is after `now + slack` (R9).
- `logSessionAction` catches it and returns `{ ok: false, message: 'That stint is dated in the future, so it was not logged.' }`.
- `deleteViewingSession` and `repairXpLedger` end with `settleLedger` instead of calling `rebuildCareerTotals`/`rebuildSeasonXpFromLedger` directly. `repairXpLedger` loads `race.findMany({ where: { userId }, select: { id, storyCompletedAt } })` once instead of one `findFirst` per bonus (`session-engine.ts:589-603`).
- The rest of the integration is in §4.0.

**`src/lib/engines/progression-resync.ts`** (new, WP2):
- `reconcileStoryBonus(tx, userId, raceId, { history?, crossingSessionId? })`: it replays the one race (`loadRaceTimelineInputs` + `replayRace`) unless the caller passes that race's `RaceHistory` (the backfill and recompute pass the one from their context). It awards `story-complete:<id>` if the race is Story Complete by replay and the row is missing (`sessionId` = the replay's `completingSessionId`, or `crossingSessionId` on the stint path); revoke it if the race is not Story Complete. The amount is the existing `storyCompleteBonus(runtimeSec, isMajorEvent).careerXp`, and a bonus paid here has `seasonAmount` 0: only the live stint path (§4.0 step 5) keeps paying season XP exactly as today. The existing bonus is never re-sized.
- `resyncAfterRaceEdit` (§4.0).

#### 3.2.11 `src/lib/engines/stint-unlocks.ts` (new, database; WP3)

This is the reconstruction that `session-summary.ts` does today (`session-summary.ts:40-80`), moved so that engines can use it inside a transaction, and **bounded on both sides and by the neighbouring stints**. It fixes the bug where reopening an old stint's summary listed later unlocks, and stops two stints logged within five minutes from sharing unlocks.

```ts
export interface StintUnlocks {
  achievements: AchievementUnlock[]; mastery: MasteryUnlock[]; milestones: MilestoneUnlock[];
  challenges: ChallengeCompletion[]; seasonPassTiers: SeasonPassTierUnlock[];
  trophies: TrophyAward[]; hallOfFame: HallOfFameAward[];
}
export function stintUnlockWindow(
  watchedAt: Date, neighbours: { previousWatchedAt: Date | null; nextWatchedAt: Date | null },
): { from: Date; to: Date };
//   from = max(watchedAt − slack, previousWatchedAt + 1 ms);  to = min(watchedAt + slack, nextWatchedAt − 1 ms)
//   slack = TIMELINE_SHAPE.recognitionSlackMinutes
export async function reconstructStintUnlocks(db: Tx, userId: string, session: { id: string; watchedAt: Date }): Promise<StintUnlocks>;
```

`reconstructStintUnlocks` reads the two neighbouring stints (`findFirst` before and after in canonical order, `(userId, watchedAt)` index). `buildOutcomeForSession` calls it with the global client. `writeExpeditionSummary` calls it with the transaction client for retrospective summaries.

### 3.3 Configuration additions

In `src/lib/config/economy.ts`, add these blocks. Each needs a comment explaining every number, in the style of the file.

```ts
export const EXPEDITION_CONFIG = {
  /** Checkpoint pool as a share of the race's non-major Story Complete bonus (a 24h race: 7,500 × 0.4 = 3,000). */
  checkpointPoolShare: 0.4,
  /** Coverage percentages and the share of the pool each pays. Shares sum to 1. Story Complete itself pays the existing bonus, never a checkpoint. */
  checkpoints: [
    { percent: 10, poolShare: 0.1 },
    { percent: 25, poolShare: 0.15 },
    { percent: 50, poolShare: 0.25 },
    { percent: 75, poolShare: 0.25 },
    { percent: 90, poolShare: 0.25 },
  ],
  /** Checkpoint XP is rounded to this step so the numbers read cleanly. */
  roundingStep: 10,
} as const;

export const EXPEDITION_SHAPE = {
  /** A race scheduled for at least this long is an Expedition unless switched off (owner decision 3). */
  autoThresholdHours: 10,
  /** Checkpoints pay XP only on races at least this long: the shortest format usually watched over more than one sitting, whose checkpoints are still at least 60 XP. Shorter races can still be followed as Expeditions, without checkpoint XP. */
  checkpointXpMinimumHours: 6,
  /** Most stint lanes the expedition timeline draws before folding the rest into "+n more". */
  stintLaneLimit: 6,
} as const;

export const CAREER_STATS_SHAPE = {
  /** Shorter stints are left out of "shortest meaningful session" (typos, test stints). */
  meaningfulSessionMinutes: 10,
  /** A race counts as experienced once this much of it was credited… */
  experiencedMinimumCreditedMinutes: 10,
  /** …and its coverage reached this share of the runtime… */
  experiencedCoverageShare: 0.1,
  /** …or this much coverage, whichever is smaller (one hour of a 24-hour race is an experience). */
  experiencedCoverageEnoughMinutes: 60,
  /** Below these bases a percentage change is hidden and only the difference is shown. */
  percentChangeMinimumBase: { hours: 10, count: 5, xp: 5_000 },
  /** A Story Complete rate needs at least this many races started. */
  rateMinimumRaces: 5,
  /** The rolling window of the "most in seven days" record. */
  recordRollingDays: 7,
  /** In-memory career timelines kept (one per account in practice). */
  timelineCacheEntries: 4,
  /** Rows shown before "Show all" in breakdown tables. */
  topListSize: 10,
  /** A chart needs at least this many points; below it the figure is said in a sentence. */
  chartMinimumPoints: 3,
  /** Most races offered by the Statistics race filter and the "Add races" dialog. */
  raceOptionLimit: 200,
  addRacesDialogLimit: 50,
} as const;

/** Race-length bands for every length breakdown and the Statistics length filter (not the Story Complete bonus bands). */
export const DURATION_CLASSES = [
  { key: 'short', label: 'Up to 3 hours', maxHours: 3.5 },
  { key: 'h4', label: '4 hours', maxHours: 5 },
  { key: 'h6', label: '6 hours', maxHours: 7 },
  { key: 'h8', label: '8 hours', maxHours: 9 },
  { key: 'h10', label: '10 hours', maxHours: 11 },
  { key: 'h12', label: '12 hours', maxHours: 13 },
  { key: 'h13to20', label: '13 to 20 hours', maxHours: 20 },
  { key: 'h24', label: '24 hours', maxHours: Infinity },
] as const;

export const CHRONICLE_SHAPE = {
  /** Version of the frozen ChronicleChapter snapshot. */
  snapshotSchemaVersion: 1,
  /**
   * A finished year is frozen only this long after local midnight on 1 January.
   * A stint's window reaches back up to 64 hours from when it is logged (a 48-hour
   * race at the 0.75× credit floor), so a stint logged on 1 January can still hold
   * time from 31 December. 72 covers the longest possible window.
   */
  freezeGraceHours: 72,
  /** Notable races picked per chapter. */
  notableRacesCount: 6,
  /** Personal records shown on the Wrapped records card. */
  wrappedRecordsShown: 3,
  /** The favourite-circuit card appears only if races with a circuit carry at least this share of the year's hours. */
  favouriteCircuitMinimumShare: 0.5,
  /** Story Complete list page size inside a chapter. */
  storyListPageSize: 25,
} as const;

export const TIMELINE_SHAPE = {
  /** A stint may be dated at most this far after the server's now (clock skew), never further. */
  futureWatchedAtSlackMinutes: 5,
  /** A replayed landmark instant is accepted only if it is at most this long after the app recorded the landmark; also the stint-unlock window. */
  recognitionSlackMinutes: 5,
  /** A stint window cut by batch logging keeps "about" precision only if at least this share of it is left (R6). */
  reliableWindowShare: 0.5,
  /** Interpolated times are shown rounded to this many minutes: they rest on when stints were logged. */
  displayRoundingMinutes: 5,
} as const;

export const EVENT_SHAPE = {
  /** A merge chain is followed at most this many hops (a guard; merges cannot form a cycle). */
  maxMergeHops: 10,
  /** Most dismissed suggestion ids remembered per account. */
  dismissedSuggestionLimit: 500,
} as const;
```

**`MASTERY_SHAPE`** adds three thresholds, with the same half-hour tolerance idea:
- `stories6hMinHours: 5.5`
- `stories8hMinHours: 7.5`
- `stories10hMinHours: 9.5`

**`MASTERY_CONFIG.raceEventNodes`** (WP4):
- **Append** these entries after the existing eight. Appending keeps every existing node's `sortOrder` (index × 10, `mastery-engine.ts:742`), so `ensureMasteryTrees` inserts only the new nodes.

```ts
{ key: 'experienced_1', name: 'First Edition Experienced', description: 'Experience any edition (a tenth of it, or an hour).', metric: 'editionsExperienced', threshold: 1, xpReward: 0, tier: 1, rarity: 'COMMON' },
{ key: 'experienced_3', name: 'Three Editions Experienced', description: 'Experience three editions.', metric: 'editionsExperienced', threshold: 3, xpReward: 300, tier: 2, rarity: 'COMMON' },
{ key: 'experienced_5', name: 'Five Editions Experienced', description: 'Experience five editions.', metric: 'editionsExperienced', threshold: 5, xpReward: 500, tier: 3, rarity: 'UNCOMMON' },
{ key: 'experienced_10', name: 'Ten Editions Experienced', description: 'Experience ten editions.', metric: 'editionsExperienced', threshold: 10, xpReward: 1_000, tier: 4, rarity: 'RARE' },
{ key: 'experienced_25', name: 'Twenty-Five Editions Experienced', description: 'Experience twenty-five editions.', metric: 'editionsExperienced', threshold: 25, xpReward: 2_500, tier: 6, rarity: 'EPIC' },
{ key: 'consecutive_10', name: 'Ten Complete in a Row', description: 'Story Complete ten consecutive editions.', metric: 'consecutiveEditions', threshold: 10, xpReward: 5_000, tier: 6, rarity: 'MYTHIC' },
{ key: 'event_hours_25', name: '25 Hours Here', description: 'Spend 25 real hours on this event.', metric: 'realHours', threshold: 25, xpReward: 500, tier: 2, rarity: 'COMMON' },
{ key: 'event_hours_100', name: '100 Hours Here', description: 'Spend 100 real hours on this event.', metric: 'realHours', threshold: 100, xpReward: 1_500, tier: 5, rarity: 'EPIC' },
{ key: 'event_hours_250', name: '250 Hours Here', description: 'Spend 250 real hours on this event.', metric: 'realHours', threshold: 250, xpReward: 3_000, tier: 7, rarity: 'LEGENDARY' },
```

- **Rename the display names** (not keys, metrics, thresholds or XP) of six existing nodes, so the Story Complete steps read differently from the new experienced steps: `edition_1` "First Complete Edition", `edition_3` "Three Complete Editions", `edition_5` "Five Complete Editions", `edition_10` "Ten Complete Editions", `consecutive_3` "Three Complete in a Row", `consecutive_5` "Five Complete in a Row". `ensureMasteryTrees` updates names in place (`mastery-engine.ts:703-717`); names are not paid, so D2 is untouched.

**New sibling module `src/lib/config/career-milestones.ts`**, exported from `config/index.ts` with `export * from './career-milestones'`. The full catalogue is in §4.1.2.

**`DEFAULT_CONFIG`** (`config/index.ts`) adds these keys:
- `expedition: EXPEDITION_CONFIG`
- `expeditionShape: EXPEDITION_SHAPE`
- `careerStatsShape: CAREER_STATS_SHAPE`
- `durationClasses: DURATION_CLASSES`
- `chronicleShape: CHRONICLE_SHAPE`
- `timelineShape: TIMELINE_SHAPE`
- `eventShape: EVENT_SHAPE`

**`tests/domain/config.test.ts`** is updated in three places:
1. Add `'expedition'` to the subsystem list at `:368-373`.
2. Add `'expeditionShape', 'careerStatsShape', 'durationClasses', 'chronicleShape', 'timelineShape', 'eventShape'` to the shape list at `:380-385`.
3. Add the new blocks to the `imported` map at `:397-409`.

The file also gets new tests for the catalogue (§8.3).

The achievement `expedition` in `config/achievements.ts:42` keeps its **key**, so its dedupe key is unchanged. Its **name** becomes `'Around the Clock, Three Times'`, which removes the clash with Race Expeditions. `syncAchievementDefinitions` updates names in place (`achievement-engine.ts:358-362`). The strategist's copy "the {race} is an expedition of about …" (`strategist-engine.ts:604-605`) becomes "the {race} is a long race of about …", because the word now names a feature that race may not have switched on.

---

## 4. The five systems

### 4.0 How it all plugs into the existing write paths

**`logViewingSession`** runs in one transaction; the numbering follows `session-engine.ts`. New steps are in **bold**.

1. The future `watchedAt` guard (R9) runs **before** the transaction.
2. Load the race and append the session. Interval merging is unchanged.
3. `recomputeRaceAggregates`. It now clamps to the runtime and writes `creditedViewingSec`.
4. Viewing XP. Unchanged.
5. The Story Complete bonus. When `aggregates.becameStoryComplete`, it is awarded exactly as today (including its season XP while the season is open). **New: when `aggregates.storyCompletedAt === null` and `story-complete:<raceId>` is held, the row is revoked** (a legacy race whose stored intervals ran past a shortened runtime can lose its completion once the clamp applies). The revocation is kept for step 16a.
6. **`reconcileExpedition(db, userId, race.id, now, { crossingSessionId: session.id })`** (§4.3.3). On this path coverage only grows and the runtime cannot change, so it only awards; its result is kept for the outcome.
7. Momentum and streak. Unchanged.
8. `ensureMasteryTrees`, `ensureSeasonCollections`, `recomputeRaceMasteries`. These include the event changes (§3.2.10).
9. `syncCollections`, then **`syncMastery`** (now writing missing event-step credits for every unlocked step before paying anything, §4.2.5), then `evaluateChallenges`.
10. **`const { metrics, history } = await computeCareerMetricsWithHistory(userId, db)`**, replacing `computeCareerMetrics`.
11. `syncAchievements(db, userId, metrics, now)`, then `syncMilestones(...)`. Unchanged.
12. **`syncCareerMilestones(db, userId, { metrics, history, now })`** (§4.1.3).
13. **`fillLandmarkDates(db, userId, { history, now, recognisedBySessionId: session.id })`** (§4.1.4).
14. The season pass. Unchanged.
15. `syncAwards`. Unchanged.
16. **Expedition Summary:** if the race is an Expedition, Story Complete by replay and has no summary, call `writeExpeditionSummary(db, userId, race.id, now, { retrospective: !aggregates.becameStoryComplete, history: replayRace(raceRow, history.sessions.filter(s => s.raceId === race.id)), unlocks: aggregates.becameStoryComplete ? { achievements, milestones, careerMilestones, mastery } : undefined })` (§4.3.6). This is "whenever a summary is missing", not only on the completing stint, so a summary never depends on a one-off moment. When this stint did not complete the story, the summary is retrospective and its unlock lists are reconstructed from the completing stint.

    16a. **`settleLedger(db, userId, [storyBonusRevocation, expedition.revocation])`** (R13). A no-op unless step 5 revoked (step 6 cannot on this path); it runs after the last award, so everything awarded after the revocation is re-stamped.
17. Outcome. It adds `careerMilestones: CareerMilestoneUnlock[]` (from **`listStintCareerMilestones(db, userId, session.id)`**), `expedition: ExpeditionOutcome | null`, and `coverageBeforeSec`, `coverageAfterSec`, `runtimeSec` (for `formatCoveragePercent`). It extends `chooseCelebration` with the facts `expeditionCompleted` and the highest career-milestone celebration (§4.7.3).

**`deleteViewingSession`**:
1. `revokeSessionXp`, then delete the stint.
2. **`rebuildRaceIntervals`** (the shared version of the existing code).
3. `recomputeRaceAggregates`.
4. The Story Complete revoke. Unchanged.
5. **`reconcileExpedition(db, userId, raceId, now)`**. It revokes checkpoints the remaining coverage no longer supports; nothing new can qualify on this path.
6. **`settleLedger`** with every revocation above, replacing the direct `rebuildCareerTotals` + `rebuildSeasonXpFromLedger`.

`SessionRemoval` adds `expeditionXpRemoved: number` and `checkpointsRemoved: number[]`. Landmarks are untouched, including milestones, event steps and summaries.

**`deleteRaceAction`** now calls `deleteRace(userId, raceId, now)` (§4.6).

**`updateRaceAction`** runs these steps inside its existing transaction:
1. **Before** the `race.update`, if the event could change (the form posts `eventKey`/`newEventName`), **`writeMissingEventStepCredits(tx, userId)`** (§4.2.5), so the race's contributions to its current event's unlocked steps are recorded before it moves.
2. The `race.update`. **Event resolution:** the form field is replaced (§4.2.3), and `resolveEventForRaceInput` produces the `iconicKey` and `raceMasteryId` values to write.
3. If `runtimeSec` changed, **`rebuildRaceIntervals`**.
4. `recomputeRaceAggregates`.
5. **`resyncAfterRaceEdit(db, userId, raceId, now, { runtimeChanged })`**, a new function in `src/lib/engines/progression-resync.ts`:
   1. `reconcileStoryBonus` (§3.2.10).
   2. `reconcileExpedition(…, { resize: runtimeChanged })`: a runtime edit re-sizes held checkpoints to the new schedule and revokes those the new runtime no longer supports (§4.3.3).
   3. `ensureMasteryTrees`, `recomputeRaceMasteries` (caches).
   4. **Only when the runtime did not change:** `syncMastery`, then `computeCareerMetricsWithHistory`, `syncAchievements`, `syncMilestones`, `syncCareerMilestones`, `fillLandmarkDates`. A runtime change is exactly the edit most likely to be a typo that is corrected a minute later, and landmarks can never be taken back, so after a runtime change the landmarks wait for the next stint, as they did in 0.3.2. Balances (the Story Complete bonus and checkpoints) follow the edit immediately, because they can be undone.
   5. `settleLedger` with every revocation.
   6. It **never** writes an Expedition Summary (a typo could otherwise leave a permanent summary behind).

It returns `{ xpAwarded, xpRevoked }`, and the action's message names them ("Saved. The Story Complete bonus came off because the race now runs to 6:10:00.").

**`logSessionAction`, `deleteSessionAction`, `deleteRaceAction`, `updateRaceAction`, and the event and expedition actions** do two extra things:
- **Before** their write, they call `await ensureChroniclesFrozen(userId, new Date()).catch(log)` (§4.5.2). It does nothing until the account's upgrade is complete and until a finished year's grace period is over.
- **After** their write, they call `clearCareerTimelineCache(userId)`.

`revalidatePathsAfterSession` (`actions.ts:339`) adds `/chronicle`, `/events`, `/career/milestones` and `` `/races/${raceId}/expedition` ``.

**`recompute` and the upgrade backfill**: see §5.

### 4.1 Career Milestones

#### 4.1.1 What the user sees
- A new page, **`/career/milestones`**. The Career nav item highlights it through the existing prefix match.
- The Career page (`src/app/career/page.tsx`) gets a panel, "Career Milestones", showing the three most recent milestones and a "See all" link.
- The page groups the milestones:
  - Firsts;
  - Complete race stories;
  - Career hours;
  - Races experienced;
  - Years;
  - Recurring events.
  A **By date** toggle switches to a single reverse-chronological timeline instead.
- Every reached milestone shows its date and time, how precise that is (the label comes from `achievedPrecision`), the race or event it happened in (a link while it still exists, otherwise `subjectName`), and its XP only when XP > 0. A 0-XP milestone shows "Celebrated by …", listing its `alsoPaidBy`. Where a matching Hall of Fame plaque exists, the milestone also links to it. A `major` milestone is drawn as a highlighted card (the accent border and soft fill of the "Season Complete" block, `stint-summary.tsx:192-198`).
- Unreached milestones show a thin `TimingBar` with the text "Still ahead: 212 of 250 hours". They never mention a deadline.
- The **Years** group lists only the years whose rung was reached, each with its date. For the current year it shows a fact line, "2026 so far: 36 hours", with **no bar and no remaining figure**: a per-year target with a bar that resets every January would be a quota. Past years that fell short are never listed.

Precision labels (`precisionLabel` in `tone.ts`). Interpolated times are shown rounded to `TIMELINE_SHAPE.displayRoundingMinutes` (5), because they rest on when stints were logged (R6); the stored instant is exact.

| Precision | Label |
|---|---|
| INTERPOLATED | "Reached around 21:45 on 14 June 2030, during a stint of 24 Hours of Le Mans 2030 (worked out from when the stint was logged)" |
| STINT | "Reached with the stint logged at 21:50 on 14 June 2030" |
| RECOGNISED | "Recorded on 14 June 2030 (history cannot place it more exactly)" |

- A short note on the page explains how milestones differ from achievements: "Achievements are challenges you complete. Milestones are the permanent moments of your career. Each keeps the date it happened, even if you later change the stints behind it."
- On `/achievements`, the Segmented tab "Milestones" is renamed **"Lifetime ladders"** (`achievement-board.tsx`), with a link to Career Milestones. `getMilestoneBoard` is unchanged. The StintSummary group "Milestones" is renamed "Lifetime ladders" too, so a stint summary never shows "Milestones" next to "Career milestones".

#### 4.1.2 The catalogue: `src/lib/config/career-milestones.ts`

```ts
export type CareerMilestoneGroup = 'firsts' | 'stories' | 'hours' | 'races' | 'years' | 'events';
export type CareerMilestoneMetric =
  | 'racesStarted' | 'racesExperienced' | 'storyCompletes' | 'stories6h' | 'stories12h' | 'stories24h'
  | 'realHours' | 'realHoursYear' | 'eventEditions';
export interface CareerMilestoneDef {
  id: string;                         // stable, never reused
  group: CareerMilestoneGroup;
  title: string; description: string;
  metric: CareerMilestoneMetric;      // MilestoneProgress.metric; realHoursYear rows use `realHoursYear:<year>`
  threshold: number | 'annualHours'; // 'annualHours' → BUDGET_CONFIG.annualHours
  kind: 'time' | 'count';
  owner: 'ladder' | 'career';         // ladder = an existing MILESTONES rung, created and paid by syncMilestones
  xp: number;                         // paid by syncCareerMilestones when owner === 'career'; 0 = recorded only
  alsoPaidBy: readonly string[];      // why xp is 0 (human-readable)
  hallOfFameKeys: readonly string[];  // link targets only; nothing is minted
  celebration: 'none' | 'notable' | 'spectacular';   // 'none' = listed in the stint summary only
}
export const CAREER_MILESTONES: readonly CareerMilestoneDef[];
export function careerMilestoneThreshold(def: CareerMilestoneDef): number;
export function careerMilestoneMetricKey(def: CareerMilestoneDef, year?: number): string;
export function careerMilestoneDedupeKey(def: CareerMilestoneDef, year?: number): string;
//   `milestone:${metric}:${threshold}` for every rung, except `milestone:realHoursYear:<Y>` for year-plan (no number in it)
export const CAREER_MILESTONES_BY_ID: ReadonlyMap<string, CareerMilestoneDef>;
export function isMajorMilestone(def: CareerMilestoneDef): boolean;   // celebration !== 'none'
```

| id | Title | metric ≥ threshold | owner | XP | Also paid by / note | celebration |
|---|---|---|---|---|---|---|
| `first-race-started` | First race started | racesStarted 1 | career | **0** | "The Green Flag achievement and the first viewing-session rung": the same instant as the first stint (R4) | none |
| `first-race-completed` | First complete race story | storyCompletes 1 | ladder (720) | — | In this app a race is completed when its story is (§3.1), so it is one moment, one card. HoF `first:story-complete`, `first:race-completed`. | notable |
| `first-6h` | First 6-hour race completed | stories6h 1 | career | **500** | — | none |
| `first-12h` | First 12-hour race completed | stories12h 1 | ladder (1,400) | — | HoF `first:race-12h` | notable |
| `first-24h` | First 24-hour race completed | stories24h 1 | ladder (2,400) | — | HoF `first:race-24h` | notable (the stint is already SPECTACULAR through the long-haul Story Complete rule) |
| `stories-10/25/50/100` | 10 / 25 / 50 / 100 complete race stories | storyCompletes N | ladder | — | HoF `milestone:stories:{10,50,100}` | none / none / notable / spectacular |
| `hours-100` | 100 career hours | realHours 100 | ladder | — | HoF `milestone:real-hours:100` | none |
| `hours-250` | 250 career hours | realHours 250 | career | **1,000** | — (not in `HOUR_STEPS`) | none |
| `hours-500`, `-1000`, `-5000`, `-10000` | … career hours | realHours N | ladder | — | HoF for 500, 1,000 | notable / spectacular / spectacular / spectacular |
| `hours-2500` | 2,500 career hours | realHours 2500 | career | **0** | "The Archive achievement" | spectacular |
| `races-100/250/500/1000` | 100 / 250 / 500 / 1,000 races experienced | racesExperienced N | career | **500 / 750 / 1,000 / 1,500** | — | none / none / notable / spectacular |
| `year-plan` | {annualHours} hours in {year} — two full weeks of racing | realHoursYear:{Y} ≥ annualHours | career | **1,000 per year** | — | notable |
| `event-editions-5/10/25` | 5 / 10 / 25 editions of one recurring event | eventEditions N | career | **0** | "That event's own steps (Five / Ten / Twenty-Five Editions Experienced) pay it, once per event" | none / notable / notable |

- "Races experienced" is the brief's word; §3.1 defines it (a tenth of the race, or an hour, and ten minutes of viewing).
- `eventEditions` counts **editions experienced** (the Event Legacy headline "9 editions experienced"). It is not Story-Complete editions, which the existing `edition_5`/`edition_10` steps and *A Decade of Devotion* already pay.

Invariants, tested in `config.test.ts`:
- Every `owner: 'ladder'` pair (metric, threshold) exists in `MILESTONES`.
- Every `owner: 'career'` pair does **not** exist in `MILESTONES`, so it can never collide with `milestone:<metric>:<threshold>` of a ladder.
- `xp === 0` if and only if `alsoPaidBy.length > 0` for career rows.
- Ids are unique, and no dedupe key contains a configurable number (the year rung's key is `milestone:realHoursYear:<Y>`).

The literal 336 never appears: `year-plan` uses `'annualHours'`.

#### 4.1.3 `syncCareerMilestones` (new engine `src/lib/engines/career-milestone-engine.ts`)

```ts
export interface CareerMilestoneUnlock {
  id: string; title: string; metric: string; threshold: number;
  achievedAt: string | null; precision: MilestonePrecision | null;   // ISO for the JSON route
  subjectName: string | null; xpAwarded: number; celebration: 'none' | 'notable' | 'spectacular';
}
export async function syncCareerMilestones(tx: Tx, userId: string, input: { metrics: CareerMetrics; history: TimelineInputs; now: Date }): Promise<{ created: number; xpAwarded: number }>;
```

The algorithm creates and pays, but does not date; dating is §4.1.4.
1. Read `milestoneProgress.findMany({ where: { userId }, select: { metric, threshold } })` into a set of reached `(metric, threshold)` keys and a set of reached metrics.
2. Compute the values:
   - `racesStarted`, `racesExperienced`, `stories6h` and `realHours` from `metrics` (so recognition uses the same rounding as the ladders; §3.2.5 explains how the replay matches it);
   - `creditedSecondsByYear` in one pass over `history.sessions`, split over the stint windows (R6) and restricted to year boundaries, in whole seconds (it shares the helper with `landmarks.creditedSecondsByLocalYear`, which does not need the interval replay);
   - `eventEditions = metrics.maxEditionsExperiencedOfOneEvent` (distinct experienced edition identities in one event, from the race rows' coverage and credited seconds, §3.2.10).
3. For each `owner: 'career'` def whose value has reached its threshold and has no row:
   - For `realHoursYear`, do this once per year Y with `creditedSecondsByYear.get(Y) ≥ annualHours × 3600`, using metric `` `realHoursYear:${Y}` ``. A year counts as reached when **any** row has that metric, whatever its threshold, so re-tuning `annualHours` never adds a second row for a year.
   - Create a `MilestoneProgress` row: `{ metric, threshold, reachedAt: now, valueAtReach: value, xpAwarded }`.
   - If `def.xp > 0`, first call `awardXp(tx, userId, { source: 'MILESTONE', amount: def.xp, description: `Career milestone — ${title}`, sourceRef: `${metric}:${threshold}`, dedupeKey: careerMilestoneDedupeKey(def, Y) })`, and store `granted` in `xpAwarded`. If `def.xp === 0`, write no ledger row.
   - Use `upsert` on `userId_metric_threshold` with an empty `update`, so a concurrent writer can never duplicate a row.
4. It never touches ladder-owned rows: `syncMilestones` still owns them (A1, "existing rungs keep current XP").

#### 4.1.4 `fillLandmarkDates`

```ts
export async function fillLandmarkDates(tx: Tx, userId: string, input: { history: TimelineInputs; now: Date; timeline?: CareerTimeline; recognisedBySessionId?: string }): Promise<{ milestones: number; eventSteps: number }>;
```

1. Find the undated landmarks:
   - `milestoneProgress.findMany({ where: { userId, achievedPrecision: null, reachedAt: { not: null } } })`;
   - `masteryProgress.findMany({ where: { userId, achievedPrecision: null, unlockedAt: { not: null }, node: { tree: { kind: 'RACE_EVENT' } } }, select: { id, unlockedAt, node: { select: { metric, threshold, tree: { select: { iconicKey } } } } } })`.
2. If both lists are empty, return. This is the usual case per stint, and it keeps the replay off the hot path.
3. Rows that cannot be replayed (a non-replayable milestone metric) are marked `RECOGNISED` straight away. Build the timeline only if some undated row is replayable: `timeline = input.timeline ?? buildCareerTimeline(history.sessions, history.races)`.
4. For each replayable milestone row:
   - `instant = milestoneInstant(timeline, metric, threshold)` (which uses `recognitionThresholdSeconds`, §3.2.5).
   - If `instant` and `acceptInstant(instant, row.reachedAt, TIMELINE_SHAPE.recognitionSlackMinutes)`, then `updateMany({ where: { id, userId, achievedPrecision: null }, data: { achievedAt: instant.at, achievedPrecision: instant.precision, sessionId, raceId, eventId, subjectName } })`.
   - Otherwise set `achievedPrecision: 'RECOGNISED'`, leave `achievedAt` null, and set `sessionId` to `input.recognisedBySessionId` when the row's `reachedAt` lies in that stint's unlock window (the live stint that recorded it), so the stint's summary still lists it.
   - The acceptance test stops a replay from putting a landmark **after** the moment the app recorded it. That can happen once stints have been deleted since.
5. Event steps get the same treatment with `eventStepInstant(timeline, tree.iconicKey, metric, threshold)` into `achievedAt/achievedPrecision/achievedSessionId`.
6. Rows are never written again once `achievedPrecision` is set (R11). That is the documented **immutability rule**: deleting, editing or backdating stints never moves a milestone's date, and a milestone is never removed. Statistics change; landmarks do not.

`listStintCareerMilestones(db, userId, sessionId)` returns the catalogue rows with `sessionId = sessionId`, mapped through `CAREER_MILESTONES`. For the per-year rows, it matches the `realHoursYear:` prefix and formats the title with the year. The live outcome and `buildOutcomeForSession` both use it.

#### 4.1.5 The view model

```ts
export interface CareerMilestoneItem {
  id: string; group: CareerMilestoneGroup; title: string; description: string; celebration: 'none' | 'notable' | 'spectacular';
  reached: boolean; date: Date | null; precision: MilestonePrecision | null; recognisedAt: Date | null;
  subject: { kind: 'race' | 'event'; href: string | null; name: string } | null;
  xp: number; alsoPaidBy: readonly string[]; hallOfFame: { title: string; href: string } | null;
  progress: { value: number; target: number; unit: 'hours' | 'count' } | null;   // unreached, non-year items only
}
export interface CareerMilestonesView {
  groups: { group: CareerMilestoneGroup; title: string; items: CareerMilestoneItem[] }[];
  timeline: CareerMilestoneItem[];                 // reached, date desc (date = achievedAt ?? reachedAt)
  currentYear: { year: number; creditedSeconds: number; reached: boolean };   // a fact, never a bar
}
export async function getCareerMilestonesView(userId: string, now: Date): Promise<CareerMilestonesView>;
```

Data sources:
- the milestone rows;
- `computeCareerMetrics` (live values for progress);
- `getCareerTimeline` (current-year credited hours and event editions);
- `hallOfFameEntry.findMany({ where: { userId, key: { in: keys } } })`;
- race and event name lookups for links.

It makes no per-item queries.

**Empty state** (a new account with two races): Firsts shows "First race started", reached with its date. The rest show progress. The page never shows an empty grid.

**Ten-year scale**: about 25 catalogue items plus one `year-plan` row per reached year, so no pagination is needed.

#### 4.1.6 Celebration
- `chooseCelebration` takes the highest `celebration` among `outcome.careerMilestones`: `'spectacular'` gives SPECTACULAR, `'notable'` gives at least NOTABLE.
- NOTABLE becomes visible (today `stint-summary.tsx:31` only distinguishes SPECTACULAR, so NOTABLE looks exactly like QUIET): the stint summary heading takes the accent colour, and the unlock block enters with the existing `rise` animation. It is CSS only, so the global reduced-motion rule (`globals.css:208-214`) covers it.
- StintSummary gets an UnlockGroup **"Career milestones"** (a `Milestone` icon from lucide) listing the titles and the precision line. A milestone with `celebration !== 'none'` is drawn as the highlighted block (the "Season Complete" style, `stint-summary.tsx:192-198`) rather than as an `UnlockRow`. `hasUnlocks()` includes the group.
- The "Lifetime ladders" group (renamed from "Milestones") excludes catalogue rows, so nothing is listed twice. The exclusion checks `(metric, threshold)` against the catalogue, including the `realHoursYear:` prefix.
- A pure `celebrationView(outcome): { level; highlighted: CareerMilestoneUnlock[]; headline: string }` helper decides all of this, so it is testable in the node test environment (there are no component tests).
- Reduced motion is handled by the global CSS rule. No JS animation is added.

### 4.2 Event Legacy

#### 4.2.1 Model
- A recurring **event** is a `RaceMastery` row. Its `key` is immutable.
- A race belongs to an event through `Race.raceMasteryId`. The invariant `race.iconicKey === event.key` is kept whenever `raceMasteryId` is set, so every existing grouping by `iconicKey` keeps working: metrics, stats favourites and mastery scopes.
- The event's name is `displayName ?? name`, where `name` is still derived by `eventDisplayName(key)` and still overwritten by `recomputeRaceMasteries`.
- Its steps are the `RACE_EVENT` tree `event:<key>` (existing), with the nodes of §3.3 appended.
- "Major event" is decoupled: the event picker is always shown, and saving with "Major event" off no longer clears the link, which fixes `actions.ts:118` and `:172`.

#### 4.2.2 Management operations

These live in the new engine `src/lib/engines/event-legacy-engine.ts`. Every operation is transactional and account-scoped. **Every operation that can change which event a race belongs to (link, unlink, merge, the race form, delete race) first calls `writeMissingEventStepCredits(tx, userId)`**, so the steps the race already helped its current event reach are recorded before it moves (§4.2.5).

```ts
export interface EventRef { id: string; key: string; name: string }
export async function resolveEventForRaceInput(tx: Tx, userId: string, input: { eventKey?: string; newEventName?: string }, now: Date): Promise<EventRef | null>;
export async function createEvent(tx: Tx, userId: string, name: string, now: Date): Promise<{ ok: true; event: EventRef } | { ok: false; existing: EventRef }>;
export async function renameEvent(tx: Tx, userId: string, key: string, displayName: string): Promise<EventRef>;
export async function mergeEvents(tx: Tx, userId: string, fromKey: string, intoKey: string, now: Date): Promise<{ racesMoved: number; stepsCarried: number }>;
export async function linkRaces(tx: Tx, userId: string, key: string, raceIds: readonly string[], now: Date): Promise<number>;
export async function unlinkRace(tx: Tx, userId: string, raceId: string, now: Date): Promise<void>;
export async function setEventArchived(tx: Tx, userId: string, key: string, archived: boolean, now: Date): Promise<void>;
export async function resolveActiveEvent(tx: Tx, userId: string, key: string): Promise<EventRef | null>;   // follows mergedIntoId, ≤ maxMergeHops, userId-scoped
export async function getEventSuggestions(userId: string): Promise<EventSuggestion[]>;                       // §4.2.6
export async function suggestEventForName(userId: string, raceName: string, circuit?: string): Promise<EventRef | null>; // Add Race preselect
```

**Keys.** A new event's key is `normaliseEventKey(name)`. If that key already exists for the account, including archived and merged events, suffixes `-2`, `-3` … are appended. **Keys are never reused.** Existing free-text keys stay exactly as they are.

**Names are unique among active events.** An active event "matches" a name when `normaliseEventKey(name)` equals `normaliseEventKey(key)` or `normaliseEventKey(displayName ?? name)`.
- `createEvent` (the Events page) returns `{ ok: false, existing }` when an active event matches; the action says "You already follow {name}" and links to it. It never creates a look-alike.
- `resolveEventForRaceInput` with `newEventName` reuses a matching active event instead of creating one. That match makes the old re-casing exploit impossible.
- `renameEvent` is rejected when another active event matches the new name.

**`resolveEventForRaceInput`**:
- `newEventName` wins: reuse a matching active event, or create one with `createdByUser: true` and `displayName: name`.
- If only `eventKey` is given (from the select, or from the seed script's legacy `iconicKey`), it looks the key up for the account and follows `mergedIntoId` to the survivor (`resolveActiveEvent`). An unknown key creates the event with that exact key: this is the legacy path, used by the seed and tests.

**Rename** sets only `displayName`, trimmed to 1–80 characters, then runs `ensureMasteryTrees` so the tree name follows. **No XP moves.**

**Merge** (`from` ≠ `into`, both active):
1. `writeMissingEventStepCredits`.
2. `race.updateMany({ where: { userId, OR: [{ raceMasteryId: from.id }, { iconicKey: from.key }] }, data: { raceMasteryId: into.id, iconicKey: into.key } })`.
3. Update `from`: `{ archivedAt: now, mergedIntoId: into.id }`.
4. `ensureMasteryTrees`.
5. **Carry-over.** For every node key that is unlocked in `from`'s tree and not unlocked in `into`'s:
   - upsert `into`'s `MasteryProgress` with `unlockedAt`, `achievedAt`, `achievedPrecision` and `achievedSessionId` copied from `from`'s row;
   - write **no** ledger row.

   The dates are preserved, and `syncMastery` then treats those steps as already unlocked, so it pays nothing for them.
6. `recomputeRaceMasteries`, then `syncMastery` (with credits), then `computeCareerMetricsWithHistory`, `syncCareerMilestones` and `fillLandmarkDates`.

`from`'s tree and its unlocks stay: they are landmarks. `/mastery` hides trees whose event has `mergedIntoId` set, and `/events/<fromKey>` redirects to the survivor. **A merge cannot be undone**, and the confirm dialog says so.

**Link and unlink**: `writeMissingEventStepCredits`, then set or clear `iconicKey` and `raceMasteryId` on the account's races, then run the same resync as a merge (step 6). **Unlinking never takes XP back.** The event's figures drop, and its steps stay unlocked.

**Archive** is allowed only when the event has no races; otherwise the action says "Move or unlink its races first". **Unarchive** is allowed only for an event that was archived by hand (`mergedIntoId` null); a merged event stays merged. Chains are followed at most `EVENT_SHAPE.maxMergeHops` hops, each hop scoped by `userId`. Events are **never deleted**: an archived event is simply hidden.

#### 4.2.3 The race forms (`add-race-form.tsx`, `edit-race-form.tsx`, `actions.ts`)
- Replace the free-text `iconicKey` field and its `isMajorEvent ?` guard with a **Recurring event** `Select`, which is always visible:
  - "None";
  - the account's active events, by display name;
  - "New event…".

  "New event…" reveals an `Input name="newEventName"` with a datalist of `MAJOR_EVENT_SUGGESTIONS` names, as naming convenience only.
- The select posts `eventKey`.
- `raceFormToObject` reads `eventKey` and `newEventName`. `raceInputSchema` gains `eventKey: optionalText(80)` and `newEventName: optionalText(80)`. It keeps `iconicKey: optionalText(80)` as a legacy alias, read as `eventKey` when `eventKey` is absent.
- `createRaceAction` and `updateRaceAction` write `iconicKey` and `raceMasteryId` from `resolveEventForRaceInput`. The edit form preselects the race's event.
- The Add Race form preselects the top `strong` link suggestion for the typed name. It calls `suggestEventForName` through a small server action on blur of the name field, and the user can change the choice.
- Replace `getIconicKeysInUse` with `getEventOptions(userId): Promise<{ key: string; name: string; editions: number }[]>` in `src/lib/server/races.ts`.

#### 4.2.4 Pages
**`/events`** (`src/app/events/page.tsx`, nav item "Events", icon `Repeat`):

*Header.* "Recurring events", with an action **Create an event** (a `Dialog` with a name field).

*"Suggested" panel.* It appears only when `getEventSuggestions` returns items.
- Each item has **Link / Create / Merge** and **Dismiss** buttons. **Create** opens the create dialog with the proposed name editable. **Merge** opens the event page's merge confirm dialog ("This combines {from} into {into}. It cannot be undone. Nothing is paid twice.").
- **Link all strong suggestions** (shown when there are at least two strong link suggestions) links them in one action, after a confirm listing them.
- Dismissing appends the id to `ConfigOverride` `dismissedEventSuggestions`, capped at `EVENT_SHAPE.dismissedSuggestionLimit`.

*The event list.* A grid of cards, sortable (Segmented: Most watched · Most editions · Recent · A–Z) and filterable with a search `Input`. It renders the first 30 cards, then a "Show more" control.

Each card shows:
- the name and accent (the tree's accent);
- the headline sentence;
- editions experienced;
- credited hours;
- complete race stories;
- the latest edition year;
- a thin bar of the event's steps unlocked out of the total.

An "Archived and merged events" `<details>` lists the rest.

*Empty state.* "An event gathers every edition of a race you follow — every Le Mans, every Sebring. Create one, or pick one on a race's edit page." It keeps the Suggested panel if there is anything in it.

**`/events/[key]`** (`src/app/events/[key]/page.tsx`):
- Links are built with `encodeURIComponent(key)`, because legacy keys are free text.
- The page looks the key up as Next passes it. If that fails, it looks up `decodeURIComponent(key)` (inside try/catch); the Next docs in `node_modules/next/dist/docs` do not state whether a dynamic segment arrives decoded, so the page handles both.
- It returns `notFound()` when the account has no such event, and `redirect()` to the survivor for a merged event.
- A `loading.tsx` using the existing `Skeleton` primitive covers the page while it builds.

The page shows:
1. **Header.** The display name. The eyebrow names the associated championships. The headline sentence is built by `eventLegacyHeadline(stats)` in `tone.ts`, for example "24 Hours of Le Mans — 9 editions experienced — 181h 42m watched — 8 complete race stories". Actions: Rename (Dialog), Merge into… (a Dialog with a Select of active events and the cannot-be-undone confirm text), Add races, and Archive (only when there are no races).
   - **Add races** is a `Dialog` with a search `Input`; it lists the account's unlinked races, suggested ones first, then by most recent, at most `CAREER_STATS_SHAPE.addRacesDialogLimit` (50) at a time, so it works for a library of thousands.
2. **Stat grid** (`Stat`, `grid-cols-2 sm:grid-cols-4`):
   - First edition watched (edition year and date);
   - Most recent edition watched;
   - Editions experienced;
   - Editions Story Complete;
   - Total real viewing time (credited);
   - Unique race coverage;
   - Re-watch time;
   - Consecutive complete editions (the longest run with its years, e.g. "3 · 2024–2026"), plus, as a sub-line, the longest run of consecutive experienced editions. Runs are history; the page never shows a "current streak";
   - Longest edition (runtime);
   - Highest completion percentage (`formatCoveragePercent`).
3. **Edition history.** One row per edition, sorted by edition year descending, with undated editions last. Each row shows the year, the race name (a link to `/races/[id]`), the championship, the runtime, a completion `TimingBar` with `formatCoveragePercent`, a Story Complete badge with its replay date, credited time, the number of stints, and an Expedition badge. Years missing between the first and latest edition appear as muted rows: "2024 — not in your library". Five or more consecutive missing years collapse into one row: "2011–2015 — not in your library".
4. **Legacy steps.** The tree's nodes, grouped in this order: Editions experienced · Complete editions · Complete in a row · Hours here; sorted by threshold within a group. Each row shows its state, its date (`achievedAt ?? unlockedAt`, with a precision label) and, as a secondary chip, its XP. The group headings carry the explanation "Steps added in 0.4.0 are smaller extras", so rising-and-falling XP between groups does not read as a mistake. An XP-free unlock shows "Recorded — these editions were already counted for this step in another event". A note links to `/mastery`.

*Thin states.* An event with no linked races shows "No editions linked yet" with the **Add races** action instead of the stat grid. An event with editions but nothing experienced yet shows the edition history and the steps, and the stat grid shows only the figures that exist.

The view model:

```ts
export interface EventLegacyView {
  event: { id: string; key: string; name: string; createdByUser: boolean; archived: boolean; mergedFrom: { key: string; name: string }[] };
  headline: string;
  stats: { editionsInLibrary: number; editionsExperienced: number; editionsStoryComplete: number;
    firstEditionWatched: EditionRef | null; mostRecentEditionWatched: EditionRef | null;
    creditedSeconds: number; uniqueCoverageSeconds: number; rewatchSeconds: number;
    longestCompleteRun: Run | null; longestExperiencedRun: Run | null;
    longestEdition: (EditionRef & { runtimeSec: number }) | null;
    highestCompletion: (EditionRef & { percentText: string }) | null; undatedEditions: number };
  championships: { id: string; name: string; accentColor: string; editions: number }[];
  editions: ({ kind: 'edition'; raceId: string; name: string; editionYear: number | null; championshipName: string | null;
      runtimeSec: number; completionPercentText: string; storyCompletedAt: Date | null; creditedSeconds: number;
      sessions: number; isExpedition: boolean } | { kind: 'missing'; fromYear: number; toYear: number })[];
  steps: { nodeKey: string; name: string; description: string; group: 'experienced' | 'complete' | 'in-a-row' | 'hours';
      threshold: number; value: number; unlocked: boolean; date: Date | null; precision: MilestonePrecision | null;
      xp: number | null; recordedOnly: boolean }[];
}
export interface EditionRef { raceId: string; name: string; editionYear: number | null; at: Date }
export async function getEventLegacy(userId: string, key: string, now: Date): Promise<EventLegacyView | { redirectTo: string } | null>;
export async function getEventsIndex(userId: string, now: Date): Promise<EventsIndexView>;
```

These are computed from `getCareerTimeline` (the event's races, filtered in memory) plus one query each for the tree and progress, the ledger rows `dedupeKey: { in: node keys }`, and the event rows. "First/most recent edition watched" is chronological by first and last stint instant: it describes the career's history.

**Race page link.** The header label row of `race-detail-view.tsx` gains `Edition {year} of {event}`, linking to `/events/[key]`. When there is no event, a strong suggestion shows as a one-line prompt: "Looks like an edition of 24 Hours of Le Mans — Link".

**`/mastery`**: each event tree card links to `/events/[key]`.

#### 4.2.5 Event-step XP: dedupe plus credits
- Keys are unchanged: `mastery:event:<key>:<nodeKey>`. Because the key is immutable, a rename creates no new tree.
- **The rule:** every race can help pay each kind of event step (each `nodeKey`) once, in any event. A race's credit for a step is written as soon as the race contributes to that step being reached, whether the step paid or was already reached, and whichever event it was in.
- `writeMissingEventStepCredits(tx, userId, loaded?)` (in `mastery-engine.ts`): for every **unlocked** `RACE_EVENT` progress row (paid or XP-free), insert a credit for every current contributor (table below) that has none. It uses the credit set it is given (or loads it once) and `createManySkippingDuplicates(tx.eventStepCredit, rows, filter)` with a `filter` built from that set, so the steady state writes nothing and logs no `prisma:error` (`client.ts:84-97`).
- `syncMastery`, for `RACE_EVENT` trees only:
  1. Load `eventStepCredit.findMany({ where: { userId }, select: { nodeKey, raceId, fingerprint } })` once per sync.
  2. Run `writeMissingEventStepCredits` with that set, **before** anything is paid. This records late editions of steps reached earlier (an edition added after `edition_5` unlocked is credited for `edition_5` on the next sync), so no later move can make them pay the same step again.
  3. `creditedFor(nodeKey, race)` is true when any credit with that `nodeKey` has `raceId === race.id`, or when its `raceId` is not a current race of the account **and** `fingerprintMatches(credit.fingerprint, editionFingerprint(race))` (§3.2.3). The second case is a tombstone, and it closes delete-and-recreate.
  4. When a node becomes newly unlocked, work out whether it pays:
     - `payable = computeEventMetrics(members.filter(r => !creditedFor(node.key, r)))`.
     - If `node.xpReward > 0` and `metricValue(payable, node.metric) ≥ node.threshold`, pay as today, then write credits for its contributors.
     - Otherwise set the unlock **XP-free**: `unlockedAt` is set, no `awardXp` call is made, `MasteryUnlock.xpAwarded` is 0, and its contributors are credited too.
  5. The contributors for each metric:

     | Metric | Contributors |
     |---|---|
     | `editionsStoryComplete` | SC member races |
     | `editionsExperienced` | experienced member races |
     | `consecutiveEditions` | SC races whose year is in the longest run |
     | `realHours` | members with credited seconds > 0 |
- `deleteRace` calls `writeMissingEventStepCredits`, then writes the tombstones before it deletes (§4.6, step 5).
- The credit set is one indexed read per sync (a Large career holds on the order of 20,000 credits); the perf harness measures `logViewingSession` with it (§1.3).
- **What this means for the owner** (said in the event page note and in §9.4): moving an edition to another event never pays a step twice. The price is that a race mistakenly linked to the wrong event, then moved to the right one, does not pay again the steps its wrong event had already reached; every step it has not yet helped reach is still payable.

#### 4.2.6 Suggestions: `getEventSuggestions(userId)`
- The inputs are the race rows (`id`, `name`, `circuitSlug`, `runtimeSec`, `championshipId`, `iconicKey`, `raceDate`, `season.year`), the events with member counts, and the dismissed set. They feed `suggestEventLinks` (§3.2.4).
- It is computed on read. There is no background job, and nothing is linked without a click.

#### 4.2.7 Fixes delivered here
- Edition year uses UTC.
- Same-year duplicates count once, in mastery, metrics and the event page.
- `updateRaceAction` now re-syncs event progression.
- "Major event" is decoupled from the event link.

### 4.3 Race Expeditions

#### 4.3.1 Eligibility (`domain/expedition.ts`)
- **Automatic**: `expeditionMode === null && scheduledDurationSec ≥ 10 h` (D3). The scheduled length is the race's advertised format, so a 10-hour race shortened by a red flag stays an Expedition.
- **On**: `expeditionMode === true`, for **any** race (D3). A race is followed as an Expedition whatever its length: the page, the timeline, the checkpoint dates and the summary all work for a 2-hour race.
- **Off**: `expeditionMode === false` always wins.
- **Checkpoint XP** is separate from eligibility: `checkpointsPayXp(runtimeSec)` is true from `EXPEDITION_SHAPE.checkpointXpMinimumHours` (6 h) of runtime. Below it, checkpoints are shown and dated but pay 0 ("Checkpoints on races of 6 hours or more also earn XP", built from config). Why 6 hours: it is the shortest classic endurance format that is usually watched across more than one sitting, and its checkpoints are still at least 60 XP; below that, a 10% checkpoint is a few minutes of racing.
- The strategist, the budget and `chooseCelebration`'s existing 12 h long-haul rule are unchanged.

#### 4.3.2 Checkpoints and XP

The schedule is `checkpointSchedule(runtimeSec)`, using non-major Story Complete bands:

| Race (runtime) | SC band | Pool (×0.4) | 10% | 25% | 50% | 75% | 90% | Total | Viewing XP for the full race at 1× |
|---|---|---|---|---|---|---|---|---|---|
| under 6 h (switched on) | — | — | 0 | 0 | 0 | 0 | 0 | **0** | — |
| 6 h (switched on) | 1,500 | 600 | 60 | 90 | 150 | 150 | 150 | **600** | 10,800 |
| 8 h (switched on) | 2,000 | 800 | 80 | 120 | 200 | 200 | 200 | **800** | 14,400 |
| 10–12 h (automatic) | 3,000 | 1,200 | 120 | 180 | 300 | 300 | 300 | **1,200** | 18,000–21,600 |
| 18 h | 4,500 | 1,800 | 180 | 270 | 450 | 450 | 450 | **1,800** | 32,400 |
| 24 h | 7,500 | 3,000 | 300 | 450 | 750 | 750 | 750 | **3,000** | 43,200 |

- **Story Complete is the sixth checkpoint.** It is shown in the list, but it pays through the existing Story Complete bonus only (R4).
- Checkpoint XP is always 40% of the race's non-major Story Complete bonus. At 1× it is at most 9.0% of the race's viewing XP (the worst case is a race just over the 18.5 h band edge: 3,000 against 33,330 at 18h31m; `work/econ-model.ts` checks every minute from 6 h to 48 h).
- At the fastest allowed playback (8×, `playback.ts:14`), checkpoints earn at most about 22 XP per real minute (3,000 XP over 139 real minutes for an 18.6 h race), below the 30 XP per real minute that viewing itself pays (`economy.ts:19`). Speed cannot make checkpoints out-earn watching; the existing Story Complete bonus already scales the same way.
- The ledger row is `awardXp(tx, userId, { source: 'EXPEDITION', amount, description: `Expedition — ${race.name}: ${pct}% of the story`, sourceRef: race.id, sessionId, dedupeKey: `expedition:${raceId}:${pct}` })`. `sessionId` is the crossing stint only when a stint is being logged; retroactive awards use `null`, so reopening an old stint's summary never shows XP granted weeks later (`session-summary.ts:37-39, 84` sums a stint's rows through that relation). `seasonAmount` is omitted, so it is 0.

#### 4.3.3 `reconcileExpedition`: XP follows the data, not the switch

```ts
export interface ExpeditionReconcile {
  isExpedition: boolean; coverageSec: number; runtimeSec: number;
  awarded: { percent: number; xp: number }[]; revoked: { percent: number; xp: number }[];
  revocation: XpRevocation;           // for settleLedger
  storyCompleted: boolean;            // Story Complete by replay now
  began: boolean;                     // the race is an Expedition and the crossing stint is its first stint
  nextCheckpoint: { percent: number; xp: number } | null;
}
export async function reconcileExpedition(
  tx: Tx, userId: string, raceId: string, now: Date,
  options?: { crossingSessionId?: string; resize?: boolean },
): Promise<ExpeditionReconcile>;
```

1. `inputs = loadRaceTimelineInputs(tx, userId, raceId)` (one race row and that race's stints; `null` → nothing to do), then `history = replayRace(inputs.race, inputs.sessions)`. Coverage is the **replay** coverage, clamped to the current runtime; the cached `race.coverageSec` is never read here.
2. `satisfied = checkpointsSatisfied(history.coverageSeconds, runtimeSec)`.
3. `held = xPTransaction.findMany({ where: { userId, source: 'EXPEDITION', sourceRef: raceId }, select: { id, dedupeKey, amount, sessionId, createdAt } })`. This uses the `(userId, source)` index, so there is no LIKE.
4. **Revoke** every held row whose percent is not in `satisfied`. That is the only reason a checkpoint is ever taken back: the viewing that reached it was deleted, or the runtime was changed so that the coverage no longer reaches it. Deleting frees the key.
5. **Resize** (only with `resize: true`, which `resyncAfterRaceEdit` passes when the runtime changed, and recompute passes as a repair): a held, satisfied row whose amount differs from `checkpointSchedule(runtimeSec)` is deleted and re-created with the same key, `sessionId` and the new amount; if the new amount is 0 (the runtime fell below 6 h), it is only deleted. Resizing never happens on the stint path, so a configuration re-balance leaves amounts already paid exactly as they were, like every other dedupe-keyed reward (`mastery-engine.ts:982-984`).
6. **Award** only when `isExpedition(race)` and `checkpointsPayXp(runtimeSec)`: every satisfied percent that is not held gets its current scheduled amount. `sessionId` is `options.crossingSessionId` if given, else `null`.
7. Return the result, including the `XpRevocation` of steps 4–5. **The caller settles** (R13): `deleteViewingSession`, `deleteRace`, `resyncAfterRaceEdit`, recompute and the backfill all end with `settleLedger`. The stint path cannot revoke (coverage only grows and the runtime cannot change inside a stint), and still passes the result to its own `settleLedger` (§4.0 step 16a) so that the invariant never depends on that argument.

**Invariant I3:** for every race, the held EXPEDITION rows are a subset of the checkpoints its replay coverage satisfies under its current runtime; each key is held at most once; each row was awarded while the race was an Expedition with checkpoint XP. A test asserts the first two after every operation in the exploit suite; the third is asserted by the toggling scenarios.

**Switching Expedition Mode off never takes XP back.** It stops new awards and nothing else. Switching it on again awards only checkpoints not already held. Dedupe keys make on/off/on pay nothing twice.

**Delete race**: `deleteRace` revokes every row returned by the `{ userId, source: 'EXPEDITION', sourceRef: raceId }` query, by exact keys.

**Retroactive award.** Switching Mode on, recompute and the 0.4.0 upgrade all call reconcile. A race already past its checkpoints receives them at that moment: the ledger's `createdAt` is now and `sessionId` is null. The Expedition page shows the crossing stint of each checkpoint from the replay (`coverageCrossing`).

#### 4.3.4 `setExpeditionModeAction(raceId, mode: 'auto' | 'on' | 'off')`

This lives in `src/lib/server/career-actions.ts` (`'use server'`), in one transaction:
1. Check ownership.
2. Write `expeditionMode` (null, true or false).
3. `reconcileExpedition` (no `resize`). Switching off awards nothing and revokes nothing (coverage and runtime are unchanged); switching on awards the satisfied, unheld checkpoints.
4. If the race is now an Expedition, Story Complete (by replay) and has no summary, `writeExpeditionSummary({ retrospective: true })`.
5. `settleLedger` (a no-op in practice; kept so the rule has no exceptions).

The messages (`expeditionModeMessage` in `tone.ts`, built from config):
- on, with checkpoints behind: "Expedition Mode is on. 3 checkpoints were already behind you: +600 XP."
- on, a race under 6 hours: "Expedition Mode is on. Checkpoints on races of 6 hours or more also earn XP."
- off: "Expedition Mode is off. Checkpoints you already reached keep their XP."
- back to automatic: "Expedition Mode follows the race's length again (automatic from 10 hours)."
- A completed summary always stays.

#### 4.3.5 The Expedition page: `/races/[id]/expedition`

`src/app/races/[id]/expedition/page.tsx`: ownership comes from `getExpeditionView(userId, raceId, now)`, which returns null for another account's race, so the page calls `notFound()`.

The race page (`race-detail-view.tsx`) gains:
- an **Expedition** panel above "Viewing history" when the race is an Expedition: the coverage meter with checkpoint ticks, the next checkpoint, and "Open the expedition";
- for every other race, a single quiet line in the details section: "Follow this race as an Expedition" with the mode control. It is available on every race (D3); on races under 6 hours it adds "(checkpoints earn XP from 6 hours)".

The **`ExpeditionModeControl`** sits on both pages. It is a `Toggle` showing the effective state ("Expedition Mode: on"), with a caption "Automatic for races of 10 hours or more" when the race follows its length, and a **Reset to automatic** link when the user has overridden it. (The three-way Automatic · On · Off control read the same for a 10-hour race whichever of the first two was chosen.) Race cards (`race-card.tsx`) show a small `Badge tone="outline"` "Expedition".

The page sections, in order:
1. **Header.** The race name, championship and event links, the mode control, and a **Log a stint** button: the same `LogSessionForm` in a `Dialog`, followed by the inline `StintSummary`, exactly as `race-detail-view.tsx:50-63` does, so an Expedition can be followed from its own page.
2. **Instruments** (`Stat` grid):
   - race duration;
   - unique coverage;
   - real viewing time (credited);
   - remaining unwatched race time;
   - current completion percentage (`formatCoveragePercent`);
   - resume position (`resumePoint`, `intervals.ts:162`);
   - number of viewing sessions;
   - expedition start date (`startedAt`);
   - elapsed real-world time since starting (`now − startedAt`, or `completedAt − startedAt`), with the note "based on when stints were logged";
   - Story Complete status.
3. **Expedition timeline** (the `ExpeditionTimeline` component, §4.3.7).
4. **Checkpoints.** A `CoverageMeter`: a `TimingBar` of unique coverage with ticks at 10/25/50/75/90. Below it, a list: each checkpoint's percent, its XP (or "no XP under 6 hours"), and when it was reached (`coverageCrossing`, STINT), or "still ahead". A checkpoint reached while the mode was off and not held says "reached — switch Expedition Mode on to count it". The last row is "Story Complete — the whole story (the Story Complete bonus)".
5. **Viewing budget.** This uses `getBudgetSnapshot(userId, now)` (existing):
   - real time left at the race's average speed (`estimateRemaining`);
   - that time as a share of `remainingHours` in the year's plan;
   - this week's `weekRemainingHours`;
   - roughly how many weeks that is at `recommendedPaceHours`.

   The text comes from `expeditionBudgetNote(...)` in `tone.ts`, which is neutral, uses the word "plan", and never says "exceeds".
6. **Championship, event and mastery.**
   - the championship mastery percentage (`getMasteryForChampionship`);
   - the event: "Edition 2026 of 24 Hours of Le Mans · 4 editions experienced", with a link, and the next event step;
   - the current Story Complete bonus band.
7. **Stints.** A table of every stint in canonical order: the date and time, the timeline window, speed, credited time, new coverage (from the replay, so it is correct after deletes), and re-watch.
8. **Expedition Summary**, when one exists (§4.3.6).

*Thin states.* An Expedition with no stints yet shows the instruments that exist (duration, remaining) and "Your expedition starts with the first stint" in place of the timeline and the checkpoint dates. A race that is not an Expedition still renders: the mode control, "This race is not an Expedition. Switch it on to follow it as one.", and the timeline.

The view model is `ExpeditionView = { race: …, mode: 'auto' | 'on' | 'off', isExpedition: boolean, checkpointsPayXp: boolean, figures: ExpeditionFigures, stints: StintEvent[], budget: {...} | null, championship: {...} | null, event: {...} | null, summary: ExpeditionSummarySnapshotV1 | null }`. It is built from one race query, that race's sessions, `replayRace`, the ledger rows for the race's EXPEDITION `sourceRef`, the summary row and the budget snapshot. It never builds the career timeline.

#### 4.3.6 The Expedition Summary (permanent)

It is written by `writeExpeditionSummary(tx, userId, raceId, now, { retrospective, history?, unlocks?, timeline?, progression? })`, and only when all of these hold:
- the race is an Expedition;
- the race is Story Complete in the replay;
- no `ExpeditionSummary` exists for `(userId, raceId)`.

There is no update path anywhere: the summary is **never rewritten**. When the race is deleted, the summary stays, with `raceId` set to null, and it remains visible in the Chronicle (§4.5.1). If the user later adds the same race again and completes it as an Expedition, that is a second completion and it gets its own summary; the Chronicle shows both, each with its own dates.

It is written from these places:
- `logViewingSession` step 16 (`retrospective` unless that stint completed the story);
- `setExpeditionModeAction`, the backfill and recompute, all with `retrospective: true`.

`resyncAfterRaceEdit` never writes one: a runtime typo that makes a race briefly Story Complete must not leave a permanent summary behind, and the real completion would otherwise be blocked by the `(userId, raceId)` unique index.

```ts
export const expeditionSummarySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  race: z.object({ id: z.string(), name: z.string(), championshipName: z.string().nullable(), eventKey: z.string().nullable(),
    eventName: z.string().nullable(), editionYear: z.number().nullable(), circuit: z.string().nullable(), runtimeSec: z.number() }),
  startedAt: z.string(), completedAt: z.string(), completingSessionId: z.string(),                 // ISO strings
  creditedSeconds: z.number(), uniqueCoverageSeconds: z.number(), rewatchSeconds: z.number(),     // up to and including the completing stint
  sessions: z.number(), calendarDays: z.number(),                                                 // local days from start to completion, inclusive
  elapsedSeconds: z.number(),                                                                     // max(completedAt − startedAt, creditedSeconds)
  averageSessionSeconds: z.number(), longestSessionSeconds: z.number(),
  finalCompletionText: z.string(),                                                                // formatCoveragePercent at completion
  xp: z.object({ viewing: z.number(), rewatch: z.number(), storyComplete: z.number(), checkpoints: z.number(), total: z.number() }),
  checkpoints: z.array(z.object({ percent: z.number(), reachedAt: z.string(), xp: z.number() })),
  mastery: z.object({
    championship: z.object({ name: z.string(), percent: z.number() }).nullable(),                // null for retrospective summaries
    event: z.object({ name: z.string(), editionsExperienced: z.number(), editionsStoryComplete: z.number() }).nullable(),
    nodes: z.array(z.object({ treeName: z.string(), nodeName: z.string(), xp: z.number() })) }),
  milestones: z.array(z.object({ title: z.string(), xp: z.number() })),
  achievements: z.array(z.object({ name: z.string(), rarity: rarityEnum, xp: z.number() })),
  records: z.array(z.object({ kind: recordKindEnum, label: z.string(), valueText: z.string() })),
  unlocks: z.enum(['live', 'reconstructed']),
});
export type ExpeditionSummarySnapshotV1 = z.infer<typeof expeditionSummarySnapshotSchema>;
```

Where each figure comes from:
- The time figures come from `replayRace`, stopping at the completing stint.
- `xp` sums ledger rows:
  - VIEWING/REWATCH rows whose `sessionId` is one of those stints (the new `sessionId` index);
  - `story-complete:<raceId>`;
  - `expedition:<raceId>:*` (whatever their `sessionId`).

  These are sums of real rows, so they are exact ("where this can be determined reliably").
- `mastery.championship` is the championship mastery percentage at that moment for a live summary. A **retrospective** summary sets it to null and the card says "Mastery at the time was not recorded", because today's percentage is not a historical fact.
- `mastery.event` is computed from the replay **cut at `completedAt`** (editions experienced and Story Complete by that instant), so it is historical in both cases.
- `mastery.nodes`, `milestones` and `achievements` come from the stint's live unlock lists. For retrospective summaries, they come from `reconstructStintUnlocks(tx, userId, completingSession)` (§3.2.11) and are marked `unlocks: 'reconstructed'`.
- `records` are the record events (§3.2.7) whose `at` is ≤ the completion instant and whose `raceId` is this race. The progression is computed from a career timeline the caller passes in (`timeline`, `progression`): the backfill and recompute build them **once per account** and pass them to every summary they write; the stint path builds them from `history` only when a summary is actually written, which happens once per race.

The summary appears in three places:
- on the race's page and its Expedition page (a raised `Panel` with `accentVars(championship colour)`);
- in the Chronicle chapter of the completion year, as the full card (§4.5.1), so it stays readable after the race is deleted;
- in StintSummary, when it was written live ("Expedition complete — see the summary", with the SPECTACULAR treatment).

#### 4.3.7 The timeline component (`src/components/races/race-timeline.tsx`)
- Extend `RaceTimeline` with the optional props `markers?: { atSec: number; label: string; kind: 'resume' | 'furthest' }[]`.
- Export the helpers `gapsBetween` and `describeCoverage` (which now uses `formatCoveragePercent`).
- Add a new `ExpeditionTimeline({ runtimeSec, intervals, stints, resumeAtSec, furthestSec, accent })`. It is a `'use client'` component inside the same file, and it draws:
  - the merged coverage bar (`RaceTimeline`, with gaps hatched);
  - **stint lanes**: each stint as a thin bar at its `[startTimestampSec, endTimestampSec]`, placed greedily into up to `EXPEDITION_SHAPE.stintLaneLimit` lanes so that overlaps (re-watches) sit on separate rows. The fill is lighter for older stints and fully saturated for the latest. Anything beyond the lane limit shows as "+n more stints";
  - the resume point and furthest point as markers. The furthest point is labelled **"Furthest point reached — not the same as watched"**.
- A caption comes from `describeFragments(intervals, runtimeSec)`, a pure string function in `src/lib/copy/tone.ts` (testable in the node test environment): "Watched in 3 stretches: 18h 12m of 24h 00m. 2 stretches still to watch, 5h 48m in total."
- `GapList` is listed below it.
- Everything readable on hover is also in the list and the caption (keyboard and touch parity).
- **Reaching the end never implies full coverage.** The completion figure is unique coverage formatted by `formatCoveragePercent` (never "100%" while any second is uncovered), and the furthest marker is labelled as above.

#### 4.3.8 The stint outcome
`SessionOutcome.expedition: ExpeditionOutcome | null`:

```ts
export interface ExpeditionOutcome {
  coveragePercentText: string;                    // formatCoveragePercent
  began: boolean;                                 // the race is an Expedition and this stint is its first
  checkpointsReached: { percent: number; xpAwarded: number }[];
  nextCheckpoint: { percent: number; xp: number } | null;
  completed: boolean;
  summaryId: string | null;
}
```

- `buildOutcomeForSession` rebuilds it from the stint's ledger rows with source `EXPEDITION`, the replay of the race (for `began` and the coverage text), plus the summary whose `snapshot.completingSessionId === sessionId`.
- StintSummary gets an UnlockGroup **"Expedition"** (the `Mountain` icon) at QUIET level. When `began` is true it says "Expedition under way — open it", so the moment an Expedition begins is visible before the first checkpoint (2.4 hours into a 24-hour race). When `completed` is true, it becomes the SPECTACULAR headline.
- The dashboard's `CurrentStint` (`src/components/dashboard/current-stint.tsx`, data from `getCurrentStint`) adds one line when its race is an Expedition: "Expedition · 62.4% · next checkpoint 75%".

### 4.4 Career Statistics

#### 4.4.1 Scope and navigation
- `/stats` stays the route. The nav label becomes **"Career Statistics"**, and so does the page title, with the eyebrow "The record".
- The page reads `?tab=overview|cadence|breakdown|career|records|compare` for its **first** render and passes `initialTab`.
  - The four core tabs (Overview, Cadence, Breakdown, Career) are always computed. Switching between them is client state, and the URL is updated with `window.history.replaceState`, which Next integrates with `useSearchParams` without a server round trip (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`, "Native History API"). Today's tab switch is instant (`statistics-view.tsx:43`), and it stays instant.
  - **Records** and **Compare** are computed only when their tab is requested. Switching to one of them is a real navigation (`router.replace` with the new `tab`) inside `useTransition`, and the tab body shows the existing `Skeleton` while it is pending.
- `src/app/stats/loading.tsx` renders `Skeleton` panels for the first load. (There are no Suspense boundaries today, so without it a slow first render looks frozen.)
- `FilterBar`'s `hasFilter` ignores `tab`, `a`, `b` and `same`. Changing a filter stays a `router.replace` (the data must be recomputed), wrapped in `useTransition` with the same pending state.

#### 4.4.2 Filters
- `StatsFilter` gains `eventKey?: string` (URL `event`), `raceId?: string` (URL `race`) and `length?: string` (URL `length`, a `DURATION_CLASSES` key).
- `buildRaceScopeWhere` maps `eventKey` to `raceMastery: { key: eventKey }`, `raceId` to `id: raceId`, and `length` to a `runtimeSec` range, always together with `userId`.
- The visible **Race length** select now lists `DURATION_CLASSES`, the same bands as the length chart and the chapter, so one page has one length taxonomy. The legacy `type` parameter (the race's own `raceType` label) is still honoured when present in a URL, and is simply no longer offered.
- `FilterBar` gets an Event select (`getFilterOptions` adds `events: { key, name, hours }[]` from the timeline) and a Race select. The Race select is shown only when a championship, event or year is chosen, and is capped at `CAREER_STATS_SHAPE.raceOptionLimit` (200) options by most-watched.
- The Records and Compare tabs respect the race filters. Compare ignores `year` and uses `a`/`b` instead. With a `year` filter, Records shows the best **within that year** (`computeRecordProgression(…, { within: yearWindow(year) })`), headed "Your best in 2027", with a link back to the career records.

#### 4.4.3 Rebuilding `loadScope` on the replay (`stats-engine.ts`)

This is the one structural change, and it makes Statistics agree with the Chronicle:

```ts
async function loadScope(userId, filter): Promise<StatsScope> {
  const timeline = await getCareerTimeline(userId);
  const races = await prisma.race.findMany({ where: buildRaceScopeWhere(userId, filter), select: STATS_RACE_SELECT });
  const include = new Set(races.map(r => r.id));
  const window = filter.year === undefined ? null : yearWindow(filter.year);
  const summary = summariseWindow(timeline, window, { weekStartsOn, include: r => include.has(r.id), meaningfulSessionSeconds, rateMinimumRaces });
  // races in scope for a year: had a stint in the window, or completed (replay) in the window
  ...
}
```

- `perRace`, `totals` and `buckets` are derived from `summary` and from each race's `RaceHistory` stints clipped to the window. `ActivityBuckets` is filled from `summary.days/months/years/weeks`.
- `realSeconds` in every existing output type now means **credited** seconds. The doc comment says so. For speeds of 0.75× and above the number is unchanged. The Overview sub-label "wall clock, re-watches included" (`statistics-view.tsx:173`) becomes "re-watches included; very slow playback counts at 0.75×".
- `newCoverageSeconds` comes from the replay, which fixes the stale-after-delete figures.
- Delete these, which the new `loadScope` replaces:
  - `loadActivityBuckets`;
  - the `raceViewingSession.groupBy` and `aggregate` inside `loadScope`;
  - `buildRacesInScopeWhere`'s year `OR` (use `summary.raceIdsWatched` plus the replay SC instants in the window);
  - the `longestSessionRow` query (`getStatistics`, `stats-engine.ts:2176`) (use `summary.longestSession`);
  - `storyCompletionsByPeriod` (use `summary.months[*].storyCompletes` and `summary.years`);
  - `loadActiveYears`'s per-year aggregates (use `summary.years` from a lifetime summary).
- `RaceTotals.racesCompleted` becomes the replay SC count in scope, the same number as `racesStoryComplete`. The UI shows one "Races completed (Story Complete)" figure. The Overview "Completion" panel drops its `library` row (`stats-engine.ts:2277`), which would now duplicate `storyLibrary`.
- `racesStarted` and `racesExperienced` come from `summary`.

New fields on `StatisticsView`:
- `rewatchSeconds`;
- `racesExperienced`;
- `storyCompleteRate` (the cohort rate, §3.1);
- `averageRaceCompletionPercent`;
- `shortestMeaningfulSession`;
- `longestRace`;
- `championshipsFollowed`;
- `eventsFollowed`;
- `byEvent`;
- `byWeekday`;
- `byDurationClass`;
- `storyCompletesByChampionship`;
- `storyCompletesByYear`;
- `completionsOverTime` (cumulative, monthly);
- `landmarksOverTime`, which is `{ month, achievements, masteryNodes, milestones }[]`, cumulative. It uses unlock dates (`achievedAt ?? unlockedAt/reachedAt`) from three `findMany` calls with `select` of the dates only;
- `xpAndLevelsByYear`: `{ year, xpEarned, levelsGained }[]` for the Year-by-year table, one ledger `aggregate` over `yearWindow(Y)` per active year plus the `levelAfter` of the last row before each window (bounded by the number of years).

Unchanged: `getXpHistory`/`monthlyXpSeries`, `getLevelHistory`, `getBudgetHistory`, `getChallengeStats` and `getSeasonPassStats`.

#### 4.4.4 Tabs and the charts that earn their place

Charts live in `src/components/charts/`. `ChartTooltip` moves there from `statistics-view.tsx:670-692`. `chart-theme.ts` holds colour tokens (`var(--accent)`, `var(--color-azure)`, grid `#222c37`, axes `#64717e`) and the rule "never pass `isAnimationActive={true}`" (R10). Every chart falls back to a sentence when it has fewer than `CAREER_STATS_SHAPE.chartMinimumPoints` (3) points ("One month so far: 12h 40m."), so no chart is drawn for decoration.

- **Overview**. The existing time, races, sessions and favourites sections, plus:
  - the Re-watch time card;
  - Races started and Races experienced ("at least a tenth watched");
  - Story Complete rate: shown only when races started is at least 5, otherwise "—" with "Needs five races";
  - Average race completion;
  - Longest and shortest meaningful session;
  - Longest race experienced;
  - Championships followed and events followed.
- **Cadence**. The existing monthly bars and year table, plus a **Weekday** bar chart ("Which evenings are race evenings": 7 bars). The Year-by-year table gains **XP earned** and **Levels gained** columns (`xpAndLevelsByYear`), so ten years of XP and levels stay readable beyond the 24-month XP chart (`STATS_CONFIG.xpHistoryDefaultMonths`).
- **Breakdown**. The existing championship and circuit tables, plus an **Event** table (link to `/events/[key]`) and a **Race length** horizontal bar chart (the `byDurationClass` hours, with the Story Complete count in the tooltip). Tables show the first `topListSize` (10) rows, then "Show all".
- **Career**. The existing XP by month and levels, plus:
  - **Race completions over time**, a cumulative step line;
  - **Story Completes by year**, bars;
  - **Landmarks over time**, a three-line cumulative chart of achievements, mastery steps and milestones.
- **Records** (new). `RecordCard`s in `RECORD_ORDER` order, from `currentRecords(computeRecordProgression(timeline, …filters))`, **only for records that are set**; the rest are named in one line below ("Still to be set: most Story Completes in a year, …"), so a new account does not see a wall of empty cards. Each card shows the value, the date, a race or event link, and an expandable "History" listing every improvement of that record. A single footnote under the grid explains the `logged-time` basis ("Records marked * depend on when stints were logged"), instead of repeating it on every card. When a filter is active the header reads "Records within: WEC · 2027".
- **Compare** (new). Two year selects (`a`, `b`); the defaults are the previous year and the current year. When **either** year is the current year, a toggle **"Same stretch of the year"** (default on) limits both to `[1 January, samePeriodEnd(year, now))`, so a year in progress is compared fairly. The tab shows:
  - `partialNote` first, when a year is the one the career began in ("Your 2026 chapter began on 22 September");
  - the `compareSummaries` rows table in `COMPARE_ROW_ORDER`: value A, value B, difference, and the percentage change or its note;
  - grouped monthly bars (A vs B, 12 months);
  - championship and event share tables (percentage points).

  Differences are worded with `differencePhrase` in `tone.ts`: "4h 10m more", "2 fewer", "the same". It never says worse, decline or behind. With fewer than two years of data, the empty state reads "Comparisons open once your career spans two calendar years. Your first full year ends on 31 December {firstYear}."

#### 4.4.5 Server entry points
- `getStatistics(userId, filter, now = new Date())` keeps its signature, plus the `now` parameter. It computes the core tabs.
- New `getRecords(userId, filter)`.
- New `getYearComparison(userId, a, b, { samePeriod, filter }, now)`.

XP for a comparison window is `xPTransaction.aggregate({ where: { userId, createdAt: { gte, lt } }, _sum: { amount } })`. That is the ledger's `createdAt` (§4.5.3).

#### 4.4.6 Performance plan
- One cached replay per account (§3.2.9) plus a handful of indexed queries per page.
- The O(n) folds use memoised week keys.
- There are no N+1 patterns: every per-race figure comes from the replay map.
- The monthly XP series keeps its bounded ≤ 60 aggregates; the Year-by-year XP columns add one aggregate per active year.
- The stats-engine query count falls from about 50 to about 25 for the core tabs; Records and Compare add their own work only when requested.
- Target: see §1.3.

#### 4.4.7 The budget and credited time
The budget engine keeps raw `realSeconds` by `watchedAt`, because it is time actually spent. `/budget` and `/stats` may therefore differ only for stints below 0.75× or stints crossing midnight. The Statistics note (`STATISTICS_NOTE`) states this in one sentence.

### 4.5 The Career Chronicle and Endurance Wrapped

#### 4.5.1 Pages
**`/chronicle`** (`src/app/chronicle/page.tsx`, nav item "Chronicle", icon `History`, placed after Career):
- The index lists every calendar year from the first stint's local year up to the current year, newest first, as `Panel` cards. Each card shows "2027 · Career Year 2", credited hours, races experienced, races completed, the top event or championship, a badge, a **Wrapped** link, and a **Read the chapter** link.
  - The **career year** is computed when the page is read, never stored: `careerYear = year − firstActivityYear + 1`, where `firstActivityYear` is the local year of the earliest stint today. Gap years count ("2029 — no racing logged" is still Career Year 4), so the numbering never skips, and it stays consistent even if an engine-backdated stint moves the first year.
  - Badges: "Year to date" (the current year); "Complete — finalising" (a finished year not frozen yet: inside its 72-hour grace period, when the badge adds "until 4 January", or while the 0.4.0 upgrade is still reading the history, §5.2); and "Complete" (frozen).
- A year with no activity between active years is a muted one-line row: "2029 — no racing logged". It has no snapshot and no Wrapped.
- Above the list, a `WrappedReadyBanner` appears when `pendingWrapped` returns a year.
- **Empty state** (no stints yet): "Your first chapter starts with your first stint. Everything you watch from then on is written here, year by year."

**`/chronicle/[year]`**:
- The page runs `ensureChroniclesFrozen(userId, now)` first. It returns `notFound()` for a year before the first activity year or after the current year, and for a non-integer.
- A frozen year renders its snapshot. A finished year that is not frozen yet renders a live chapter with `complete: true` and the "Complete — finalising" badge. The current year renders a live chapter with a clear `Badge`, "Year to date — still being written", and the as-of time. On 1 January before the first stint of the new year, the current year shows "Your {year} chapter starts with your next stint" instead of an empty chapter.
- The header carries **← 2026 · 2028 →** links to the neighbouring chapters (only those that exist), so ten years can be browsed without going back to the index.
- `src/app/chronicle/[year]/loading.tsx` renders `Skeleton` panels.
- **Sections** follow the brief's order. A section with no data collapses to a single calm line.
  1. **Career summary.** `chapterHeadline(chapter)`, then tiles for hours, races experienced, races started, races completed (Story Complete), new race coverage, XP earned, and levels gained (start → end). In **Career Year 1**, a "How it began" block comes first, from `chapter.beginnings`: "Your chronicle begins on 22 September 2026 with the 6 Hours of Fuji", then the first complete race story and the first edition of an event, when they happened in the year.
  2. **Viewing statistics.**
     - sessions and active days;
     - average and longest session;
     - most active day, week (the user's week start; a week that straddles New Year is labelled with its days in the year, "the days in 2026") and month;
     - re-watch time;
     - completion percentage;
     - weekday distribution (bars).
  3. **Championship breakdown**: a table of hours, share, races and Story Completes, each linking to a filtered `/stats?championship=&year=`. The first 10 rows, then "Show all" (the snapshot stores the full list).
  4. **Event breakdown**: the same, plus editions experienced in the year. Each links to `/events/[key]`.
  5. **Story Complete statistics**:
     - the count;
     - by race length (`DURATION_CLASSES`) and by championship;
     - the longest race completed;
     - average stints per story;
     - average days from start to finish;
     - the completion rate (the cohort rate of §3.1), but only when races started in the year is at least 5;
     - the full list, paginated 25 at a time on the client;
     - **Expeditions completed**: the full `ExpeditionSummaryCard` of each, rendered from the `expedition_summaries` rows the snapshot lists by id (immutable rows, one query), in a `<details>` per Expedition. A summary whose race was deleted stays fully readable here.
  6. **Mastery progression**: steps unlocked in the year, grouped by tree, with dates and mastery XP.
  7. **Achievements and milestones**:
     - achievements unlocked in the year (`unlockedAt`);
     - Career Milestones reached in the year (`achievedAt ?? reachedAt`), with precision and the race or event they happened in;
     - Lifetime-ladder rungs, collapsed;
     - Event Legacy steps reached in the year.
  8. **Personal records set this year**: the snapshot's records, each with "since beaten on {date}" computed at render time with `beatenAfter(currentProgression, record)` (§3.2.7), so a frozen chapter never carries a stale note.
  9. **Notable races** (§4.5.3).
  10. **Monthly activity**: 12 months of bars (credited hours and new coverage), with dots for Story Completes. Below it, one link: "See {year} in Career Statistics" (`/stats?year=`).
  11. **Career progression**:
      - XP by month (12 bars);
      - the level at the start and end of the year;
      - levels reached in the year, with dates (`getLevelHistory` filtered);
      - titles reached;
      - XP by source (`xpBySource(userId, start, end)`).

  The footer is an "About this chapter" `<details>`: "Frozen on {frozenAt} (time zone {tz}, week starts {day})". A frozen year also gets **Rebuild this chapter from today's history…** (§4.5.2). The year also shows a "Compared with {year−1}" strip with 4 rows from the snapshot's `previousYear`, led by the partial-year note when the previous year is the one the career began in (§4.5.4 card 14).

**`/chronicle/[year]/wrapped`**:
- A full-page `WrappedDeck` (`'use client'`). There is no `Dialog`, because `dialog.tsx` caps its height and closes on a backdrop click.
- The page renders one large card at a time inside `mx-auto max-w-3xl`. Cards use `min-h-[26rem] sm:min-h-[22rem]` rather than a fixed aspect ratio, so a long race or championship name never clips; names use `line-clamp-2`.
- **Card anatomy**, the same for every card (`wrapped-card.tsx`): a label (`label` class); a hero number or name in a raw `className` string with `timing text-timing-lg` (never through `cn()`, R10); one sentence from `wrappedCardLine(card)` (§4.7.4); and an optional accent through `accentVars(color)`. This is what makes Wrapped a celebration rather than a table: every card says one warm, plain thing about the year.
- Controls: **Back** and **Next** buttons, `←`/`→` keys, `Escape` (goes to the chapter), and progress dots (`aria-label "Card 3 of 12"`). The card region has `aria-live="polite"`.
- The position is kept in `?card=N`. The server reads it only for the first render; the deck updates it with `window.history.replaceState`, so pressing **Next** never re-renders the server page.
- There is **no timer, no auto-advance and no JS animation**. Each card enters with `animate-[rise_0.24s_var(--ease-out-quint)_both]`, which the global reduced-motion rule neutralises. React Compiler-safe: the keydown listener is added in `useEffect` and state changes only in handlers.
- Reaching the last card of a **frozen** year calls `markWrappedSeenAction(year)`. The year-to-date preview, and a finished year's Wrapped during its grace period, never mark anything seen. In the year-to-date preview **every** card carries a chip "Year to date · as of {date}", so no single card can be mistaken for the finished year.

#### 4.5.2 Freezing, and the snapshot schema

```ts
export async function ensureChroniclesFrozen(userId: string, now: Date): Promise<number[]>;
export async function getChronicleIndex(userId: string, now: Date): Promise<ChronicleIndexView>;
export async function getChronicleChapter(userId: string, year: number, now: Date): Promise<{ chapter: ChronicleChapterV1; careerYear: number; state: 'year-to-date' | 'finalising' | 'frozen'; frozen: { frozenAt: Date; rebuiltAt: Date | null } | null; wrappedSeen: boolean; neighbours: { previous: number | null; next: number | null } } | null>;
export async function buildChapterData(userId: string, year: number, now: Date, prebuilt?: { db: Tx; timeline: CareerTimeline; progression: RecordEvent[] }): Promise<ChronicleChapterV1>;
export async function freezeYear(tx: Tx, userId: string, year: number, now: Date, prebuilt: { timeline: CareerTimeline; progression: RecordEvent[] }): Promise<boolean>;
export async function rebuildChronicleYear(userId: string, year: number, now: Date): Promise<void>;
export async function markWrappedSeen(userId: string, year: number, now: Date): Promise<void>;
export async function pendingWrapped(userId: string, now: Date): Promise<{ year: number } | null>;
export function freezeDueAt(year: number): Date;   // yearWindow(year).end + CHRONICLE_SHAPE.freezeGraceHours
```

These live in `src/lib/engines/chronicle-engine.ts`. The start-up pass that loops over accounts, `freezeAllChronicles({ now, shouldContinue })`, lives in `src/lib/server/upgrades/chronicle-freeze.ts`, because only server code reads the clock (R9).

**When a year is frozen.** `ensureChroniclesFrozen`:
1. Does nothing unless `isCareerBackfillApplied(userId)` (§5.1). A chapter must never be frozen before the upgrade has dated the landmarks and written the summaries it would contain; the backfill's own last phase freezes the finished years of an upgraded account.
2. Takes `firstYear` as the local year of the earliest stint (`findFirst` ordered by `watchedAt`). With no stints, it returns `[]`.
3. For each `Y` with `firstYear ≤ Y` and `now ≥ freezeDueAt(Y)`, where there is no `ChronicleYear` row and Y has activity (a stint whose window overlaps `yearWindow(Y)`), it builds the timeline and record progression **once**, then calls `freezeYear` per year, each in its own transaction. `freezeYear` builds the chapter (`complete: true`) and writes it with `chronicleYear.upsert({ where: { userId_year }, create, update: {} })`, so a concurrent writer never produces a unique-constraint error in the user's log.

It is called from:
- the start-up pass `freezeAllChronicles` (§5.4), for every account whose backfill is complete, while `shouldContinue()`;
- every Chronicle page, and `pendingWrapped` (so the dashboard's banner never waits for a Chronicle visit);
- the start of every mutating server action (§4.0).

**Why the grace period.** A stint's window reaches back from when it is logged (R6). The brief's own case, a stint watched from 22:30 on 31 December to 00:30 and logged at 00:31, puts an hour and a half into the old year. If the year froze at midnight, the action that logs this stint would freeze the year first and the time would be missing from the chapter and Wrapped for ever, while Statistics would count it. So year Y is frozen only from `freezeDueAt(Y)` = local midnight on 1 January Y+1 plus 72 hours, which covers the longest possible window (64 hours, R6). Until then the finished year is shown live, marked "finalising"; its Wrapped can be opened but is not yet announced or marked seen. After the grace period, nothing the UI can do adds time to that year (D1). An engine-backdated stint (seed, tests) into a frozen year leaves the chapter untouched, by design.

**What is frozen**: the whole `ChronicleChapterV1`, with `schemaVersion: 1`.
- Dates are ISO strings.
- Names are captured at freeze time. A later rename does not rewrite history; the ids are kept for links.
- Everything that depends on today is **not** frozen but computed at render: the career-year number, "since beaten" notes, and the summary cards of the year's Expeditions (read from their immutable rows).

```ts
export const chronicleChapterSchema = z.object({
  schemaVersion: z.literal(1), year: z.number(), complete: z.boolean(),
  generatedAt: z.string(), timeZone: z.string(), weekStartsOn: z.number(),
  window: z.object({ start: z.string(), end: z.string(), activeFrom: z.string().nullable() }),  // activeFrom: first stint instant in the year
  beginnings: z.object({                                                                            // filled only in the career's first year
    firstStint: z.object({ at: z.string(), raceId: z.string(), raceName: z.string() }).nullable(),
    firstStoryComplete: z.object({ at: z.string(), raceId: z.string(), raceName: z.string() }).nullable(),
    firstEventEdition: z.object({ at: z.string(), eventKey: z.string(), eventName: z.string(), raceName: z.string() }).nullable(),
  }).nullable(),
  summary: z.object({ creditedSeconds: z.number(), newCoverageSeconds: z.number(), rewatchSeconds: z.number(), sessions: z.number(),
    activeDays: z.number(), racesExperienced: z.number(), racesStarted: z.number(), storyCompletes: z.number(),
    championshipsWatched: z.number(), eventsWatched: z.number(), completionPercent: z.number().nullable(),
    xpEarned: z.number(), levelStart: z.number(), levelEnd: z.number(), levelsGained: z.number(),
    achievementsUnlocked: z.number(), milestonesReached: z.number(), masteryStepsUnlocked: z.number(), masteryXp: z.number(),
    expeditionsCompleted: z.number() }),
  viewing: z.object({
    longestRace: z.object({ raceId: z.string(), name: z.string(), runtimeSec: z.number(), storyComplete: z.boolean() }).nullable(),
    longestSession: z.object({ raceId: z.string(), raceName: z.string(), at: z.string(), creditedSeconds: z.number() }).nullable(),
    averageSessionSeconds: z.number().nullable(),
    mostActiveDay: z.object({ dayKey: z.string(), seconds: z.number() }).nullable(),
    mostActiveWeek: z.object({ weekKey: z.string(), label: z.string(), start: z.string(), end: z.string(), clipped: z.boolean(), seconds: z.number() }).nullable(),
    mostActiveMonth: z.object({ month: z.number(), label: z.string(), seconds: z.number() }).nullable(),
    weekdaySeconds: z.array(z.number()) }),
  monthly: z.array(z.object({ month: z.number(), label: z.string(), creditedSeconds: z.number(), newCoverageSeconds: z.number(),
    sessions: z.number(), activeDays: z.number(), storyCompletes: z.number(), xpEarned: z.number() })),   // always 12
  championships: z.array(groupRowJson),                                            // full list
  events: z.array(groupRowJson.extend({ key: z.string().nullable(), editionsExperienced: z.number() })),  // full list
  circuits: z.array(groupRowJson),                                                 // full list
  storyComplete: z.object({ count: z.number(),
    byDurationClass: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
    byChampionship: z.array(z.object({ name: z.string(), count: z.number() })),
    averageStintsPerStory: z.number().nullable(), averageDaysToComplete: z.number().nullable(), rate: z.number().nullable(),
    list: z.array(z.object({ raceId: z.string(), name: z.string(), at: z.string(), runtimeSec: z.number() })) }),
  mastery: z.object({ steps: z.array(z.object({ treeKey: z.string(), treeName: z.string(), nodeKey: z.string(), nodeName: z.string(), at: z.string(), xp: z.number() })), xp: z.number() }),
  achievements: z.array(z.object({ key: z.string(), name: z.string(), rarity: rarityEnum, at: z.string(), xp: z.number() })),
  milestones: z.object({
    career: z.array(z.object({ id: z.string(), title: z.string(), at: z.string(), precision: precisionEnum, xp: z.number(),
      celebration: z.enum(['none', 'notable', 'spectacular']), subjectName: z.string().nullable(),
      subjectId: z.string().nullable(), subjectKind: z.enum(['race', 'event']).nullable() })),
    ladder: z.array(z.object({ metric: z.string(), label: z.string(), threshold: z.number(), at: z.string() })),
    eventLegacy: z.array(z.object({ eventKey: z.string(), eventName: z.string(), nodeKey: z.string(), nodeName: z.string(), at: z.string() })) }),
  records: z.array(z.object({ kind: recordKindEnum, label: z.string(), value: z.number(), valueText: z.string(), at: z.string(), raceId: z.string().nullable() })),
  notableRaces: z.array(z.object({ raceId: z.string(), name: z.string(), reason: notableReasonEnum, detail: z.string() })),
  expeditions: z.array(z.object({ summaryId: z.string(), raceId: z.string().nullable(), raceName: z.string(), completedAt: z.string(), creditedSeconds: z.number(), calendarDays: z.number() })),
  progression: z.object({ xpBySource: z.array(z.object({ source: z.string(), amount: z.number() })),
    levelsReached: z.array(z.object({ level: z.number(), at: z.string() })), titlesReached: z.array(z.string()) }),
  previousYear: z.object({ year: z.number(), activeFrom: z.string().nullable(), careerBeganInYear: z.boolean(),
    creditedSeconds: z.number(), racesExperienced: z.number(), storyCompletes: z.number(), xpEarned: z.number(),
    averageSessionSeconds: z.number().nullable() }).nullable(),
});
export type ChronicleChapterV1 = z.infer<typeof chronicleChapterSchema>;
// groupRowJson = { id, name, accent, creditedSeconds, racesExperienced, storyCompletes, share }
// notableReasonEnum = 'longest-story' | 'most-watched' | 'expedition' | 'most-stints' | 'first-edition' | 'longest-journey'
```

- The lists are bounded by what one person watched in one year (a heavy year is a few hundred races), so storing them in full keeps "Show all" honest for frozen years; the index reads at most 20 small snapshots (§1.3).
- `upgradeChapterSnapshot(raw: unknown): ChronicleChapterV1` validates with `chronicleChapterSchema`. It throws for anything else; the page then shows "This chapter was saved by a newer version." A future schema adds an upgrade branch here.
- `previousYear` comes from the frozen row of Y−1 when there is one, otherwise from a live `summariseWindow` plus the ledger. `careerBeganInYear` is true when Y−1 is the year of the career's first stint and that stint is after 1 January.

**Rebuilding.** This is the only update path, and it runs only on an explicit request:
- `rebuildChronicleYearAction(year)` in `career-actions.ts`. It is confirmed in a `Dialog`: "This chapter was frozen on {date}. Rebuilding replaces it with what your history says today. Your Wrapped for {year} will follow."
- It runs `rebuildChronicleYear`, which overwrites `snapshot`, sets `rebuiltAt = now`, and keeps `frozenAt` and `wrappedSeenAt`.
- The only other way is `scripts/recompute.ts --rebuild-chronicle <year>`.

#### 4.5.3 How the chapter is built (pure `buildChapter` in `src/lib/domain/chronicle.ts`, data from `buildChapterData`)

`buildChapterData` uses the `prebuilt` timeline and record progression when it is given them (the freeze pass and the backfill build them once per account, never once per year), and otherwise `getCareerTimeline` and one `computeRecordProgression`. It then loads the following, each at most one query:
- `weekStart`;
- the ledger rows in the window (`createdAt`, `amount`, `source`, `levelAfter`);
- the level at the start: the `levelAfter` of the last row before the window, or 1;
- `xpBySource`;
- achievements with `unlockedAt` in the window, with their definitions;
- all milestone rows, filtered in JS;
- event and other mastery progress unlocked (`achievedAt ?? unlockedAt` in the window), with node and tree;
- expedition summaries with `completedAt` in the window;
- the Y−1 frozen row.

`buildChapter` combines:
- `summariseWindow(timeline, window, …)` for sections 1–5 and 10;
- `recordsSetIn(progression, window)` for section 8;
- `beginnings` from `raceStartEvents`, `storyCompleteEvents` and the first experienced event edition, filled only when the year is the career's first;
- the notable races, below.

**Notable races**: deterministic, at most `CHRONICLE_SHAPE.notableRacesCount`, with no race listed twice, filled in this order:
1. the longest race completed in the year;
2. the most-watched race by credited time in the year;
3. every Expedition completed, at most 2;
4. the race with the most stints in the year, only if it has at least 3;
5. the year's earliest first-experienced edition of an event;
6. the completed race with the longest start-to-finish `elapsed`.

**XP and levels by year** use the ledger's `createdAt`, which is the only time XP has.
- Awards backfilled by the 0.4.0 upgrade are dated at the upgrade, in 2026. They are documented as such.
- Milestone *dates* are historical (`achievedAt`), so a milestone can appear in an earlier chapter than the XP it paid. The chapter says, under milestones: "XP is counted in the year it was recorded."

#### 4.5.4 Wrapped cards (pure `buildWrappedCards(chapter, { careerYear, state }): WrappedCard[]` in `domain/chronicle.ts`)

The order is fixed. A card is **omitted** when it has no data, and nothing is ever invented:

| # | Card | Shown when |
|---|---|---|
| 1 | Opening: "{year} · Career Year N". In Career Year 1 it is the beginning: "Your chronicle begins on 22 September 2026 with the 6 Hours of Fuji". "Year to date" when incomplete | always |
| 2 | Hours: credited hours, active days, equivalent days | hours > 0 |
| 3 | Races: races experienced and "N complete race stories" | always |
| 4 | Most-watched championship: name, accent, hours, share | at least 1 championship |
| 5 | Most-watched recurring event: name, hours, editions | at least 1 event |
| 6 | Longest race: name, runtime, completed or how much was seen | always if there are races |
| 7 | Longest viewing session | at least 1 stint |
| 8 | Favourite circuit | races with a circuit carry at least `favouriteCircuitMinimumShare` (0.5) of the year's hours; otherwise omitted ("do not fabricate") |
| 9 | Most active month and week | always if there are stints |
| 10 | XP earned and levels gained | always |
| 11 | Landmarks: achievements, milestones, mastery steps, plus up to 3 highlights (spectacular and notable career milestones first) | any > 0 |
| 12 | Expeditions completed | at least 1 |
| 13 | Personal records set (the first `wrappedRecordsShown` in `RECORD_ORDER`) | at least 1 |
| 14 | Compared with {year−1}: hours, races, stories and XP, with differences worded by `differencePhrase`. When `previousYear.careerBeganInYear`, the card leads with "Your {year−1} chapter began on {date}" and shows no percentage changes | `previousYear` exists |
| 15 | Closing: "Read the full chapter" | always |

`WrappedCard` is a discriminated union with one member per row above. The type lives in `domain/chronicle.ts`. Every member carries the fields `wrappedCardLine` needs.

**The prompt.** `pendingWrapped` first calls `ensureChroniclesFrozen`, then returns the latest **frozen** year with `wrappedSeenAt = null` and `year = now.getFullYear() − 1`. The dashboard (`src/app/page.tsx`) and `/chronicle` show `WrappedReadyBanner`, "Your 2026 Endurance Wrapped is ready", with **Open** and **Hide**. Hide calls `markWrappedSeenAction`; the Wrapped stays in the Chronicle. Nothing opens by itself.

#### 4.5.5 Ten-year scale
- The index reads the snapshots of past years (JSON) and builds only the current year (and a finishing year during its grace period) live.
- A chapter's tables show the top 10 rows with "Show all"; the Story Complete list is paginated; there are exactly 12 months.
- Twenty years means twenty cards, so no virtualization is needed. Previous/next links make the chapters browsable in order.

### 4.6 Deleting a race takes its XP back (D4)

`deleteRace(userId, raceId, now): Promise<RaceRemoval | null>` lives in `session-engine.ts`. It is one transaction with `TRANSACTION_OPTIONS`:
1. `race = findFirst({ where: { id: raceId, userId }, select: { id, name, runtimeSec, raceDate, circuitSlug, season: { select: { year } } } })`. If there is no race, return `null`; the action then says "That race is no longer in the library."
2. `sessionIds = raceViewingSession.findMany({ where: { raceId, userId }, select: { id } })`.
3. `revokeSessionsXp(tx, userId, sessionIds)`, then `revokeRaceViewingXp(tx, userId, raceId)` for any VIEWING/REWATCH row of this race whose `sessionId` was already nulled by an older stint deletion. Both run **before** the cascade, which would null `sessionId`.
4. `revokeXpByDedupeKeys(tx, userId, [`story-complete:${raceId}`, ...heldExpeditionKeys])`. `heldExpeditionKeys` is the `dedupeKey` of every row matching `{ userId, source: 'EXPEDITION', sourceRef: raceId }`.
5. `writeMissingEventStepCredits(tx, userId)`, then `eventStepCredit.updateMany({ where: { userId, raceId }, data: { fingerprint: serialiseFingerprint(editionFingerprint({ editionYear: editionYear({ raceDate: race.raceDate, seasonYear: race.season?.year ?? null }), circuitSlug: race.circuitSlug, name: race.name, runtimeSec: race.runtimeSec })) } })` writes the tombstones.
6. `race.deleteMany({ where: { id: raceId, userId } })`.
   - It cascades to sessions, intervals and collection items. The new `sessionId` indexes make the cascade's FK searches cheap (11.6 ms for 200 stints at Large scale).
   - `HallOfFameEntry.raceId` and `ExpeditionSummary.raceId` are set to null (SetNull), so both entries **stay**.
   - Milestone and mastery rows are untouched, because their provenance columns have no foreign key.
7. `recomputeRaceMasteries(tx, userId, now)`, so event caches drop the edition.
8. `settleLedger(tx, userId, [every revocation above])` (R13): the batched re-stamp from the earliest removed row, and `rebuildSeasonXpFromLedger` **only if** any revoked row carried season XP.
9. Return `{ raceName, sessionsRemoved, careerXpRemoved, seasonXpRemoved, storyBonusRemoved, expeditionXpRemoved, levelBefore, levelAfter }`.

**`deleteRaceAction`** runs:
1. `requireUserId`;
2. `ensureChroniclesFrozen`;
3. `deleteRace`;
4. `clearCareerTimelineCache`;
5. revalidate `/races`, `/`, `/collections`, `/chronicle`, `/events`, `/career`, `/stats` and `/career/milestones`.

It returns `{ ok: true, message }` with the message from `raceRemovedNotice(name, xp)` in `tone.ts`: "{name} was removed from the library, with the {n} XP it earned. Achievements and milestones you reached stay." (or, when it held no XP, "{name} was removed from the library."). The race page no longer discards it (`race-detail-view.tsx:284-287` awaits the action and navigates): it navigates to `/races?removed=<encoded name>&xp=<n>`, and the library page reads those two parameters and shows the notice once, as a quiet one-line panel above the list.

**The client confirm text** (`race-detail-view.tsx:285`): "Remove {name} from the library? Its viewing history goes with it, and so does the XP it earned — viewing, Story Complete and expedition checkpoints. Achievements and milestones you reached stay."

**`deleteSessionAction` message fix** (`actions.ts:335`): use the `SessionRemoval`. The message becomes "Stint removed. {careerXpRemoved} XP came off with it; coverage has been recalculated." When the value is 0, it becomes "Stint removed. Coverage has been recalculated."

`repairXpLedger` is extended: an `expedition:<raceId>:*` row whose race no longer exists is deleted, just like a stale story bonus.

What a re-created race can and cannot earn again (§6 row 6): its viewing, re-watch, Story Complete and checkpoint XP come back once, as it is watched again, because they were taken back. Milestones, achievements, mastery nodes and event steps are not paid again. A re-created **major-event** race can mint a second Major Event trophy and Hall of Fame plaque, because those are keyed by race id (`awards-engine.ts:812, 825`); they carry no XP, and the README's "Known limits" says so.

### 4.7 Shared UI changes

#### 4.7.1 Navigation (`nav.tsx` `NAV`)
- The order becomes: Dashboard · Race Library · Race Strategist · Viewing Budget · Challenges · Season Pass · Career · **Chronicle** (`History`) · **Career Statistics** (the relabelled `/stats`, moved up) · **Events** (`Repeat`) · Mastery · Collections · Achievements · Trophy Cabinet · Hall of Fame · Settings. The history trio (Career, Chronicle, Career Statistics) sits together.

That makes 16 items. The mobile chip row already scrolls. Every nested route (`/chronicle/*`, `/events/*`, `/career/milestones`, `/races/[id]/expedition`) highlights its parent through `isActive` (`nav.tsx:42-45`). `tests/e2e/desktop.mjs` checks that depend on the nav order are updated in WP8.

#### 4.7.2 Components (new)
- `src/components/ui/accent.ts`: `accentVars(color: string): React.CSSProperties`, which sets `--accent` and `--accent-soft` (`color-mix(in oklab, <color> 16%, transparent)`, the mix the themes use, `globals.css:96-102`). `accentStyle()` (`identity.ts:97-103`) is refactored to call it, so there is one implementation. `Panel accent=` keeps its current behaviour; new tinted surfaces use `style={accentVars(color)}`. (`Panel` sets only `--accent`, `primitives.tsx:17-29`, and `accentStyle()` takes a theme key, not a colour.)
- `src/components/chronicle/{chronicle-index.tsx, chapter-view.tsx, wrapped-deck.tsx, wrapped-card.tsx, wrapped-ready-banner.tsx}`
- `src/components/events/{events-index.tsx, event-legacy-view.tsx, event-dialogs.tsx, event-suggestions.tsx}`
- `src/components/expeditions/{expedition-view.tsx, coverage-meter.tsx, expedition-summary-card.tsx, expedition-mode-control.tsx}`
- `src/components/milestones/{career-milestones-view.tsx, milestone-card.tsx}`
- `src/components/stats/{records-tab.tsx, compare-tab.tsx}`
- `src/components/charts/{chart-tooltip.tsx, chart-theme.ts, monthly-bars.tsx, weekday-bars.tsx, cumulative-line.tsx, share-bars.tsx, compare-bars.tsx}`
- `loading.tsx` files for `/stats`, `/chronicle/[year]` and `/events/[key]`, built from `Skeleton`.

They are all built from `Panel`, `PanelHeader`, `PanelBody`, `Stat`, `TimingBar`, `Badge`, `EmptyState`, `Skeleton`, `Segmented`, `Select`, `Toggle`, `Button` and `Dialog`.

Rules:
- An accent-tinted surface uses `accentVars` (both variables).
- Hero numbers use raw `className` strings, never `cn()` with `text-timing-lg`.

#### 4.7.3 Celebrations
`chooseCelebration` gains two facts:
- `expeditionCompleted` gives SPECTACULAR;
- `careerMilestoneCelebration: 'none' | 'notable' | 'spectacular'` (the highest in the stint) gives at least that level.

`buildOutcomeForSession` passes both, from the rebuilt `expedition` and `careerMilestones`. `stint-summary.tsx` `hasUnlocks()` includes `careerMilestones.length > 0`, `expedition?.began`, `expedition?.checkpointsReached.length > 0` and `expedition?.completed`. NOTABLE is given its visible treatment (§4.1.6).

The dashboard's `RecentUnlocks` (`dashboard.ts:160-230`, `panels.tsx:270`) gains a `milestone` kind: reached career-catalogue rows, dated `achievedAt ?? reachedAt`, linking to `/career/milestones`. Career milestones are the app's major permanent moments, so they belong on that shelf.

#### 4.7.4 Copy (`src/lib/copy/tone.ts`)
- Add these functions: `chapterHeadline`, `chapterBeginning`, `eventLegacyHeadline`, `expeditionBudgetNote`, `expeditionModeMessage`, `differencePhrase`, `wrappedOpeningLine`, `wrappedCardLine`, `precisionLabel`, `describeFragments`, `raceRemovedNotice` and `yearToDateFact` ("2026 so far: 36 hours"). They are all pure; `race-timeline.tsx` imports `describeFragments` from here.
- `wrappedCardLine(card: WrappedCard): string` returns one plain, warm sentence per card type, for example "212 hours at the track — nearly nine days, end to end." or "Your longest race was the 24 Hours of Le Mans: 62% of the story so far." It never says "not completed", "missed" or anything that reads as a shortfall.
- Register every one in `periods-tone.test.ts` `everyUserFacingString()`, with representative inputs, including zero and small values. The server action messages built in `src/lib/server/*` are covered by the forbidden-phrase scan once WP2 adds `SERVER_FILES` to it (R10).

---

## 5. Upgrade backfill and recompute

### 5.1 The module: `src/lib/server/upgrades/career-backfill.ts`

It sits outside `src/lib/engines`, like `season-reset.ts`, and follows the 0.3.1 pattern (`season-reset.ts:94-158`) with three differences: the marker is **compared by value**, progress is recorded **per phase and per chunk**, and every chunk checks the start-up deadline **before it starts**.

```ts
export const CAREER_BACKFILL_KEY = 'careerBackfill';
export const CAREER_BACKFILL_VERSION = '0.4.0';
export const CAREER_BACKFILL_PHASES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;  // WP3 ships P1 and P3; WP4 adds P2, WP5 P4, WP7 P5
export type PhaseKey = (typeof CAREER_BACKFILL_PHASES)[number];
export const STARTUP_BUDGET_MS = 30_000;          // shared by the backfill and the freeze pass, measured from register() start
const CHUNK_TRANSACTION = { maxWait: 15_000, timeout: 60_000 } as const;

export interface CareerBackfillMarker {
  version: string;                               // '0.4.0'
  done: PhaseKey[];
  cursors: { P1?: string; P4?: string };         // last race id finished by a chunk
  lastRunAt: string | null;                      // ISO; accounts run least-recently-served first
}
export async function readCareerBackfillMarker(userId: string, db?: Tx): Promise<CareerBackfillMarker | null>;
export async function isCareerBackfillApplied(userId: string, db?: Tx): Promise<boolean>;  // version matches and every known phase is done
export async function markCareerBackfillApplied(userId: string, db?: Tx): Promise<void>;   // every phase done (pre-marking, recompute)

/** The only thing that reads the clock. Injected so tests can make the deadline tiny. */
export interface BackfillClock { shouldStartChunk(estimatedMs: number): boolean }
export function deadlineClock(deadline: number, now?: () => number): BackfillClock;

export interface CareerBackfillSummary {
  userId: string; completed: boolean; skipped: boolean; pausedBefore: { phase: PhaseKey; cursor: string | null } | null;
  racesCredited: number; legacyRacesRepaired: number; storyBonusesAwarded: number; storyBonusesRevoked: number;
  eventStepsUnlocked: number; eventStepXp: number; creditsWritten: number;
  milestonesCreated: number; milestoneXp: number; datesFilled: number; datesRecognised: number;
  expeditionCheckpoints: number; expeditionXp: number; summariesWritten: number; chaptersFrozen: number;
  leftovers: { orphanedViewingRows: number; storyBonusesOfDeletedRaces: number };   // counted, never removed here (R11)
}
export async function runCareerBackfillFor(userId: string, options: { now: Date; clock: BackfillClock; force?: boolean }): Promise<CareerBackfillSummary>;
export async function runCareerBackfill(options: { now: Date; clock: BackfillClock; log?: Logger }): Promise<CareerBackfillSummary[]>;
// phase bodies, exported for recompute:
export async function backfillRaces(ctx: PhaseContext, chunk: readonly string[]): Promise<RaceChunkResult>;   // P1
export async function backfillEventProgression(tx: Tx, userId: string, now: Date): Promise<{ unlocked: number; xp: number; credits: number }>; // P2
export async function backfillMilestones(tx: Tx, userId: string, now: Date, timeline: CareerTimeline): Promise<{ created: number; xp: number; filled: number; recognised: number }>; // P3
export async function backfillExpeditions(ctx: PhaseContext, chunk: readonly string[], options: { resize: boolean }): Promise<{ checkpoints: number; xp: number; summaries: number }>; // P4
```

`PhaseContext` holds what a run builds **once per account**, outside the chunk transactions: the career timeline, the record progression and the per-stint XP sums. At start-up this is safe, because `register()` finishes before the server answers any request (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`: register "must complete before the server is ready to handle requests"), so nothing else writes meanwhile; recompute is a single-threaded script. The chunks themselves re-check what they write (dedupe keys, `achievedPrecision: null`, "no summary yet"), so a stale context can never double-pay.

### 5.2 Phases

Each account runs these phases in order. **Each chunk is its own `prisma.$transaction(…, CHUNK_TRANSACTION)`, and the same transaction updates the marker** (the phase's cursor, or adds the phase to `done`), so progress and work commit together.
- Before every chunk, `clock.shouldStartChunk(estimate)` is asked, where `estimate` is the longest chunk this run has seen (at least 1 s). If it says no, the account stops with `pausedBefore` set; the next start continues from the recorded phase and cursor. A chunk that has started always finishes inside its own 60 s transaction.
- Every chunk is idempotent, so a chunk repeated after a crash changes nothing.

| # | Phase | What it does | Chunks | Idempotent because |
|---|---|---|---|---|
| P1 | races | For each race: write `creditedViewingSec` where it differs. **Legacy repair:** a race whose stored intervals end past its runtime (one `watchedInterval.groupBy({ by: ['raceId'], _max: { endSec } })` per chunk) gets `rebuildRaceIntervals` and `recomputeRaceAggregates(…, { preserveStatus: true })`, so a runtime shortened under 0.3.x no longer counts coverage past the new end, and the race's status is kept. Then `reconcileStoryBonus` from the replay: a Story Complete race without its bonus (a 0.3.2 runtime edit could skip it) receives it, career-only; a bonus held by a race the replay says is not complete is revoked. `settleLedger` at the end of the chunk. | 500 races, in id order | Derived values are written only when they differ; the bonus exists exactly when the replay says so. |
| P2 | events | `ensureMasteryTrees` (inserts the appended event nodes into existing trees, `mastery-engine.ts:689-724`, and applies the renamed display names), `recomputeRaceMasteries` (distinct editions, merged-key resolution), then `syncMastery`, which first writes the missing credits for every already-unlocked step (§4.2.5) and then pays the **new** steps an event had already passed. | one | Tree and node inserts are skip-if-present; credits use `createManySkippingDuplicates` with a filter; `syncMastery` unlocks once and uses dedupe keys. |
| P3 | milestones | `computeCareerMetricsWithHistory`, `syncMilestones` (existing ladders; nothing new normally), `syncCareerMilestones` (new rungs, paid once), then `fillLandmarkDates` with the context's timeline. It dates **every** undated milestone and event-step row: rows reached since 22 Sep 2026 get their historical instants, and non-replayable metrics become RECOGNISED. | one | Rows are created once, dates written only while `achievedPrecision` is null, and dedupe keys prevent double pay. |
| P4 | expeditions | For each race that is an Expedition (from the timeline race rows): `reconcileExpedition` from the replay coverage (retroactive awards with `sessionId` null); if the replay says Story Complete and there is no summary, `writeExpeditionSummary({ retrospective: true, timeline, progression })` with the context's timeline and record progression. `settleLedger` if anything was revoked (it cannot be on a first run). | 25 Expedition races, in id order | I3 and one summary per race. |
| P5 | chronicle | For each finished year that is due (`now ≥ freezeDueAt(Y)`), has activity and has no `ChronicleYear` row: `freezeYear` with the context. When no year remains, P5 is added to `done` and the account is complete. | one year | It skips existing years, and completion is written last. |

Order matters: P2 reads `creditedViewingSec` (P1); P3 dates event steps that P2 unlocks; P4 and P5 need P1's corrected coverage and P3's dates.

**While an account is part-way through** (it paused, or a start failed), the app is fully usable and nothing can be paid twice:
- A stint does, for its own race, everything the backfill would: it writes credits for every unlocked event step before paying (§4.2.5), dates any undated landmark (`fillLandmarkDates` in the stint path builds the replay when undated rows exist), reconciles its race's checkpoints and writes its race's missing summary.
- Event actions write the missing credits before they move a race (§4.2.2), so moving an edition before P2 has run cannot re-pay a step.
- `ensureChroniclesFrozen` does nothing until the account is complete (§4.5.2), so no chapter is frozen without its dates and summaries. Finished years are shown live, marked "Complete — finalising", until P5 freezes them.

**Performance.**
- Real account (≤ 3,000 stints): the whole backfill < 5 s, in one start.
- Large account: every chunk < 5 s; the context build (loads plus replay plus record progression) < 3 s. The start-up budget of 30 s leaves the Next boot and the desktop's 60 s health gate (`main.ts:40`) a wide margin. `tests/perf/career-scale.test.ts` measures every phase against the Large database from the WP that adds it (§10).

### 5.3 Selecting accounts, logging, pre-marking

**`runCareerBackfill`**:
- Loads `prisma.user.findMany({ select: { id: true, name: true, configOverrides: { where: { key: CAREER_BACKFILL_KEY }, select: { value: true } } } })` and keeps the accounts that are not complete. The filter is in JavaScript on purpose: JSON equality filters are not portable on SQLite.
- Orders them by `lastRunAt` ascending (never-run first), so an account that did not get time on one start goes first on the next; a large first account can no longer starve a second one.
- Runs `runCareerBackfillFor` per account, in its own try/catch. A failure is logged and the account keeps its last recorded progress, so it is retried on the next start.

**Log lines** use the prefix `[career-backfill]` and go to `console`, which the desktop shell captures:
- a completed account: `[career-backfill] Alex (<id>): credited 12 races, 0 legacy races repaired, story bonuses +0/−0; 3 event steps (+950 XP), 41 credits; 2 new milestones (+1,500 XP), 14 dates filled, 3 recorded only; 2 expedition checkpoints (+300 XP), 1 summary; 0 chapters frozen`;
- leftovers, when there are any: `[career-backfill] Alex (<id>): 2 viewing XP rows and 0 Story Complete bonuses from races deleted before 0.4.0 were left as they were (db:recompute removes them)`;
- a paused account: `… paused before P4 (after race <id>); continues on the next start`.

**Pre-marking.** `createAccount` (`src/lib/auth/accounts.ts:192-195`) calls `await markCareerBackfillApplied(id)` straight after `markSeasonResetApplied`. A brand-new account has nothing to backfill.

### 5.4 `src/instrumentation.ts`

`register()` keeps its Node-runtime guard and gains two more try/catch blocks:

```ts
const { deadlineClock, STARTUP_BUDGET_MS } = await import('@/lib/server/upgrades/career-backfill');
const clock = deadlineClock(Date.now() + STARTUP_BUDGET_MS);
// 1. 0.3.1 season reset (unchanged)
// 2. 0.4.0 career backfill
try { const { runCareerBackfill } = await import('@/lib/server/upgrades/career-backfill'); await runCareerBackfill({ now: new Date(), clock }); }
catch (error) { console.error('[career-backfill] could not run at start-up; it will be tried again on the next start', error); }
// 3. Chronicle freeze pass for complete accounts (every start; cheap when nothing is due)
try { const { freezeAllChronicles } = await import('@/lib/server/upgrades/chronicle-freeze'); await freezeAllChronicles({ now: new Date(), shouldContinue: () => clock.shouldStartChunk(1_000) }); }
catch (error) { console.error('[chronicle] could not freeze finished years at start-up; the Chronicle will try again when opened', error); }
```

`freezeAllChronicles` runs `ensureChroniclesFrozen` for each complete account while `shouldContinue()`.

### 5.5 `db:recompute`: `src/lib/server/recompute.ts` plus `scripts/recompute.ts`

Move the body of `rebuild()` (`scripts/recompute.ts:50-101`) into `export async function recomputeCareer(userId: string, options: RecomputeOptions): Promise<RecomputeReport>` in `src/lib/server/recompute.ts`, so the tests can call it. The script becomes argument parsing plus printing.

```ts
export interface RecomputeOptions { now?: Date; rebuildChronicleYears?: number[]; rebuildMilestoneDates?: boolean }
```

The steps, in order. It builds the same once-per-account context as the backfill and uses the same chunked phase bodies, with a clock that never says stop:
1. **Races**, in chunks: `rebuildRaceIntervals` (intervals are derived, R1), `recomputeRaceAggregates` (which writes `creditedViewingSec`, clamps, and keeps the existing recompute status behaviour), and `reconcileStoryBonus`; `settleLedger` per chunk.
2. `repairXpLedger`, extended with the orphan `expedition:*` rows (§4.6) and without its N+1.
3. One transaction (timeout 120 s):
   - `ensureMasteryTrees`, `ensureSeasonCollections`, `recomputeRaceMasteries`;
   - `syncCollections`, `syncMastery` (which writes the missing event-step credits first);
   - **`computeCareerMetricsWithHistory`**, `syncAchievements`, `syncMilestones`, **`syncCareerMilestones`**, **`fillLandmarkDates`**.
4. **Expeditions**, in chunks: `backfillExpeditions(…, { resize: true })` reconciles every race (including races that stopped being Expeditions: only unsupported rows are revoked), re-sizes held rows to the current runtime, writes missing summaries, and settles.
5. `markCareerBackfillApplied`, then **`ensureChroniclesFrozen`**.
6. If `rebuildChronicleYears` is set, `rebuildChronicleYear` for each year. This is the only way besides the in-app button.
7. If `rebuildMilestoneDates` is set, recompute `achievedAt`/`achievedPrecision` from the replay **only for rows whose replay instant passes `acceptInstant`**, and leave every other row as it is. This is the documented, explicit exception to write-once, for developer repair.

The script prints each new count in the existing style. The new flags are `--rebuild-chronicle <year>` (repeatable) and `--rebuild-milestone-dates`. **Recompute never pays a landmark twice and never rewrites a frozen chapter or a summary unless it is asked to.**

---

## 6. Exploit analysis

**Invariants asserted after every scenario:**
- (I1) Every `dedupeKey` occurs at most once per account. This is structural.
- (I2) `CareerProfile.careerXp` equals `Σ ledger.amount`, and every row's `careerXpAfter` equals the running sum in `(createdAt, id)` order. Structural through R13.
- (I3) For every race, held EXPEDITION rows ⊆ the checkpoints its replay coverage satisfies under its current runtime (§4.3.3).
- (I4) Every new XP row has `seasonAmount = 0`.
- (I5) Landmark rows never decrease, and their `achievedAt` never changes.
- (I6) For every event step, no race has helped pay it twice: each `(nodeKey, race)` pair appears in at most one paid unlock, across all events.

All the tests below are in **`tests/integration/xp-exploits.test.ts`** unless noted. The file runs on the real test database, with a per-file user id prefix and `now` injected.

| # | Attack | Defence | Proving test |
|---|---|---|---|
| 1 | **Re-watch** a watched section repeatedly | Replay coverage is unique: `addedCoverageSeconds` is 0, so nothing counts toward a checkpoint, Story Complete, editions or new coverage. Re-watch viewing XP is 0.25× (existing). Hours milestones count re-watches as real viewing, which is the existing meaning of "real hours". | `rewatch never crosses a checkpoint or completes a story`; `tests/domain/career-timeline.test.ts › re-watching adds re-watch time and no coverage` |
| 2 | **Playback speed**: log 0.1× to inflate hours, or 8× to rush coverage | `creditedSeconds` caps at `timeline / xpMinSpeed` (R7) for milestones, the year rung, records, the Chronicle and statistics. At 8× checkpoints earn at most about 22 XP per real minute, below the 30 XP per real minute viewing pays (§4.3.2); the Story Complete bonus (existing) already scales the same way. | `a 0.1× stint cannot reach 100 career hours earlier than 0.75× would`; `slow playback cannot set the longest-session record`; `tests/domain/economy-balance.test.ts › checkpoints never out-earn viewing time per real minute, even at 8×`; `tests/domain/career-timeline.test.ts › credited seconds equal XP-credited real time` |
| 3 | **Repeatedly crossing** a checkpoint: log to 55%, delete back to 20%, re-log | Deleting reconciles and revokes 25/50, which frees their keys. Re-crossing re-awards once. At most one row per key is ever held. | `crossing 50% three times holds each checkpoint once`; ledger-count assertion per key |
| 4 | **Edit = delete + re-log** | Viewing XP follows the stint. The SC bonus and checkpoints follow coverage. Landmarks were created once and their `achievedAt` does not move. Event steps are already unlocked. | `delete and re-log a stint: totals equal a single log, milestone dates unchanged` |
| 5 | **Delete and re-create a session** | The same as #4. The new session id gives no new dedupe keys, because the keys are race/pct/metric based. | `re-creating the completing stint does not pay Story Complete or checkpoints twice` |
| 6 | **Delete and re-create a race** | D4: `deleteRace` revokes VIEWING/REWATCH (by stint and by `sourceRef`), `story-complete:` and `expedition:*` before the cascade, then settles. The re-created race's XP is therefore held once, as it is watched again. Milestones, achievements, mastery nodes and event steps stay and are not re-paid. Event steps in a **new** event are blocked by tombstones, matched on edition year, rounded hours, and circuit or name. A re-created major-event race can mint a second Major Event trophy and plaque (keyed by race id, `awards-engine.ts:812, 825`); they carry no XP and the README names it. | `deleting a race takes back viewing, re-watch, Story Complete and expedition XP`; `deleting a race also takes back viewing XP whose stint was deleted under 0.3.x`; `re-creating it re-earns them once and no landmark twice`; `a re-created edition cannot pay a step again through a new event, even with a runtime a few seconds different` |
| 7 | **Re-key / rename / merge / move** between events | Keys are immutable. The race form offers existing events, not free text, and a name typed in another case resolves to the existing event; `createEvent` refuses a duplicate name. Rename changes only `displayName`. Merge carries unlocked steps over XP-free. Credits are written for every contributor of every unlocked step on every sync and before every move (§4.2.5), so any edition moved anywhere pays no step it already helped reach. Merge chains are guarded (no unarchive of a merged event, at most 10 hops, userId-scoped). | `renaming an event creates no tree and pays nothing`; `typing an event name in another case reuses the event`; `creating an event with an existing name is refused`; `merging carries steps over with their dates and pays nothing`; `moving every edition to a fresh event pays none of its steps again`; `moving later editions of an event into a fresh event pays none of the steps the original event had unlocked`; `a merged event cannot be unarchived` |
| 8 | **Toggle Expedition Mode** on/off/on | Off never revokes; on awards only unheld checkpoints; keys dedupe. The summary is written once and never rewritten. | `toggling Expedition Mode never holds a checkpoint twice`; `switching Expedition Mode off keeps held checkpoints`; `the summary survives the mode being switched off` |
| 9 | **Lower thresholds / change the runtime** | No XP threshold is user-editable. The expedition threshold, the checkpoint list and milestone thresholds are config. The year rung reads `BUDGET_CONFIG.annualHours`, **not** the editable `BudgetYear.annualBudgetHours`, and its key has no number in it. Checkpoint XP needs 6 h of runtime. A runtime edit re-sizes held checkpoints to the new schedule and revokes those the new runtime no longer supports. | `lowering this year's budget hours does not create a full-year milestone`; `a 5-hour race switched on earns no checkpoint XP`; `changing the runtime re-sizes held checkpoints and revokes those no longer reached` |
| 10 | **Recompute** | Every step is idempotent (§5.5). | `tests/integration/recompute.test.ts › running recompute twice changes nothing` |
| 11 | **Migration or backfill re-run, or a start cut short** | The migration runner records checksums and is a no-op the second time. The backfill records progress per chunk in the same transaction as the work, and a forced re-run pays nothing because of dedupe keys, fill-only-null dates and credits. | `tests/integration/career-backfill.test.ts › a forced second backfill changes no ledger row`; `› with a tiny deadline it makes progress on every start, completes after N starts, and ends with the same ledger as one uninterrupted run`; `tests/desktop/migrate-040.test.ts › is a no-op the second time` |
| 12 | **Restart** | `register()` skips complete accounts, and the freeze pass skips frozen years. | `tests/integration/instrumentation.test.ts › a second start changes nothing` |
| 13 | **Backdated / imported stints** (engine `watchedAt`) | Canonical order places them. They can create **new** landmarks with historical dates, but never move existing ones (write-once). A frozen year's chapter is unchanged. Their XP is the ordinary stint XP. | `a backdated stint dates a new milestone historically`; `a backdated stint never moves an existing milestone`; `a backdated stint into a frozen year leaves that chapter untouched` |
| 14 | **Future-dated `watchedAt`** | Rejected when later than `now + 5 min` (R9). The action returns a plain message. | `a stint dated tomorrow is refused`; `a stint 2 minutes ahead (clock skew) is accepted` |
| 15 | **Tiny races** | Checkpoint XP needs 6 h of runtime; a race counts as experienced only with 10 credited minutes and a tenth (or an hour) of coverage. The Story Complete bonus on tiny races is existing behaviour and out of scope. | `tests/domain/expedition.test.ts › a 9h59m scheduled race is not automatic`; `… a 5-hour race switched on earns no checkpoint XP`; `a hundred 1-minute races with 1-second stints reach no races-experienced rung` |
| 16 | **Manual COMPLETED status** | Excluded from every 0.4.0 figure and new rung (§3.1). Existing ladders are unchanged. | `marking a race Completed by hand changes no Chronicle, statistic, record or new milestone` |
| 17 | **Runtime shrink** to fake completion | `recomputeRaceAggregates` and the replay clamp to the runtime, and `updateRaceAction` rebuilds the intervals. A legacy race shrunk under 0.3.x is repaired by the upgrade (P1), and the stint path revokes a bonus its clamped coverage no longer supports, then settles. | `tests/integration/session-flow.test.ts › shortening a race does not complete it from coverage past the new end`; `a 0.3.2-shaped race with intervals past a shortened runtime keeps I2 and I3 after the backfill and after one more stint` |
| 18 | **Throw-away races and one-race events** to farm per-race or per-event rewards | Counted races and editions must be experienced (≥ 10 credited minutes, which is ≥ 300 viewing XP, and a tenth or an hour of coverage). "First Edition Experienced" pays 0. What remains is proportional to viewing the user logs, and bounded per event: `experienced_3` pays 300 for at least 30 credited minutes over three editions (900 viewing XP); `event_hours_25` pays 500 for 25 credited hours (45,000 viewing XP); `races-100` pays 500 for at least 100 experienced races (30,000 viewing XP). The existing `edition_1` (1,000) still needs a Story Complete. | `a dummy race in its own event pays no event step`; `each race can help pay an event step once across events`; `a hundred 1-minute races with 1-second stints reach no races-experienced rung` |
| 19 | **Gap-tolerance stitching** (1-second stints 20 s apart) | Inherited from Story Complete (the same 20 s tolerance). It needs roughly 4,000 hand-entered stints for a 24 h race, so it is documented as a residual rather than changing the definition of coverage the race page shows. | `tests/domain/career-timeline.test.ts › replay coverage equals the race page coverage for bridged gaps` (documents the behaviour) |
| 20 | **Cross-account access**: event keys, race ids, years, summary ids | Every lookup is scoped by `userId`, including the fingerprint aggregates and merge hops, and caches are keyed per account. | `tests/auth/account-isolation.test.ts` additions (§8.2) |
| 21 | **A runtime typo** that briefly completes a race | Balances follow the edit and follow it back; landmarks and summaries wait for the next stint after a runtime change (§4.0), so correcting the typo leaves nothing permanent behind. | `a mistyped runtime that is corrected leaves no summary and no landmark, and the real completion writes the summary` |
| 22 | **Configuration re-balance** of checkpoints | Amounts already paid are never re-sized except by a runtime edit or recompute; I3 is about coverage, not amounts, so a re-balance can neither break it nor re-pay a key. | `tests/domain/expedition.test.ts › checkpoint keys contain no amount`; `recompute re-sizes checkpoints to the current schedule once` |

Pre-existing and **unchanged**: moving races to a newly created championship re-pays championship-tree nodes (MAPS risk). It is outside the five systems. The README "Known limits" paragraph names it, and 0.4.0 does not widen it.

---

## 7. The XP economy

### 7.1 One moment, one payer

| Moment | Payer, which never changes | 0.4.0 display, at 0 new XP |
|---|---|---|
| First stint / first race started | `sessions:1` (360), *Green Flag* (200) | Career Milestone `first-race-started` |
| First race completed = first Story Complete | `storyCompletes:1` (720), *The Whole Story* (1,000), HoF | `first-race-completed` ("First complete race story") |
| First 12 h / 24 h | `stories12h:1`, `stories24h:1`, achievements, nodes | `first-12h`, `first-24h` |
| 10/25/50/100 Story Completes; 100/500/1,000/5,000/10,000 h | the existing ladder rungs, plus achievements and nodes | career cards |
| 2,500 h | *The Archive* (120,000) | `hours-2500` |
| 5 / 10 / 25 editions of one event (experienced) | the event step `experienced_5/10/25` (new, per event) | `event-editions-5/10/25` |
| First edition of an event experienced | nothing: recorded, 0 XP (R4, §6 row 18) | the event step `experienced_1` |
| Story Complete | `story-complete:<raceId>` | Expedition's sixth checkpoint |

`year-plan` ("{annualHours} hours in {year}") and the lifetime rung `realHours:336` are different moments that can fall on one stint in a first year that holds every hour of the career; both pay (R4).

### 7.2 New XP, all career-only

| Source | Amounts | Dedupe key | Why it is "a little" |
|---|---|---|---|
| Expedition checkpoints (runtime ≥ 6 h) | 600 / 800 / 1,200 / 1,800 / 3,000 per race (§4.3.2) | `expedition:<raceId>:<pct>` | At most 9.0% of the race's viewing XP at 1×, and 40% of its Story Complete bonus; below viewing's rate per real minute at any speed. |
| `hours-250` | 1,000 | `milestone:realHours:250` | 0.2% of the 450,000 viewing XP it takes to get there; its neighbours pay 4,000–4,600. |
| `first-6h` | 500 | `milestone:stories6h:1` | A third of the 12 h first (1,400). |
| `races-100/250/500/1000` | 500 / 750 / 1,000 / 1,500 | `milestone:racesExperienced:N` | 3,750 in total over at least 1,000 experienced races. |
| `year-plan` | 1,000 per calendar year | `milestone:realHoursYear:<Y>` | 0.17% of a year of viewing XP (604,800). |
| Event steps | `experienced_1/3/5/10/25` 0/300/500/1,000/2,500; `event_hours_25/100/250` 500/1,500/3,000; `consecutive_10` 5,000 | `mastery:event:<key>:<node>` | 14,300 per event over a lifetime, against the existing 85,000. |

### 7.3 `tests/domain/economy-balance.test.ts`

The test stays tight and must keep passing. **Update its model** so the new sources are visible. The justification: it models only what exists, and a new source it does not model is invisible to it (MAPS).

Changes, which reproduce `work/econ-model.ts`:
- `career()` gains the metrics `racesExperienced: Math.ceil(stories * 1.25)` and `stories6h: stories` (the model's races are 6 h).
- It gains a `careerMilestones` component: the career-owned `CAREER_MILESTONES` rows with `xp > 0` whose threshold the metrics reach. `year-plan` counts as `Math.floor(hours / BUDGET_CONFIG.annualHours) × def.xp`.
- `expedition = stories24h × Σ checkpointSchedule(24h) + (stories10h − stories24h) × Σ checkpointSchedule(10h)`.
- `eventLegacyNew`: for `eventsFollowed = stories === 0 ? 0 : min(6, max(1, floor(stories / 12)))` events, the **appended** nodes of `MASTERY_CONFIG.raceEventNodes` (identify them by key: the 9 keys from §3.3) are measured against `{ editionsExperienced: min(25, years), consecutiveEditions: metrics.longestConsecutiveEditions, realHours: min(hours × 0.15, 24 × years) }`, where `years = max(1, ceil(hours / BUDGET_CONFIG.annualHours))`.
- The existing event nodes stay unmodelled, as today, and the comment says so.
- `milestones` becomes ladder rungs plus career milestones (so the windfall test sees them). `mastery` becomes existing mastery plus `eventLegacyNew`. `expedition` is a new named source in "out-earns every other source".
- A second profile, `longRaceCareer(hours)`: 65% of the hours on 24-hour races, checkpoints paid **by coverage** (the full races plus the one in progress), not only on completion; everything else as `career()`.

Checked results (viewing share of all XP, which must stay > 0.4):

| Stage (h) | 20 | 58 | 150 | 336 | 672 | 1,680 | 3,360 |
|---|---|---|---|---|---|---|---|
| Before | 0.4406 | 0.5041 | 0.5284 | 0.5101 | 0.5070 | 0.5584 | 0.6047 |
| After | **0.4379** | 0.5000 | 0.5236 | 0.5044 | 0.5010 | 0.5501 | 0.5957 |
| Long-race profile | **0.4301** | 0.4922 | 0.5158 | 0.4976 | 0.4943 | 0.5423 | 0.5866 |

The other assertions:
- Growth holds: 0.5957 ≥ 0.5000.
- The windfall holds: milestones at 20 h are 0.275 × viewing, against the 0.5 limit.
- Every source stays below viewing.
- Level(336) = 53, inside (30, 100). Level(3,360) = 132, inside (90, 400).
- Headroom at 20 h is 7,790 XP.

New assertions:
- `'keeps viewing the main source for a long-race career'`: the long-race profile's viewing share is > 0.4 at every stage.
- `'keeps each race's checkpoints small next to its viewing'`: for every runtime from 6 h to 48 h in one-minute steps, `Σ checkpointSchedule(runtime).xp ≤ 0.0905 × (runtime hours × 60 × xpPerRealMinute)`. The maximum is 0.0900 at 18h31m.
- `'checkpoints never out-earn viewing time per real minute, even at 8×'`: for the same runtimes, `Σ checkpoints / (runtime / MAX_PLAYBACK_SPEED in minutes) < xpPerRealMinute`.
- `'keeps the new milestone and event sources small'`: at every stage, `(careerMilestones + eventLegacyNew) / viewing < 0.02`. The maximum is 0.014 at 20 h (the `first-6h` rung).

---

## 8. Test plan

### 8.1 Conventions
- **Pure tests** go in `tests/domain/*.test.ts` and **engine-core tests** in `tests/engines/*.test.ts`. They use fixtures and no database.
- **Real-database tests** go in `tests/integration/*.test.ts` and `tests/auth/*.test.ts`. They use the existing pattern:
  - a per-file fixed user id or name prefix;
  - `prisma.user.deleteMany` in `beforeEach`;
  - `disconnectDb()` in `afterAll`;
  - an injected `now`;
  - stints logged through the real `logViewingSession` with explicit `watchedAt` and `now`.
- **The ledger's `createdAt` is always the real clock** (`awardXp` never sets it, `xp-ledger.ts:97-111`), even when an engine is handed an injected `now`. Tests of XP by year or month therefore set `createdAt` explicitly after the fact (`xPTransaction.updateMany({ where: { userId, id: { in } }, data: { createdAt } })`) and then settle, rather than relying on `now`. `awardXp` is not given a way to backdate rows.
- New helpers:
  - `tests/helpers/timeline-fixture.ts` (pure) builds `TimelineSessionRow`/`TimelineRaceRow` fixtures from a compact DSL: `stint(race, '2026-12-31T23:30', { from: '0:00', to: '1:00', speed: 1 })`.
  - `tests/helpers/career-db.ts` creates a user with a profile, races, and stints via the engine. It also inserts "0.3.2-shaped" rows (no markers, new columns null), including a race whose intervals run past a shortened runtime.
  - `tests/helpers/fixture-db.ts` copies `tests/fixtures/career-0.3.2.db` to a temp file and points `process.env.DATABASE_URL` at the copy **before the first query** (the client is created lazily, `client.ts:32-37`, and every test file runs in its own fork).
- **Time-zone tests** set `process.env.TZ` in `beforeAll` (`'Pacific/Auckland'`, `'America/Los_Angeles'`, `'Europe/London'`) and restore it in `afterAll`. Node applies a TZ change at runtime. Each file first asserts **both** `new Date(2026, 0, 1).getTimezoneOffset()` and `new Date(2026, 6, 1).getTimezoneOffset()` have the expected values (London: 0 and −60), so a platform that ignores the change fails loudly rather than passing by accident on a UTC machine.
- **Performance tests** are `tests/perf/career-scale.test.ts`. They are gated by `process.env.PERF === '1'` (`describe.skipIf`), so they are not in CI. They build a synthetic 10-year career (§1.3) in memory, and for the database part insert it with `createMany` into a separate file DB. They assert the §1.3 targets. The pure part lands in WP1; the database part in WP2 (the loader, `logViewingSession`, `deleteRace`, `deleteViewingSession`); each later WP adds its own hot paths (WP3: P1/P3 and `logViewingSession` with dating; WP4: event actions and P2; WP5: P4 and the Expedition page; WP6: `/stats`; WP7: P5 and the Chronicle pages).
- **The 0.3.2 fixture.** `tests/fixtures/career-0.3.2.db` is generated in WP1 **before** the schema changes, by the real 0.3.2 code: `DATABASE_URL=file:./tests/fixtures/career-0.3.2.db ./node_modules/.bin/prisma migrate deploy`, then `DATABASE_URL=… npm run db:seed:demo`. The demo seed logs its stints through the real `logViewingSession` and backdates them to 2025 (`scripts/seed.ts:173-174, 289-301`), so the fixture holds ledger re-stamps, BigInt `careerXpAfter`, intervals built in insertion order, and achievement, mastery, milestone and Hall of Fame rows exactly as 0.3.2 wrote them, across two calendar years. `.gitignore` gains `!tests/fixtures/*.db`. A `tests/fixtures/README.md` records the command, the commit and the generation date, which the tests use as their `now`.

### 8.2 Every TESTING item from the brief, mapped to tests

| Brief item | File › test names |
|---|---|
| Career-year boundaries | `domain/calendar.test.ts` › `splits a stint across local midnight on 31 December into both years`; `attributes a stint's facts to the year of its watchedAt`. `integration/chronicle.test.ts` › `a stint logged at 00:31 on 1 January that began on 31 December is in the frozen 2026 chapter`; `nothing freezes before the grace period ends`; `a finished year is frozen at the first start after its grace period`; `a stint ending at 00:30 on 1 January counts its facts in the new chapter` |
| Leap years | `domain/calendar.test.ts` › `29 February is a day of its own in 2028`; `a leap year has 366 day buckets`; `samePeriodEnd maps 29 February to 28 February`. `domain/records.test.ts` › `the seven-day record spans 29 February correctly` |
| Timezone-sensitive session attribution | `domain/calendar.test.ts` › `the same instant falls in different local years in Auckland and Los Angeles`; `a DST day splits into 23 and 25 hours correctly`. `domain/edition.test.ts` › `a race dated 1 January keeps its edition year west of Greenwich`. `integration/chronicle.test.ts` › `a frozen chapter does not change when the machine time zone changes` |
| Year-in-review calculations | `domain/chronicle.test.ts` › `summary totals equal the sum of the monthly rows`; `most active week honours a Sunday week start`; `a most active week straddling New Year is labelled with its days in the year`; `championship shares sum to 1`; `notable races are deterministic and never repeat a race`; `completion percentage is runtime-weighted`; `Wrapped omits cards without data`; `the favourite-circuit card needs circuit data for half the hours`; `Career Year 1 opens with its beginning`; `every year-to-date card is marked year to date`; `a year that finishes last year's races never shows a rate above 100%`. `integration/chronicle.test.ts` › `a live chapter equals the frozen chapter built after the grace period`; `year-to-date chapters are marked incomplete`; `statistics filtered to a year equal that year's chapter`; `a chapter is never frozen before the account's backfill is complete`; `the chapter of a deleted race's expedition still shows the full summary` |
| Recurring-event edition association | `domain/edition.test.ts` › `edition year comes from the UTC race date`; `falls back to the season year`; `two races of one year are one edition`; `an undated race is its own edition`; `fingerprints match across a few seconds of runtime and either circuit or name`. `domain/event-association.test.ts` › `suggests an event whose editions share the race name without its year`; `suggests by circuit and length when names differ`; `suggests creating an event for two unlinked editions, named after the latest race`; `suggests merging events whose keys differ only in case`; `never uses a hard-coded list of famous races`; `dismissed suggestions stay dismissed`. `integration/events.test.ts` › `the race form's event reuses an existing event typed in another case`; `creating an event with an existing name is refused` |
| Event Legacy streaks | `domain/edition.test.ts` › `longest run of consecutive years`. `integration/events.test.ts` › `Three Complete in a Row unlocks at three consecutive Story Complete editions`; `a streak broken by a missing year restarts`; `the page shows runs as history, never a current streak` |
| Missing editions | `domain/edition.test.ts` › `lists the years between the first and latest edition with no race`. `integration/events.test.ts` › `the event page shows missing years as rows and counts nothing for them` |
| Expedition eligibility | `domain/expedition.test.ts` › `a race scheduled for 10h is automatic and 9h59m is not`; `a 10h race cut short by a red flag stays automatic`; `any race can be switched on`; `off always wins`; `checkpoints pay XP from 6 hours of runtime` |
| Expedition checkpoint crossing | `domain/expedition.test.ts` › `checkpoint schedule per race length` (the table in §4.3.2). `integration/expeditions.test.ts` › `a stint crossing 50% pays 10, 25 and 50 once each`; `each checkpoint names the stint that crossed it`; `a retroactive checkpoint carries no stint, so an old stint's summary is unchanged` |
| Checkpoint idempotency | `integration/expeditions.test.ts` › `more stints past a checkpoint never pay it again`; `reconcile twice changes nothing`; `backfill after live play pays nothing new`; `switching Expedition Mode off keeps held checkpoints` |
| Fragmented watched intervals | `domain/career-timeline.test.ts` › `coverage from fragmented stints equals the merged coverage`; `reaching the end with gaps is not Story Complete`. `integration/expeditions.test.ts` › `watching the last hour first does not cross 90%`. `domain/periods-tone.test.ts` › `describeFragments counts stretches and gaps`. `domain/time-playback.test.ts` › `a Story Complete race with a 40 s gap never shows 100%` |
| Rewatch behavior | `domain/career-timeline.test.ts` › `re-watching adds re-watch time and no coverage`. `integration/xp-exploits.test.ts` › `rewatch never crosses a checkpoint or completes a story` |
| Playback-speed behavior | `domain/career-timeline.test.ts` › `credited seconds equal XP-credited real time`; `0.5× is credited at 0.75×`. `integration/xp-exploits.test.ts` › `a 0.1× stint cannot reach 100 career hours earlier than 0.75× would`. `domain/economy-balance.test.ts` › `checkpoints never out-earn viewing time per real minute, even at 8×` |
| Story Complete Expeditions | `integration/expeditions.test.ts` › `completing a 24h expedition writes one summary with exact figures`; `the summary survives deleting the completing stint and deleting the race`; `completing an expedition celebrates spectacularly`; `a race completed before 0.4.0 gets a retrospective summary`; `a retrospective summary never shows mastery reached after completion`; `a mistyped runtime that is corrected leaves no summary, and the real completion writes one` |
| Milestone threshold crossing | `domain/landmarks.test.ts` › `the 100-hour crossing is inside the stint that crossed it`; `count milestones take the completing stint`; `recognition and replay agree at every HOUR_STEPS rung`. `integration/career-milestones.test.ts` › `crossing 250 hours creates the row and pays 1,000 once`; `a full viewing year is reached once per year`; `re-tuning the annual hours never pays a year twice` |
| Historical milestone backfilling | `integration/career-backfill.test.ts` › `dates existing rungs from history`; `awards new rungs that were already passed, once`; `marks rungs history cannot place as recognised`. `integration/upgrade-from-0.3.2.test.ts` (below) |
| Exact time-based milestone timestamps | `domain/career-timeline.test.ts` › `interpolates the instant 100 hours was crossed`; `uses credited seconds for the interpolation`; `the year rung is interpolated inside the part of the stint in that year`; `two stints logged a minute apart never date a later threshold before an earlier one`; `a batch-logged stint's crossing is STINT, not INTERPOLATED`; property test `milestone instants are monotone in threshold for random logs`. `domain/landmarks.test.ts` › `a rung recognised at 99.96 h gets an INTERPOLATED date inside the stint that recognised it`. `integration/career-milestones.test.ts` › `achievedAt equals the interpolated instant to the second` |
| Milestone idempotency | `integration/career-milestones.test.ts` › `syncing twice creates no second row or XP`; `integration/career-backfill.test.ts` › `a forced second backfill changes no ledger row` |
| Edited sessions | `integration/xp-exploits.test.ts` › `delete and re-log a stint: totals equal a single log, milestone dates unchanged` |
| Deleted sessions | `integration/career-milestones.test.ts` › `deleting stints keeps milestones and their dates`. `integration/expeditions.test.ts` › `deleting a stint revokes checkpoints no longer covered`. `integration/delete-race.test.ts` › `deleting a stint from the first year re-stamps the ledger in batches and keeps I2` |
| Imported historical sessions | `integration/xp-exploits.test.ts` › `a backdated stint dates a new milestone historically`; `a backdated stint never moves an existing milestone`; `a backdated stint into a frozen year leaves that chapter untouched` |
| Career statistics | `integration/stats-engine.test.ts` › `credited totals`; `event filter`; `race filter`; `length filter uses the duration classes`; `a 10-hour race is classed as 10 hours`; `new coverage is right after a delete`; `shortest meaningful session ignores stints under 10 minutes`; `completed equals Story Complete, never manual status`; `races experienced leaves out glimpses`; `by weekday and by race length`; `XP and levels by year` |
| Year-to-year comparisons | `domain/window-summary.test.ts` › `absolute and relative differences`; `no percentage change on a small base`; `no percentage change against the year the career began in`; `rates need five races in both years`; `championship shares compare in percentage points`; `the rows are exactly COMPARE_ROW_ORDER`. `integration/stats-engine.test.ts` › `a year in progress compares against the same stretch of the other year, whichever side it is on` |
| Personal records | `domain/records.test.ts` › one test per record kind; `ties keep the earlier holder`; `progression lists every improvement`; `fastest completion is never shorter than the credited time`; `records respect filters`; `records within a year`; `beatenAfter finds the record that replaced it` |
| Account isolation | `auth/account-isolation.test.ts` › `an event cannot be renamed, merged, linked or read from the other account`; `a merge chain never follows into the other account`; `Expedition Mode cannot be switched on the other account's race`; `a chronicle year cannot be rebuilt or marked seen from the other account`; `an expedition summary of the other account cannot be opened`; `deleting a race from the other account takes back no XP`; `the career-timeline cache never serves another account`; `the timeline fingerprint changes only with this account's data` |
| Database migration from the current production schema | `desktop/migrate-040.test.ts` (§2.5), `desktop/migrate.test.ts` (31 tables), and **`integration/upgrade-from-0.3.2.test.ts`**: copy the committed 0.3.2 fixture, `runMigrations(copy, MIGRATIONS)`, then `runCareerBackfill`. It asserts that stints, intervals (except legacy over-runtime races) and race statuses are byte-identical; I1–I6 hold; every milestone and event-step row has `achievedPrecision` set; the 2025 chapter is frozen; the marker is complete; and a second run changes nothing. |
| Recomputation | `integration/recompute.test.ts` › `running recompute twice changes nothing`; `recompute rebuilds intervals and pays a Story Complete bonus a runtime edit skipped`; `recompute re-sizes checkpoints to the current schedule once`; `recompute never rewrites a frozen chapter unless asked`; `--rebuild-chronicle replaces only that year` |
| XP exploit prevention | `integration/xp-exploits.test.ts`: every row of §6 |

### 8.3 Existing tests that change
- `tests/desktop/migrate.test.ts:147`: 28 becomes 31.
- `tests/domain/config.test.ts`: the new blocks and keys (§3.3). New cases: `the career milestone catalogue never repeats a paying ladder rung`, `career milestones with no XP say who pays`, `no career dedupe key contains a configurable number`, `checkpoint shares sum to 1`, `duration classes are ordered and cover every length`, `XPSource and MilestonePrecision mirrors match the schema` (read `schema.prisma`).
- `tests/domain/design-rules.test.ts`: the forbidden-phrase scan also covers `SERVER_FILES` (R10).
- `tests/domain/economy-balance.test.ts`: the model update and the new assertions (§7.3).
- `tests/domain/periods-tone.test.ts`: the new tone functions registered.
- `tests/engines/mastery.test.ts`:
  - fixtures unchanged, because the new fields are optional;
  - `treats two editions in the same year as one` also asserts `editionsStoryComplete === 1`;
  - new cases for `editionsExperienced`, for a node with `xpReward` 0 (no ledger row), and for credits (the engine-core part through exported pure helpers).
- `tests/integration/instrumentation.test.ts`: `runs the career backfill in the Node runtime`, `the season reset failing does not stop the career backfill`, `a second start changes nothing`, `new accounts are pre-marked`, and `the freeze pass skips accounts whose backfill is not complete`.
- `tests/integration/session-flow.test.ts`: every existing test stays green. Add `shortening a race does not complete it from coverage past the new end` and `deleting a stint says how much XP came off`.
- `tests/domain/time-playback.test.ts` (or `strategist.test.ts`, wherever the copy is asserted): the strategist's "a long race of about …" wording.

---

## 9. Documentation plan and version bump

### 9.1 README.md
- **"The systems" table** (`:266-285`): add rows for the Chronicle and Wrapped, Events (Event Legacy), Race Expeditions, Career Statistics and Records, and Career Milestones.
- **New section "Your career, year by year (0.4.0)"**, after "How the tracking works", with these subsections:
  - *Career Chronicle* (including the 72-hour "finalising" period after New Year and why it exists);
  - *Endurance Wrapped*;
  - *Event Legacy*, including *How recurring events are associated*: suggestions, the picker, rename and merge, and what moving an edition does to its steps;
  - *Race Expeditions*, including *How Expedition XP works*: the §4.3.2 table, "checkpoint XP from 6 hours", and "switching off keeps what you earned";
  - *Career Statistics and Personal Records*, including what "races experienced" means and why "races completed" is the Story Complete count;
  - *Career Milestones*, including *How milestones differ from achievements* and *Why a milestone keeps its date*;
  - *How historical backfilling works*, in plain words: what the first start of 0.4.0 reads; what gets an exact date and what does not; what "around 21:45" means (worked out from when the stint was logged, shown to the nearest five minutes); what "Recorded on" means; and that a very large history is read over a few starts.
- **"Derived versus persisted"**: the §2.3 table, in plain words.
- **"Balance constants"**: every new block (§3.3) with its values.
- **"Updating"** (`:57-69`): the pre-update snapshot, the migration, the one-time history pass (§5), and that going back means restoring `pre-update-0.4.0-*.db`.
- **"The other commands"** (`:200-217`): `db:recompute`, what it rebuilds now, and `--rebuild-chronicle`, `--rebuild-milestone-dates`.
- **"Architecture"** (`:287-336`): the new modules (domain calendar, career-timeline, edition, event-association, landmarks, records, window-summary, expedition, chronicle; the engines career-timeline, career-milestone, event-legacy, expedition, chronicle, progression-resync, stint-unlocks; `server/recompute`, `upgrades/career-backfill`, `upgrades/chronicle-freeze`). Also a fourth rule: "one replay: every history figure comes from `buildCareerTimeline`", and a fifth: "one ledger settlement: `settleLedger`".
- **"Testing"** (`:352-400`): the new files, the TZ convention, the 0.3.2 fixture and `PERF=1`.
- **"Known limits"**: the gap-tolerance stitching; re-paid championship nodes (pre-existing); XP counted by the year it was recorded; a re-created major-event race can receive a second (XP-free) trophy; a deleted race's Expedition Summary stays, so completing the re-added race gives a second one.

### 9.2 docs/
- **`docs/install.md`**:
  - *Backing up*: the new tables are included in backups automatically.
  - *Restoring*: restoring an older backup re-runs the upgrade, and a database 0.4.0 has written to may not open in 0.3.2.
  - *When something does not work*: the `[career-backfill]` and `[chronicle]` log lines, including "paused … continues on the next start".
- **`docs/career-history.md`** (new, for developers): the replay algorithm and canonical order, the stint window and its reliability rule, the credited-seconds definition, "experienced", the recognition threshold, the write-once landmark rule, `EventStepCredit` and when credits are written, the reconcile invariant and "the switch never revokes", `settleLedger`, the freeze rule and grace period, the snapshot schemas, the backfill phases, chunks, marker and budget, the cache fingerprint, and the exploit table (§6), with test names.
- **`docs/releasing.md`**: in the rehearsal section, a 0.3.2 → 0.4.0 upgrade check, the e2e script (§10, WP8), and how to regenerate the 0.3.2 fixture if it is ever needed (from a `git worktree` of `4c59efc`).

### 9.3 Version: 0.4.0
- `package.json:3`: `"version": "0.4.0"`.
- `package-lock.json:3` and `:9`: `0.4.0`.
- `src/lib/changelog.ts`: a new `CHANGELOG[0]`. Its `date` is the day WP8 runs, which must be at least `2026-09-24` (`changelog.test.ts` requires non-increasing dates).
- `CHANGELOG.md`: regenerate with `npm run changelog`.
- The header comment of `tests/e2e/desktop.mjs` (`:28-31`) names 0.4.0 and the new check count after it has been run.
- Everything else derives from `package.json` (`src/lib/version.ts`, the desktop and electron-builder).

The changelog entry, in the app's plain voice:

```ts
{
  version: '0.4.0',
  date: '<YYYY-MM-DD of release, ≥ 2026-09-24>',
  title: 'Your career, year by year',
  summary:
    'Five new ways to look back on your watching: a Chronicle with a chapter for every year and an Endurance ' +
    'Wrapped to click through, a page for every recurring event you follow, Expeditions for long races, Career ' +
    'Statistics with personal records, and Career Milestones that keep the date they happened.',
  note:
    'The first time this version starts, it reads your viewing history once and fills in what you had already ' +
    'reached: milestone dates, event histories and expedition checkpoints. Before that, the desktop app saves a copy ' +
    'of your career in %APPDATA%\\Endurance Racing Career\\backups, in a file whose name starts with pre-update-0.4.0.',
  changes: [
    { kind: 'New', items: [
      'Chronicle, in the menu: a chapter for every year you have watched, starting with your first stint. Each has ' +
        'your hours, races, complete race stories, championships and events, records, milestones and a month-by-month ' +
        'view. A finished year is kept exactly as it was, even if you change your history later (it is settled a few ' +
        'days into January, so a race you watch across New Year counts in both years).',
      'Endurance Wrapped: cards for a finished year that you click through yourself. You can open a preview of the ' +
        'current year at any time; every card of it is marked as a year still being written.',
      'Events, in the menu: every recurring event you follow, such as the 24 Hours of Le Mans, has a page with every ' +
        'edition you have watched, the hours and complete race stories they add up to, your longest run of ' +
        'consecutive editions and the steps you have reached. You can create your own events, rename them and combine ' +
        'two into one. Any race can belong to an event, not only major events.',
      'Race Expeditions: races of 10 hours or more are Expeditions automatically, and you can switch Expedition Mode ' +
        'on or off for any race. An Expedition has its own page with a timeline that shows exactly which parts you ' +
        'have seen, and checkpoints at 10%, 25%, 50%, 75% and 90% of the story, which earn a little XP on races of ' +
        '6 hours or more. Switching it off never takes that XP away. When you complete one, a summary of the whole ' +
        'expedition is kept.',
      'Career Statistics (was Statistics): filter by year, championship, event, race or race length, compare two ' +
        'years side by side, and see your personal records, such as your longest stint and your most in seven days.',
      'Career Milestones, from the Career page: the big moments of your career, such as your first 24-hour race or ' +
        '1,000 hours, each with the date and time it happened. New ones include your first 6-hour race, 250 hours, ' +
        '100 races experienced and a full year of viewing.',
    ] },
    { kind: 'Changed', items: [
      'Deleting a race now takes back the XP it earned, the same as deleting its stints one by one: viewing and ' +
        're-watch XP, its Story Complete bonus and its Expedition checkpoints. Achievements, milestones and anything ' +
        'else you reached stay.',
      'Hours for milestones, records and statistics count viewing time the same way XP does, so a stint logged at ' +
        'a very slow speed cannot add more than it could earn.',
      'The recurring event of a race is now chosen from a list, and no longer disappears when "Major event" is ' +
        'switched off.',
      'An edition of an event is counted once per year, however many races of that year you have added.',
      'Some moments are now shown as milestones without paying a second time, because something already pays for ' +
        'them: your first race started (Green Flag), 2,500 hours (The Archive), and 5, 10 or 25 editions of an event ' +
        '(that event\'s own steps).',
      'The Milestones tab on Achievements is now called Lifetime ladders. The achievement "Expedition" is now called ' +
        '"Around the Clock, Three Times", and the event steps for complete editions now say "complete" in their names.',
    ] },
    { kind: 'Fixed', items: [
      'Deleting a stint now says how much XP came off with it, instead of saying the XP stays.',
      "Changing a race's length now works out again what counts as watched, so a shorter length can no longer " +
        'complete a race you have not fully seen.',
      'Event editions dated 1 January are no longer counted in the year before on computers west of Greenwich.',
      'A stint summary opened again later no longer lists things unlocked after that stint.',
      'A completion figure never rounds up to 100% while part of the race is still to watch.',
    ] },
  ],
}
```

### 9.4 Notes for the owner (WP8 hand-off)

The owner is not technical and reads the result, not this document. The WP8 hand-off message ends with these points, in these words or close to them:
1. **"First race started" has no XP of its own.** Your first stint already earns Green Flag and the first-session milestone for that exact moment, and you asked for nothing to pay twice. It is shown on the Milestones page with its date.
2. **"First edition experienced" of an event has no XP either**, so that a race put into an event of its own cannot earn a step for a few clicks. Every later event step pays a little.
3. **5, 10 and 25 editions of one event** pay through that event's own steps, once per event; the career milestone shows the moment without paying it again. **2,500 hours** is paid by The Archive achievement.
4. **Moving a race to a different event never pays a step twice.** If a race was linked to the wrong event and you move it, the steps the wrong event had already reached with it are not paid again in the right one.
5. **"Races experienced"** means you watched at least a tenth of the race (or an hour of a long one) and at least ten minutes in all.
6. **Switching Expedition Mode off keeps the checkpoint XP you earned.** Checkpoint XP comes back off only if you delete the viewing (or the race) behind it.
7. **A finished year is settled about three days into January**, so a race you watch across New Year counts fully in both years. Until then its chapter says "finalising".

---

## 10. Work breakdown (sequential)

### Rules for every WP
- **Start** from the previous WP's green tree.
- **Read** the Next docs in `node_modules/next/dist/docs/` before relying on any framework behaviour you have not already seen in this repository.
- **Never use `npx prisma`.** Use `npm run db:generate` and `npm run db:deploy`, or `./node_modules/.bin/prisma`.
- **After adding a route**, run `./node_modules/.bin/next typegen` before typechecking, because `PageProps<'/…'>` comes from `.next/types`.
- **Every WP must pass**:
  ```
  npm run db:generate
  ./node_modules/.bin/next typegen
  npx tsc --noEmit
  npx eslint
  npx vitest run
  ```
  plus the targeted tests named in the WP, and `PERF=1 npx vitest run tests/perf` for the paths the WP adds to the harness (from WP2 on).
- **Do not** edit an applied migration, write `336` or `1.35` outside config, or add `Math.random` to an engine.
- **Do not** delete existing functionality.
- **A hook added by a later WP** (a step in `logViewingSession`, a phase of the backfill, a step of `resyncAfterRaceEdit` or recompute) is added **by that WP**, never stubbed earlier.

### WP1 — Foundation: fixture, schema, migration, config, pure domain
**Goal.** Every data structure and pure function the systems need, and a faithful 0.3.2 database to test the upgrade against. The app behaves exactly as before.

**First, before touching the schema:** generate `tests/fixtures/career-0.3.2.db` with the 0.3.2 code (§8.1): `DATABASE_URL=file:./tests/fixtures/career-0.3.2.db ./node_modules/.bin/prisma migrate deploy`, then `DATABASE_URL=file:./tests/fixtures/career-0.3.2.db npm run db:seed:demo`. Add `!tests/fixtures/*.db` to `.gitignore` and write `tests/fixtures/README.md` (command, commit `4c59efc`, generation date). (`npm run db:seed` without `:demo` creates an empty career, which would test nothing.)

**Create**
- `prisma/migrations/20260924120000_career_history/migration.sql`, identical to `work/migration.sql`.
- The pure domain modules:
  - `src/lib/domain/calendar.ts`
  - `src/lib/domain/career-timeline.ts` (including `isRaceExperienced`, the R6 windows and `raceExperiencedEvents`)
  - `src/lib/domain/edition.ts`
  - `src/lib/domain/event-association.ts`
  - `src/lib/domain/landmarks.ts` (including `recognitionThresholdSeconds`)
  - `src/lib/domain/records.ts`
  - `src/lib/domain/window-summary.ts` (including `COMPARE_ROW_ORDER` and the partial-year rule)
  - `src/lib/domain/expedition.ts` (eligibility, `checkpointsPayXp`, schedule, figures, dedupe key; the summary schema and builder come in WP5)
- `src/lib/config/career-milestones.ts`
- `tests/helpers/timeline-fixture.ts`, `tests/helpers/fixture-db.ts`
- The domain tests:
  - `tests/domain/calendar.test.ts`
  - `tests/domain/career-timeline.test.ts`
  - `tests/domain/edition.test.ts`
  - `tests/domain/event-association.test.ts`
  - `tests/domain/landmarks.test.ts`
  - `tests/domain/records.test.ts`
  - `tests/domain/window-summary.test.ts`
  - `tests/domain/expedition.test.ts`
- `tests/desktop/migrate-040.test.ts`
- `tests/integration/upgrade-from-0.3.2.test.ts`, the migration part only: a copy of the fixture, `runMigrations`, row counts unchanged, `foreign_key_check` empty, a second run a no-op.
- `tests/perf/career-scale.test.ts`, the pure part only (`PERF=1`).

**Modify**
- `prisma/schema.prisma`: replace it with `work/schema.v040.prisma`.
- `src/lib/domain/types.ts`: the XPSource and MilestonePrecision mirrors.
- `src/lib/domain/time.ts`: `formatCoveragePercent`.
- `src/lib/config/economy.ts`: `EXPEDITION_CONFIG`, `EXPEDITION_SHAPE`, `CAREER_STATS_SHAPE`, `DURATION_CLASSES`, `CHRONICLE_SHAPE`, `TIMELINE_SHAPE`, `EVENT_SHAPE`, and the `MASTERY_SHAPE` additions. **Not** the event nodes or the node renames.
- `src/lib/config/index.ts`: the export and the `DEFAULT_CONFIG` keys.
- `src/lib/engines/stats-engine.ts`: import `localDayKey`/`yearWindow` from `calendar.ts` and re-export `yearWindow`. No other change.
- `.gitignore`: the fixture exception.
- Tests: `tests/domain/config.test.ts`, `tests/domain/economy-balance.test.ts` (the model and assertions of §7.3; new event nodes are looked up by key and are absent until WP4, so `eventLegacyNew` is 0 until then and every assertion still holds), `tests/domain/time-playback.test.ts` (`formatCoveragePercent`), and `tests/desktop/migrate.test.ts` (31).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/domain tests/desktop tests/integration/upgrade-from-0.3.2.test.ts
npm run desktop:build
```
The migration applies on the test database (`tests/setup.ts` runs `db:deploy` automatically).

**Do not touch.** Session/race/mastery/metrics engines, server actions, UI, instrumentation.

### WP2 — Engine plumbing, ledger settlement, and "deleting a race takes its XP back"
**Goal.** Credited time everywhere, runtime clamping, the canonical interval rebuild, the timeline loader and cache, the edition fixes, the future-date guard, `settleLedger` with the batched re-stamp, and D4.

**Create**
- `src/lib/engines/career-timeline-engine.ts` (cache on `globalThis`, in-flight de-duplication, userId-scoped fingerprint).
- `src/lib/engines/progression-resync.ts`, with `reconcileStoryBonus` and `resyncAfterRaceEdit` (story bonus, caches, and the landmark syncs that exist so far, skipped after a runtime change; §4.0). WP3 and WP5 add their calls.
- `src/lib/server/recompute.ts`, moved from `scripts/recompute.ts`, with §5.5 step 1 (intervals, aggregates, `reconcileStoryBonus`) and step 2.
- `tests/helpers/career-db.ts`
- Integration tests:
  - `tests/integration/delete-race.test.ts` (including orphaned viewing XP by `sourceRef`, and a first-year stint deletion that re-stamps in batches)
  - `tests/integration/credited-time.test.ts`
  - `tests/integration/timeline-cache.test.ts`
  - `tests/integration/ledger-settle.test.ts` (I2 after every revoke path; batched equals row-by-row; `from` equals a full rebuild)
  - `tests/integration/recompute.test.ts`, the baseline idempotency test and the skipped-bonus repair
- `tests/perf/career-scale.test.ts`, the database part: the Large DB builder, `loadTimelineInputs`/`buildCareerTimeline`, `logViewingSession`, `deleteRace` (year 1 and last month) and `deleteViewingSession`.

**Modify**
- `race-engine.ts`: `rebuildRaceIntervals`, the clamp, `creditedViewingSec`, `preserveStatus`.
- `session-engine.ts`:
  - the future guard and `InvalidStintError`;
  - the stint path revokes a no-longer-supported story bonus and settles (§4.0 steps 5 and 16a);
  - `deleteViewingSession` uses `rebuildRaceIntervals` and `settleLedger`;
  - `deleteRace` (§4.6, without the expedition keys and the credits/tombstones, which come in WP5/WP4);
  - `repairXpLedger` without its N+1, ending with `settleLedger`.
- `xp-ledger.ts`: `XpRevocation.earliest`, `revokeSessionsXp`, `revokeRaceViewingXp`, `revokeXpByDedupeKeys`, the batched `rebuildCareerTotals` with `from`, `settleLedger`.
- `metrics.ts`: credited figures, the shape thresholds, `stories6h`, `racesExperienced`, the edition fixes, `computeCareerMetricsWithHistory` with one race query.
- `mastery-engine.ts`:
  - UTC edition year and distinct editions;
  - the `experienced` input and the `editionsExperienced` metric;
  - credited hours;
  - merged-key resolution (≤ 10 hops, userId-scoped);
  - event-row union and `displayName` in `ensureMasteryTrees`;
  - no `awardXp` call for a node with `xpReward` 0.
- `contracts.ts`: `RaceRemoval`; the `SessionRemoval` additions without the expedition fields; `SessionOutcome.coverageBeforeSec/coverageAfterSec/runtimeSec`.
- `actions.ts`:
  - `deleteRaceAction` uses `deleteRace` and returns its message;
  - `deleteSessionAction` message;
  - `updateRaceAction` rebuilds intervals and calls `resyncAfterRaceEdit`;
  - `logSessionAction` catches `InvalidStintError`;
  - `clearCareerTimelineCache` calls and the revalidate list.
- `race-detail-view.tsx`: the confirm text, navigation to `/races?removed=…&xp=…`, and "Real viewing" from `creditedViewingSec ?? realViewingSec`. `src/app/races/page.tsx`: the one-line removal notice. `src/lib/server/races.ts` `getRaceDetail`: `creditedViewingSec`.
- `stint-summary.tsx` and `race-timeline.tsx` (`describeCoverage`): `formatCoveragePercent`.
- `tone.ts`: `raceRemovedNotice`.
- `scripts/recompute.ts`: a thin wrapper.
- Tests: `tests/engines/mastery.test.ts`; `tests/integration/session-flow.test.ts` (two new cases); `tests/auth/account-isolation.test.ts` (deleting from the other account takes back nothing; the fingerprint is per account); `tests/domain/design-rules.test.ts` (`SERVER_FILES` in the forbidden-phrase scan); `tests/domain/periods-tone.test.ts`.

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/session-flow.test.ts tests/integration/delete-race.test.ts \
  tests/integration/credited-time.test.ts tests/integration/timeline-cache.test.ts \
  tests/integration/ledger-settle.test.ts tests/integration/recompute.test.ts tests/engines tests/auth
PERF=1 npx vitest run tests/perf
```
- Deleting a race removes exactly its VIEWING, REWATCH and `story-complete` rows, keeps all landmarks, and I2 holds.
- The existing test "never revokes a landmark" is unchanged.
- The §1.3 Large targets for `logViewingSession`, `deleteRace` and `deleteViewingSession` hold.

**Do not touch.** UI pages beyond the race page and library notice; the stats engine; new XP sources.

### WP3 — Career Milestones and the backfill framework
**Goal.** The catalogue, the new rungs, exact dates, the page, the stint-summary group and visible celebrations, and the upgrade framework with P1 and P3.

**Create**
- `src/lib/engines/career-milestone-engine.ts`
- `src/lib/engines/stint-unlocks.ts`, moved from `session-summary.ts` and bounded by the window and the neighbouring stints.
- `src/lib/server/upgrades/career-backfill.ts`: the JSON marker with `done`, cursors and `lastRunAt`; `deadlineClock`; P1 and P3 with their chunks; least-recently-served ordering; leftovers counting; logging. `CAREER_BACKFILL_PHASES` lists only the phases this WP ships; each later WP appends its own, and an account completed by an earlier development build simply runs the new phase (no `force` needed).
- `src/app/career/milestones/page.tsx`
- `src/components/milestones/career-milestones-view.tsx`, `milestone-card.tsx`
- `tests/integration/career-milestones.test.ts`
- `tests/integration/career-backfill.test.ts`, covering P1 (including the legacy over-runtime repair and the skipped-bonus award) and P3, and the tiny-deadline test.

**Modify**
- `session-engine.ts`: steps 10, 12, 13 and 17; `chooseCelebration` gains `careerMilestoneCelebration`; the pure `celebrationView`.
- `contracts.ts`: `CareerMilestoneUnlock`, `SessionOutcome.careerMilestones`.
- `session-summary.ts`: `careerMilestones`, the catalogue exclusion from the renamed "Lifetime ladders" group, and `stint-unlocks`.
- `stint-summary.tsx`: the group, the highlighted block, the visible NOTABLE treatment, and `hasUnlocks`.
- `achievement-board.tsx`: the tab label "Lifetime ladders" and a link.
- `src/app/career/page.tsx`: the panel.
- `src/lib/server/dashboard.ts` and `panels.tsx`: the `milestone` kind in `RecentUnlocks`.
- `src/instrumentation.ts`: the backfill block and the start-up clock.
- `src/lib/auth/accounts.ts`: pre-marking.
- `src/lib/server/recompute.ts`: career milestones, dates, `--rebuild-milestone-dates`, and `markCareerBackfillApplied`.
- `progression-resync.ts`: add `syncCareerMilestones` and `fillLandmarkDates` (when the runtime did not change).
- `tone.ts`: `precisionLabel`, `yearToDateFact`.
- Tests: `tests/domain/periods-tone.test.ts`, `tests/integration/instrumentation.test.ts`, `tests/integration/upgrade-from-0.3.2.test.ts` (P1 and P3 on the fixture: every milestone row dated, I1–I2 hold, statuses unchanged), and the perf harness (P1, P3, `logViewingSession` with dating).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/career-milestones.test.ts tests/integration/career-backfill.test.ts \
  tests/integration/instrumentation.test.ts tests/integration/upgrade-from-0.3.2.test.ts \
  tests/domain/design-rules.test.ts tests/domain/economy-balance.test.ts
```
- Against a copy of the dev `endurance.db`, running `npm run db:deploy` and then starting `npm run dev` fills dates for every rung.

**Do not touch.** Event trees and credits, expeditions, stats, chronicle.

### WP4 — Event Legacy
**Goal.** Events as first-class, user-managed profiles: the new steps, credits on every sync and before every move, pages, the picker and suggestions, and P2.

**Create**
- `src/lib/engines/event-legacy-engine.ts`
- `src/lib/server/career-actions.ts` (`'use server'`), with `createEventAction`, `renameEventAction`, `mergeEventsAction`, `linkRacesToEventAction`, `linkStrongSuggestionsAction`, `unlinkRaceFromEventAction`, `setEventArchivedAction`, `dismissEventSuggestionAction` and `suggestEventForNameAction`.
- `src/app/events/page.tsx`, `src/app/events/[key]/page.tsx`, `src/app/events/[key]/loading.tsx`
- `src/components/events/*`
- `tests/integration/events.test.ts`
- `tests/integration/xp-exploits.test.ts`, created here with rows 6 (event part), 7 and 18.

**Modify**
- `economy.ts`: append the 9 `raceEventNodes`; rename the six existing display names (§3.3).
- `mastery-engine.ts`: `writeMissingEventStepCredits`; credits and payable in `syncMastery`; the merge carry-over helper; hiding merged trees in the overview.
- `session-engine.ts` `deleteRace`: `writeMissingEventStepCredits` and tombstones.
- `actions.ts`: event resolution in create and update, and `writeMissingEventStepCredits` before an event change.
- `src/lib/server/races.ts`: `getEventOptions`.
- `schemas.ts`: `eventKey`, `newEventName`.
- `add-race-form.tsx`, `edit-race-form.tsx`, `src/app/races/new/page.tsx`, `src/app/races/[id]/edit/page.tsx`.
- `race-detail-view.tsx`: the edition link and suggestion line.
- `mastery-trees.tsx`: links.
- `nav.tsx`: Events, directly after Career (WP6 and WP7 later place Career Statistics and Chronicle between them, §4.7.1).
- `career-backfill.ts`: P2.
- `recompute.ts`: nothing new beyond `syncMastery` now writing credits (asserted in its test).
- `tone.ts`: `eventLegacyHeadline`.
- Tests: `tests/auth/account-isolation.test.ts` (events, merge hops); `tests/engines/mastery.test.ts`; `tests/domain/economy-balance.test.ts` (the new nodes now present); `tests/integration/upgrade-from-0.3.2.test.ts` (P2: the fixture's `le-mans` event gets its credits and new steps once); the perf harness (event actions, P2, `logViewingSession` with the credit read).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/events.test.ts tests/integration/xp-exploits.test.ts \
  tests/engines/mastery.test.ts tests/domain/economy-balance.test.ts tests/auth \
  tests/integration/upgrade-from-0.3.2.test.ts
```
- The economy test includes the new nodes and still passes. I6 holds after every event scenario.

**Do not touch.** Expedition, stats and chronicle code.

### WP5 — Race Expeditions
**Goal.** Eligibility for any race, the mode control, checkpoints with the reconcile invariant (the switch never revokes), the Expedition page and timeline, the permanent summary, the stint-summary group, and P4.

**Create**
- `src/lib/engines/expedition-engine.ts` (`reconcileExpedition`, `writeExpeditionSummary`, `getExpeditionView`)
- `src/app/races/[id]/expedition/page.tsx`
- `src/components/expeditions/*`
- `src/components/ui/accent.ts` (`accentVars`; `accentStyle` refactored onto it)
- `tests/integration/expeditions.test.ts`

**Modify**
- `domain/expedition.ts`: the summary schema and builder.
- `session-engine.ts`: step 6 and step 16, `outcome.expedition` (with `began`), `expeditionCompleted`, the reconcile in `deleteViewingSession`, the expedition keys in `deleteRace`, and orphan expedition rows in `repairXpLedger`.
- `progression-resync.ts`: `reconcileExpedition` with `resize` when the runtime changed (and no summary, ever).
- `race-timeline.tsx`: `markers`, `ExpeditionTimeline`, and the exported helpers.
- `tone.ts`: `describeFragments`, `expeditionBudgetNote`, `expeditionModeMessage`.
- `race-detail-view.tsx`: the Expedition panel, the "Follow this race as an Expedition" line with the mode control on every race, and the per-stint new coverage from the replay.
- `race-card.tsx`: the badge. `current-stint.tsx` and `getCurrentStint`: the Expedition line.
- `contracts.ts`: `ExpeditionOutcome`, and the `SessionRemoval` expedition fields.
- `session-summary.ts`, `stint-summary.tsx`.
- `career-actions.ts`: `setExpeditionModeAction`.
- `config/achievements.ts`: the `expedition` display name. `strategist-engine.ts`: "a long race of about …" (and the test that asserts it).
- `career-backfill.ts`: P4.
- `recompute.ts`: `backfillExpeditions` with `resize: true`.
- `src/lib/server/races.ts` `getRaceDetail`: replay-derived new coverage per stint.
- Tests: `xp-exploits.test.ts`, rows 1–5, 8, 9, 13–17, 21 and 22; `tests/integration/upgrade-from-0.3.2.test.ts` (P4: I3 holds; a completed long race gets a retrospective summary); the perf harness (P4, the Expedition page).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/expeditions.test.ts tests/integration/xp-exploits.test.ts \
  tests/integration/session-flow.test.ts tests/domain/expedition.test.ts \
  tests/integration/upgrade-from-0.3.2.test.ts
```
- I3 holds after every exploit scenario.

**Do not touch.** Stats and chronicle.

### WP6 — Career Statistics
**Goal.** Statistics on the replay: event, race and length filters, instant core tabs, the new figures and charts, Records, Compare.

**Create**
- `src/components/charts/*`: move `ChartTooltip` here; `chart-theme.ts` with the reduced-motion rule.
- `src/components/stats/records-tab.tsx`, `compare-tab.tsx`
- `src/app/stats/loading.tsx`
- `tests/integration/stats-engine.test.ts`

**Modify**
- `stats-engine.ts`: the §4.4.3 rewrite of `loadScope`, `getRecords`, `getYearComparison`, the new `StatisticsView` fields (including `xpAndLevelsByYear`), `getFilterOptions` (events, races, length classes), and the dropped `library` row.
- `src/app/stats/page.tsx`: `tab`, `event`, `race`, `length`, `a`, `b`, `same`; Records and Compare computed only when requested.
- `statistics-view.tsx`: `history.replaceState` for the core tabs, transitions and pending states for Records, Compare and filters, the filters, the new cards and charts (with the sentence fallback), the Records footnote, the sub-label, imports from `components/charts`.
- `nav.tsx`: "Career Statistics", moved to directly after Career (WP7 inserts Chronicle between them).
- `tone.ts`: `differencePhrase`.
- Tests: `periods-tone.test.ts`; the perf harness (`/stats` core tabs, Records, Compare).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/stats-engine.test.ts tests/domain/window-summary.test.ts tests/domain/records.test.ts
```
- `npm run build` succeeds.
- Manually, on the seeded dev database, every tab renders with and without filters, and switching between the four core tabs makes no server request.

**Do not touch.** Chronicle, and the ledger series functions.

### WP7 — Career Chronicle and Endurance Wrapped
**Goal.** The index, chapters, frozen snapshots with the grace period, Wrapped, the prompt, the freeze triggers, and P5.

**Create**
- `src/lib/domain/chronicle.ts` (the chapter schema, `buildChapter`, `buildWrappedCards`)
- `src/lib/engines/chronicle-engine.ts`
- `src/lib/server/upgrades/chronicle-freeze.ts` (`freezeAllChronicles`)
- `src/app/chronicle/page.tsx`, `src/app/chronicle/[year]/page.tsx`, `src/app/chronicle/[year]/loading.tsx`, `src/app/chronicle/[year]/wrapped/page.tsx`
- `src/components/chronicle/*`
- `tests/domain/chronicle.test.ts`, `tests/integration/chronicle.test.ts`

**Modify**
- `src/instrumentation.ts`: the freeze pass.
- `career-backfill.ts`: P5 (completion is now P5).
- `actions.ts` and `career-actions.ts`: `ensureChroniclesFrozen` before each write, plus `rebuildChronicleYearAction` and `markWrappedSeenAction`.
- `src/app/page.tsx`: the Wrapped banner.
- `nav.tsx`: Chronicle, between Career and Career Statistics.
- `recompute.ts`: the freeze step and `--rebuild-chronicle`.
- `tone.ts`: `chapterHeadline`, `chapterBeginning`, `wrappedOpeningLine`, `wrappedCardLine`.
- Tests: `periods-tone.test.ts`; `tests/auth/account-isolation.test.ts` (chronicle, summaries); `tests/integration/instrumentation.test.ts` (freeze pass, skipped for incomplete accounts); `tests/integration/upgrade-from-0.3.2.test.ts` (the fixture's 2025 chapter frozen, the marker complete, a second run a no-op); the perf harness (P5, `/chronicle`, `/chronicle/[year]`).

**Acceptance.** The standard commands, plus:
```
npx vitest run tests/integration/chronicle.test.ts tests/domain/chronicle.test.ts \
  tests/integration/career-backfill.test.ts tests/integration/instrumentation.test.ts \
  tests/integration/upgrade-from-0.3.2.test.ts
```
- `npm run build` succeeds.
- The seeded dev database (2025 plus 2026 data) shows a frozen 2025 chapter and a 2026 year to date.

**Do not touch.** The XP economy.

### WP8 — Docs, version, changelog, e2e, final verification, owner notes
**Goal.** Ship 0.4.0.

**Modify**
- `README.md` (§9.1)
- `docs/install.md`, `docs/releasing.md`, and the new `docs/career-history.md`
- `package.json`, `package-lock.json` (both places)
- `src/lib/changelog.ts` (§9.3), then `npm run changelog`
- `tests/e2e/desktop.mjs`:
  - version header, and any check that depends on the nav order;
  - checks: `/career/milestones` renders dated milestones;
  - `/events`: create an event, link a race, open `/events/<key>`;
  - `/races/<24h race>/expedition`: timeline and checkpoints after logging stints from the Expedition page;
  - Expedition Mode off (checkpoint XP unchanged) and on;
  - `/chronicle`, then the current year's chapter, then Wrapped clicked to the end (the preview is not marked seen);
  - `/stats?tab=records` and `?tab=compare`;
  - a simulated upgrade: the e2e copies `tests/fixtures/career-0.3.2.db` into the app's data folder, launches, then checks that `config_overrides.careerBackfill` is complete and every `milestone_progress.achievedPrecision` is non-null.
- `tests/perf/career-scale.test.ts`: a final full run.

**Acceptance**
```
npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && npx vitest run
npm run build
npm run desktop:build
npm run changelog && git diff --exit-code CHANGELOG.md
PERF=1 npx vitest run tests/perf
```
- The e2e run, when Electron and xvfb are available: `npm run desktop:pack` then `node tests/e2e/desktop.mjs --app dist/linux-unpacked/…`, with its check count written into the header.
- Leave the tree with `npm rebuild better-sqlite3` done (`docs/releasing.md:86-101`).
- The hand-off message ends with the owner notes of §9.4.

**Do not touch.** Behaviour. Only docs, version, and tests or scripts that verify.

---

## Appendix A. Review resolutions

One line per review point. "Accepted" means the text above now implements it; "Rejected" gives the reason; "Partly" says which part was taken. Point ids follow the critiques: **I** = `CRITIQUE-integrity.md`, **P** = `CRITIQUE-product.md`, **E** = `CRITIQUE-engineering.md`; `M`/`E1…` are majors, `m` minors.

**Integrity**
- I-M1 (event-step credits only on paying unlocks; duplicate-name events) — Accepted: credits for every contributor of every unlocked step on every `syncMastery` and before every move (§4.2.2, §4.2.5); `createEvent` refuses a matching active name; §6 rows 7/18 restated, invariant I6 added; the honest-mistake trade-off is in §4.2.5 and §9.4.
- I-M2 (throw-away races farm per-race rungs) — Accepted: "race experienced" floor (§3.1) for `racesExperienced` rungs, `editionsExperienced` steps and `eventEditions`; `experienced_1` pays 0; exploit tests added. The Story Complete bonus on tiny races stays out of scope (§6 row 15).
- I-M3 (stint path revokes without rebuild; P4 on stale coverage) — Accepted: reconcile uses replay coverage (§4.3.3); R13 `settleLedger` on every path, the stint path included; the stint path revokes an unsupported story bonus (§4.0 step 5); P1 repairs legacy over-runtime races; test for a 0.3.2-shaped shrunk race.
- I-M4 (backfill budget and resumability) — Accepted: per-phase and per-chunk progress in the marker, committed with the work; the clock is asked before every chunk; 30 s budget; least-recently-served accounts first; context built once per account (§5.1–5.3); tiny-deadline test.
- I-M5 (paused backfill leaves unsafe state) — Accepted: freezing waits for completion (§4.5.2); credits are written on every sync and before every move, so nothing can re-pay while P2 is pending; §5.2 lists what is safe while paused.
- I-M6 (runtime typo writes a permanent summary) — Accepted: `resyncAfterRaceEdit` never writes a summary and defers landmark syncs after a runtime change (§4.0); a missing summary is written by the next stint, the mode switch, the backfill or recompute; test added (§6 row 21).
- I-M7 (`rebuildCareerTotals` too slow for new revoke paths) — Accepted: batched `CASE` re-stamp from the earliest removed row (§3.2.10, R13); Large targets for every delete path (§1.3) measured from WP2.
- I-m1 (migrate-040 test 3 cannot pass) — Accepted: comment lines stripped, per-statement regexes (§2.5).
- I-m2 (`year-plan` key includes the threshold) — Accepted: key `milestone:realHoursYear:<Y>`, reached by metric alone (§4.1.3); the coincidence with `realHours:336` in a first year is stated in R4 and §7.1.
- I-m3 (`deleteRace` misses orphaned viewing XP) — Accepted: `revokeRaceViewingXp` by `sourceRef` (§4.6); decided: the upgrade counts and logs 0.3.x leftovers but does not remove them, `db:recompute` does (R11, §5.3).
- I-m4 (retroactive checkpoint rows point at an old stint) — Accepted: retroactive awards carry `sessionId` null (§4.3.2).
- I-m5 (config change breaks I3) — Rejected as proposed (no config-hash marker): I3 is now defined on coverage only and paid amounts are never re-sized except by a runtime edit or recompute, so a re-balance cannot break it (§4.3.3, §6 row 22).
- I-m6 (merge chains unguarded) — Accepted: a merged event cannot be unarchived; at most 10 hops; every hop userId-scoped (§4.2.2, `EVENT_SHAPE`).
- I-m7 ("no grace period" false premise) — Accepted: 72-hour grace (`CHRONICLE_SHAPE.freezeGraceHours`, §4.5.2).
- I-m8 (XP by year untestable with injected `now`) — Accepted: tests set the ledger's `createdAt` explicitly (§8.1); `awardXp` stays unable to backdate.
- I-m9 (recompute misses intervals and skipped bonuses) — Accepted: §5.5 step 1; the upgrade's P1 also pays a skipped bonus (career-only).
- I-m10 (§2.6 inaccurate) — Accepted: corrected; only `EXPEDITION` ledger rows affect 0.3.2.
- I-m11 (SQLite has no `skipDuplicates`) — Accepted: `createManySkippingDuplicates` with a filter (§4.2.5, P2).
- I-m12 (deleted race's summary does not block a second) — Rejected: completing a re-added race is a real second completion and involves no XP; documented in §4.3.6 and README "Known limits".
- I-m13 (checkpoints pay the same at 8×) — Rejected (no cap): at 8× checkpoints earn at most about 22 XP per real minute, below viewing's 30, and the existing Story Complete bonus scales the same way; named in §6 row 2 and asserted in the economy test (§7.3).
- I-m14 (R4 overrides a binding decision) — Accepted as a hand-off: "first race started" stays at 0 XP because the owner's verbatim rule is "never twice" and the moment already pays through Green Flag and `sessions:1`; it is put to the owner in §9.4 and the changelog.
- I-m15 (fingerprint queries unscoped) — Accepted: every aggregate `where: { userId }` (§3.2.9, R12) and an isolation test.

**Product**
- P-M1 (D3: any individual race) — Accepted: any race can be switched on; checkpoint XP only from 6 h of runtime (§4.3.1).
- P-M2 (switching off takes XP back) — Accepted: the switch never revokes; I3 restated; tests added (§4.3.3, §6 row 8).
- P-M3 (NOTABLE has no visible effect) — Accepted: visible NOTABLE, the highlighted milestone block, per-milestone `celebration` levels, and a tested `celebrationView` (§4.1.6).
- P-M4 (duration classes mislabelled) — Accepted: `DURATION_CLASSES` runtime bands used by the chart, the chapter and the length filter (§3.1, §3.3, §4.4.2).
- P-M5 (`router.replace` re-renders on every click) — Accepted: `history.replaceState` for core tabs and Wrapped cards; Records and Compare computed on request inside a transition; `loading.tsx` files (§4.4.1, §4.5.1).
- P-M6 (frozen v1 lacks the first chapter's needs) — Accepted in full: (a) `beginnings`, (b) milestone subject, (c) career year computed at read time, (d) full lists stored, (e) "since beaten" computed at render, (f) full summary cards in the chapter from their rows (§4.5.1–4.5.2).
- P-M7 (retrospective summaries freeze today's mastery) — Accepted: championship mastery null for retrospective summaries; event figures replayed at `completedAt` (§4.3.6); test added.
- P-M8 (first comparison against a 100-day year) — Accepted: `activeFrom`/`careerBeganInYear`, no percentage changes and a leading note; "same stretch" symmetric (§3.2.6, §4.4.4, §4.5.4).
- P-M9 ("100%" shown with gaps) — Accepted: `formatCoveragePercent` floors and is used on every surface, the existing stint summary included (§3.2.8).
- P-M10 (Wrapped reads as a report) — Accepted: `wrappedCardLine`, a fixed card anatomy, `min-h` and `line-clamp` (§4.5.1, §4.7.4).
- P-m1 (D2 departure not surfaced) — Accepted: §9.4 owner notes and a changelog line.
- P-m2 (Expedition page is a dead end) — Accepted: "Log a stint" on the page (§4.3.5).
- P-m3 (no "Expedition started" moment) — Accepted: `ExpeditionOutcome.began` and its line (§4.3.8).
- P-m4 (delete-race message discarded) — Accepted: `/races?removed=…&xp=…` notice (§4.6).
- P-m5 (strategist copy collides) — Accepted: "a long race of about …" (§3.3).
- P-m6 (eligibility tolerance) — Accepted: automatic eligibility from the scheduled length (§4.3.1).
- P-m7 (three-way control opaque) — Accepted: a toggle with the effective state, a caption and "Reset to automatic" (§4.3.5).
- P-m8 (two "Real viewing" figures) — Accepted: the race page shows credited time; the Statistics sub-label is reworded (R7, §4.4.3).
- P-m9 (Completion panel duplicates) — Accepted: the `library` row is dropped; §3.1 explains why "completed" equals Story Complete.
- P-m10 (vocabulary drift) — Accepted: "races started" and "races experienced" defined once and used everywhere; one of them on the Wrapped card; "Lifetime ladders" in the stint summary; "First complete race story".
- P-m11 (event-step XP looks broken) — Accepted: grouped steps, XP as a secondary chip with an explanation, and "Complete" in the existing Story Complete step names (§3.3, §4.2.4).
- P-m12 ("consecutive editions followed") — Accepted: "Consecutive complete editions" plus the experienced run, both as history, never a current streak (§3.1, §4.2.4).
- P-m13 ("full viewing year" as a quota) — Accepted: the current year is a fact with no bar; unreached years are never listed; plain wording (§4.1.1).
- P-m14 (suggestion names and one-click merges) — Accepted: names from the latest race with its own spelling; merges only through the confirm dialog; "Link all strong suggestions" (§3.2.4, §4.2.4).
- P-m15 ("Add races" does not scale) — Accepted: search, suggested first, at most 50 (§4.2.4).
- P-m16 (browsing ten years) — Accepted: previous/next chapter links, "See {year} in Career Statistics", and the 1 January state (§4.5.1).
- P-m17 (year-to-date marking and a11y) — Accepted: the chip on every card and `aria-live` (§4.5.1).
- P-m18 (Wrapped banner can arrive late) — Accepted: `pendingWrapped` calls `ensureChroniclesFrozen` first; with the grace period the banner comes when the year is frozen (§4.5.4).
- P-m19 (empty and thin states) — Accepted: event with no races, Expedition with no stints, records shown only when set, one footnote, charts below three points become a sentence (§4.2.4, §4.3.5, §4.4.4).
- P-m20 (XP and levels at ten years) — Accepted: XP and Levels columns in the Year-by-year table (§4.4.3–4.4.4).
- P-m21 (compare rows not enumerated; Records with a year) — Accepted: `COMPARE_ROW_ORDER` with a test; a year filter shows the best within that year (§3.2.6, §4.4.2).
- P-m22 (thin dashboard integration) — Accepted: the Expedition line in `CurrentStint` and a `milestone` kind in `RecentUnlocks` (§4.3.8, §4.7.3).
- P-m23 (accent mechanism) — Accepted: `accentVars`, with `accentStyle` refactored onto it (§4.7.2).
- P-m24 (tone coverage of server files) — Accepted: `SERVER_FILES` joins the forbidden-phrase scan (R10, WP2).
- P-m25 (navigation order) — Accepted: Career · Chronicle · Career Statistics · Events (§4.7.1).
- P-m26 (Recharts reduced motion) — Accepted: never `isAnimationActive={true}` (R10, `chart-theme.ts`).
- P-m27 (README backfilling subsection) — Accepted (§9.1).
- P-m28 (precision caveat) — Accepted: interpolated times shown to five minutes with "worked out from when the stint was logged"; batch-logged windows fall back to STINT (§4.1.1, R6).

**Engineering**
- E1 (FK child scans; 3.3 s race delete) — Accepted: `@@index([sessionId])` on `xp_transactions` and `watched_intervals`, plus `expedition_summaries(raceId)`; migration regenerated and verified (11.6 ms) (§2.1–2.2).
- E2 (`rebuildCareerTotals` 29.6 s) — Accepted: batched from-earliest settle (6.9 s full re-stamp) and §1.3 targets, measured from WP2.
- E3 (freeze drops midnight-spanning stints) — Accepted: 72-hour grace; the boundary tests replaced (§4.5.2, §8.2).
- E4 (rounded recognition vs exact replay) — Accepted: `recognitionThresholdSeconds` (§3.2.5) and tests.
- E5 (overlapping windows date backwards) — Accepted: windows cut at the previous stint's instant, STINT when unreliable, monotonicity property test (R6, §3.2.2).
- E6 (Story Complete rate above 100%) — Accepted: cohort rate (§3.1) and test.
- E7 (backfill and recompute phases unbounded) — Accepted: chunks, a once-per-account context, a 30 s budget, and per-WP performance checks (§5).
- E8 (no test on data written by real 0.3.2) — Accepted with a correction: the fixture comes from `npm run db:seed:demo` (plain `db:seed` makes an empty career), generated before WP1 changes the schema; `upgrade-from-0.3.2.test.ts` grows with each WP (§8.1, §10).
- E-m1 (snapshot interfaces break `InputJsonValue`) — Accepted: zod schemas and `z.infer` types (§3.2).
- E-m2 (snippet does not type-check) — Accepted: corrected (§3.2.10).
- E-m3 (stint-path reconcile can break I2) — Accepted: no re-size on the stint path, and `settleLedger` everywhere (§4.3.3, R13).
- E-m4 (P4 uses cached coverage) — Accepted: replay coverage in reconcile; P1 legacy repair (§5.2).
- E-m5 (credit load on every sync) — Partly: the `createManySkippingDuplicates` filter is accepted; the single per-sync read stays, because I-M1 needs credits on every sync; its cost is in the perf harness (§4.2.5).
- E-m6 (replay built for non-replayable rows) — Accepted (§4.1.4 step 3).
- E-m7 (two race scans per stint) — Accepted: one union select (§3.2.10).
- E-m8 (`repairXpLedger` N+1) — Accepted (§3.2.10).
- E-m9 (cache placement and concurrent misses) — Accepted: `globalThis`, in-flight de-duplication, and the season-year assumption in a comment (§3.2.9).
- E-m10 (weak time-zone guard) — Accepted: January and July offsets asserted (§8.1).
- E-m11 (frozen "since" goes stale) — Accepted: computed at render with `beatenAfter` (§3.2.7, §4.5.1).
- E-m12 (`year-plan` key) — Accepted (same as I-m2).
- E-m13 (one-race-per-event farm understated) — Partly: §6 row 18 corrected, the experienced floor added and `experienced_1` set to 0; the "pay only from two editions" rule is rejected, because what remains is proportional to logged viewing (`event_hours_25` is 1.1% of the viewing XP it needs) and a reached-but-unpaid step would read as a fault.
- E-m14 (economy model under-counts checkpoints) — Accepted: the long-race profile, the per-race bound and the per-minute bound replace the aggregate 0.04 bound (§7.3).
- E-m15 (URL tabs recompute everything) — Accepted (same as P-M5).
- E-m16 (Chronicle index parses every snapshot) — Rejected: at most 20 snapshots of a few tens of KB each; the index has a < 500 ms Large target in the harness, so no extra column is needed.
- E-m17 (redundant `EventStepCredit` index) — Accepted: removed (§2.1).
- E-m18 (`stintUnlockWindow` overlap) — Accepted: bounded by the neighbouring stints (§3.2.11).
- E-m19 (`freezeAllChronicles` reads the clock in an engine) — Accepted: moved to `server/upgrades/chronicle-freeze.ts` with `shouldContinue` (§4.5.2, §5.4).
- E-m20 (caught unique violations log errors) — Accepted: `upsert` with an empty update (§4.5.2).
- E-m21 (week label straddles the year) — Accepted: the label is clipped to the year (§3.2.1, §4.5.1).
- E-m22 (the boundary test encodes E3) — Accepted: replaced (§8.2).
- E-m23 (major-event trophy wording wrong) — Accepted: corrected in §4.6, §6 row 6 and "Known limits".
- E-m24 (DB performance first measured in WP8) — Accepted: the DB harness is built in WP2 and each WP adds its paths (§8.1, §10).
