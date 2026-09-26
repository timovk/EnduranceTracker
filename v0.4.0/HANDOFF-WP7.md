# HANDOFF — WP7 (Career Chronicle and Endurance Wrapped)

Branch `release/v0.4.0`, working tree only (not committed, per instructions), on top of WP6's `ee42fb0`.
WP7 was resumed from an unfinished working tree that already held nearly all of the source and most tests. I reviewed it
against SPEC §1, §3.1, §3.2.6–3.2.7, §3.3, §4.0, §4.5 (all), §4.7, §5.1–5.5, §6 rows 12/13/16, §8 and §10 WP7, kept what was
correct, and changed or finished the rest (list at the end of "What was built"). No schema, migration or `prisma/` change:
WP1's `ChronicleYear` model is used as it is. The XP economy is untouched.

## What was built (files)

**New (source)**
- `src/lib/domain/chronicle.ts` (pure): `chronicleChapterSchema` / `ChronicleChapterV1` (schemaVersion 1),
  `UnreadableChapterError`, `upgradeChapterSnapshot(raw)`, the chapter inputs (`ChapterInput`, `ChapterLedgerRow`,
  `ChapterAchievementRow`, `ChapterMilestoneRow`, `ChapterCareerMilestone`, `ChapterLadderRung`, `ChapterMasteryStep`,
  `ChapterExpeditionRow`), `chapterWindowOptions(weekStartsOn)`, `firstActivityYear(timeline)`, `activeYears(timeline)`,
  `careerBeganInYear(timeline, year)`, `buildChapter(input)`, `NOTABLE_REASONS`, `ChapterState`
  (`'year-to-date' | 'finalising' | 'frozen'`), `WrappedCard` (15-member union) / `WrappedCardKind` / `WrappedComparison`,
  `buildWrappedCards(chapter, { careerYear, state })`.
- `src/lib/engines/chronicle-engine.ts`: `freezeDueAt(year)`, `yearsToFreeze(db, userId, now)`, `buildChapterData(userId,
  year, now, prebuilt?)`, `freezeYear(tx, userId, year, now, prebuilt)`, `ensureChroniclesFrozen(userId, now)`,
  `rebuildChronicleYear(userId, year, now) → boolean`, `markWrappedSeen(userId, year, now) → boolean`,
  `pendingWrapped(userId, now)`, `getChronicleIndex(userId, now) → ChronicleIndexView`, `getChronicleChapter(userId, year,
  now) → ChronicleChapterView | null`; view types `ChronicleIndexView`, `ChronicleIndexChapter`, `ChronicleIndexQuietYear`,
  `ChronicleTop`, `ChronicleChapterView`, `ChapterExpeditionSummary`.
- `src/lib/server/upgrades/chronicle-freeze.ts`: `freezeAllChronicles({ now, shouldContinue, log? })` (start-up pass) and
  `freezeFinishedYears(userId, now)` (= `ensureChroniclesFrozen(...).catch(log)`, used by every page and action).
- Pages: `src/app/chronicle/page.tsx`, `src/app/chronicle/[year]/page.tsx` (+ `generateMetadata`),
  `src/app/chronicle/[year]/loading.tsx`, `src/app/chronicle/[year]/wrapped/page.tsx` (+ `generateMetadata`),
  `src/app/chronicle/[year]/wrapped/loading.tsx` (extra, deviation 11).
- Components `src/components/chronicle/`: `chronicle-index.tsx` (`ChronicleIndex`, `ChapterStateBadge`),
  `chapter-view.tsx` (client; all eleven sections, "Compared with", "About this chapter", the rebuild `Dialog`),
  `wrapped-deck.tsx` (client), `wrapped-card.tsx`, `wrapped-ready-banner.tsx` (client).
- Tests: `tests/domain/chronicle.test.ts` (21), `tests/integration/chronicle.test.ts` (37 after the review fixes).

**Modified (source)**
- `src/instrumentation.ts`: one `clock` (`deadlineClock(startedAt + STARTUP_BUDGET_MS)`) shared by the backfill and the new
  third try/catch, the freeze pass (`shouldContinue: () => clock.shouldStartChunk(1_000)`), exactly as §5.4.
- `src/lib/server/upgrades/career-backfill.ts`: P5 (`CAREER_BACKFILL_PHASES = ['P1','P2','P3','P4','P5']`),
  `CareerBackfillSummary.chaptersFrozen`, log segment `…; N chapter(s) frozen`.
- `src/lib/server/actions.ts`: `freezeFinishedYears` before the write of `createRaceAction`, `updateRaceAction`,
  `setRaceStatusAction`, `deleteRaceAction`, `logSessionAction`, `deleteSessionAction`, `createChampionshipAction`,
  `upsertSeasonAction`, and `updateSettingsAction` when the week start changes.
- `src/lib/server/career-actions.ts`: every event action (through `attempt(userId, …)`) and `setExpeditionModeAction` freeze
  first; new `rebuildChronicleYearAction(year)` and `markWrappedSeenAction(year)` (years validated by
  `chronicleYearSchema`, 1970–9999 integer, in `validation/schemas.ts`).
- `src/app/page.tsx`: `WrappedReadyBanner` above the career header when `pendingWrapped` returns a year.
- `src/components/layout/nav.tsx`: Chronicle (`History`) between Career and Career Statistics (§4.7.1 order now complete).
- `src/lib/server/recompute.ts`: step 5 = `markCareerBackfillApplied` then `ensureChroniclesFrozen`; step 6 =
  `rebuildChronicleYears`; `RecomputeOptions.rebuildChronicleYears?: readonly number[]`; `RecomputeReport.chaptersFrozen /
  chaptersRebuilt: number[]`. `scripts/recompute.ts`: `--rebuild-chronicle <year>` (repeatable; consumes its value, so the
  year is never read as the account), prints both counts.
- `src/lib/copy/tone.ts`: `chapterHeadline`, `chapterBeginning`, `wrappedOpeningLine`, `wrappedCardLine`.
- `src/lib/domain/records.ts`: `recordValueText(record)` exported (moved from `domain/expedition.ts`, which now imports it).
- Tests modified: `periods-tone.test.ts` (four functions registered in `everyUserFacingString()` with zero/small/large
  inputs for every card kind, + 2 tests), `account-isolation.test.ts` (`a chronicle year cannot be rebuilt or marked seen from
  the other account`), `instrumentation.test.ts` (+3: freeze at start-up, `the freeze pass skips accounts whose backfill is not
  complete`, a failing freeze pass is logged and the server starts; `a second start changes nothing` covers chapters),
  `upgrade-from-0.3.2.test.ts` (the fixture's 2025 chapter frozen with dated landmarks and its Expedition, 2026 year to date,
  marker complete, a second run changes no chapter), `career-backfill.test.ts` (P5 test + phase lists), `recompute.test.ts`
  (`recompute never rewrites a frozen chapter unless asked`, `--rebuild-chronicle replaces only that year`, chapters in the
  "twice changes nothing" state), `xp-exploits.test.ts` (row 13 `a backdated stint into a frozen year leaves that chapter
  untouched`; row 16 chapter assertions), `tests/perf/career-scale.test.ts` (P5, `/chronicle`, `/chronicle/[year]` year to date
  and frozen).

**Changed in this session (on top of the resumed tree)**
- Quiet years: `ChronicleChapterView.quiet`; the chapter page of a year with nothing in it says "No racing logged in {year}."
  with no state badge, no Wrapped and no "About"; its `/wrapped` is `notFound()` (was a "finalising" chapter for ever).
- Wrapped card 14 gives no percentages in a year-to-date preview and says "So far, next to the whole of {Y−1}: …"; the
  chapter's "Compared with" strip notes "{Y} so far, set against the whole of {Y−1}."
- Card 11 highlights: celebrated career milestones, then achievements rarest first, then the other milestones.
- Card 2 line names the active days ("212 hours at the track, across 41 days of viewing — about 8.8 days, end to end.").
- Card 3 with no race experienced: "A year of first glimpses, with the stories still to watch." (the old "Races started…"
  was false for a year whose only viewing is the start of a New Year stint).
- `WrappedDeck` marks a frozen year seen also when opened straight at its last card (`?card=N`).
- `chapter-view.tsx` takes "Show all" size from `CAREER_STATS_SHAPE.topListSize` and the rate note from `rateMinimumRaces`.
- `account-isolation` chronicle test no longer depends on the real date (fails in the first 72 h of a year otherwise).
- New tests: YTD comparison, highlight order, a year whose only viewing is a New Year stint's start (frozen, listed, not
  quiet; finalising inside its grace period), quiet-year assertions, marking only a frozen year. New `wrapped/loading.tsx`.
- **Perf harness fix** (`tests/perf/career-scale.test.ts`): an `afterEach` in the database describe that yields one
  event-loop turn (`setImmediate`). With WP7's four perf tests the database block ran past 60 s, and the run ended with
  vitest's unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` (exit 1, although every test passed): the
  better-sqlite3 driver resolves every query as a microtask, so the worker never got a macrotask turn to read vitest's RPC
  replies. Reproduced twice with the WP7 tests and not without them; gone with the yield (EXIT 0). WP8's "final full run"
  adds more — keep the `afterEach`.

## Deviations (smallest sound change, with reasons)

1. **Career Year 1 is the earlier of the first stint's local year and the earliest frozen chapter.** A frozen year must stay
   in the Chronicle (and keep its number) even if every stint of it is later deleted; with the spec's "first stint only" rule
   it would vanish from the index and 404.
2. **`ChronicleChapterV1.viewing.longestRace` has an extra `coverageSeconds`** (coverage at the year's end), so card 6 can say
   "62% of the story seen by the end of 2026" from the snapshot without inventing anything.
3. **`getChronicleChapter` returns a wider view** than the §4.5.2 signature: also `quiet`, `settlesOn`, `recordsBeaten`
   (ISO per `chapter.records`, from `beatenAfter` on the current progression), `expeditionSummaries` (parsed immutable rows,
   one query), `raceIdsInLibrary` (only races still in the library are links) and `eventHrefs`. `markWrappedSeen` and
   `rebuildChronicleYear` return `boolean` (true when they wrote) instead of `void`.
4. **Pages and actions call `freezeFinishedYears`** (the `.catch(log)` wrapper) rather than inlining the catch; the engine's
   `pendingWrapped` swallows a freeze failure silently (engines do not log; the next page or write logs it).
5. **More actions freeze first than §4.0 lists**: also `createRaceAction`, `setRaceStatusAction`, `createChampionshipAction`,
   `upsertSeasonAction` and a week-start change in `updateSettingsAction`, because each changes what a chapter counts
   (names, championships, the week a chapter's weeks start on).
6. **P5 has no cursor**: each chunk re-reads `yearsToFreeze` (cheap) and freezes the oldest due year; the phase is marked done
   in the chunk that freezes the last one, or in an empty chunk when none is due. `freezeYear` uses the run's context (timeline
   + progression) but reads landmarks, summaries and the ledger through the chunk's transaction, so P3's dates and P4's
   summaries are in the chapter.
7. **XP by source and levels reached come from the year's ledger rows** loaded once (`createdAt, amount, source, levelAfter`),
   not `xpBySource`/`getLevelHistory`: those use the global client, which must not be used inside the freeze transaction
   (WP2 note). They agree because every settle re-stamps `levelAfter` (R13).
8. **Card 14 and year-to-date**: percentages are withheld when the chapter itself is not complete, as well as when the year
   before is the partial first year — a few months set against twelve would read as a fall.
9. **Quiet years** (a finished year with nothing in it between active ones): the chapter page renders a calm line; the Wrapped
   page is `notFound()` ("It has no snapshot and no Wrapped"). The spec lists notFound only for years outside the career.
10. **Card 11 highlight order** reads "spectacular and notable career milestones first" as: celebrated milestones, then
    achievements by rarity, then uncelebrated milestones.
11. **Extra `src/app/chronicle/[year]/wrapped/loading.tsx`** (a card-shaped skeleton): without it the chapter's skeleton
    (`[year]/loading.tsx`, which wraps child segments) was shown while Wrapped loads.
12. **Perf, Large cold**: with twenty frozen years (the §1.3 row; the Large career has ten, so the harness adds copies of its
    latest chapter for the ten years before its first, and removes them after), the `/chronicle` index is 857 ms cold and a
    frozen chapter 956 ms cold (warm 131 / 40 ms; real 69 / 52 ms cold). §1.3 gives Large "< 500 ms" for both without a
    cold/warm split: **the target is met warm only.** Cold is dominated by the replay build (~500 ms load alone at Large): the
    index builds the year in progress live (§4.5.5), and a frozen chapter needs the current record progression for "since
    beaten" (§4.5.1, section 8) and the active years for its neighbours. The harness asserts warm < 500 ms and cold < 1.5 s
    (was 5 s until the review), so a cold regression shows. The real-career targets are met cold. WP8 carries this into the
    owner notes (see "Facts later WPs must know").
13. `records.recordValueText` moved from `domain/expedition.ts` to `domain/records.ts` (shared by the Expedition Summary and
    the chapter; no behaviour change).

## Facts later WPs must know

- **Freezing**: `freezeDueAt(Y)` = local midnight 1 Jan Y+1 + `CHRONICLE_SHAPE.freezeGraceHours` (72 h). A year is frozen only
  when `isCareerBackfillApplied`, due, has activity (a stint instant in it, or the reach-back of the first stint logged after
  it), and has no row; `upsert … update: {}`. Frozen rows are never rewritten except by `rebuildChronicleYear` (the chapter's
  "Rebuild this chapter from today's history…" dialog, or `db:recompute -- --rebuild-chronicle <year>`), which keeps
  `frozenAt`/`wrappedSeenAt` and sets `rebuiltAt`.
- **Log lines**: `[chronicle] <name> (<id>): froze the 2025 chapter` / `froze the 2024 and 2025 chapters`;
  `[chronicle] <name> (<id>): could not freeze its finished years; the Chronicle will try again when opened`;
  `[chronicle] could not freeze finished years at start-up; the Chronicle will try again when opened`;
  `[chronicle] <userId>: could not freeze its finished years; they stay live until the next try` (page/action).
  The backfill line now ends `…, N summaries; M chapter(s) frozen`.
- **Badges** (index and chapter): "Year to date"; "Complete — finalising until 4 January" (grace period) or
  "Complete — finalising" (upgrade not complete); "Complete". Quiet line: "2029 — no racing logged · Career Year 4".
- **Wrapped for e2e (WP8)**: `/chronicle/<year>/wrapped`; cards are `<article>`; progress dots are buttons with
  `aria-label="Card N of M"` and `aria-current="step"` on the current one; buttons "Back" / "Next", the last card shows a
  "Read the chapter" link instead of Next; `←`/`→`/`Escape` keys; `?card=N` kept with `history.replaceState`. Every
  year-to-date card carries the chip "Year to date · as of {d Month yyyy}". The preview never writes anything: reaching its end
  leaves `chronicle_years` untouched (there is no row). A frozen year's end sets `chronicle_years.wrappedSeenAt`.
  Dashboard/Chronicle banner text: "Your {year} Endurance Wrapped is ready" with "Open" and "Hide".
- **Nav order** (WP8 e2e): Dashboard · Race Library · Race Strategist · Viewing Budget · Challenges · Season Pass · Career ·
  Chronicle · Career Statistics · Events · Mastery · Collections · Achievements · Trophy Cabinet · Hall of Fame · Settings.
- **Docs (WP8)**: the ledger dates XP by the real clock, so a chapter's "XP earned" for a year of engine-backdated stints (the
  demo seed's 2025) is 0 while its mastery steps and milestones (dated historically) show what they paid; the chapter says "XP
  is counted in the year it was recorded". Upgrade awards are dated 2026 (§4.5.3).
- **Module cycle**: `chronicle-engine` imports `isCareerBackfillApplied` from `career-backfill`, which imports `freezeYear` /
  `yearsToFreeze` from `chronicle-engine`. Harmless (all uses are inside functions, like WP2's xp-ledger ↔ season-pass cycle);
  keep module top levels free of cross-calls.
- `ChapterStateBadge` is exported from `chronicle-index.tsx` (a server-compatible file also imported by the client chapter
  view). Keep `zod` out of client files: the client components import only types from `domain/chronicle.ts`.
- **For WP8's owner notes (§9.4) and README "Known limits"**: on a very large history (the ten-year, 60,000-stint Large
  career), the first opening of the Chronicle or of a finished year's chapter after a start or a change takes about one
  second (§1.3 asks for half a second); opened again, it is well under that. The real-career targets are met either way.
  Suggested words: "On a very long history, the Chronicle can take about a second to open the first time after a change."
- Acceptance check on data: `DATABASE_URL=file:<copy of tests/fixtures/career-0.3.2.db>`, `npm run db:deploy`, `next dev`:
  start-up log `… 18 expedition checkpoints (+6,900 XP), 3 summaries; 1 chapter frozen`; `/chronicle` shows
  "2026 · Career Year 2 · Year to date" and "2025 · Career Year 1 · Complete" with the Wrapped banner for 2025.

## Check results (before the review; superseded by "Review fixes" below)

All on the final tree (after the last source edit; the perf file's `afterEach` was the last change, followed by tsc,
eslint, the perf run and the build).

- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors. `npx eslint`: 0 problems.
- `npx vitest run`: 63 files passed, 1 skipped (perf); **1,201 tests passed**, 29 skipped (log `scratchpad/v040/wp7-final.log`).
- WP7 acceptance (targeted):
  ```
  npx vitest run tests/integration/chronicle.test.ts tests/domain/chronicle.test.ts \
    tests/integration/career-backfill.test.ts tests/integration/instrumentation.test.ts \
    tests/integration/upgrade-from-0.3.2.test.ts
  ```
  5 files, **77 tests passed** (17 + 15 + 11 + 13 + 21).
- `PERF=1 npx vitest run tests/perf`: **29/29 passed, no errors, EXIT 0** (137 s; log `wp7-perf3.log`).

  | Path | Real | Large cold / warm | §1.3 |
  |---|---|---|---|
  | `/chronicle/[year]`, year to date | 137 ms | 1,042 / 278 ms | < 800 ms; < 4 s / < 1 s ✓ |
  | `/chronicle` index (10 frozen years) | 34 / 12 ms | 776 / 102 ms | < 300 ms; < 500 ms (warm ✓, cold see deviation 12) |
  | `/chronicle/[year]`, frozen | 41 / 11 ms | 753 / 38 ms | < 300 ms; < 500 ms (warm ✓, cold see deviation 12) |
  | P5, one year per chunk | 92 ms (whole account) | slowest chunk 232 ms (10 years) | each chunk < 5 s ✓ |
  | `ensureChroniclesFrozen`, nothing due | — | 1 ms | (what every write pays first) |

- `npm run build`: exit 0 (routes `/chronicle`, `/chronicle/[year]`, `/chronicle/[year]/wrapped`).
- Acceptance on data (the real `endurance.db` is off limits, so, like WP3–WP6, a scratch copy of the 0.3.2 fixture):
  `wp7/dev/app.db`, `db:deploy` applied `20260924120000_career_history`, `next dev -p 3927`; start-up log
  `[career-backfill] Demo Driver (…0001): credited 11 races, …; 18 expedition checkpoints (+6,900 XP), 3 summaries; 1 chapter frozen`.
  Driven with headless Electron (`wp7/e/main.js`, log `wp7/e/run.log`), no console errors:
  - `/` shows "Your 2025 Endurance Wrapped is ready"; `/chronicle` lists "2026 · Career Year 2 · Year to date" and
    "2025 · Career Year 1 · Complete" (**a frozen 2025 chapter and a 2026 year to date**);
  - `/chronicle/2025` (frozen, "How it began", every section) and `/chronicle/2026` render; `/chronicle/2024`, `/2027`, `/abc`
    are not found;
  - `/chronicle/2026/wrapped?card=3` opens on card 3; clicked to the end with → (15 cards, every one with "Year to date · as of
    26 September 2026"), nothing marked; `/chronicle/2025/wrapped` clicked to the end with Next (14 cards) marks it seen and the
    dashboard banner is gone; the rebuild dialog shows the spec's text and rebuilding reports "Your 2025 chapter was rebuilt from
    your history as it stands today."
- **Mutation checks** (`wp7/mut/mutate.py`; each applied alone, the named tests run, the file restored and md5-verified):
  no grace period; no backfill guard; active years by instant only; no reach-back activity; prompt without freezing;
  percentages in a year to date; highlights order; never quiet; P5 done after the first year; frozen chapter rebuilt live;
  marking a year that is not frozen. **11/11 caught** (two survived the first pass and got the new tests listed above).

## Review fixes

An independent review reported one major and three minor issues and three spec gaps. Each was checked against the code; all
were valid and all are fixed. None is rejected.

1. **Major — nothing tested that a write or a page freezes what is due first (§4.0, §4.5.2).** Confirmed: with the reviewer's
   no-op `freezeFinishedYears` stub the whole suite stayed green. Fixed in `tests/integration/chronicle.test.ts`, new describe
   `every write and every Chronicle page freezes what is due first`. The file now mocks the session, `server-only` and
   `next/cache` (as `events.test.ts` does) and, only in these tests, fakes `Date` alone (`vi.useFakeTimers({ toFake:
   ['Date'] })`, 10 January 2027 12:00; real timers restored in `afterEach`). Set-up: a 2026 past its grace period, backfill
   marked complete, nothing opened (Spa in the Spa Classic, Fuji in a championship, an empty Fuji Classic). For each of 18
   actions — log stint, delete stint, delete race, edit race, race status, add race, add championship, save season, week
   start, and create / rename / merge / link / unlink / archive event, Expedition Mode, rebuild chapter, hide Wrapped prompt —
   the test builds the chapter as it stands, runs the real action, and asserts that the action succeeded, that a 2026 row now
   exists, and that its snapshot **equals the chapter from before the write**. Where the write changes what a chapter would
   say, it also asserts the frozen value and the different live value: the deleted stint's and race's time still counted, the
   old race and event names, the events before a link, merge or unlink, and `weekStartsOn` 1 after a change to Sunday.
   Rebuild keeps `frozenAt` = now and sets `rebuiltAt`. Hiding the prompt sets `wrappedSeenAt`. After each action, a further
   `ensureChroniclesFrozen` finds nothing and leaves the row alone, and the ledger is settled.
   The three Chronicle pages are driven too: their default exports are called with the mocked session and props, and the
   returned elements are inspected, never rendered. Each freezes 2026 first. The chapter page hands `ChapterView` a frozen
   view, and the Wrapped page sets `markSeenAtEnd`.
   `linkStrongSuggestionsAction` has no case of its own, because it freezes through the same `attempt(userId, …)` as the
   five event actions that do.
   **Mutation check**: with the reviewer's stub (`review-wp7/vitest.mut-freeze.config.ts`), all 21 new cases fail and the
   older 16 pass. The index page's case fails too, because `getChronicleIndex` does not freeze by itself.
2. **Minor — `recordsBeaten` and `eventHrefs` untested.** New test, `what a frozen chapter works out when it is shown ›
   says which of its records were beaten since, and where its events are, without touching the snapshot`. It freezes 2026 (2 h
   + 2 h in December, Spa in an event), then shows every record standing (`null`) and `eventHrefs = { key: eventHref(key) }`.
   It then logs a 3 h stint in February 2027. `longest-session` is now beaten at that stint's `watchedAt`, `most-in-a-day` at
   local midnight of that day, and `most-in-a-month` still stands; the stored row is unchanged. Mutation-checked (each applied
   alone, then the md5 of the file verified): `recordsBeaten` always null, the ISO string passed instead of `new Date(...)`,
   and `eventHrefs: {}`. All 3 are caught.
3. **Minor — perf bounds too loose; 10 frozen years instead of 20.** The index test now pads each career to **twenty frozen
   years** (copies of its latest chapter for the years before its first, removed in a `finally`) and asserts exactly 20 frozen
   rows in the view. The Large cold assertions for the index and for a frozen chapter are tightened from 5 s to **1.5 s**.
   Deviation 12 is rewritten with the new figures, and the missed cold target is now in "Facts later WPs must know" for WP8's
   owner notes and README (§9.4), so it is stated there and not hidden by a bound.
4. **Minor — docstring of `chronicle-freeze.ts` said "oldest-served first".** The comment now says what the code does:
   accounts are taken in id order in what is left of the start-up budget, and any account the pass does not reach is frozen
   by its next page or write. No behaviour change. The pass costs about 1–2 ms per account when nothing is due, and a missed
   account loses nothing, so ordering by the backfill's `lastRunAt` would add a marker read for no gain.

Spec gaps: §1.3 is covered by 3 (met warm only; now measured at 20 years, bound tightened, carried to WP8). §4.0 / §10
"freeze before each write" is covered by 1. §4.5.1 section 8, "since beaten", is covered by 2.

### Check results (final run, after the last edit)

- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0). `./node_modules/.bin/next typegen`: ✓ Types generated.
- `npx tsc --noEmit`: 0 errors. `npx eslint`: 0 problems.
- `npx vitest run`: 63 files passed, 1 skipped (perf); **1,223 tests passed**, 29 skipped (log `wp7-fix/checks.log`; its one
  `prisma:error` is the expected refusal in `account-isolation`, as in every earlier run).
- WP7 acceptance (targeted, the five files): **99 tests passed** (chronicle integration 37, domain 21, career-backfill 17,
  instrumentation 11, upgrade-from-0.3.2 13).
- `PERF=1 npx vitest run tests/perf`: **29/29 passed, EXIT 0** (log `wp7-fix/perf.log`).

  | Path | Real | Large cold / warm | §1.3 |
  |---|---|---|---|
  | `/chronicle/[year]`, year to date | 135 ms | 1,156 / 291 ms | < 800 ms; < 4 s / < 1 s ✓ |
  | `/chronicle` index, **20 frozen years** | 69 / 30 ms | 857 / 131 ms | < 300 ms ✓; < 500 ms warm ✓, cold asserted < 1.5 s |
  | `/chronicle/[year]`, frozen | 52 / 7 ms | 956 / 40 ms | < 300 ms ✓; < 500 ms warm ✓, cold asserted < 1.5 s |
  | P5, one year per chunk | 106 ms (whole account) | slowest chunk 284 ms (10 years) | each chunk < 5 s ✓ |
  | `ensureChroniclesFrozen`, nothing due | — | 2 ms | |

