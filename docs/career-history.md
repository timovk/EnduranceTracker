# Career history: how 0.4.0 works underneath

The README says what the Chronicle, Endurance Wrapped, Event Legacy, Race
Expeditions, Career Statistics and Career Milestones do. This is the other
half, for anyone changing them: the one replay they all read, the rules that
decide what XP follows the data and what stays earned, how a finished year is
kept, how an older career is brought up to date, and every way we could think
of to farm XP out of it, with the test that closes each one.

Everything here is enforced by code and tests, not by convention. Where a rule
has a test, its name is given, so the rule and its proof can be read side by
side.

---

## Where things live

| Module | What it is |
|---|---|
| `src/lib/domain/calendar.ts` | The local calendar: days, weeks, months and years in the computer's time zone, and stint windows split at local midnight. |
| `src/lib/domain/career-timeline.ts` | **The replay.** Pure. Every history figure starts here. |
| `src/lib/domain/edition.ts` | Edition years, edition identity, consecutive runs, event keys and name signatures, edition fingerprints. |
| `src/lib/domain/event-association.ts` | Event suggestions. It suggests; it never links. |
| `src/lib/domain/landmarks.ts` | When a milestone or event step happened, from the replay. |
| `src/lib/domain/window-summary.ts` | One period of a career summed up: the core of the Chronicle, Career Statistics and Compare. |
| `src/lib/domain/records.ts` | Personal records and their progression. |
| `src/lib/domain/expedition.ts` | Expedition eligibility, the checkpoint schedule, live figures, and the Expedition Summary snapshot. |
| `src/lib/domain/chronicle.ts` | The chapter snapshot, `buildChapter` and the Wrapped cards. |
| `src/lib/engines/career-timeline-engine.ts` | The replay's loader (two queries), its fingerprint and its per-account cache. |
| `src/lib/engines/career-milestone-engine.ts` | Career Milestones: writing, paying and dating them. |
| `src/lib/engines/event-legacy-engine.ts` | Events: create, rename, merge, link, unlink, archive, suggestions, the pages. |
| `src/lib/engines/expedition-engine.ts` | `reconcileExpedition`, the mode switch, the summary, the page. |
| `src/lib/engines/chronicle-engine.ts` | Chapters, freezing, rebuilding, Wrapped and its prompt. |
| `src/lib/engines/progression-resync.ts` | The Story Complete bonus reconciled from the replay, and what a race edit re-syncs. |
| `src/lib/engines/stint-unlocks.ts` | What a stint unlocked, rebuilt for a summary opened again later. |
| `src/lib/engines/xp-ledger.ts` | The ledger, including `settleLedger`. |
| `src/lib/server/recompute.ts` | `db:recompute`. |
| `src/lib/server/upgrades/career-backfill.ts` | The one-time history pass that brings an older career up to 0.4.0. |
| `src/lib/server/upgrades/chronicle-freeze.ts` | The start-up pass that freezes finished years. |

Pure modules do no database work. Engines take a transaction client and never
read the clock; only pages, server actions and the start-up upgrades do.

---

## Sources and what is derived

Three things are the truth about a career:

- the stints (`RaceViewingSession`), which are only ever added or deleted;
- the races they belong to;
- the XP ledger (`XPTransaction`).

Everything else is **derived** and can be rebuilt from those three:
`WatchedInterval`, every cached figure on `Race` (including
`creditedViewingSec`), the `RaceMastery` counters, `MasteryProgress.value`,
every statistic, record, chapter still being written, Wrapped card, event
figure, live Expedition figure and suggestion. `db:recompute` rebuilds all of
them.

Nothing new reads a stint's `newCoverageSeconds`, `coverageBeforeSec` or
`coverageAfterSec` for history, because those are a snapshot taken when the
stint was logged and go stale when an earlier stint is deleted. Nothing new
reads `Race.completedAt` either: it is sticky. The stint summary still shows
the snapshot, because it describes that moment.

What is **stored** is what cannot be worked out again, or must not change once
it has happened: a race's Expedition Mode, an event's display name and whether
it was made, archived or merged, the date of every landmark, Expedition
Summaries, frozen chapters and `wrappedSeenAt`, event-step credits, and two
per-account `ConfigOverride` values (`careerBackfill`,
`dismissedEventSuggestions`). The README's *Derived versus persisted* table
lists them.

---

## The replay

`buildCareerTimeline(sessions, races)` in `domain/career-timeline.ts` is one
fold over every stint ever logged. Pages get it through
`getCareerTimeline(userId)`, which caches it (below); write paths build it
themselves from `loadTimelineInputs(tx, userId)`.

### Canonical order

Stints are sorted by `watchedAt`, then `createdAt`, then `id`
(`compareCanonical`). Every replay, and every "which stint crossed it"
question, uses that order, so two stints logged in the same instant always
come out the same way round. `deleteViewingSession`'s interval rebuild uses it
too; merged intervals do not depend on order, so its result is unchanged.

### Coverage

Per race, stints are folded in canonical order with the same `addInterval`
the race page uses, with `limit` set to the race's **current** runtime and the
same 20-second gap tolerance Story Complete uses. So:

- timeline past the runtime is neither coverage nor re-watch (the runtime
  clamp);
- a stint's `addedCoverageSeconds` is what that call added, and the added
  coverage of a race's stints always sums to its final coverage;
- the replay's coverage of a race is the race page's coverage.

A race is **Story Complete** exactly when its replayed coverage passes the
existing `isStoryComplete` test. Its completion instant is the `watchedAt` of
the first stint after which that holds; coverage never shrinks within a
replay, so there is only one. "Races completed" and "Story Completes" are the
same number everywhere in 0.4.0. A race marked `COMPLETED` by hand still counts
where it counted in 0.3.2 (`CareerMetrics.racesCompleted`, collections) and
in no 0.4.0 figure.

**Re-watch** per stint is the credited time of the part of the stint inside
the runtime that added nothing:
`credited × max(0, inRuntime − min(added, inRuntime)) / timelineSeconds`.

### Credited seconds

```
creditedSeconds = max(0, min(realSeconds, round(timelineSeconds / XP_CONFIG.xpMinSpeed)))
```

It is the real time XP credits: at 0.75× or faster, the real time; below
0.75×, the time the stint would have taken at 0.75×. Every hour figure 0.4.0
introduced uses it — milestones, the calendar-year rung, records, the
Chronicle, Career Statistics, Event Legacy, Expeditions — and so do
`CareerMetrics.realHours`, `longestSessionHours`, `averageSessionMinutes`,
mastery's hours (through `Race.creditedViewingSec`) and the race page's "Real
viewing". The viewing budget alone keeps raw real time, because it measures
time actually spent.

Test: `tests/domain/career-timeline.test.ts › credited seconds equal XP-credited real time`.

### The stint instant and its window

A stint's **instant** is its `watchedAt`: when it was logged, which the form
sets to "now", so effectively its end. Facts attached to a stint happen at its
instant: a race started, experienced or completed, a checkpoint crossed, a
session counted, the longest-session record.

Its **nominal window** is `[watchedAt − creditedSeconds, watchedAt]`. Its
**window** is the nominal window cut at the previous stint's instant, in the
career's canonical order:

```
startsAt = max(watchedAt − credited, previous stint's watchedAt)
```

Two stints logged a minute apart therefore never overlap, and every time
interpolated along windows runs forwards in canonical order. A window is
**reliable** when it keeps at least `TIMELINE_SHAPE.reliableWindowShare` (half)
of its nominal length; batch logging, several stints entered one after
another, makes unreliable windows.

Quantities — credited time, new coverage, re-watch — are spread over the
window in proportion to time, split at local midnight
(`splitAcrossLocalDays`). A zero-length window puts everything on the day of
its instant.

The longest window possible is 64 hours: a race is at most 48 hours, a stint
logged by timestamps has no real-time cap, and credited time is capped at the
timeline over 0.75. That number is why a finished year is frozen only after 72
hours (below).

`replayRace(race, sessions)` replays one race on its own, for the Expedition
paths. Its windows are cut at that race's own previous stint, which is enough
there, because the Expedition figures date nothing by interpolation.

### Experienced

A race is **experienced** once its replay has reached both:

- `CAREER_STATS_SHAPE.experiencedMinimumCreditedMinutes` (10) credited
  minutes, **and**
- coverage of `min(ceil(runtime × experiencedCoverageShare), experiencedCoverageEnoughMinutes × 60)`:
  a tenth of the race, or an hour for a race over ten hours.

Its experienced instant is the first stint after which both hold. The same
predicate, `isRaceExperienced({ coverageSec, runtimeSec, creditedSec })`, is
used by the replay, metrics and mastery, so race rows and the replay never
disagree about a race. A race rushed through at 8× can be Story Complete
without being experienced, and a glimpse is started but not experienced.
**Nothing that pays XP counts a race or an edition that was only started.**

### Crossings

`cumulativeCrossing(stints, T, amountOf, within?)` finds when a running total
crossed `T`. For the stint `s` whose amount takes the total from below `T` to
`T` or more:

- when its window is reliable, the instant is interpolated inside the window
  (clipped to `within`, for the calendar-year rung): precision
  **INTERPOLATED**;
- otherwise the instant is the stint's own: precision **STINT**.

Stints that add nothing are skipped. Because windows never overlap, instants
are non-decreasing in canonical order and in `T`.

Counts (the tenth complete story, the hundredth race experienced) take the
stint that reached them, with precision STINT (`nthEvent`). A checkpoint
takes the first stint whose coverage, compared in whole numbers
(`coverageAfterSeconds × 100 ≥ percent × runtimeSec`), reaches it
(`coverageCrossing`).

Tests: `tests/domain/career-timeline.test.ts › interpolates the instant 100 hours was crossed`,
`› two stints logged a minute apart never date a later threshold before an earlier one`,
`› a batch-logged stint’s crossing is STINT, not INTERPOLATED`,
`› milestone instants are monotone in threshold for random logs`.

### The local calendar

Every day, week, month and year is the Node server's local time, through
`domain/calendar.ts` only. The week starts on `User.weekStart` (JavaScript's
`getDay` numbering), and week keys come from `viewingWeek`, so they agree with
the budget. `User.timezone` stays unused. A finished year is frozen, so a
later change of time zone never rewrites it.

An **edition year** is the race date's UTC year (the date is stored as UTC
midnight of the day typed), or the season's year when there is no date. Two
races of one event in one year are one edition; an undated race is an edition
of its own, which counts but cannot join a consecutive run.

---

## Balances and landmarks

The rule is **XP follows the data; landmarks stay earned.**

**Balances** exist exactly when the data says so. When the data stops saying
so, the ledger row is deleted (never written as a negative amount) and the
ledger is settled:

- VIEWING and REWATCH, per stint, and for a deleted race every such row whose
  `sourceRef` is that race;
- STORY_COMPLETE, `story-complete:<raceId>`;
- EXPEDITION, `expedition:<raceId>:<percent>`. Taken back only when coverage
  (a stint or race deleted) or the runtime (an edit) no longer supports it —
  never by the Expedition Mode switch or by a change of configuration.

**Landmarks** are written once and never taken back or paid again:
achievements, `MilestoneProgress` rows (the new Career Milestone rungs among
them), `MasteryProgress` unlocks (event steps among them), trophies and Hall
of Fame entries, Expedition Summaries and frozen chapters.

Test: `tests/integration/session-flow.test.ts › never revokes a landmark, only a balance`.

Every new award is career XP only: `seasonAmount` is left at 0, so nothing
0.4.0 pays reaches the season pass.

### The write-once dates

A landmark's date is written only while its `achievedPrecision` is null, with
`updateMany({ where: { id, userId, achievedPrecision: null } })`. Once set,
nothing moves it: deleting, editing or backdating stints changes statistics,
never a milestone's date. `fillLandmarkDates` (in
`career-milestone-engine.ts`) dates undated rows:

1. It finds undated milestone rows and undated event steps. If there are none,
   it returns before building any replay, which is the usual case per stint.
2. A row whose metric the replay cannot place is marked **RECOGNISED**, with
   no `achievedAt`: "Recorded on" the day it was reached. Those metrics are
   races completed (it counts races marked Completed by hand), championships
   and seasons completed, circuits, countries, career XP and level.
3. For the rest, it asks `milestoneInstant` or `eventStepInstant` for the
   replay's instant, and accepts it only if `acceptInstant` passes: the
   instant is at most `TIMELINE_SHAPE.recognitionSlackMinutes` (5) after the
   app recorded the landmark (`reachedAt` / `unlockedAt`). A replay can place
   a landmark later than it was recorded once stints have been deleted since;
   such a row is marked RECOGNISED instead of being given a date it never had.
4. A RECOGNISED row recorded inside the unlock window of the stint being
   logged is attached to that stint, so its summary still lists it.

The one exception is `db:recompute -- --rebuild-milestone-dates`
(`rebuildLandmarkDates`), a developer repair that re-dates rows whose replayed
instant passes the same test, and reports only the rows it actually moved.

### The recognition threshold

The app recognises an hour rung from a rounded value: `round1(seconds / 3600)`
compared with `value < threshold`. `round1(x) ≥ T` holds from
`x ≥ T − 0.05 h`, which is 180 seconds early. So the replay crosses the same
line the app did: `recognitionThresholdSeconds(metric, T)` is `T × 3600 − 180`
for `realHours`, `timelineHours` and an event's `realHours`, and exactly
`T × 3600` for `realHoursYear:<Y>`, which is compared in whole seconds. A
count metric's threshold is a count. A rung recognised in the last three
minutes of a stint is therefore still dated inside that stint.

Tests: `tests/domain/landmarks.test.ts › recognition and replay agree at every HOUR_STEPS rung`,
`› a rung recognised at 99.96 h gets an INTERPOLATED date inside the stint that recognised it`.

### A stint's unlocks, reopened

`stintUnlockWindow(watchedAt, { previousWatchedAt, nextWatchedAt })` is
`[watchedAt − 5 min, watchedAt + 5 min]`, cut 1 ms inside the neighbouring
stints' instants. `reconstructStintUnlocks` reads what was unlocked inside it,
so a stint summary opened weeks later lists what that stint unlocked and
nothing after it, and two stints logged minutes apart never claim each other's
unlocks. Mastery XP in a reopened summary is read from the ledger, so an
XP-free event step shows 0, as it did live.

---

## One ledger settlement: `settleLedger`

Every transaction that deletes an `XPTransaction` row ends with
`settleLedger(tx, userId, revocations)`, after its last award. It:

- does nothing when nothing was removed;
- otherwise re-stamps every running total (`careerXpAfter`, `levelAfter`) from
  the **earliest** removed row, in `(createdAt, id)` order, and updates the
  profile (`rebuildCareerTotals(tx, userId, { from })`). Everything before
  that row is summed in one aggregate and left alone;
- takes season XP back only when a removed row carried some, and then only
  those rows' own: each pass loses the removed season XP dated inside its
  quarter, boosted by the largest momentum bonus there is (7.5%) and rounded
  up (`takeBackSeasonXp`, `seasonXpToTakeBack`). The pass is never rebuilt
  from the ledger's sum: the ledger holds season XP without the momentum
  bonus a stint added on top, so a rebuild would take that bonus off every
  other stint of the quarter. Taking back the top bonus means a removed stint
  can never leave any of its own bonus behind, so logging a stint and
  deleting it again never gains season XP.

Changed rows are written 400 at a time (`LEDGER_RESTAMP_BATCH`), one
`UPDATE … FROM (VALUES (id, careerXpAfter, levelAfter), …)` statement per
batch, joined by primary key. On the ten-year perf career (180,000 ledger
rows) a full re-stamp takes about a second, which is what keeps deleting a
stint from the first year of a long career inside its transaction.

Because it runs after the last award, invariant **I2** — career XP equals the
sum of the ledger, and every row's running total equals the sum up to it — is
structural rather than something each caller must remember.

`awardXp` stamps a new row on the real clock, but strictly after the account's
latest row when that row is less than a second ahead (`ledgerStamp`): two
awards in the same millisecond would otherwise be ordered by their random ids
rather than by when they were written. A row further ahead (a clock once set
ahead) is not followed: the new row goes on the clock and the totals are
re-stamped from it. **XP is dated when it is paid**, so XP by month and by year
follows the ledger's `createdAt`; an award has no other date.

Tests: `tests/integration/ledger-settle.test.ts` (I2 after every way XP is
taken back, and award stamping), `tests/integration/delete-race.test.ts ›
re-stamps the ledger in batches and keeps I2`.

---

## Event steps: `EventStepCredit`

An event is a `RaceMastery` row with an immutable `key`; its steps are the
nodes of the `RACE_EVENT` tree `event:<key>`, paid with the dedupe key
`mastery:event:<key>:<nodeKey>`. A rename changes only `displayName`, so it
makes no new tree and pays nothing.

The rule: **every race can help pay each kind of event step (each `nodeKey`)
once, in any event.** A race's `EventStepCredit (userId, nodeKey, raceId)` is
written as soon as it contributes to that step being reached, whether the step
paid or was already reached, and whichever event it was in.

| Step metric | Contributors |
|---|---|
| `editionsStoryComplete` | the Story Complete races of the event |
| `editionsExperienced` | the experienced races of the event |
| `consecutiveEditions` | the Story Complete races whose year is in the longest run |
| `realHours` | the races with credited time |

**When credits are written.** `writeMissingEventStepCredits(tx, userId)`
credits every current contributor of every unlocked step, paid or XP-free,
that has no credit yet. It runs:

- at the start of every `syncMastery`, before anything is paid, so an edition
  added after a step unlocked is credited for it on the next sync;
- before every operation that can move a race between events: link, unlink,
  merge, the race form when the event changes, and deleting a race.

The steady state writes nothing (`createManySkippingDuplicates`, with a filter
built from the credits already loaded).

**When a step pays.** When a step newly unlocks, `eventStepPays` measures the
step against the event's races that are **not** credited for that `nodeKey`.
It pays only if they reach the threshold on their own and the step has a
reward; otherwise the step unlocks XP-free (`xpAwarded` 0, no ledger row), and
its contributors are credited either way. "First Edition Experienced" has no
reward at all, so a race put into an event of its own earns nothing for a few
clicks.

**Tombstones.** Before a race is deleted, its credits are given a
`fingerprint`: its edition year, its length rounded to the hour, its circuit
and its name signature (`editionFingerprint`). A race matching a tombstone for
a step — the same year and rounded hours, and the same circuit **or** the same
name — counts as credited for it, so deleting an edition and adding it again
in a new event cannot pay its steps twice. Rounding the hours means a runtime
changed by a few seconds still matches; matching on circuit or name means both
must change to evade it. The one way round it is to edit the race's date or
length first, then delete it; the README lists that under *Known limits*.

**Merging.** A merge writes the missing credits, moves the races, archives the
old event with `mergedIntoId`, and copies every step unlocked in the old tree
and not in the new one across with its dates and **no ledger row**
(`carryOverEventSteps`). The next `syncMastery` finds those steps already
unlocked. The old tree stays (it is a landmark), `/mastery` hides it, and
`/events/<old key>` redirects to the survivor. Lists of "what was unlocked
when" drop the copies through `carriedEventStepCopies`, so a step is shown
once, where it was reached. A merged event cannot be unarchived, and chains
are followed at most `EVENT_SHAPE.maxMergeHops` (10) hops, each scoped to the
account. Trees of merged-away events never count towards
`masteryTreesCompleted`.

The price, which the event page and the README say plainly: a race linked to
the wrong event and then moved to the right one does not pay again the steps
the wrong event had already reached with it.

Invariant **I6**: no `(nodeKey, race)` pair appears in more than one paid
unlock, across all events. `eventStepProblems(userId)` in
`tests/helpers/career-db.ts` checks it after every test that touches events.

---

## Expeditions: `reconcileExpedition`

A race is an Expedition when `expeditionMode` is `true`, or when it is `null`
and the race is **scheduled** for at least `EXPEDITION_SHAPE.autoThresholdHours`
(10). `false` always wins. Checkpoint XP is separate from being an
Expedition: it is paid only on races with at least
`checkpointXpMinimumHours` (6) of runtime. Checkpoints share
`EXPEDITION_CONFIG.checkpointPoolShare` (40%) of the race's ordinary Story
Complete bonus; the README has the table.

`reconcileExpedition(tx, userId, raceId, options)` replays the one race and:

1. revokes every held checkpoint whose own percentage the replayed coverage no
   longer reaches (`coverageReaches`) — the only reason one is ever taken
   back;
2. with `resize` (a runtime edit, or recompute) re-sizes held checkpoints to
   the current schedule, deleting and re-writing them under the same key, or
   only deleting them when the new amount is 0;
3. on a race edit (`edit`), remembers what steps 1 and 2 took off (the
   `ConfigOverride` key `expeditionRevokedByEdit:<raceId>`, with the stint
   that paid each), and gives back what an earlier edit took off — same key,
   same stint, the current schedule's amount — once the coverage reaches it
   again under a runtime that pays, in every mode. A corrected typo in the
   race's length therefore restores exactly what the typo took, even with
   Expedition Mode switched off. Only a checkpoint the race held can come back
   this way, and `deleteRace` forgets the race's list;
4. pays every reached checkpoint that is not held, only when the race is an
   Expedition with checkpoint XP. On the stint path the row names the stint
   that crossed it; a retroactive award (switching the mode on, the upgrade,
   recompute) names no stint, so an old stint's summary never shows XP granted
   weeks later.

The caller settles the ledger. `deleteViewingSession` passes `award: false`,
because nothing new can qualify on that path. A race edit passes `award`
only when the race was an Expedition **before** the edit: an edit that makes
a race an Expedition (a scheduled length typed as ten hours) pays no
checkpoint, so correcting it has nothing to take back, and the landmarks a
save syncs are never reached on the strength of a typo. Its message says what
the next stint (or switching the mode on) will pay (`waiting`).

Invariant **I3**: for every race, the held EXPEDITION rows are a subset of the
checkpoints its replayed coverage reaches under its current runtime, and each
key is held at most once. `expeditionProblems(userId)` in
`tests/helpers/career-db.ts` checks it.

**The switch never revokes.** Switching Expedition Mode off is a preference,
not a change to the data: it stops new checkpoints paying and does nothing
else. Switching it on again pays only what is not already held, and the dedupe
keys make on/off/on pay nothing twice. Checkpoint XP comes back off only when
the viewing or the race behind it is deleted, or the runtime changes so that
the coverage no longer reaches it; correcting that runtime gives it back,
whatever the mode.

**The summary.** An Expedition Summary is written when an Expedition is Story
Complete by replay and has none: by the completing stint (live), or by the
next stint, the mode switch, the upgrade or recompute (retrospective). A race
edit **never** writes one, and after a runtime change the landmark syncs wait
for the next stint, so a mistyped runtime corrected a minute later leaves
nothing permanent behind. A summary is never rewritten, and survives the
race's deletion (`raceId` is set to null).

---

## The Chronicle: freezing

A chapter is one local calendar year. The year in progress, and a finished
year inside its grace period, are built live whenever they are shown. A
finished year is **frozen** — written to `ChronicleYear` once and read from
there ever after — by `ensureChroniclesFrozen(userId, now)` when all of these
hold:

- the account's 0.4.0 backfill is complete (`isCareerBackfillApplied`), so no
  chapter is frozen before its landmarks are dated and its summaries written;
- `now ≥ freezeDueAt(Y)`: local midnight on 1 January of the next year, plus
  `CHRONICLE_SHAPE.freezeGraceHours` (72);
- the year had activity: a stint logged in it, or time the first stint logged
  after it reaches back into it;
- it has no row yet. The write is `upsert … update: {}`, so a second writer
  changes nothing and raises nothing.

**Why 72 hours.** A stint reaches back from when it was logged. A stint watched
from 22:30 on 31 December to 00:30, logged at 00:31, puts an hour and a half
into the old year. Frozen at midnight, the action logging that stint would
freeze the year first, and the time would be missing from the chapter for
ever. The longest window possible is 64 hours, so after 72 nothing the app can
do adds time to a finished year. Until then the year reads *Complete —
finalising until 4 January*. A stint backdated through the engine (the seed,
tests) into a frozen year leaves the chapter as it was, by design.

It runs at start-up (`freezeAllChronicles`, in what is left of the 30-second
budget), from every Chronicle page and `pendingWrapped`, and before the write
of every action that changes what a chapter would say: logging or deleting a
stint; adding, editing, deleting or changing the status of a race; adding a
championship or saving a season; changing the week start; every event action;
the mode switch; rebuilding a chapter and hiding the Wrapped prompt. The last phase of the backfill freezes an upgraded account's
finished years.

**Career Year 1** is the local year of the first stint, or of the earliest
frozen chapter if that year's stints have since been deleted: a frozen year
stays in the Chronicle, with its number, whatever happens to the history after
it.

**Rebuilding** is the only way a frozen chapter changes, and only on request:
the chapter's *Rebuild this chapter from today's history…* dialog
(`rebuildChronicleYearAction`) or `db:recompute -- --rebuild-chronicle <year>`.
It keeps `frozenAt` and `wrappedSeenAt` and sets `rebuiltAt`.

**Wrapped** is built from a chapter by `buildWrappedCards`, in a fixed order,
leaving out any card with nothing true to say. Reaching the last card of a
frozen year's Wrapped, or *Hide* on its prompt, sets `wrappedSeenAt`. The
preview of a year still being written writes nothing.

---

## The snapshot schemas

Both snapshots are zod schemas with `type X = z.infer<typeof schema>` (a type
alias, not an interface, so it is a Prisma `Json` value as it stands), and
both carry a `schemaVersion`.

**`ChronicleChapterV1`** (`chronicleChapterSchema`, `domain/chronicle.ts`),
`schemaVersion: 1`:

- `year`, `complete`, `generatedAt`, `timeZone`, `weekStartsOn`, and `window`
  (`start`, `end`, `activeFrom`: the first stint instant in the year);
- `beginnings` (only in the career's first year): the first stint, the first
  complete story and the first event edition experienced;
- `summary`: credited, new and re-watched time, sessions, active days, races
  experienced and started, Story Completes, championships and events watched,
  completion, XP earned, levels, achievements, milestones, mastery steps and
  their XP, Expeditions completed;
- `viewing`: the longest race (with its coverage at the year's end), the
  longest session, the average session, the most active day, week and month,
  and seconds by weekday;
- `monthly`: always twelve rows;
- `championships`, `events` and `circuits`, in full;
- `storyComplete`: count, by length and by championship, average stints and
  days to complete, the rate, and the full list;
- `mastery` steps, `achievements`, `milestones` (career, ladder and event
  legacy), `records`, `notableRaces`, `expeditions`, `progression` (XP by
  source, levels and titles reached) and `previousYear`.

Dates are ISO strings. Names are captured when the chapter is frozen; ids are
kept for links, which are shown only while the race is still in the library.
What depends on today is not frozen but worked out when the chapter is shown:
the Career Year number, which records have been beaten since, and the summary
cards of the year's Expeditions, read from their own immutable rows.
`upgradeChapterSnapshot(raw)` reads a stored snapshot; anything it cannot read
throws, and the page says the chapter was saved by a newer version. A future
version adds its upgrade branch there.

**`ExpeditionSummarySnapshotV1`** (`expeditionSummarySnapshotSchema`,
`domain/expedition.ts`), `schemaVersion: 1`: the race as it was (name,
championship, event, edition year, circuit, runtime), `startedAt`,
`completedAt`, the completing stint, credited, unique and re-watched time,
sessions, calendar days and elapsed time from start to finish, average and
longest session, the final completion text, XP by source (viewing, re-watch,
Story Complete, checkpoints) summed from the ledger, the checkpoints with
their dates, the mastery, milestones and achievements of the completing stint,
the records set, and `unlocks: 'live' | 'reconstructed'`. A retrospective
summary has no championship mastery percentage, because today's figure is not
a fact about then. `parseExpeditionSummarySnapshot` returns null for anything
it cannot read.

---

## The upgrade: `career-backfill.ts`

The first time 0.4.0 starts on a career from an earlier version, `register()`
in `src/instrumentation.ts` runs the career backfill before the server answers
any request.

### The marker

Progress is a per-account `ConfigOverride`, key `careerBackfill`:

```ts
{ version: '0.4.0', done: PhaseKey[], cursors: { P1?: string; P4?: string }, lastRunAt: string | null }
```

It is compared **by value**: an account is complete when the version matches
and every phase this build knows is in `done`, so an account completed by an
earlier build runs only the phases added since. A new account is pre-marked
complete by `createAccount` (it has nothing to backfill), and so is every
account `db:recompute` rebuilds.

### Phases and chunks

| Phase | What it does | Chunks |
|---|---|---|
| P1 races | Credited time written where it differs. A race whose stored intervals run past a runtime shortened under 0.3.x has its intervals rebuilt and its aggregates recomputed **with its status kept**. The Story Complete bonus is made to exist exactly when the replay says the race is complete; one a 0.3.x runtime edit skipped is paid, career XP only. Settled per chunk. | 500 races, in id order |
| P2 events | The event trees brought up to date (the nine new steps inserted, six renamed), the event caches recomputed, then `syncMastery`: every step an event had reached is credited first, then the new steps it had passed are paid once. | one |
| P3 milestones | The achievements and ladders synced, the new rungs a career had passed written and paid once — all of them again until nothing new is reached (`syncLandmarks`) — and every undated milestone and event step dated from the replay. | one |
| P4 expeditions | Every Expedition gets the checkpoints its replayed coverage had reached (paid now, naming no stint), and a completed one its retrospective summary. The last chunk runs `syncLandmarks` again, because the checkpoints' XP can cross a Career XP or level rung or a level achievement. | 25 Expedition races, in id order |
| P5 chronicle | Every finished year that is due is frozen, oldest first. The account is complete when none is left. | one year |

Order matters: P2 reads P1's credited time, P3 dates what P2 unlocks, and P4
and P5 need P1's coverage and P3's dates.

`syncLandmarks` repeats its round — metrics read afresh, then achievements,
ladders and Career Milestones — until a round reaches nothing, because what
one round pays can reach more: the first-million rung's own XP can take a
career up a level, and so past a level rung and a level achievement. What it
reaches is recorded at the upgrade's `now`; an XP or level rung has no
moment in history, so it is RECOGNISED and names no stint. Without the second
sync, a rung the upgrade's own XP crossed would wait for the first stint after
the update, which would claim it and list it in its summary, and a forced
second run would pay it.

Each chunk is its own transaction (`maxWait` 15 s, `timeout` 60 s), and **the
same transaction** records the chunk in the marker: the cursor (the last race
id finished) or the phase added to `done`. Work and progress commit together,
so a start cut short loses nothing, and every chunk is idempotent — values are
written only when they differ, awards are guarded by dedupe keys, dates only
while none is set — so a chunk repeated after a crash, or a forced second run,
changes nothing.

What each run needs for a whole account — the replay, the record progression,
the loaded history — is built **once per account**, outside the chunks. At
start-up that is safe, because nothing else writes until `register()` has
finished.

### The budget

`STARTUP_BUDGET_MS` is 30 seconds, measured from the start of `register()`,
and shared by the backfill and the freeze pass through one
`deadlineClock`. Before **every** chunk the clock is asked whether one more
fits, using the longest chunk the run has seen (at least one second) as the
estimate. If it does not, the account stops with `pausedBefore` set and the
next start carries on from the recorded phase and cursor. A chunk that has
started always finishes. Accounts run least recently served first (never-run
first, then by `lastRunAt`), so one large career cannot starve another, and
each account is guarded on its own: a failure is logged, the account keeps its
progress, and it is tried again on the next start.

**While an account is part-way through**, the app is fully usable and nothing
can be paid twice. A stint does for its own race everything the backfill
would: it credits unlocked event steps before paying, dates any undated
landmark, reconciles its race's checkpoints and writes its race's missing
summary. Event actions write credits before moving a race. And no chapter is
frozen until the account is complete, so a finished year reads *finalising*
until P5.

### What it leaves alone

Viewing XP whose stint was deleted under 0.3.x, and Story Complete bonuses of
races deleted under 0.3.x, are counted and logged once the account completes,
never removed: `db:recompute` removes them (`repairXpLedger`). The upgrade
never modifies a stint.

### Log lines

```
[career-backfill] Alex (<id>): credited 12 races, 0 legacy races repaired, story bonuses +0/−0; 3 event steps (+800 XP), 41 credits; 2 new milestones (+1,500 XP), 0 achievements (+0 XP), 14 dates filled, 3 recorded only; 2 expedition checkpoints (+300 XP), 1 summary; 0 chapters frozen
[career-backfill] Alex (<id>): …; paused before P4 (after race <id>); continues on the next start
[career-backfill] Alex (<id>): 2 viewing XP rows whose stint was deleted and 0 Story Complete bonuses of races deleted before 0.4.0 were left as they were (db:recompute removes them)
[career-backfill] Alex (<id>): failed, will retry on the next start
[chronicle] Alex (<id>): froze the 2026 chapter
```

---

## `db:recompute`

`recomputeCareer(userId, options)` in `src/lib/server/recompute.ts` uses the
same phase bodies as the backfill, with a clock that never says stop:

1. races, in chunks: intervals rebuilt, aggregates recomputed, the Story
   Complete bonus reconciled; settled per chunk;
2. `repairXpLedger`: viewing XP whose stint is gone, Story Complete bonuses
   whose race is gone or no longer complete, and checkpoints of races that are
   gone are removed;
3. one transaction for mastery (credits first), collections, metrics,
   achievements, ladders, Career Milestones and any missing dates (all of
   them again with `--rebuild-milestone-dates`, as above);
4. Expeditions, in chunks, with `resize`: the one repair that re-sizes a held
   checkpoint to the current schedule; then `syncLandmarks` in one more
   transaction, for whatever the XP paid since step 3 reaches;
5. the account marked as upgraded, and finished years frozen;
6. with `--rebuild-chronicle <year>`, that frozen year rebuilt.

Running it twice changes nothing. It never pays a landmark twice, never
rewrites an Expedition Summary, and never rewrites a frozen chapter or a
milestone's date unless asked.

---

## The replay cache

`getCareerTimeline(userId)` keeps the replay in memory, on `globalThis` (Next
compiles server actions and server components into separate layers, and a
module-level map could exist once in each), as an LRU of
`CAREER_STATS_SHAPE.timelineCacheEntries` (4) accounts, with in-flight builds
shared so concurrent misses for one account build once.

It is keyed by a **fingerprint** of the account's data: four aggregates, every
one `where: { userId }`:

- stints: count, newest `createdAt`, and the sums of `realSeconds`,
  `timelineSeconds` and `startTimestampSec` (stints are only added and
  deleted, so these catch every change);
- races, events (`RaceMastery`) and championships: count and newest
  `updatedAt` (every edit bumps it, `updateMany` included).

A season's year feeds the edition year but is not watched: it is part of the
season's identity, never edited in place, and moving a race to another season
updates the race. A hit costs the four aggregates; a miss, the two loads and
the replay. Every action clears the account's entry after it commits, but
correctness never depends on that: any change to the history changes the
fingerprint.

**Never call `getCareerTimeline` inside a transaction.** It cannot see the
transaction's writes, and its race load waits for the open transaction to
finish. Inside a transaction, replay `loadTimelineInputs(tx, userId)`.

---

## Invariants and the exploit table

Asserted after every scenario of `tests/integration/xp-exploits.test.ts`:

- **I1** Every `dedupeKey` occurs at most once per account (a unique index).
- **I2** Career XP equals the sum of the ledger, and every running total is
  right in `(createdAt, id)` order (`ledgerProblems`).
- **I3** Held EXPEDITION rows ⊆ the checkpoints each race's replayed coverage
  reaches (`expeditionProblems`).
- **I4** Every new XP row has `seasonAmount = 0`.
- **I5** Landmark rows never decrease, and their dates never change.
- **I6** No race has helped pay an event step twice (`eventStepProblems`).

Every test named below is in `tests/integration/xp-exploits.test.ts` unless
another file is given.

| # | Attack | Defence | Tests |
|---|---|---|---|
| 1 | Re-watch a watched stretch again and again | Replayed coverage is unique: a re-watch adds none, so it reaches no checkpoint, story or edition. Re-watch viewing XP is a quarter, as before. | `rewatch never crosses a checkpoint or completes a story`; `tests/domain/career-timeline.test.ts › re-watching adds re-watch time and no coverage` |
| 2 | Log 0.1× to inflate hours, or 8× to rush coverage | Credited seconds cap at the timeline over 0.75 for every hour figure. At 8×, checkpoints earn at most about 22 XP per real minute, below viewing's 30. | `a 0.1× stint cannot reach 100 career hours earlier than 0.75× would`; `slow playback cannot set the longest-session record`; `tests/domain/economy-balance.test.ts › checkpoints never out-earn viewing time per real minute, even at 8×`; `tests/domain/career-timeline.test.ts › credited seconds equal XP-credited real time` |
| 3 | Cross a checkpoint, delete back, cross it again | Deleting reconciles and frees the key; crossing again pays once. At most one row per key. | `crossing 50% three times holds each checkpoint once` |
| 4 | Edit a stint by deleting and logging it again | Viewing XP follows the stint; the bonus and checkpoints follow coverage; landmark dates do not move. | `delete and re-log a stint: totals equal a single log, milestone dates unchanged` |
| 5 | Delete and re-create a stint | As 4. Keys are by race, percentage or metric, never by stint. | `re-creating the completing stint does not pay Story Complete or checkpoints twice` |
| 6 | Delete and re-create a race | `deleteRace` takes back viewing and re-watch XP (by stint and by `sourceRef`), the Story Complete bonus and checkpoints, then settles. Landmarks stay and are not paid again; tombstones stop the edition paying event steps again in a new event. | `deleting a race takes back viewing, re-watch, Story Complete and expedition XP`; `re-creating it re-earns its viewing once and no landmark twice`; `a re-created edition cannot pay a step again through a new event, even with a runtime a few seconds different`; `a step reached before the upgrade credited it cannot be paid again by deleting the race and adding it to a new event`; `tests/integration/delete-race.test.ts › also takes back viewing XP whose stint was deleted under 0.3.x` |
| 7 | Re-key, rename, merge or move editions between events | Keys are immutable; the race form picks from existing events and a name in another case finds the same event; a duplicate name is refused. Credits are written on every sync and before every move. A merge carries steps over without XP; merged events cannot be unarchived; merged trees never count as finished. | `renaming an event creates no tree and pays nothing`; `typing an event name in another case reuses the event`; `creating an event with an existing name is refused`; `merging carries steps over with their dates and pays nothing`; `moving every edition to a fresh event pays none of its steps again`; `moving later editions of an event into a fresh event pays none of the steps the original event had unlocked`; `moving an edition before the upgrade has credited its steps pays none of them again`; `merging a finished event into new ones never finishes a second tree`; `a merged event cannot be unarchived` |
| 8 | Toggle Expedition Mode on, off, on | Off never takes back; on pays only what is not held; the summary is written once. | `toggling Expedition Mode never holds a checkpoint twice`; `switching Expedition Mode off keeps held checkpoints, and switching it on pays only what is new`; `the summary survives the mode being switched off` |
| 9 | Lower thresholds, or change the runtime | No XP threshold is editable in the app. The year rung reads `BUDGET_CONFIG.annualHours`, not the editable budget, and its key holds no number. A runtime edit re-sizes held checkpoints and takes back those no longer reached. | `lowering this year’s budget hours does not create a full-year milestone`; `changing the runtime re-sizes held checkpoints and revokes those no longer reached` |
| 10 | Recompute | Every step is idempotent. | `tests/integration/recompute.test.ts › running recompute twice changes nothing` |
| 11 | Run the migration or the backfill again, or cut a start short | The migration runner records what it applied. The backfill records progress with each chunk; a forced second run pays nothing. | `tests/integration/career-backfill.test.ts › a forced second backfill changes no ledger row`; `› with a tiny deadline it makes progress on every start, completes after N starts, and ends with the same ledger as one uninterrupted run`; `tests/desktop/migrate-040.test.ts › is a no-op the second time` |
| 12 | Restart | Complete accounts are skipped; frozen years are skipped. | `tests/integration/instrumentation.test.ts › a second start changes nothing` |
| 13 | Backdate stints through the engine | Canonical order places them. They can create new landmarks with historical dates, never move existing ones, and never change a frozen chapter. | `a backdated stint dates a new milestone historically`; `a backdated stint never moves an existing milestone`; `a backdated stint into a frozen year leaves that chapter untouched` |
| 14 | Date a stint in the future | Refused beyond `now` plus 5 minutes. | `a stint dated tomorrow is refused`; `a stint 2 minutes ahead (clock skew) is accepted` |
| 15 | Tiny races | Checkpoint XP needs 6 hours of runtime; experienced needs 10 credited minutes and a tenth (or an hour) of coverage. | `a 5-hour race switched on earns no checkpoint XP`; `a hundred 1-minute races with 1-second stints reach no races-experienced rung`; `tests/domain/expedition.test.ts › a race scheduled for 10h is automatic and 9h59m is not` |
| 16 | Mark a race Completed by hand | Counts in no 0.4.0 figure or new rung. | `marking a race Completed by hand changes no Chronicle, statistic, record or new milestone` |
| 17 | Shorten a race to fake completion | The replay and the aggregates clamp to the runtime, a runtime edit rebuilds the intervals, and the upgrade repairs 0.3.x races. | `a 0.3.2-shaped race with intervals past a shortened runtime keeps I2 and I3 after the backfill and after one more stint`; `tests/integration/session-flow.test.ts › shortening a race does not complete it from coverage past the new end` |
| 18 | Throw-away races and one-race events | Counted races and editions must be experienced; "First Edition Experienced" pays nothing. What is left is small and proportional to the viewing logged. | `a dummy race in its own event pays no event step`; `complete editions rushed through at 8× are not experienced editions`; `each race can help pay an event step once across events`; `a hundred 1-minute races with 1-second stints reach no races-experienced rung` |
| 19 | Stitch 1-second stints 20 seconds apart | Inherited from Story Complete's gap tolerance; about 4,000 hand-entered stints for a 24-hour race, so documented rather than changed. | `tests/domain/career-timeline.test.ts › replay coverage equals the race page coverage for bridged gaps` |
| 20 | Reach another account's events, races, years or summaries | Every lookup is scoped by `userId`, fingerprints and merge hops included; caches are per account. | `tests/auth/account-isolation.test.ts` (the event, Expedition, Chronicle, replay-cache and fingerprint cases, and `two accounts that follow the same events and were active in the same year`, where both accounts hold the same event keys, the same year and stints a minute apart, so an unscoped lookup would show or move the other account's data) |
| 21 | A runtime typo that briefly completes a race | Balances follow the edit and follow it back; landmarks and summaries wait for the next stint after a runtime change. Checkpoints an edit took off come back when it is corrected, in every mode; an edit that makes a race an Expedition pays no checkpoint. The one thing a correction does not give back is the season XP of a Story Complete bonus it took off: paid again by an edit, the bonus is career XP only (R3). | `a mistyped runtime that is corrected leaves no summary and no landmark, and the real completion writes the summary`; `with Expedition Mode switched off, correcting the runtime gives back the checkpoints the typo took`; `a length typed short and corrected gives an Expedition back its checkpoints, even through a runtime too short to pay`; `a runtime typo that briefly makes a race an Expedition pays nothing, so correcting it leaves nothing behind`; `a scheduled-length typo that briefly makes a race an Expedition pays nothing, and reaches no landmark`; `checkpoints earned with the mode switched on survive automatic, a rename and a length typo`; `with the season open, a corrected typo keeps the momentum bonus on every other stint of the quarter` |
| 22 | Re-balance the checkpoints in configuration | Amounts paid are never re-sized except by a runtime edit or recompute; I3 is about coverage, not amounts. | `a checkpoint paid under an older schedule keeps its amount on the stint path and the switch`; `a checkpoint the configuration no longer lists stays held while the coverage reaches it`; `tests/domain/expedition.test.ts › checkpoint keys contain no amount`; `tests/integration/recompute.test.ts › recompute re-sizes checkpoints to the current schedule once` |

Unchanged from before 0.4.0, and outside these systems: moving races to a
newly created championship can pay that championship's mastery nodes again.
The README names it under *Known limits*.

---

## Performance

`PERF=1 npx vitest run tests/perf` builds a synthetic ten-year career — 5,000
races, 60,000 stints, 180,000 ledger rows — and holds every path above to its
target: the replay, logging and deleting stints and races, event actions, the
mode switch, every backfill phase chunk by chunk, and the Chronicle, Events,
Expedition and Career Statistics pages. It takes a few minutes and is not part
of `npm test`. A real career (a few thousand stints) is timed alongside it.
