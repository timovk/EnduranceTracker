# HANDOFF — WP4 (Event Legacy)

Branch `release/v0.4.0`, working tree only (not committed, per instructions), on top of WP3's `228d90e`.
Built against SPEC §1, §3.2.3–3.2.4, §3.3, §4.0, §4.2, §4.6, §4.7, §5, §6 rows 6/7/18, §7, §8 and §10 WP4.

## What was built (files)

**New (source)**
- `src/lib/engines/event-legacy-engine.ts` — the Event Legacy engine:
  - operations (all take the caller's `tx`): `createEvent`, `resolveEventForRaceInput`, `renameEvent`, `mergeEvents`,
    `linkRaces`, `linkRaceGroups`, `unlinkRace`, `setEventArchived`, `resolveActiveEvent`, `dismissEventSuggestion`;
  - reads: `getEventSuggestions`, `suggestEventForName`, `getEventSuggestionForRace`, `getEventsIndex`, `getEventLegacy`,
    `findRacesToLink`;
  - types `EventRef`, `EventOperationRefused` (+ `EventRefusalReason`), `EventsIndexView`, `EventCard`, `InactiveEvent`,
    `SuggestionItem`, `EventLegacyView`, `EditionRef`, `EditionRow`, `EventStepView`, `StepGroup`, `LinkableRace`,
    `EventResync`; constants `EVENT_NAME_MAX_LENGTH` (80), `DISMISSED_SUGGESTIONS_KEY` (`'dismissedEventSuggestions'`).
- `src/lib/server/career-actions.ts` (`'use server'`): `createEventAction`, `renameEventAction`, `mergeEventsAction`,
  `linkRacesToEventAction`, `linkStrongSuggestionsAction`, `unlinkRaceFromEventAction`, `setEventArchivedAction`,
  `dismissEventSuggestionAction`, `suggestEventForNameAction`, and `findRacesToLinkAction` (deviation 2).
- `src/app/events/page.tsx`, `src/app/events/[key]/page.tsx` (with `generateMetadata`), `src/app/events/[key]/loading.tsx`.
- `src/components/events/events-index.tsx`, `event-legacy-view.tsx`, `event-dialogs.tsx` (Create/Rename/Merge/Add races
  dialogs + `CreateEventButton`), `event-suggestions.tsx`.
- `src/components/races/event-picker.tsx` — the shared "Recurring event" select used by both race forms (`NEW_EVENT` sentinel).

**Modified (source)**
- `src/lib/config/economy.ts`: the 9 `raceEventNodes` appended; the six display names renamed; a comment explaining every number.
- `src/lib/engines/mastery-engine.ts`:
  - event-step credits: `EventStepCreditRow`, `EventStepCreditIndex`, `loadEventStepCredits`, `indexEventStepCredits`,
    `isCreditedFor`, `eventStepContributors`, `eventStepPays` (pure, exported for tests), `writeMissingEventStepCredits`;
  - `syncMastery`: loads credits once, credits every already-unlocked event step before paying anything, pays a newly
    unlocked event step only when `eventStepPays`, otherwise unlocks it XP-free; credits its contributors either way;
  - `carryOverEventSteps(tx, userId, fromKey, intoKey)` (merge carry-over, no ledger row);
  - `getMasteryOverview` hides trees of merged events; `MasteryTreeView.eventHref`; exported `eventHref(key)`;
  - `computeScopes` also returns `eventMembers`.
- `src/lib/engines/session-engine.ts` `deleteRace`: widened race select; `writeMissingEventStepCredits` then the tombstone
  `eventStepCredit.updateMany({ where: { userId, raceId }, data: { fingerprint } })` before the delete.
- `src/lib/server/actions.ts`: `raceFormToObject` reads `eventKey`/`newEventName`; `createRaceAction` and `updateRaceAction`
  resolve the event (`resolveEventForRaceInput`) and write `iconicKey` + `raceMasteryId`; `updateRaceAction` writes the
  missing credits before an event change; "Major event" no longer clears the link; `createRaceAction` now runs in the 60 s
  `EDIT_TRANSACTION` and revalidates `/events` and `/mastery`.
- `src/lib/validation/schemas.ts`: `eventKey`, `newEventName` (and `iconicKey` kept as alias); `eventNameSchema`,
  `eventKeySchema`, `raceIdsSchema`, `eventSuggestionIdSchema`.
- `src/lib/server/races.ts`: `getEventOptions(userId) → EventOption[]` replaces `getIconicKeysInUse` (removed);
  `RaceDetail.event: { key, name, editionYear, href } | null`.
- `src/components/races/add-race-form.tsx` / `edit-race-form.tsx`: the always-visible picker; Add Race guesses the event
  on blur of the name (`suggestEventForNameAction`) unless the user already chose; Edit preselects the race's event (and
  adds it to the list if the list would not offer it). `src/app/races/new/page.tsx`, `src/app/races/[id]/edit/page.tsx`
  pass `events`.
- `src/components/races/race-detail-view.tsx` + `src/app/races/[id]/page.tsx`: `Edition {year} of {event}` link in the
  header label row; a one-line strong suggestion ("Looks like an edition of … — Link / Not this one").
- `src/components/dashboard/mastery-trees.tsx`: "Event page" link on event trees. `src/components/layout/nav.tsx`: Events
  (`Repeat`) directly after Career.
- `src/lib/server/upgrades/career-backfill.ts`: P2 (`backfillEventProgression`), `CAREER_BACKFILL_PHASES = ['P1','P2','P3']`,
  summary fields `eventStepsUnlocked`, `eventStepXp`, `creditsWritten`, log segment, `PhaseContext.history`.
- `src/lib/copy/tone.ts`: `eventLegacyHeadline(stats)`.
- `src/lib/engines/career-milestone-engine.ts`: event subjects link to `/events/[key]` (closes WP3's spec gap); event names
  now come from the account's `RaceMastery` rows, so an event with no races is still named and linked.
- `src/lib/engines/stint-unlocks.ts`: a reopened summary's mastery XP is read from the ledger (see deviation 9).
- `src/lib/domain/landmarks.ts`: `stintsByEvent` memoised per timeline (`WeakMap`) — WP3's suggested fix for P3/dating cost
  now that event trees have 17 steps.

**Tests**
- New: `tests/integration/events.test.ts` (23), `tests/integration/xp-exploits.test.ts` (13: rows 6-event, 7, 18, plus
  "moving an edition before the upgrade has credited its steps pays none of them again").
- Modified: `tests/engines/mastery.test.ts` (+8: the appended nodes, the renames, 14,300 vs 85,000, contributors, payable,
  tombstones), `tests/domain/economy-balance.test.ts` (+1: every configured new node is modelled and pays from 672 h),
  `tests/auth/account-isolation.test.ts` (+2 §8.2 names), `tests/integration/upgrade-from-0.3.2.test.ts` (+1: the fixture's
  `fort-aurelia-24` gets its 17 steps, credits and new steps once; credits in the "changes nothing" comparison),
  `tests/integration/career-backfill.test.ts` (+1 P2 test; the tiny-deadline test now expects 5 starts and the new log
  segment), `tests/integration/recompute.test.ts` (+1: recompute writes the credits, a second run writes none),
  `tests/domain/periods-tone.test.ts` (`eventLegacyHeadline` registered + 1 test), `tests/perf/career-scale.test.ts` (+4).
- Helpers: `tests/helpers/career-db.ts` gains `eventStepProblems(userId)` (I6 checker) and `addRace({ circuit })`.

## Deviations (smallest sound change, with reasons)

1. **`getEventLegacy(userId, key)` and `getEventsIndex(userId)` take no `now`.** They are pure reads with no time-dependent
   figure; an unused parameter would fail lint, and reading the clock would break R9.
2. **Extra read-only action `findRacesToLinkAction(key, query)`** (and engine `findRacesToLink`). The "Add races" dialog must
   search a library of thousands (§4.2.4); the page sends only the first 50 and the dialog searches server-side, rather than
   shipping every unlinked race to the browser.
3. **Refusals are thrown, not returned** (`EventOperationRefused` with a reason and, for `name-taken`, the existing event),
   so `renameEvent` keeps the spec's `Promise<EventRef>` and a refusal rolls its transaction back. `createEvent` still returns
   `{ ok: false, existing }` as specified. Actions map reasons to sentences.
4. **Merging re-points events already merged into `from` straight at `into`**, so no chain ever grows past one hop and the
   10-hop guard is never reached in practice. Resolution still follows chains (≤ 10 hops, userId-scoped) for any old row.
5. **A race joining a hand-archived event un-archives it** (`resolveEventForRaceInput` with that key): archive requires no
   races, so an archived event with races would be a contradiction. `resolveActiveEvent` returns null for archived events;
   `linkRaces` to an archived/merged-away key is refused (`not-found`).
6. **Additive view fields**: `EventLegacyView.event.href/accentColor`, `stats.storyCompleteRaces` (the headline's
   "complete race stories" counts races, not editions), `EditionRow.coverageSec` (for the bar). `EventsIndexView` shape is
   mine (spec gave only the name). "Longest edition" and "Highest completion" are among watched editions (an `EditionRef`
   needs an instant). Edition history has one row per race (each links to its race page); two races of one year share a
   year label.
7. **`updateRaceAction` writes the missing credits only when the event actually changes** (resolved key ≠ current key),
   not on every save that posts the field. A form without any event field (API callers, older tests) leaves the event as it
   is; "None" (`eventKey=''`) clears it.
8. **New keys are cut to 72 characters of the name before the `-N` suffix**, so every generated key fits the 80-character
   `eventKey` the forms accept. Keys taken include those carried by races without a `RaceMastery` row (never reused).
9. **`reconstructStintUnlocks` reads what each mastery node actually paid from the ledger** (was `node.xpReward`). Without
   this, a reopened summary would show the full reward for an XP-free event step, disagreeing with the live summary.
   Tested (`events.test.ts › a step reached on editions that already paid it`).
10. **P2 dates what it unlocks only when P3 is already done** (a dev database a WP3 build completed — WP3's gotcha).
    `backfillEventProgression(tx, userId, now, dating?)` takes the optional context; on a normal upgrade P3 dates it. P2's
    filled/recognised counts go into `datesFilled`/`datesRecognised`.
11. **Events index cards** use `Panel accent=` (sets `--accent` only) and never `--accent-soft`, because `accentVars` is WP5's.
    WP5 may switch the cards to `style={accentVars(color)}`.
12. **`/events/[key]` for an unknown key**: `notFound()` inside a streamed route (there is a `loading.tsx`) gives HTTP 200
    with the not-found UI and `noindex` (Next behaviour, verified with `next dev`); the page itself behaves as specified.

## Facts later WPs must know

- **The credit rule**: `EventStepCredit (userId, nodeKey, raceId)` is unique; a race holds one credit per node key in any
  event; `fingerprint` is set only by `deleteRace` (tombstone). `syncMastery` writes credits for every unlocked event step on
  every sync; the steady state writes nothing (`createManySkippingDuplicates` with the loaded index as filter).
  Large career: ~17,200 credits; a stint reading them costs ~0.8 s total on Large.
- **Anything that moves a race between events must call `writeMissingEventStepCredits(tx, userId)` first** (done for link,
  unlink, merge, the race form, delete race). WP5/WP6/WP7 add no such path, but if one appears, follow the rule.
- `eventStepPays(node, members, index)` — pays only when `xpReward > 0` and the uncredited members reach the threshold.
  An XP-free unlock has `MasteryUnlock.xpAwarded` 0 and no ledger row; `EventStepView.recordedOnly` = unlocked, reward > 0,
  no ledger row.
- `eventHref(key)` (mastery-engine) is the one way to build `/events/<encoded key>`; `RaceDetail.event.href` uses it.
- `resolveEventForRaceInput(tx, userId, { eventKey?, newEventName? }, now)` — a new name reuses an active event going by that
  name (normalised: `normaliseEventKey` of key or `displayName ?? name`); an unknown key creates the event with exactly that key.
- Backfill: phases `['P1','P2','P3']`; WP5 appends `'P4'`, WP7 `'P5'`. `PhaseContext` is `{ userId, now, timeline, history }`.
  Log line now: `…story bonuses +a/−b; N event steps (+X XP), C credits; M new milestones …`.
- `getEventsIndex`/`getEventLegacy`/`findRacesToLink` use the cached replay (`getCareerTimeline`); suggestions for the race
  page and Add Race read race rows only (no replay).
- `EventLegacyView.editions[].isExpedition` uses `domain/expedition.isExpedition` (badge only; WP5 may link it to
  `/races/[id]/expedition`). The race page's edition label sits in the header label row; WP5's Expedition line can go under it.
- Chronicle (WP7): `EventCard`/`EventLegacyView` expose `storyCompleteRaces`, `editionsExperienced`, credited seconds and
  `longestCompleteRun` if a chapter wants an event line; the Career Milestones `eventEditions` rows carry `eventId`.
- **Lists of past unlocks must leave merge copies out.** A merge copies the merged event's unlocked steps into the survivor
  with the same `unlockedAt` (§4.2.2). Anything that lists "what was unlocked when" (reopened stint summary, dashboard shelf,
  and WP7's Chronicle if it lists event steps reached in a year) passes its rows through
  `carriedEventStepCopies(db, userId, rows: UnlockedStepRow[])` (mastery-engine) and drops the returned `<treeKey>:<nodeKey>`s.
- **"Experienced" has one definition everywhere.** `MasteryRaceInput.experienced` is now `isRaceExperienced(...)` alone
  (WP2 had `storyComplete || …`), so mastery, metrics, the replay, landmarks and the event page agree: a Story Complete race
  with under 10 credited minutes (a 1 h race at 8×, a tiny race) is complete but not experienced.
- **`CareerMetrics.masteryTreesCompleted` skips trees of merged-away events** (the carried copies would otherwise make one
  finished tree two, and Specialist/Polymath could be reached by merging). `masteryNodesUnlocked` is unchanged (it pays nothing).
- **Residual for WP8 (§9.4 owner notes and README "Known limits"):** a race's date or length edited just before deleting it
  defeats the tombstone. `deleteRace` fingerprints the race as it is at deletion (year and rounded hours must match), so
  editing only the race date (or its runtime by enough to change the rounded hours), deleting it, and re-creating the true edition in a new
  event lets the re-watched edition pay its event steps once more. Closing it needs the race's earlier values, which no
  column holds (no schema change in 0.4.0). The viewing has to be logged again to earn anything.
- **Pre-existing flake (not introduced here; seen once, in one run of the backfill test file, and not in the six runs after):** `awardXp` lets the database stamp `createdAt`
  (ms precision) and the ledger is ordered by `(createdAt, id)` with random uuids, so two awards in the same millisecond can be
  ordered opposite to how they were stamped until the next settle; `ledgerProblems` then reports it. It showed once in
  `career-backfill.test.ts › what 0.3.x left in the ledger` (passes on rerun). R13 says `awardXp` is unchanged, so it was left;
  WP8 may want to decide (e.g. stamp `createdAt = max(now, last + 1 ms)`).

## Measured (this container, `tsx`, copy of WP2's `large.db`; script `scratchpad/v040/wp4/time-wp4.ts`)

| Path | Real (ms) | Large (ms) |
|---|---|---|
| First stint after seeding (creates trees and all credits; untimed in the harness) | 1,234 | 5,177 |
| P2 with no credits yet (writes 116 / 17,205) | 52 | 2,204 |
| A stint reading every credit | 135 | 819 |
| Rename / link / unlink / merge | 9 / 84 / 82 / 113 | 13 / 757 / 723 / 1,000 |
| `/events/[key]` view cold / warm | 39 / 4 | 575 / 24 |
| `/events` index, warm | 14 | 179 |
| `deleteRace`, last month (now with credits and tombstones) | 45 | 234 |

Economy (`work/econ-model.ts`, now with the nodes present) reproduces SPEC §7.3 exactly: 20 h 0.4379, 58 h 0.5000, 150 h 0.5236,
336 h 0.5044, 672 h 0.5010, 1,680 h 0.5501, 3,360 h 0.5957; long-race 0.4301 … 0.5866; eventNew 0 / 0 / 0 / 0 / 3,000 / 16,800 / 22,800.

`next dev` on a scratch copy of the 0.3.2 fixture (with a session row): start-up log
`… 2 event steps (+500 XP), 5 credits; 2 new milestones (+500 XP), 26 dates filled, 16 recorded only`; `/events`,
`/events/fort-aurelia-24`, `/races/[id]` (shows "Edition 2026 of Fort Aurelia 24"), `/races/[id]/edit` (event preselected),
`/races/new`, `/mastery`, `/career/milestones` all 200; `/events/no-such-event` renders the not-found UI.

**Mutation checks** (each applied alone, targeted tests run, file restored and md5-verified; every one failed ≥ 1 test):
pay ignoring credits; no credit pass before paying; no tombstones in `deleteRace`; no merge carry-over; race-form move
without credits; link without credits; merged trees shown in Mastery; no redirect for a merged event; a form without the
event field clearing it; exact-only name matching; P2 without dating; reopened mastery XP from `node.xpReward`.

## Check results (final run, after the last edit)

- `npm run db:generate`: ✔ Generated Prisma Client (7.10.0).
- `./node_modules/.bin/next typegen`: ✓ Types generated successfully.
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 problems.
- `npx vitest run`: 58 files passed, 1 skipped (perf); **1,050 tests passed**, 19 skipped.
- WP4 targeted: `npx vitest run tests/integration/events.test.ts tests/integration/xp-exploits.test.ts tests/engines/mastery.test.ts tests/domain/economy-balance.test.ts tests/auth tests/integration/upgrade-from-0.3.2.test.ts` —
  9 files, **166 tests passed**.
- `PERF=1 npx vitest run tests/perf`: **19/19 passed** (WP4 paths: P2 2.6 s incl. checks; credit-reading stints, event actions
  and pages all inside §1.3).
- Acceptance: the economy test includes the new nodes and passes; I6 (`eventStepProblems`) is asserted after every test in
  `events.test.ts` and `xp-exploits.test.ts`, and in the fixture, recompute, backfill and perf tests.

## Review fixes

The independent review reported six minor issues and no spec gaps. I checked each one against the code. All six are valid;
five are fixed with tests and one is recorded as a residual. I also found and fixed one related issue myself (item 7).

1. **"New event…" with an empty name quietly took the race out of its event** (`event-picker.tsx`, `actions.ts`). Fixed. The
   name `Input` and its `Field` are `required`. `createRaceAction` and `updateRaceAction` refuse a posted-but-blank
   `newEventName` before the transaction (`unnamedNewEvent`): `{ ok: false, message: 'A couple of fields need a second
   look.', errors: { newEventName: 'Give the new event a name.' } }`. Both forms already show `errors.newEventName` on the
   picker. Test: `events.test › asks for a name when "New event…" is chosen without one, rather than reading it as "None"`
   (edit keeps the event; add creates no race).
2. **A stale Add Race guess stayed picked** (`add-race-form.tsx`). Fixed. While the user has not chosen, every blur now sets the
   choice to the new guess, or back to "None" (and drops the hint) when the name is blank or gives no guess. `eventTouched`
   is now a ref that is checked again after the server action returns, so a choice made during the round trip is never
   overwritten. No component test harness exists in the repo (no DOM testing library). I left this untested and did not
   add one.
3. **Merge copies were listed as the old stint's unlocks** (`stint-unlocks.ts`, `dashboard.ts`). Fixed. The dates are still
   copied as spec'd. New `carriedEventStepCopies(db, userId, rows)` (mastery-engine) identifies a copy: the same node key
   with the identical `unlockedAt`, in an event of the same merge family (same survivor via `eventKeyResolver`) that was
   archived earlier (a merge copies out of the event it archives, so the original is the one that left first). A row with
   its own ledger payment is never a copy. It costs nothing when the account has no merged event. The reviewer's simpler
   "dedupe by (node key, unlockedAt)" was not used: P2 and link actions unlock steps in many unrelated events at one `now`,
   and those rows would have collapsed. `reconstructStintUnlocks` drops the copies. The dashboard reads mastery unlocks a
   page at a time (`recentMasteryUnlocks`, now ordered `(unlockedAt desc, id asc)`) so copies never push older unlocks off
   the shelf. Test: `events.test › what a merge leaves in the history › reopening a stint lists what it unlocked then, and
   the dashboard shows each step once, however often it is merged` (A→B, then B→C; both reopened stints and the shelf are
   unchanged).
4. **The event page and the steps counted experienced editions differently.** Valid, but fixed on the other side from the
   reviewer's suggestion. The mismatch came from `mastery-engine` `toRaceInput` (`storyComplete || isRaceExperienced(…)`,
   added in WP2), not from the page. §3.1 defines "experienced" as `isRaceExperienced` alone and says mastery, metrics and
   the replay use that one predicate. Metrics (`racesExperienced`, `maxEditionsExperiencedOfOneEvent`), landmark dating
   (`eventStepInstant` `editionsExperienced`), the window summary and the page all already did. Changing the page instead
   would have left mastery disagreeing with landmark dating and the career milestones. It would also have let three
   1-minute Story Complete races in one event pay `experienced_3`, breaking §6 row 18's bound ("counted races and editions
   must be experienced"). So `toRaceInput` now uses `isRaceExperienced(...)` alone. No account is affected: the
   `experienced_*` steps are new in 0.4.0. Tests: `events.test › counts an edition rushed through at 8× as complete but not
   experienced, on the page and in its steps alike` (then 5 min at 1× makes page and step agree), and
   `xp-exploits › row 18 › complete editions rushed through at 8× are not experienced editions`.
5. **No test covered the credit pass in `deleteRace`.** Added `xp-exploits › row 6 › a step reached before the upgrade
   credited it cannot be paid again by deleting the race and adding it to a new event` (credits deleted to model 0.3.2 before
   P2; the re-created edition's `edition_1` in the new event is unlocked, not paid). It fails with the pass removed.
6. **A race's date/length edited before deletion defeats the tombstone.** Confirmed (`fingerprintMatches` needs the same
   year and rounded hours; `deleteRace` fingerprints the race as it is then). Closing it needs the race's earlier values,
   which requires a schema change, so it is not fixed. It is recorded above under "Facts later WPs must know" for WP8's §9.4
   notes and the README "Known limits".
7. **(Found while fixing 3) Merging could finish extra mastery trees.** `CareerMetrics.masteryTreesCompleted` counted every
   tree, including a merged-away event's tree. Merging a finished event into a new event, and that one into another, gave
   three "finished" trees and so *Specialist* (20,000) and *Polymath* (60,000 XP). Trees of merged-away events are now left
   out of the count, as `/mastery` already hides them. The count never drops on a merge, because the survivor receives every
   step. Test: `xp-exploits › row 7 › merging a finished event into new ones never finishes a second tree` (25 real 10-hour
   editions; after two merges the count is 1 and only `achievement:mastery_first` is in the ledger).

**Mutation checks for the fixes.** Each mutation was applied alone, the two files were run, and the file was restored and
md5-verified. Every mutation failed its test: no blank-name refusal; no copy filter in `reconstructStintUnlocks`; no copy
filter on the dashboard; `storyComplete ||` restored; no credit pass in `deleteRace`; merged trees counted.

**Check results after the review fixes**
- `npm run db:generate` ✔, `./node_modules/.bin/next typegen` ✓, `npx tsc --noEmit` 0 errors, `npx eslint` 0 problems.
- `npx vitest run`: 58 files passed, 1 skipped (perf); **1,056 tests passed**, 19 skipped.
- WP4 targeted (the acceptance command above): 9 files, **172 tests passed**.
- `PERF=1 npx vitest run tests/perf`: **19/19 passed**.

Committed as `8a9e8fa` on `release/v0.4.0` and pushed to origin.
