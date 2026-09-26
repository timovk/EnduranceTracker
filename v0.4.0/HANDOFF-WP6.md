# HANDOFF — WP6 (Career Statistics)

Branch `release/v0.4.0`, working tree only (not committed, per instructions), on top of WP5's `688f1b7`.
No schema, migration or `prisma/` change. Built against SPEC §1, §3.1, §3.2.6–3.2.7, §3.3, §4.4 (all), §4.7.1–4.7.4,
§8.2 (Career statistics, Year-to-year comparisons, Personal records rows) and §10 WP6.

## What was built (files)

**New**
- `src/components/charts/`
  - `chart-theme.ts`: `CHART_COLORS` (accent, azure, verde, grid `#222c37`, axis `#64717e`, cursor), `AXIS_PROPS`,
    `hasEnoughPoints(points)`. Its header states the motion rule (never `isAnimationActive={true}`) and the decoration rule.
  - `chart-tooltip.tsx`: `ChartTooltip`, moved out of `statistics-view.tsx`. It gained `format?` and shows a row's `note`.
  - `chart-frame.tsx` (extra file): `ChartFrame({ points, sentence, height, children })`. It draws the sentence
    instead of the chart below `CAREER_STATS_SHAPE.chartMinimumPoints`.
  - `monthly-bars.tsx`: `PeriodBars<T>` (months or years; one or more series) and the `BarSeries<T>` type.
  - `weekday-bars.tsx`: `WeekdayBars`. `cumulative-line.tsx`: `CumulativeLine<T>` (`step` for a step line).
  - `share-bars.tsx`: `ShareBars` (horizontal). `compare-bars.tsx`: `CompareBars` (A against B, 12 months).
- `src/components/stats/records-tab.tsx` (`RecordsTab`) and `compare-tab.tsx` (`CompareTab`).
- `src/app/stats/loading.tsx`: `Skeleton` panels.
- `tests/integration/stats-engine.test.ts`: 17 tests, including every §8.2 name plus coverage at the year's end,
  re-watch, landmarks, records and the comparison defaults.

**Modified**
- `src/lib/engines/stats-engine.ts`:
  - `loadScope` is rewritten on the replay (§4.4.3), through `loadFilterContext`, `raceTotalsInWindow` and `bucketsFromSummary`.
  - `StatsFilter` gains `eventKey`, `raceId` and `length`. `buildRaceScopeWhere` maps them.
  - New `StatisticsView` fields, `getFilterOptions(userId, filter)` with events, races and lengths, `getRecords` and `getYearComparison`.
  - Deleted: `loadActivityBuckets`, the session `groupBy`/`aggregate`, `buildRacesInScopeWhere`, `buildSessionScopeWhere`,
    the `longestSessionRow` query, `storyCompletionsByPeriod`, `loadActiveYears` and `CompletionStats.library`.
- `src/app/stats/page.tsx`: reads `tab`, `event`, `race`, `length` (validated against `DURATION_CLASSES`), `a`, `b` and `same`.
  Its title is "Career Statistics". Records and Compare are computed only for their tab.
- `src/components/dashboard/statistics-view.tsx`:
  - Core tabs switch through `window.history.replaceState` and make no server request (verified; see checks).
  - Records, Compare and filter changes run `router.replace` inside `useTransition`, and the tab body shows a skeleton while pending.
  - The filter bar gains Event, a conditional Race select and length bands. `hasFilter` ignores `tab`, `a`, `b` and `same`.
  - New cards and charts, with a sentence when there are too few points. Tables show 10 rows, then "Show all".
  - The Real viewing time sub-label is changed as specified.
- `src/components/layout/nav.tsx`: "Career Statistics" sits directly after Career.
- `src/lib/copy/tone.ts`: `differencePhrase(difference, unit)`.
- `src/lib/domain/window-summary.ts`: `durationClassRange(key)`. `src/lib/domain/records.ts`: `recordLabel(kind, rollingDays?)` is exported
  (it was the private `labelFor`).
- Tests:
  - `periods-tone.test.ts`: `differencePhrase` is registered in `everyUserFacingString()`, plus one test.
  - `window-summary.test.ts`: `durationClassRange` agrees with `durationClassOf`.
  - `records.test.ts`: `recordLabel`.
  - `tests/perf/career-scale.test.ts`: `/stats` core tabs (cold and warm, plus year + championship), Records and Compare.

## Deviations (smallest sound change, with reasons)

1. **The event filter matches `Race.iconicKey`, not `raceMastery: { key }`** (§4.4.2). The replay groups by `iconicKey`
   (WP2 deviation 4), and so do the event options and the `byEvent` rows. Matching the same key means a filter always
   chooses the races its row counts. Merges move `iconicKey` and the link together (WP4), so the two differ only
   during a recompute.
2. **Under a year filter a race is in scope if it has a stint *or credited time* in the window.** A stint logged at
   00:30 on 1 January gives most of its time to the old year, so the groups' hours still add up to the total.
   (The §4.4.3 "or completed in the window" case is already covered: a completion is a stint.)
3. **Under a year filter, `uniqueCoverageSeconds` and `averageCoveragePercent` use each race's coverage when the year ended**
   (`coverageAt(end − 1 ms)`), matching the summary's completion figures. Without a year they are as they stand now.
4. **`rewatchRealSeconds` is measured by the replay.** It used to be apportioned. `rewatchShare` is now re-watch ÷ credited.
   Average speed uses Σtimeline ÷ Σ(timeline ÷ speed), so it still describes real playback.
5. **XP, levels and landmarks are career-wide whatever the race filters.** The ledger has no race dimension for most sources.
   `careerWideNote` (`CAREER_WIDE_XP_NOTE`) says so on the Year-by-year table, XP by month, Landmarks and Compare.
   These figures do follow a year filter.
6. **The empty Compare copy reads "…Your first year ends on 31 December {firstYear}."**, not "first full year". For a
   career that began on 22 September, "first full year" would be false.
7. **`getYearComparison(userId, a?, b?, …)`**: `a` and `b` are optional. The page cannot know the career's years, so the
   engine validates them and falls back to the previous year and the current one (the latest year of the career).
8. **The "back to career records" link is a button that calls `router.replace` inside the transition**, so it shows
   the same pending state.
9. **`StatsFilterOptions.durations` and `StatsDurationOption` are removed; `lengths` replaces them.** The legacy `type`
   parameter is still honoured and still named in the scope label (§4.4.2).
10. **The Mastery completion figure leaves out merged-away event trees**, as `/mastery` and `masteryTreesCompleted`
    already do. Otherwise a merged event's steps are counted twice. Landmarks over time applies the same rule.
11. **The tab re-syncs on every new server render** (state compared by the `stats` object). Without this, the nav link
    back to `/stats` while on Records left the Records tab waiting for data that would never come.
12. Extras:
    - `narrowsRaces(filter)`;
    - `getMonthlyBreakdown(…, now)`;
    - `getActivityCalendar` now on the replay;
    - a per-replay `WeakMap` memo of the lifetime summary (the page and its options share one fold);
    - `RECORDS_LOGGED_TIME_NOTE`.

## Facts later WPs must know

- **Entry points:**
  - `getStatistics(userId, filter, now)`;
  - `getFilterOptions(userId, filter)`;
  - `getRecords(userId, filter) → RecordsView`, with `records: RecordCard[]` (current record + `history`, newest first),
    `stillToBeSet`, `withinYear`, `loggedTimeNote`;
  - `getYearComparison(userId, a?, b?, { samePeriod?, filter? }, now) → YearComparisonView`, with `rows`, `championships`,
    `events`, `months`, `partialNote`, `stretchLabel`, `emptyNote`. It re-exports the types `CompareRow` and `CompareGroupRow`.
- **WP7:**
  - `getStatistics(userId, { year })` uses the same `summariseWindow(yearWindow(year))` a chapter does. The test "statistics
    filtered to a year equal that year's chapter" can compare `viewing.realSeconds`, `newCoverageSeconds`, `races.racesStarted`,
    `racesExperienced` and `storyCompleteRate`. Links `/stats?year=Y` and `/stats?championship=<id>&year=Y` work.
  - Reuse `components/charts/*` (`PeriodBars`, `CumulativeLine`, `CompareBars`, `ChartFrame`) and `differencePhrase` (Wrapped card 14).
  - Nav: insert Chronicle between Career and Career Statistics.
- `StatsTab` and `ParamChanges` are types exported from `statistics-view.tsx`.
- Chart rule: never pass `isAnimationActive`. Import from `components/charts`.
- Months on the XP ledger use its real-clock `createdAt`. Seeded backdated stints therefore show 0 XP in 2025 on the fixture.
  This is true and the page says "dated by when the XP was awarded".

## Check results (final run, 2026-09-26)

- `npm run db:generate` ✔, `next typegen` ✓, `npx tsc --noEmit` 0 errors, `npx eslint` 0 problems.
- `npx vitest run`: 60 files passed, 1 skipped (perf); **1,145 passed**, 25 skipped.
- Targeted: `npx vitest run tests/integration/stats-engine.test.ts tests/domain/window-summary.test.ts tests/domain/records.test.ts
  tests/domain/periods-tone.test.ts`: 4 files, **95 passed**.
- `PERF=1 npx vitest run tests/perf`: **25/25 passed**.

  | Path | Real | Large cold / warm |
  |---|---|---|
  | `/stats` core tabs | 131 / 57 ms | 1,195 / 439 ms (year + championship: 267 ms) |
  | Records | 131 ms | 1,228 / 516 ms |
  | Compare | 128 ms | 1,247 / 528 ms |

- `npm run build`: exit 0.
- Manual check. Setup: `next dev` on a migrated scratch copy of the 0.3.2 fixture, driven by headless Electron
  (`scratchpad/v040/wp6/e/*.js`, screenshots in `wp6/shots/`). Results:
  - Every tab renders, with and without filters (year, event, length, compare `same=0`, an unknown championship,
    a missing race id).
  - Switching between the four core tabs made **0** requests to the server. Records, Compare and a filter change made 1 each.
  - An account with no history shows every empty state, with no errors.
- Mutation checks: 8 mutations in `stats-engine.ts` (event filter, band lower bound, year scope, same stretch, level
  boundary, weekday rotation, coverage at year end, records filter). Every one is caught (coverage at year end only after its test was added) by `stats-engine.test.ts`. The file
  was restored and its md5 verified.

## Review fixes (2026-09-26)

Every issue and the spec gap from the independent review was checked against the code and found valid. All are fixed;
none was rejected.

1. **Chart series clashed with the accent (major).**
   - `globals.css` gains `--chart-2` (azure) and `--chart-3` (verde) on `:root`. Midnight sets `--chart-2` to gold. Sarthe and
     Nordschleife set `--chart-3` to violet (Nordschleife's olive `#7f9f4f` is close to verde).
   - `CHART_COLORS.secondary`/`tertiary` are now `var(--chart-2)`/`var(--chart-3)`.
   - New `tests/domain/chart-theme.test.ts` resolves the three series through `globals.css` for every `THEMES` entry.
     It asserts that they are pairwise different and that the first is the theme's accent. It fails on the old
     colours (`midnight: #4f8fd0, #4f8fd0, #3fa06b`).
2. **Compare's XP and levels had no test (major, and the §8.2 spec gap).**
   - New helpers in `stats-engine.test.ts`:
     - `watchAwarding` logs a stint and returns its ledger rows;
     - `dateAwards` dates each stint's rows to its instant, rebuilds the totals and checks I2;
     - `xpOf`.
     "XP and levels by year" now uses them too.
   - The same-stretch test now asserts the `xp` and `levelsGained` rows:
     - same stretch, both directions: the September 2026 awards are left out;
     - `samePeriod: false`: they are counted;
     - two past years: whole years.
3. **Figures and deviations that no test pinned (minor).** Six new tests (24 in the file now):
   - a stint logged at 00:30 on 1 January: race in scope in both years, 30 min each, the session in the new year,
     plus `options.races` under `{ year }`;
   - championships followed, `storyCompletesByChampionship` without zero rows, and `majorEventsStoryComplete` in the window;
   - a quiet year kept as an empty slot;
   - year landmarks, which covers two cases: a milestone whose `achievedAt` was moved to January counts in January,
     and a year with no landmark gives `[]`;
   - a merged event counted once, which checks `completion.mastery` total/done, `masteryTreesTotal` and the landmarks' mastery line;
   - the edition-streak record links `eventHref(key)`.
   - Mutation run in a scratch copy (`scratchpad/v040/wp6-fix/mutate.py`): the reviewer's 11 mutations plus 4 new ones.
     The new ones are: the same year allowed; the year gaps closed up; the status guard using `in`; and levels over
     the whole year instead of the window. All **15/15** are caught. The repo file was never mutated; the md5 of the
     restored copy matches.
   - Reviewer mutation (1) (landmarks ignore the year) only changes a year with no landmarks, because the month walk
     already stays inside the year. The new `[]` assertion covers that case: before, it drew 12 flat points instead
     of the sentence.
4. **A year compared with itself.**
   - `getYearComparison`: a base equal to `b` falls back to the year before `b` (the newest other year when `b` is the
     first). Tested.
   - `CompareTab`: picking the other side's year swaps the two sides.
5. **Story Completes by year closed up gaps.** `buildStoryCompletesByYear` fills every year from the first to the last
   with 0 for quiet years. The field's doc says so. Tested.
6. **Story Completes by championship had no "Show all".** It now uses `useTopRows` and renders `more`.
7. **A core tab picked while a navigation was pending was lost.** Changes in `StatisticsView`:
   - `requested` (a ref) holds the query of the navigation under way, and `queryWith` builds on it, so a second
     change never drops the first;
   - while `pending`, `selectTab` routes even a core tab through `navigate`, so the address it lands on and the server's
     `initialTab` are the tab that was clicked;
   - `refiltering` is set when a navigation changes a non-view parameter. The skeleton covers a core tab only then;
     Records and Compare still wait whenever the server is working.
   - Checked in headless Electron against `next dev` on a scratch copy (`wp6-fix/e/tabs.js`):
     - Records then Cadence at once lands on `?tab=cadence` with no skeleton meanwhile (2 requests);
     - core tabs switch with 0 requests;
     - Year then Career at once lands on `?year=2025&tab=career`;
     - on Compare, setting the first year to the second's gives `?a=2026&b=2025`.
8. **An unknown `status` or `type` crashed /stats.**
   - `isRaceStatus` and `isRaceType` are exported from `stats-engine.ts`. `isRaceStatus` uses `Object.hasOwn`, so
     `constructor` is not a status.
   - `page.tsx` keeps a value only when the guard accepts it. The guards are tested.

**For later WPs.**
- Chart colours come from `CHART_COLORS` only; the second and third series are theme variables.
- `storyCompletesByYear` is contiguous.
- `isRaceStatus`/`isRaceType` exist for any page that parses these from an address.

**Housekeeping note.** A `git stash push` of an untracked file failed during this pass, and the `git stash pop` after it
applied the pre-existing `stash@{0}` ("v0.4.0 WP1 partial (stopped by owner)"). That caused conflicts in
`src/lib/config/economy.ts`, `src/lib/config/index.ts` and `tests/desktop/migrate.test.ts`. None of the three had
WP6 changes, so all three were restored from HEAD. `prisma/` and the config are byte-identical to HEAD. The stash
entry is still there, unchanged.

**Checks (final run).**
- `npm run db:generate` ✔, `next typegen` ✓, `npx tsc --noEmit` 0 errors, `npx eslint` 0 problems.
- `npx vitest run`: 61 files passed, 1 skipped; **1,154 passed**, 25 skipped.
- Targeted: `stats-engine`, `window-summary`, `records`, `periods-tone`, `chart-theme` and `design-rules`:
  6 files, **133 passed**.
- `PERF=1 npx vitest run tests/perf`: **25/25**.

  | Path | Real | Large cold / warm |
  |---|---|---|
  | `/stats` core tabs | 132 / 61 ms | 1,232 / 437 ms |
  | Records | 102 ms | 1,201 / 510 ms |
  | Compare | 118 ms | 1,319 / 550 ms |

- `npm run build`: exit 0.
