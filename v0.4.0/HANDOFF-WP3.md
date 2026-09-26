# HANDOFF — WP3 (Career Milestones and the backfill framework)

Branch `release/v0.4.0`, committed as `228d90e` (on top of WP2's `f18c75d`) and pushed to `origin/release/v0.4.0`, after the review fixes below.
WP3 was resumed from an unfinished working tree. That tree held nearly all of the source changes but no tests.
I reviewed it against SPEC §1, §3.2.11, §4.0, §4.1, §4.7.3–4.7.4, §5 and §10 WP3, kept what was correct, and made these changes:
- `domain/celebration.ts` no longer imports engine types;
- the reconstructed ladder rows are ordered;
- recompute shares one replay between filling dates and rebuilding them, and its comment is corrected;
- the achievements page header is renamed;
- every test and perf path WP3 names is written.

## What was built (files)

**New (source)**
- `src/lib/engines/career-milestone-engine.ts`:
  - `syncCareerMilestones`, `fillLandmarkDates`, `rebuildLandmarkDates`;
  - `listStintCareerMilestones`, `isCareerMilestoneRung`, `listRecentCareerMilestones`;
  - `getCareerMilestonesView` and the view types.
- `src/lib/engines/stint-unlocks.ts`: `StintUnlocks`, `stintUnlockWindow`, `stintUnlockWindowFor`, `reconstructStintUnlocks`. This is the reconstruction moved out of `session-summary.ts`, bounded on both sides and by the neighbouring stints.
- `src/lib/domain/celebration.ts` (pure): `CelebrationLevel`, `MilestoneCelebration`, `CelebratedMilestone`, `highestMilestoneCelebration`, `levelForMilestone`, `louderLevel`, `celebrationView<M>`.
- `src/lib/server/upgrades/career-backfill.ts`:
  - the marker, `deadlineClock` and `buildPhaseContext`;
  - P1 (`backfillRaces`) and P3 (`backfillMilestones`);
  - `runCareerBackfillFor` and `runCareerBackfill`;
  - `describeCareerBackfill` and `describeLeftovers`.
- `src/app/career/milestones/page.tsx`
- `src/components/milestones/career-milestones-view.tsx` (a client component, for the "By kind" / "By date" toggle) and `milestone-card.tsx`.

**Modified (source)**
- `session-engine.ts`:
  - step 10 destructures `history`;
  - step 12 is `syncCareerMilestones` (its XP goes into `xpBreakdown` as "Career milestone — …");
  - step 13 is `fillLandmarkDates(…, { recognisedBySessionId })`;
  - step 17 builds the outcome's `careerMilestones` with `listStintCareerMilestones`, and leaves catalogue rungs out of `milestones`;
  - `chooseCelebration` takes `careerMilestoneCelebration`;
  - `celebrationView` is re-exported.
- `contracts.ts`: `CareerMilestoneUnlock` and `SessionOutcome.careerMilestones`.
- `session-summary.ts`: uses `reconstructStintUnlocks` and `listStintCareerMilestones`, applies the same catalogue exclusion, and passes the milestone celebration.
- `stint-summary.tsx`:
  - a "Career milestones" group;
  - a highlighted block, styled like "Season Complete", for any milestone whose celebration is not `none`;
  - a NOTABLE heading in the accent colour, with the unlock block rising in;
  - `hasUnlocks` includes the group;
  - "Milestones" is renamed "Lifetime ladders".
- `achievement-board.tsx`: the tab is renamed "Lifetime ladders", the stat is renamed "Ladder rungs", and there are two links to Career Milestones.
- `src/app/achievements/page.tsx`: the header now reads "Achievements and lifetime ladders" (deviation 10).
- `src/app/career/page.tsx`: a "Career Milestones" panel with the three most recent and a "See all" link.
- `hall-of-fame.tsx`: each entry's `<li>` has `id={entry.key}`, so a milestone can link to `/hall-of-fame#<key>`.
- `dashboard.ts` and `panels.tsx`: `RecentUnlocks` has a `milestone` kind, dated `achievedAt ?? reachedAt` and linking to `/career/milestones`.
- `instrumentation.ts`: the backfill block, with a clock of `startedAt + STARTUP_BUDGET_MS`, where `startedAt` is taken when `register` begins.
- `accounts.ts`: `createAccount` calls `markCareerBackfillApplied(id)`.
- `recompute.ts`:
  - `syncCareerMilestones`, then `fillLandmarkDates`, then `rebuildLandmarkDates` when `rebuildMilestoneDates` is set;
  - then `markCareerBackfillApplied`;
  - five new report fields.
- `scripts/recompute.ts`: the `--rebuild-milestone-dates` flag and the new printed counts.
- `progression-resync.ts`: `syncCareerMilestones` and `fillLandmarkDates` run inside the `!runtimeChanged` block, and `xpAwarded` includes their XP.
- `config/career-milestones.ts`: `careerMilestoneOfRow(metric, threshold)`.
- `tone.ts`: `precisionLabel`, `yearToDateFact`, `celebratedBy` and `stillAheadNote`.

**Tests**
- New:
  - `tests/integration/career-milestones.test.ts` (14 tests)
  - `tests/integration/career-backfill.test.ts` (13)
  - `tests/engines/celebration.test.ts` (13; covers `chooseCelebration`, `celebrationView` and `stintUnlockWindow`)
- Modified:
  - `tests/integration/instrumentation.test.ts`, with 5 new tests: the four §8.3 names plus "logs a failure of the career backfill and still lets the server start".
  - `tests/integration/upgrade-from-0.3.2.test.ts`: now uses `pointPrismaAtFixture`, and has 6 new tests running P1 and P3 on the fixture.
  - `tests/integration/recompute.test.ts`: dates are part of the idempotency state, and 2 new tests.
  - `tests/domain/periods-tone.test.ts`: the new tone functions are registered, and 4 new tests.
  - `tests/domain/config.test.ts`: `careerMilestoneOfRow`.
  - `tests/perf/career-scale.test.ts`, with three new paths:
    - a stint that dates every undated landmark;
    - the whole backfill of the real career;
    - the context and every P1 and P3 chunk on the large career.

## Deviations (smallest sound change, with reasons)

1. **`backfillRaces(tx, ctx, chunk)` takes the chunk's transaction.** The spec's signature is `(ctx, chunk)`. Each chunk must write its marker in the same transaction as its work (§5.2), so the caller opens the transaction and passes it in. The perf harness calls it the same way.
2. **`celebrationView` and its helpers live in `src/lib/domain/celebration.ts`, and `session-engine` re-exports it.**
   - `stint-summary.tsx` is a client component. Importing `session-engine` from it would pull Prisma into the browser bundle.
   - The types are structural (`celebrationView<M extends { title; celebration }>`), so the domain module imports nothing from the engines.
3. **An unlock window's neighbours are the stints strictly before and after it by `watchedAt`, not by the full canonical order.**
   - With canonical tie-breaks, a stint sharing its `watchedAt` with the previous one would get `from = watchedAt + 1 ms > to`, an empty window.
   - Unlocks are told apart only by their stamp, so two stints with the same `watchedAt` share one window.
4. **Neighbouring windows can overlap between two instants (this is the spec's own formula). Each stint's own instant still falls in its window and in no neighbour's.**
   - Live unlocks are stamped with the stint's `now`, which is its `watchedAt`, because the form sends no `watchedAt`.
   - So no unlock is ever claimed twice. `celebration.test.ts` states this, and "two stints logged minutes apart never claim each other's unlocks" proves it end to end.
5. **`reconstructStintUnlocks` orders ladder rows by ladder (the `MILESTONES` order), then by threshold.** A reopened summary then lists them exactly as the live stint did. The tests compare the two for equality.
6. **Extra fields:**
   - `CareerMilestoneUnlock.recordedAt` (ISO `reachedAt`), so a RECOGNISED row in a stint summary can say when it was recorded;
   - `syncCareerMilestones` returns `{ created, xpAwarded, reached[] }`, where `reached` feeds the XP breakdown;
   - `fillLandmarkDates` returns `{ milestones, eventSteps, recognised }`.
7. **`getCareerMilestonesView` does not call `getCareerTimeline`.** It takes the current year's hours and the event names from `computeCareerMetricsWithHistory`, which the progress figures need anyway, plus `creditedSecondsByLocalYearOfSessions`. The figures are the same, with one load and no replay.
8. **Event subjects have `href: null` until WP4.** `/events/[key]` does not exist yet, so a link would lead nowhere. The name is shown.
9. **The acceptance check "a copy of the dev `endurance.db`" was run on a copy of `tests/fixtures/career-0.3.2.db` in the scratchpad**, because the real `endurance.db` is off limits.
   - Steps:
     1. `DATABASE_URL=file:<copy> npm run db:deploy` applied `20260924120000_career_history`.
     2. `DATABASE_URL=file:<copy> next dev -p 3917` started.
   - The start-up log shows:
     - `[season-reset] Demo Driver …: removed 0 …`
     - `[career-backfill] Demo Driver (…0001): credited 11 races, 0 legacy races repaired, story bonuses +0/−0; 2 new milestones (+500 XP), 24 dates filled, 16 recorded only`
   - Afterwards, 0 of 39 milestone rows and 0 event steps were undated, and the marker was complete.
   - With a session row added to the copy, `/career/milestones`, `/career`, `/` and `/achievements` all returned 200 and rendered as intended.
10. **The `/achievements` header was renamed from "Achievements and milestones / Milestones are the numbers underneath them" to "Achievements and lifetime ladders / The lifetime ladders are the numbers underneath them"**, and the stat "Milestones" to "Ladder rungs". The spec renames only the tab. Without this, the page would define "milestones" differently from the new Career Milestones page. Season pass "Milestones" (tiers) are a different thing and are untouched.
11. **Two extra tone functions: `celebratedBy(payers)` and `stillAheadNote(value, target, unit)`.**
    - `celebratedBy` gives "Celebrated by the Green Flag achievement and the first viewing-session rung." and "Celebrated by The Archive achievement."
    - `stillAheadNote` gives "Still ahead: 212 of 250 hours". It floors, so it never reads as reached early.
    - Both are registered in `everyUserFacingString()`.
12. **`CareerBackfillMarker` is a `type` alias, not an `interface`.** A Prisma `Json` input needs the implicit index signature of a type alias (§3.2).
13. **`CareerBackfillSummary` carries only WP3's counters**: races, legacy repairs, bonuses, milestones, dates and leftovers. Later WPs add theirs, and the matching log-line segments.
14. **Recompute's `markCareerBackfillApplied` is labelled step "4" in `recompute.ts` for now.** §5.5 puts Expeditions (WP5) at 4 and the mark at 5, so WP5 inserts its step and renumbers.

## Facts later WPs must know

**Signatures (as built)**
- `career-milestone-engine.ts`:
  - `syncCareerMilestones(tx, userId, { metrics, history, now }) → { created, xpAwarded, reached: { id, title, metric, threshold, xpAwarded }[] }`:
    - it writes and pays career-owned rows only;
    - a year counts as reached when **any** row has its metric;
    - rows are upserted with an empty `update`.
  - `fillLandmarkDates(tx, userId, { history, now, timeline?, recognisedBySessionId? }) → { milestones, eventSteps, recognised }`:
    - it returns before building any replay when nothing is undated;
    - every write is guarded by `achievedPrecision: null`.
  - `rebuildLandmarkDates(tx, userId, timeline) → number`: the developer-repair exception to write-once, for rows whose replayed instant passes `acceptInstant` and differs from what the row holds. It returns the rows it actually moved, so a second rebuild reports 0.
  - `listStintCareerMilestones(db, userId, sessionId) → CareerMilestoneUnlock[]`: in catalogue order.
  - `isCareerMilestoneRung({ metric, threshold })`
  - `listRecentCareerMilestones(userId, limit, db = prisma) → RecentCareerMilestone[]`, each `{ key, title, date, precision, subjectName, celebration }`, newest first.
  - `getCareerMilestonesView(userId, now) → CareerMilestonesView`, which is `{ groups, timeline, currentYear }`.
    - Item ids are catalogue ids; a year's rung is `year-plan:<year>`.
    - A plaque's `href` is `/hall-of-fame#<key>`.
- `stint-unlocks.ts`:
  - `stintUnlockWindow(watchedAt, { previousWatchedAt, nextWatchedAt })`
  - `stintUnlockWindowFor(db, userId, { watchedAt })`
  - `reconstructStintUnlocks(db, userId, { id, watchedAt }) → StintUnlocks`. It works with a transaction client, so WP5's `writeExpeditionSummary` can use it.
  - Its `milestones` include **every** row in the window, catalogue rows too, with a raw metric label for career-owned ones.
    - Filter them with `isCareerMilestoneRung` (as `session-summary` does).
    - Take the career milestones from `listStintCareerMilestones`.
- `config`: `careerMilestoneOfRow(metric, threshold) → { def, year? } | null`. It recognises `realHoursYear:<Y>` by metric alone.
- `tone.ts`:
  - `precisionLabel(precision | null, at, subjectName?)`. INTERPOLATED times are rounded to `TIMELINE_SHAPE.displayRoundingMinutes`. A null precision gives "Recorded on …".
  - `yearToDateFact(year, creditedSeconds)`
  - `celebratedBy(payers)`: joins the `alsoPaidBy` strings as they are; they are written in their mid-sentence form (see Review fixes, 3).
  - `stillAheadNote(value, target, unit)`
- `chooseCelebration(facts)` requires `careerMilestoneCelebration: 'none' | 'notable' | 'spectacular'`. **WP5** adds `expeditionCompleted`, and must also extend `hasUnlocks` in `stint-summary.tsx`.

**The backfill (`career-backfill.ts`)**
- Exports:
  - `CAREER_BACKFILL_KEY = 'careerBackfill'` and `CAREER_BACKFILL_VERSION = '0.4.0'`;
  - `CAREER_BACKFILL_PHASES = ['P1', 'P3']` and `PhaseKey`;
  - `STARTUP_BUDGET_MS = 30_000`;
  - `readCareerBackfillMarker`, `isCareerBackfillApplied`, `markCareerBackfillApplied` (which keeps `lastRunAt`);
  - `BackfillClock` and `deadlineClock(deadline, now = Date.now)`;
  - `PhaseContext { userId, now, timeline }` and `buildPhaseContext(userId, now)`;
  - `backfillRaces(tx, ctx, chunk)` and `backfillMilestones(tx, userId, now, timeline)`;
  - `runCareerBackfillFor(userId, { now, clock, force? })` and `runCareerBackfill({ now, clock, log? })`;
  - `describeCareerBackfill(summary, name?)` and `describeLeftovers(summary, name?)`.
- Internals: `RACE_CHUNK = 500`, a minimum chunk estimate of 1 s, and chunk transactions of `{ maxWait: 15_000, timeout: 60_000 }`.
- **Adding a phase (WP4 P2, WP5 P4, WP7 P5).** Change these together:
  - insert it in `CAREER_BACKFILL_PHASES` in its §5.2 order;
  - add its branch in the `runCareerBackfillFor` loop;
  - extend `markerSchema` and `parseMarker` (the `cursors` field is `z.object({ P1 })`, which strips unknown keys, so WP5 must add `P4`);
  - update the cursor clearing in `withPhaseDone`;
  - add the summary fields and `emptySummary`;
  - add the log segment in `describeCareerBackfill`.

  `isComplete` needs every known phase, so an account completed by a WP3 build runs just the new phase.
- **WP4 gotcha.** An account a WP3 build completed has P3 in `done`. When P2 then runs alone, P3 does not run again to date the steps P2 unlocks, so they stay undated until the next stint dates them.
  - This affects development databases only.
  - The simplest fix is for P2 to call `fillLandmarkDates` with the context's timeline at the end of its chunk.
- `runCareerBackfill` picks the incomplete accounts in JavaScript. It runs never-served accounts first, then orders by `lastRunAt` ascending, then by id. It logs one line per account, plus a leftovers line when there is anything to report.
- **P1 details:**
  - credited time comes from the context replay's `RaceHistory.creditedSeconds`;
  - legacy repair is triggered by `watchedInterval.groupBy _max.endSec > runtimeSec`, and then runs `rebuildRaceIntervals` and `recomputeRaceAggregates({ preserveStatus: true })`;
  - `reconcileStoryBonus` runs only where the replay's completion and the held bonus disagree;
  - one `settleLedger` per chunk.
- **Leftovers** are counted only once an account completes, and never removed:
  - viewing XP: VIEWING or REWATCH rows with `sessionId` null;
  - Story Complete bonuses of races that are gone: `story-complete:` keys with no matching race.
- `instrumentation.ts` creates its clock inline. **WP7** should lift it into a `const clock` shared with the freeze pass (§5.4).

**Recompute and the script**
- `RecomputeOptions` is `{ now?, rebuildMilestoneDates? }`. `RecomputeReport` adds `careerMilestonesReached`, `careerMilestoneXp`, `datesFilled`, `datesRecognised` and `milestoneDatesRebuilt`.
- **WP7:** `scripts/recompute.ts` `parseArguments` rejects unknown `--` flags, and takes the first non-flag argument as the account. `--rebuild-chronicle <year>` must therefore consume its value, or the year is read as an account name.

**UI and data**
- Stint summary: the highlighted block is used for any `celebration !== 'none'`, and headlines come from `celebrationView`. The page's `MilestoneCard` highlights reached major milestones.
- **WP4:** set `subject.href` for event subjects in `getCareerMilestonesView`'s `subjectOf`. `history.races` has both `eventId` and `eventKey`, so the key can be found from the row's `eventId`.
- **WP7:** a milestone row carries its `subjectName`, `raceId` and `eventId`, so a chapter can name its subject even if the race is gone. `listRecentCareerMilestones` and the view's `timeline` are ready to use.
- `buildOutcomeForSession` no longer counts milestone XP in a reopened stint's `careerXpAwarded`, because career milestone awards carry no `sessionId`. This matches every other non-viewing award since 0.3.x.

**Measured (this container, tsx, on a copy of WP2's `large.db`)**

| Path | Real (ms) | Large (ms) |
|---|---|---|
| First stint after seeding (creates and dates every rung; untimed in the harness) | 1,170 | 4,000 |
| An ordinary stint | 126 | 720 |
| A stint that dates every landmark (all undated) | 175 | 2,780 |
| `buildPhaseContext` | 28 | 567 |
| P1, slowest chunk of 500 | 54 | 96 (11 chunks, 775 in all) |
| P3 | 63 | 1,662 (373 filled, 41 recognised) |
| Whole backfill, forced | 153 | 2,856 |

On the Large career, P3 is dominated by `eventStepInstant`, which filters all 60,000 stints once per event-step row. If WP4's extra steps push it towards 5 s, memoise the stints of each event per timeline (a `WeakMap`) in `domain/landmarks.ts`.

**Mutation checks.** Each change below was applied alone and then restored; the md5 of every file was verified afterwards. Each one failed at least one test.
- `stintUnlockWindow` without the next-stint bound
- `fillLandmarkDates` accepting every instant
- the year rung reached by `(metric, threshold)` instead of by metric
- no catalogue exclusion from the live `milestones`
- `preserveStatus: false` in the legacy repair
- accounts ordered by id alone
- recognised rows never attached to the stint

## Check results (final run, after the last edit)

- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 problems.
- `npx vitest run`: 56 files passed, 1 skipped (perf); **995 tests passed**, 15 skipped.
- WP3 targeted tests: 6 files, **86 tests passed**. The command:
  ```
  npx vitest run tests/integration/career-milestones.test.ts tests/integration/career-backfill.test.ts \
    tests/integration/instrumentation.test.ts tests/integration/upgrade-from-0.3.2.test.ts \
    tests/domain/design-rules.test.ts tests/domain/economy-balance.test.ts
  ```
- `PERF=1 npx vitest run tests/perf`: **15/15 passed**. The WP3 paths were:
  - a dating stint: real and large together, 2.4 s;
  - large context plus 11 P1 chunks plus P3: 3.0 s;
  - the real career's whole backfill: well under its 5 s limit.

## Review fixes

An independent review reported five minor issues and two spec gaps. Each was checked against the code. All five issues were valid and are fixed, four with a new or stronger test; the fifth changes no behaviour, so its test guards the isolation rather than the query. Neither spec gap is changed in WP3; the reasons are below.

1. **Nothing tested how `fillLandmarkDates` dates event steps (§4.1.4 step 5).**
   - `upgrade-from-0.3.2.test.ts › dates every milestone and event step…` now checks every step counted in editions (`editionsStoryComplete`, `editionsExperienced`). Each must be STINT, and its `achievedSessionId` must name a stint of a race with the step's own `iconicKey`. Its `achievedAt` must equal that stint's `watchedAt` and be no later than `unlockedAt` + 5 min. The fixture has one such step, `fort-aurelia-24 edition_1`.
   - New `career-milestones.test.ts › an event step › is dated to the stint that completed its edition, from the replay of that event's races`. A 1-hour `iconicKey` race is watched in two stints.
     - Live, `edition_1` is STINT at the closing stint's instant, with `achievedSessionId` set to that stint.
     - The row is then undated and `fillLandmarkDates` is run with no stint being logged, so there is no `recognisedBySessionId` to fall back on. It returns `{ milestones: 0, eventSteps: 1, recognised: 0 }`, and `achievedSessionId` is again the closing stint, not the opening one.
   - Mutation: replaying the step under `event:<iconicKey>` (what reading `tree.key` would do) fails both tests.
2. **Nothing checked that a career milestone raises `SessionOutcome.celebrate`.**
   - New `career-milestones.test.ts › a milestone history cannot place › celebrates the stint that recorded it as loudly as the milestone asks, live and reopened`. An undated `racesExperienced:1000` row (`races-1000`, spectacular), recorded at the stint's instant, makes a ten-minute first stint SPECTACULAR. `buildOutcomeForSession` gives the same.
   - The neighbouring test now asserts the control: the same stint with only `none` milestones is not SPECTACULAR.
   - Mutation: `'none'` in place of `highestMilestoneCelebration(careerMilestones)` fails the test, both in `session-engine.ts` and in `session-summary.ts`.
3. **`celebratedBy` lower-cased the "The" of The Archive.**
   - The `alsoPaidBy` strings in `config/career-milestones.ts` are now written as they read mid-sentence:
     - "the Green Flag achievement" and "the first viewing-session rung";
     - "The Archive achievement";
     - "that event's own … step".
   - The field's comment says so. `celebratedBy` only joins them; the regex is gone. (WP1's hand-off quoted the old capitalised forms.)
   - `periods-tone.test.ts` now reads the payers from the catalogue. It expects "Celebrated by The Archive achievement." and also checks a list of three.
   - Mutation: putting the regex back fails the test.
4. **`rebuildLandmarkDates` rewrote and counted rows it did not change.**
   - It now also reads each row's stored date fields: `achievedAt`, `achievedPrecision`, `sessionId`, `raceId`, `eventId` and `subjectName`, or for a step `achievedAt`, `achievedPrecision` and `achievedSessionId`. It skips the write when the replay gives the same values. The count is therefore the rows actually moved, and an unchanged row keeps its `updatedAt`.
   - `recompute.test.ts › never moves a milestone's date unless asked…` now expects exactly 1 rebuilt (the date made wrong). Every other row, `updatedAt` included, must be unchanged. A second `rebuildMilestoneDates: true` run must report 0 and change no row.
   - New `› a rebuild counts only the dates it moves, not the ones the same run has just filled`: with every row undated, a rebuild run reports dates filled and 0 rebuilt.
   - Mutation: dropping the skip fails both tests.
5. **P1's legacy-repair probe read `watchedInterval` without an account scope.**
   - The `groupBy` is now `where: { raceId: { in: chunk }, race: { userId } }`. `WatchedInterval` has no `userId`, so it is scoped through its race (R12).
   - Nothing observable changes, because only races re-read with `userId` were ever consulted. No test can tell the two queries apart.
   - New `career-backfill.test.ts › P1: races › leaves a race of another account in its chunk exactly as it is`. It calls `backfillRaces` for one account with another account's shortened, bonus-holding legacy race in the chunk. The result is all zeros, and that race, its intervals and its owner's ledger are unchanged.

**Spec gaps (not changed in WP3)**
- **Event subjects have no link (§4.1.1, §4.1.5; deviation 8).** This is confirmed: `subjectOf` returns `href: null` for events. `/events/[key]` does not exist until WP4, and a link now would be dead navigation, which the rules forbid. **WP4 must close it** in `getCareerMilestonesView`'s `subjectOf`, as "Facts later WPs must know" says.
- **The view reads the current year's hours and the event names from `computeCareerMetricsWithHistory`, not the cached `getCareerTimeline` (§4.1.5; deviation 7).** This is confirmed and kept.
  - The progress figures need `computeCareerMetricsWithHistory` anyway.
  - `creditedSecondsByLocalYearOfSessions` equals `creditedSecondsByLocalYear(timeline)` (WP1).
  - Event names come from the same loader rows.
  - `getCareerTimeline` would add a fingerprint query and possibly a replay, and change no figure. No §1.3 target covers this page.

### Check results (after the review fixes)
- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 problems.
- `npx vitest run`: 56 files passed, 1 skipped (perf); **999 tests passed**, 15 skipped.
- WP3 targeted tests: 6 files, **89 tests passed**.
- `PERF=1 npx vitest run tests/perf`: **15/15 passed**.
