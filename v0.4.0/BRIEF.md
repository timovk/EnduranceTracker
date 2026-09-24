# v0.4.0 — the owner's brief (verbatim) and the owner's decisions

## Owner's decisions (answers to questions asked before implementation)

1. **Past viewing:** "No, start from now." Do NOT add a "when did you watch this" field or any import feature. The Chronicle starts from when the owner began using the app (first real data: 22 September 2026). The engine's existing optional `watchedAt` input (used by scripts/seed.ts and tests) stays; the history replay must handle backdated sessions correctly because tests and seed data use them.
2. **New XP:** "A little, never twice." Expedition checkpoints and the genuinely NEW milestones (e.g. first race started, first 6-hour race completed, hours in one calendar year, 5 and 25 editions of one event, new event-legacy steps) pay modest XP. Moments that already pay XP today keep paying exactly as now and are never paid a second time by a new system.
3. **Expedition threshold:** races of **10 hours and longer** are Expeditions automatically. The user can switch Expedition Mode on or off for any individual race.
4. **Deleting a race:** "Yes, take the XP back." Deleting a whole race removes the viewing XP, rewatch XP, Story Complete bonus and expedition XP it earned (like deleting its stints one by one), then rebuilds totals. Achievements, milestones and other landmarks already reached stay.

Defaults announced to the owner (not objected to):
- The existing Milestones system (MilestoneProgress + config/milestones.ts) is upgraded into Career Milestones (exact dates, new rungs, own page) rather than duplicated. Nothing already earned is lost or re-paid.
- Event Legacy is built on the existing recurring-event mechanism (Race.iconicKey / RaceMastery / RACE_EVENT mastery trees). Any race can be linked to a recurring event (decoupled from "Major event"). Events can be renamed and merged without paying XP again (immutable key; display name separate).
- Milestones and Expedition Summaries are permanent once earned ("XP follows the data, landmarks stay earned"). Deleting stints changes statistics but a milestone keeps its date. Expedition checkpoint XP follows the data like the Story Complete bonus (revoked if the viewing that earned it is deleted; can only ever be held once).
- Hours for milestones and records count credited viewing time the same way XP does (very slow playback cannot inflate them).
- Years follow the computer's local clock. A completed year's Wrapped/chapter is frozen once the year is over so later edits do not rewrite it.
- New XP is career XP only (seasonAmount 0) — it never feeds the season pass.
- Navigation: Chronicle and Events get their own menu items; Statistics becomes Career Statistics with a Records tab; Expeditions live on each race's page (and completed ones appear in the Chronicle).
- Wrapped is a set of cards the user clicks through themselves, never auto-playing; a year-to-date preview is always available and clearly marked incomplete.

## The owner's brief (verbatim)

Version: v0.4.0

You are working on the existing EnduranceTracker repository. Your task is to implement a major feature update focused on long-term career history, statistics, event legacy, milestones, and immersive long-race progression.

Before changing any code, inspect the entire repository carefully. Understand the existing architecture, database schema, migrations, progression engines, XP ledger, race/session tracking, watched-interval model, Story Complete logic, mastery systems, achievements, collections, challenges, annual viewing budget, authentication/account isolation, Electron integration, tests, and UI conventions.

Do not replace working architecture simply because you would design it differently. Extend the existing systems cleanly. Reuse existing engines, database models, components, utilities, design tokens, navigation patterns, and progression infrastructure wherever appropriate.

The guiding philosophy remains:

"Watching endurance racing is the hobby. The progression system is here to celebrate it."

All new systems must reinforce the existing "complete race story" philosophy without making the application feel obligatory or punishing.

Implement all five systems below as a cohesive v0.4.0 update.

### 1. CAREER CHRONICLE AND YEAR IN REVIEW

Create a permanent Career Chronicle that records the user's endurance-racing history over time.

Add a dedicated Career Chronicle section accessible from the main application navigation.

The primary view should present the user's career chronologically by calendar year. Each year should behave as a permanent historical chapter rather than merely a filtered statistics page.

For each year calculate and display meaningful statistics including total real viewing time, unique race coverage, races started, races completed, Story Completes, championships watched, events watched, XP earned, career levels gained, achievements earned, milestones reached, mastery progress earned, longest race watched, longest individual viewing session, most active week, most active month, rewatch time, completion percentage, and other useful metrics that can be derived reliably from existing data.

Historical statistics must be derived from canonical viewing and progression history whenever possible. Do not introduce unnecessary duplicated mutable counters.

Create a rich yearly summary page with sections for:

Career summary.
Viewing statistics.
Championship breakdown.
Event breakdown.
Story Complete statistics.
Mastery progression.
Achievements and milestones.
Personal records set during that year.
Notable races.
Monthly activity.
Career progression.

At the end of each completed calendar year, provide a polished "Endurance Wrapped" presentation.

This should feel like a celebratory retrospective rather than an analytics report.

It may include statistics such as:

Total hours watched.
Number of races experienced.
Number of complete race stories.
Most-watched championship.
Most-watched recurring event.
Longest race.
Longest viewing session.
Favourite or most frequently watched circuit where the available data supports this.
Most active month.
Most active week.
XP earned.
Levels gained.
Mastery gained.
Achievements unlocked.
Milestones reached.
Interesting personal records.
Comparison with the previous year.

Do not fabricate statistics when the underlying metadata does not exist.

The Wrapped experience should consist of visually strong cards or slides inside the application and should remain accessible permanently after the year ends.

Users should also be able to generate a preview of the current year's Wrapped using year-to-date statistics, clearly identified as an incomplete year.

Design the Career Chronicle so that someone using EnduranceTracker for ten years can meaningfully browse their entire history from Career Year 1 onward.

### 2. EVENT LEGACY SYSTEM

Create persistent legacy profiles for recurring endurance races and major recurring events.

The application should intelligently associate individual race editions with their recurring event when sufficient metadata exists. The implementation must integrate with the application's existing race/event data model rather than relying on hardcoded famous races.

A recurring event should therefore be able to represent examples such as:

24 Hours of Le Mans.
24 Hours of Daytona.
24 Hours Nürburgring.
24 Hours of Spa.
12 Hours of Sebring.
Petit Le Mans.

However, users must also be able to create and manage their own recurring events.

Each Event Legacy page should provide a historical overview containing statistics such as:

First edition watched.
Most recent edition watched.
Number of editions watched.
Number of editions Story Completed.
Total real viewing time.
Total unique race coverage.
Rewatch time.
Consecutive editions followed.
Longest edition.
Highest completion percentage.
Associated championships where applicable.
Historical list of every edition represented in the user's career.

Each edition should open its corresponding race page.

Add event-specific lifetime progression.

Examples of Event Legacy milestones include:

First edition watched.
Three editions watched.
Five editions watched.
Ten editions watched.
25 editions watched.
Three consecutive editions.
Five consecutive editions.
Ten consecutive editions.
25 hours watched.
50 hours watched.
100 hours watched.
250 hours watched.
First Story Complete.
Five Story Complete editions.
Ten Story Complete editions.

These values should be configurable through the application's existing balance/configuration architecture rather than scattered as magic numbers throughout components.

Event Legacy must coexist cleanly with the existing mastery systems. Do not duplicate an existing recurring-event mastery mechanic if one already exists. Instead, inspect the current implementation and determine whether Event Legacy should extend, visualize, or consume that system.

The objective is for a page eventually to communicate something like:

"24 Hours of Le Mans — 9 editions experienced — 181h 42m watched — 8 complete race stories."

The exact wording and statistics should emerge from real stored data.

### 3. RACE EXPEDITIONS

Introduce Race Expeditions.

An Expedition is an immersive progression and presentation layer around particularly long races. It must not become another mandatory challenge or battle-pass system.

Determine Expedition eligibility using configurable race-duration thresholds. The default should make long endurance races feel significant while avoiding turning ordinary short races into expeditions.

Users should be able to manually enable or disable Expedition Mode for a race where appropriate.

When an Expedition begins, create an Expedition experience showing:

Race duration.
Unique coverage.
Real viewing time.
Remaining unwatched race time.
Current completion percentage.
Current resume position where applicable.
Number of viewing sessions.
Expedition start date.
Elapsed real-world time since starting.
Story Complete status.
Viewing budget implications using the existing annual/weekly budget system.
Relevant championship, event and mastery information.

Add Expedition checkpoints at configurable percentages such as 10%, 25%, 50%, 75%, 90%, and Story Complete.

These checkpoints should celebrate progress without granting disproportionately large rewards or encouraging inefficient viewing behavior.

Checkpoint rewards must respect the existing XP economy and XP ledger. Every one-time reward must be idempotent and protected by appropriate deduplication keys.

Do not create exploits involving rewatches, playback speed, repeatedly crossing a checkpoint, editing sessions, deleting and recreating sessions, or recomputation.

Create a visual Expedition Timeline showing watched and unwatched portions of the race using the existing watched-interval model.

The timeline should make fragmented coverage obvious. Reaching the end of the race must never falsely imply that the entire race was watched.

When an Expedition reaches Story Complete, generate a permanent Expedition Summary containing:

Race.
Total race duration.
Real viewing time.
Unique coverage.
Rewatch time.
Number of sessions.
Calendar duration from start to completion.
Average session length.
Longest session.
Final completion percentage.
XP earned from the expedition where this can be determined reliably.
Mastery progression associated with the race.
Milestones or achievements triggered.
Any personal records set.

Completed Expedition summaries should remain accessible through the race and Career Chronicle.

### 4. MOTORSPORT CAREER STATISTICS

Create a comprehensive Career Statistics area.

This should become the analytical heart of EnduranceTracker.

Provide lifetime statistics and allow filtering or comparison by calendar year, championship, recurring event, race, and other meaningful dimensions already represented by the data model.

Include statistics such as:

Lifetime real viewing time.
Lifetime unique race coverage.
Lifetime rewatch time.
Total races started.
Total races completed.
Total Story Completes.
Story Complete rate.
Average race completion percentage.
Average viewing session duration.
Longest viewing session.
Shortest meaningful viewing session.
Longest race experienced.
Total championships followed.
Total recurring events followed.
Viewing time by championship.
Viewing time by event.
Viewing time by year.
Viewing time by month.
Viewing time by weekday.
Viewing time by race duration category.
Story Completes by championship.
Story Completes by year.
Race completions over time.
XP earned over time.
Career levels gained over time.
Mastery progression.
Achievement progression.
Milestone progression.

Where useful, create polished charts and visualizations.

Do not create charts merely for decoration. Every visualization should communicate something interesting about the user's viewing career.

Add historical comparisons.

Users should be able to compare two calendar years, for example:

2027 vs 2028.

The comparison should show absolute values and meaningful differences for compatible statistics such as viewing hours, races, Story Completes, XP, session length, championship distribution and other relevant metrics.

Be careful with percentages when denominators are small.

Create a Personal Records section containing dynamically calculated career records.

Potential records include:

Longest viewing session.
Most viewing time in one day.
Most viewing time in seven consecutive days.
Most viewing time in one calendar month.
Most races completed in one month.
Most Story Completes in one year.
Longest race Story Completed.
Fastest real-world completion of a long race.
Longest gap between starting and completing a race.
Largest amount of unique race coverage in one day.
Longest consecutive-edition streak for a recurring event.

Only implement records that can be calculated reliably from canonical data.

Statistics must remain performant with many years of viewing history. Avoid repeatedly loading the entire database into React and performing expensive calculations client-side. Use appropriate server/database queries and reusable statistics services or engines.

### 5. CAREER MILESTONES AND RECORDS

Create a dedicated Career Milestone system separate from ordinary achievements.

Achievements may represent interesting accomplishments or challenges. Career Milestones should represent major permanent moments in the user's endurance-racing life.

Examples include:

First race started.
First race completed.
First Story Complete.
First 6-hour race completed.
First 12-hour race completed.
First 24-hour race completed.
10 Story Completes.
25 Story Completes.
50 Story Completes.
100 Story Completes.
100 career viewing hours.
250 career viewing hours.
500 career viewing hours.
1,000 career viewing hours.
2,500 career viewing hours.
5,000 career viewing hours.
10,000 career viewing hours.
100 races experienced.
250 races experienced.
500 races experienced.
1,000 races experienced.
336 hours watched during a calendar year.
Five editions of one recurring event.
Ten editions of one recurring event.
25 editions of one recurring event.

Treat these examples as starting points and integrate them sensibly with the existing progression philosophy.

Milestones must store or reconstruct the exact date/time at which they were first achieved whenever the underlying historical data permits this.

A milestone should therefore be capable of permanently showing:

"1,000 Career Hours — reached 14 June 2030."

Historical milestone backfilling is important.

When a user upgrades an existing EnduranceTracker database to v0.4.0, the application should evaluate existing history and award milestones that had already been achieved.

Where the exact historical crossing time can be calculated from viewing-session data, calculate it.

For time-based milestones, determine the actual point within the session at which the cumulative threshold was crossed rather than simply assigning the migration date.

Do not silently invent precision if historical data cannot support it.

Milestone awarding must be idempotent.

Deleting, editing or importing historical sessions must interact predictably with milestones. Decide explicitly whether milestones represent immutable historical accomplishments or recomputed current-state accomplishments and document that decision in code and user-facing behavior.

Prefer preserving legitimately achieved historical milestones while allowing the derived statistics that caused them to change if source data is corrected, unless this conflicts with established architecture.

### CROSS-SYSTEM INTEGRATION

These five features must feel like one system.

A completed Expedition should be able to appear in the Career Chronicle.

A race should contribute to Career Statistics.

A race associated with a recurring event should contribute to Event Legacy.

An Event Legacy milestone may appear in the Career Chronicle.

A personal record may appear in the Year in Review.

A Story Complete may simultaneously affect career statistics, mastery, event legacy, milestones, collections, achievements and the annual retrospective.

Implement these relationships through shared domain logic rather than duplicating calculations independently inside UI components.

Create reusable domain/statistics services where appropriate.

Preserve the principle that canonical viewing history is the source of truth and derived progression can be reconstructed.

### DATABASE AND MIGRATIONS

Inspect the existing Prisma schema and migration system before designing new tables.

Add only the persistent state that genuinely needs persistence.

Prefer derived statistics when they can be calculated efficiently and deterministically.

Persistent records are appropriate for things such as milestone unlock timestamps, Expedition state where necessary, recurring-event associations, manually configured event metadata, and historical snapshots where preserving the historical state is genuinely important.

All migrations must work against existing user databases.

Do not reset, replace, or destructively recreate databases.

Update backup/recovery and recomputation behavior where necessary.

db:recompute or its current equivalent must understand every new derived progression system introduced by this update.

### XP AND PROGRESSION INTEGRITY

Respect the existing XP ledger.

Do not directly mutate XP totals from UI components.

Every new XP source must have an explicit reason/source and deterministic deduplication behavior.

Race Expeditions and milestones must not create repeatable XP exploits.

Rewatching, changing playback speed, editing sessions, importing historical data, restarting the application, recomputing progression, and database migrations must not duplicate one-time rewards.

Add tests specifically attempting to exploit these systems.

### UI AND UX

Study the existing visual language before creating new components.

The new pages should feel native to EnduranceTracker rather than like five separate feature packs.

Prioritize information hierarchy, polished dashboard layouts, progressive disclosure and responsive behavior.

The application should make enormous amounts of historical information accessible without overwhelming the user.

Use strong empty states. A new account with two races should still see useful pages rather than enormous empty dashboards.

At the opposite extreme, ensure the UI remains usable for a hypothetical career containing ten years, thousands of races and thousands of viewing sessions.

Use celebratory animation sparingly for meaningful moments such as major milestones and Story Complete Expedition completion. Respect reduced-motion preferences.

Do not introduce gamification that pressures users to watch races purely to preserve streaks or avoid losing progression.

### PERFORMANCE

Assume long-term users may eventually accumulate:

10+ years of history.
Thousands of races.
Tens of thousands of viewing sessions.
Large XP ledgers.
Hundreds of achievements and milestones.
Many championships and recurring events.

Design database queries and indexes accordingly.

Avoid N+1 query patterns.

Avoid recalculating expensive lifetime statistics unnecessarily.

Introduce caching only where appropriate and ensure cached/derived values can be invalidated or rebuilt safely.

### TESTING

Expand the existing Vitest and integration test suite substantially.

At minimum, add tests covering:

Career-year boundaries.
Leap years.
Timezone-sensitive session attribution.
Year-in-review calculations.
Recurring-event edition association.
Event Legacy streaks.
Missing editions.
Expedition eligibility.
Expedition checkpoint crossing.
Checkpoint idempotency.
Fragmented watched intervals.
Rewatch behavior.
Playback-speed behavior.
Story Complete Expeditions.
Milestone threshold crossing.
Historical milestone backfilling.
Exact time-based milestone timestamps.
Milestone idempotency.
Edited sessions.
Deleted sessions.
Imported historical sessions.
Career statistics.
Year-to-year comparisons.
Personal records.
Account isolation.
Database migration from the current production schema.
Recomputation.
XP exploit prevention.

Use real-database integration tests for behavior where mocking would hide important transactional or migration issues.

### DOCUMENTATION

Update the README and relevant internal documentation.

Document:

Career Chronicle.
Endurance Wrapped.
Event Legacy.
Race Expeditions.
Career Statistics.
Career Milestones.
How historical backfilling works.
How recurring events are associated.
How Expedition XP works.
How milestones differ from achievements.
Which values are derived versus persisted.
Any new balance/configuration constants.
Migration behavior.
Recomputation behavior.

Update the application version to v0.4.0 everywhere it is represented.

### IMPLEMENTATION PROCESS

Do not attempt to implement this update as five isolated giant components.

First inspect the repository and map the existing domain architecture.

Then determine which existing systems can be extended.

Design the database changes and domain interfaces.

Implement the shared backend/domain foundation first.

Then implement each feature incrementally.

Reuse the existing watched-interval logic rather than creating alternative completion calculations.

Reuse the existing XP ledger rather than creating separate reward counters.

Reuse existing mastery and achievement infrastructure where sensible while keeping Career Milestones conceptually distinct.

Keep TypeScript strict.

Do not suppress type errors with broad any usage.

Do not leave placeholder implementations, fake statistics, TODO-only buttons, non-functional navigation, or mocked production data.

Do not delete existing functionality to simplify implementation.

Run the complete test suite, type checking, linting and production build after implementation.

Fix failures rather than bypassing checks.

Where Electron packaging tests exist, ensure the update does not break them.

### DEFINITION OF DONE

v0.4.0 is complete when an existing EnduranceTracker user can upgrade without losing data, open the application, inspect their complete historical Career Chronicle, browse persistent recurring-event legacies, turn a long endurance race into an Expedition, explore comprehensive career statistics and personal records, receive historically correct Career Milestones, and see all five systems interact coherently with the existing XP, mastery, achievements, Story Complete, watched-interval and viewing-budget systems.

The result should make EnduranceTracker feel less like an application that records races and more like a permanent record of an endurance-racing career.

A user opening the application in 2035 should be able to look back at 2026 and understand how their endurance-racing journey began.
