# HANDOFF — WP1 (Foundation: fixture, schema, migration, config, pure domain)

Branch `release/v0.4.0`, committed as `d617807` and pushed to `origin/release/v0.4.0`. The app behaves exactly as 0.3.2: no engine,
action, UI or instrumentation file was touched except `stats-engine.ts` (import + re-export only).

## What was built

**Schema and migration**
- `prisma/schema.prisma` — replaced with `work/schema.v040.prisma` (byte-identical copy).
- `prisma/migrations/20260924120000_career_history/migration.sql` — byte-identical to `work/migration.sql`.
  Verified: `prisma migrate diff --from-schema <4c59efc schema> --to-schema prisma/schema.prisma --script` prints the same file (`diff` empty).
- The test DB (`endurance-test.db`) was migrated by `tests/setup.ts` automatically (all 4 migrations recorded).

**Fixture**
- `tests/fixtures/career-0.3.2.db` (see deviation 1), `tests/fixtures/README.md` (command, commit `4c59efc`, generated 2026-09-24 16:41:05 UTC).
- `.gitignore`: `!tests/fixtures/*.db` (with a comment). `git status` now shows `tests/fixtures/` as untracked (db + README).

**Config**
- `src/lib/config/economy.ts`: `EXPEDITION_CONFIG`, `EXPEDITION_SHAPE`, `CAREER_STATS_SHAPE`, `DURATION_CLASSES`, `CHRONICLE_SHAPE`,
  `TIMELINE_SHAPE`, `EVENT_SHAPE` (end of file, commented per number); `MASTERY_SHAPE` gains `stories6hMinHours 5.5`,
  `stories8hMinHours 7.5`, `stories10hMinHours 9.5`. **Not** the event nodes / node renames (WP4).
- `src/lib/config/career-milestones.ts` (new): the §4.1.2 catalogue + helpers.
- `src/lib/config/index.ts`: `export * from './career-milestones'`; `DEFAULT_CONFIG` gains `expedition`, `expeditionShape`,
  `careerStatsShape`, `durationClasses`, `chronicleShape`, `timelineShape`, `eventShape`.

**Domain (pure, new)**: `src/lib/domain/{calendar,career-timeline,edition,event-association,landmarks,records,window-summary,expedition}.ts`.
**Domain (modified)**: `types.ts` (`'EXPEDITION'` in `XPSource`, `MilestonePrecision`), `time.ts` (`formatCoveragePercent`).
**Engine (modified, import only)**: `stats-engine.ts` imports `localDayKey`/`yearWindow` from `calendar.ts`, deletes its own copies,
`export { yearWindow }`. `DateWindow` interface kept (structurally = `LocalWindow`).

**Tests**
- New: `tests/domain/{calendar,career-timeline,edition,event-association,landmarks,records,window-summary,expedition}.test.ts`,
  `tests/desktop/migrate-040.test.ts`, `tests/integration/upgrade-from-0.3.2.test.ts` (migration part), `tests/perf/career-scale.test.ts` (pure part, `PERF=1`).
- New helpers: `tests/helpers/timeline-fixture.ts`, `tests/helpers/fixture-db.ts`, plus `tests/helpers/time-zone.ts` and
  `tests/helpers/synthetic-career.ts` (see "facts").
- Modified: `tests/domain/config.test.ts` (subsystem/shape lists, `imported` map, catalogue + enum-mirror + checkpoint + duration tests),
  `tests/domain/economy-balance.test.ts` (§7.3 model + 4 new assertions), `tests/domain/time-playback.test.ts` (`formatCoveragePercent`),
  `tests/desktop/migrate.test.ts` (28 → 31, comment naming the three tables).

## Deviations (smallest sound change, with reasons)

1. **Fixture not regenerated.** `tests/fixtures/career-0.3.2.db` already existed (untracked, ignored), written at 2026-09-24 16:41:05 UTC.
   I verified it is exactly the 0.3.2 demo seed: only the three 0.3.2 migrations applied (by the Prisma CLI, 16:41:01Z), one account
   `00000000-0000-4000-8000-000000000001` "Demo Driver", 11 `[demo]` races, 28 stints (2025-07-23 → 2026-09-23), 99 ledger rows,
   37 milestone rows, 72 mastery progress, 13 HoF, `config_overrides` empty. My attempt to move it aside and regenerate was refused
   by the permission classifier as a destructive action, so I kept it and documented it (README + `FIXTURE_GENERATED_AT`).
   If the owner wants it regenerated: move the file away, then run the two commands in `tests/fixtures/README.md` on a 0.3.2 checkout.
2. **`DURATION_CLASSES` `h13to20.maxHours` is 21, not 20.** With the spec's "first band whose `maxHours` is above the runtime", a 20-hour
   race would be labelled "24 hours". 21 follows the pattern of every other band (top = named length + 1 h; +0.5 h for "Up to 3").
   Comment in `economy.ts` says so; `window-summary.test.ts` asserts `durationClassOf(20h)` is "13 to 20 hours".
3. **`CompareGroupRow`** (`Omit<CompareRow,'key'> & { id: string | null }`) for `compareSummaries(...).championships/events`: `CompareRow.key`
   is the `CompareRowKey` union, which cannot name a championship.
4. **Per-session compare rows** (`averageSession`, `longestSession`): whether a percentage is shown is judged on the base year having
   ≥ `percentChangeMinimumBase.count` sessions, not on the 10-hour base (no single session reaches 10 h, and the note "too little" would be false).
5. **`expeditionFigures(history, avgSpeed, now, held = new Set())`**: optional 4th arg; the pure replay cannot know which checkpoints the ledger holds.
6. **Records**: every record needs a value > 0; `longest-edition-streak` needs a run of ≥ 2 editions (one edition is not a run).
   `most-in-seven-days.detail` always names the full rolling window ("31 March 2026 to 6 April 2026").
7. **`isRaceExperienced`** returns false for `runtimeSec ≤ 0` (guard; such a race has no coverage anyway).
8. **`recognitionThresholdSeconds`**: count metrics return the threshold unchanged (it is a count); hour metrics as specified.
9. **Test helpers named `inTimeZone` / `pointPrismaAtFixture`**, not `use…`: eslint's react-hooks rule flags any `use*` call in tests.
10. **Economy model**: `eventLegacyNew` finds the 9 new nodes by key (`NEW_EVENT_NODE_KEYS`) and is 0 until WP4 appends them (as the spec says).

## Facts later WPs must know

**Signatures (as built)**
- `calendar.ts`: `LocalWindow {start,end}` (half-open); `localDayKey`, `localMonthKey`, `dayKeyToLocalDate`, `yearWindow`, `monthWindow(y, m1to12)`,
  `isLeapYear`, `daysInYear`, `weekKeyForDay(dayKey, weekStartsOn, memo?)` (memo belongs to ONE week start),
  `weekLabel(weekKey, weekStartsOn, clipTo?) → {label, start, end /*exclusive*/, clipped}` (e.g. "Mon 28 – Thu 31 Dec"),
  `splitAcrossLocalDays(start, end) → TimeSlice[]` (fractions sum to exactly 1; zero-length → day of `end`),
  `clipToWindow(start, end, window) → {startsAt, endsAt, fraction} | null`, `samePeriodEnd(targetYear, reference)`, `localTimeZoneName()`.
- `career-timeline.ts`: exactly the §3.2.2 API. `DEFAULT_TIMELINE_OPTIONS` from config. `replayRace(race, sessions)` filters sessions to
  that race and sorts them itself; its window/career fields are race-local. `buildCareerTimeline(sessions, races)` overwrites `ordinal`,
  `startsAt`, `windowReliable`, `cumulative*` career-wide and sets `RaceHistory.startedAt`. `rewatchCreditedSeconds` is an unrounded float.
  `RaceHistory.longestStintSeconds` is credited seconds. `coverageAt(history, at)` = coverage after last stint with `watchedAt ≤ at`.
- `edition.ts`: §3.2.3 API plus `editionIdentityOf(raceId, year)` (used with `TimelineRaceRow.editionYear`).
  `metrics.ts longestRun` still has its own body — delegating it to `longestConsecutiveRun` is an engine change (WP2).
- `event-association.ts`: `suggestEventLinks(races, events, dismissed)`. Merges are grouped transitively (key↔key, name↔name, key↔name
  normalised) and each loser is suggested into the survivor (most members, then earliest `createdAt`, then lowest key). A dismissed
  link lets the next-strongest candidate through; a race with no undismissed link can join a create group.
- `landmarks.ts`: §3.2.5 API plus `creditedSecondsByLocalYearOfSessions(sessions, xpMinSpeed?)` — the raw-session helper for
  `syncCareerMilestones` (whole seconds, same R6 windows, no interval replay; equals `creditedSecondsByLocalYear(timeline)`).
  `milestoneInstant` sets `subjectName` = race name, except `eventEditions` → `eventId` + `subjectName` = event name.
  **Events are grouped by `TimelineRaceRow.eventKey`** (landmarks, `editionsExperiencedByEvent`, records, window summary `byEvent`).
  WP2's loader must fill `eventKey/eventId/eventName` from `raceMastery` (and decide the `iconicKey` fallback so it matches
  metrics' `raceMasteryId ?? iconicKey` keying).
- `window-summary.ts`: §3.2.6 API. Percentages (`completionPercent`, `averageRaceCompletionPercent`, `storyCompleteRate`) are 0–100,
  unrounded. `coverageAt` is read at `window.end − 1 ms`. Group rows: `byChampionship` has a `{id:null, name:'Without a championship'}` row;
  `byEvent`/`byCircuit` omit races without one; `byDurationClass` is in `DURATION_CLASSES` order. Compare notes (exact text):
  `"Too little in {a.year} for a percentage to mean much"`, `"A rate needs at least 5 races started in each year"`,
  partial note `"Your {year} chapter began on 22 September"` (en-GB day month).
- `records.ts`: §3.2.7 API; labels: "Longest session", "Most in a day", "Most in seven days", "Most in a month",
  "Most Story Completes in a month", "Most Story Completes in a year", "Longest race completed", "Fastest long race, start to finish",
  "Longest start to finish", "Most new race coverage in a day", "Longest run of complete editions". `within` restricts stints by
  `watchedAt` AND clips their time to the window. `RecordOptions.weekStartsOn` is accepted but unused (no weekly record).
- `expedition.ts`: `isExpedition`, `checkpointsPayXp`, `checkpointSchedule`, `checkpointsSatisfied`, `expeditionDedupeKey`,
  `ExpeditionFigures`, `expeditionFigures(history, avgSpeed, now, held?)`. **Summary schema/builder (`EXPEDITION_SUMMARY_SCHEMA_VERSION`,
  `expeditionSummarySnapshotSchema`, `buildExpeditionSummarySnapshot`) are NOT written — WP5.**
- `time.ts`: `formatCoveragePercent(cov, rt)` floors to one decimal and drops a trailing ".0" ("25%", "62.4%", "99.9%", "100%" only when full).
- `career-milestones.ts`: `CAREER_MILESTONES`, `CAREER_MILESTONES_BY_ID`, `careerMilestoneThreshold`, `careerMilestoneMetricKey(def, year?)`
  (**throws** for `year-plan` without a year), `careerMilestoneDedupeKey(def, year?)`, `isMajorMilestone`, plus
  `careerMilestoneTitle(def, year?)` — the year rung's title is stored as `"{annualHours} hours in {year} — two full weeks of racing"`
  with `{year}` filled by this helper ("in a calendar year" without one); the "two full weeks" phrase is computed from
  `BUDGET_CONFIG.annualHours`. Ladder rows carry `xp: 0` (their ladder pays). `alsoPaidBy` strings are user copy ("The Green Flag achievement", …).

**Still to do in later WPs (not stubbed here)**
- `metrics.ts` still hard-codes 7.5/9.5/11.5/23 and has no `stories6h`/`racesExperienced`/`maxEditionsExperiencedOfOneEvent` (WP2).
- Achievement `expedition` rename and strategist "long race" copy (WP5 per §10).
- No tone functions added, so `periods-tone.test.ts` is unchanged.

**Test helpers**
- `timeline-fixture.ts`: `race(id, {hours?, ...TimelineRaceRow})` (editionYear derived from raceDate/seasonYear unless given),
  `stint(raceOrId, 'YYYY-MM-DDTHH:MM[:SS]' | Date, {from, to, speed?, id?, createdAt?, realSeconds?})` — times are LOCAL, positions
  `H:MM` or `H:MM:SS` (seconds may exceed 59, e.g. `0:00:14256`); ids `s1, s2…` (`resetStintIds()`); `career(races, sessions)`; `localTime`, `position`.
- `time-zone.ts`: `inTimeZone(zone, offsets)` inside a `describe` (or file top level) + `ZONES.{london,auckland,losAngeles}`; it asserts the
  January/July offsets in `beforeAll`. **Build dates inside `it`, never at describe-collection time** (collection runs before the zone switch).
- `fixture-db.ts`: `copyFixtureDatabase()`, `pointPrismaAtFixture()` (copy + `DATABASE_URL=file:<abs>`; throws if a Prisma client already
  exists — call in `beforeAll` before any query), `FIXTURE_GENERATED_AT = 2026-09-24T16:41:05Z`, `FIXTURE_USER_ID`.
- `synthetic-career.ts`: `syntheticCareer(raceCount=5000, stintsPerRace=12) → {races: TimelineRaceRow[], sessions: TimelineSessionRow[]}`,
  seeded, 60,000 stints over 2017–2026, 12 championships, 40 events (every 3rd race), 60 circuits. WP2's DB perf part can insert it with `createMany`.

**Measured (this container, `tsx`)**: `buildCareerTimeline` real (3,000 stints) 26 ms cold / 11 ms warm; large (60,000) 108–145 ms;
lifetime `summariseWindow` 158–171 ms; one-year summary 59–85 ms; `computeRecordProgression` 97–110 ms.

**Economy model shares now** (eventLegacyNew = 0 until WP4): 20 h 0.4379, 58 h 0.5000, 150 h 0.5236, 336 h 0.5044, 672 h 0.5016,
1,680 h 0.5518, 3,360 h 0.5970; long-race profile 0.4301 … 0.5879; new milestone share max 0.0139 (20 h); windfall 0.275; level(3,360) = 131.

## Check results (final run, after the last edit)

- `npm run db:generate` — ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen` — ✓ Types generated successfully.
- `npx tsc --noEmit` — 0 errors.
- `npx eslint` — 0 problems.
- `npx vitest run` — 48 files passed, 1 skipped (perf); **870 tests passed**, 4 skipped (after the review fixes below).
- `npx vitest run tests/domain tests/desktop tests/integration/upgrade-from-0.3.2.test.ts` — 27 files, 514 tests passed.
- `PERF=1 npx vitest run tests/perf` — 4/4 passed (real < 50 ms, large < 1.5 s, summary/records inside the warm Statistics budget).
- `npm run desktop:build` — exit 0.

## Review fixes

The independent review reported four minor issues and no spec gaps. All four were checked against the code, were valid, and are fixed.

1. **The period-end rules in `summariseWindow` had no tests.** Added `a race is experienced and covered only as far as it was by the end of the window`
   to `tests/domain/window-summary.test.ts`. It uses one 6-hour race: 5 minutes on 20 December 2026, then the rest on 9 January 2027.
   - 2026: racesStarted 1, racesExperienced 0, longestRace null, completionPercent and averageRaceCompletionPercent both = 100 × 300 / 21,600.
   - 2027: racesExperienced 1, longestRace is the race, both percentages 100.
   - Lifetime: racesExperienced 1, completion 100.
2. **Deviation 4 (per-session compare rows) had no tests.**
   - Added `a session row judges its base on the number of sessions, not on the length of one`. With `twoYears(5, 6)`, averageSession and
     longestSession both have a = b = 6 h, difference 0, percentChange 0 and note null.
   - `no percentage change on a small base` now also checks both rows (1 session in 2026 → no percentage, "Too little in 2026…").
3. **`CAREER_STATS_SHAPE` comment claimed 10 credited minutes is "at least 300 viewing XP".** That is false: re-watch pays ×0.25
   (`rewatchXpMultiplier`). The comment now says "up to 300 viewing XP, less where it was a re-watch". SPEC §6 row 18 makes the same
   "≥ 300 viewing XP" claim. The code's behaviour is unchanged. The claim is only an argument there, and its conclusion still holds:
   ten credited minutes of real viewing are needed.
4. **`MASTERY_SHAPE` header said "Every band allows the same half hour".** The 24-hour band allows a full hour (`stories24hMinHours: 23`).
   The sentence now reads "Every band allows half an hour, and the 24-hour band a full hour."

**Mutation check.** Each change below was applied to `window-summary.ts` alone, and in each case exactly one test failed. The source was
then restored byte-for-byte.
- `beforeEnd(history.experiencedAt)` → `true`
- `coverageAtEnd(history)` → `history.coverageSeconds`
- The `PER_SESSION_ROWS` check deleted
- The `PER_SESSION_ROWS` check made always true

**Checks after the fixes**
- `npm run db:generate` ✔
- `next typegen` ✓
- `tsc --noEmit`: 0 errors
- `eslint`: 0 problems
- `vitest run`: 870 passed, 4 skipped
- Targeted tests: 514 passed
- `PERF=1` perf tests: 4/4 passed
