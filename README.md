# Endurance Racing Career Mode

A permanent career record for watching endurance racing, as a Windows
application.

It turns a personal viewing history — WEC, IMSA, ELMS, Asian Le Mans, GT World
Challenge, the 24H Series, or any championship you invent — into something
tangible: a six-hour race becomes a completed story, a season becomes a
collection, a 24-hour race becomes an expedition, and a year of watching
becomes a chapter of a career that never resets.

Two ideas hold the whole thing together.

**Experience the complete story.** The application is not interested in
highlights. Coverage is tracked as a set of watched intervals over the race
timeline, so skipping twenty minutes in the middle is visible, and *stays*
visible until you go back for it. Reaching the end of a race is not the same as
having watched it.

**Completion without obligation.** Nothing here can reduce your XP, your level,
your statistics or your collections — only deleting or correcting the viewing,
or the race, that earned them does, because the record follows what you
actually watched. Challenges expire without penalty, streaks freeze rather
than break, the annual viewing plan will never tell you not to watch
something, and a backlog is described as a library of future experiences
rather than as debt. After a fortnight away, the application says *"Welcome
back. Ready for another stint?"* and nothing else.

---

## Installing it

1. Open the **[Releases](../../releases)** page and download
   **`Endurance Racing Career Setup <version>.exe`**.
2. Run it. It installs for you alone, so there is no administrator prompt, and
   you can choose where it goes. You get a Start-menu entry and a desktop
   shortcut called *Endurance Racing Career*.
3. Open it and make yourself an account. That is the whole setup.

Windows will probably show a blue *"Windows protected your PC"* box the first
time, because the installer is not code-signed — a certificate costs a few
hundred pounds a year and this is a personal project. Choose **More info** and
then **Run anyway** if you are willing to; if you are not, that is an entirely
reasonable place to stop.

There is also a **portable** build on the same page —
`Endurance Racing Career <version> portable.exe` — which runs without
installing anything. It keeps your career in the same place the installed
version does.

Nothing about the application uses the internet. There is no account server, no
sync, no telemetry, no update check. It works on a machine that has never been
online.

[docs/install.md](docs/install.md) is the longer version of all of this —
backups, moving a career to another PC, and what to do when something does not
work.

### Updating

Download the newer `Endurance Racing Career Setup <version>.exe` and run it over
the top of the one you have. Your career is kept: it lives outside the program
folder, and the installer never touches it.

The first time a new version opens it does three things for you:

- saves a copy of your career to `backups\pre-update-<version>-<date>.db`
  before it changes anything (the last five are kept);
- shows what changed, once;
- puts its version in the title bar and at the bottom of the sidebar, which
  opens the full [update log](CHANGELOG.md).

Before the window opens it also brings the database up to date. Migrations
only ever add to it, and each runs in one transaction. Updating to 0.4.0 adds
three tables and a few columns, and then, once, reads your viewing history to
fill in what 0.4.0 knows about it: the dates of the milestones you had already
reached, your event histories, the checkpoints of your Expeditions and the
chapters of years already finished ([How historical backfilling
works](#how-historical-backfilling-works)). On an ordinary career that takes a
second or two.

Going back to 0.3.2 means restoring the copy 0.4.0 saved,
`backups\pre-update-0.4.0-<date>.db`, as `data\endurance.db`, with the
application closed and any `-wal` and `-shm` files beside it deleted. A career
0.4.0 has written to may not open in 0.3.2, because an Expedition checkpoint is
a kind of XP 0.3.2 does not know. Restoring an older backup into 0.4.0 is
always safe: it is upgraded again the next time it opens.

### Your career, and where it lives

```
%APPDATA%\Endurance Racing Career\
  data\endurance.db        your entire career, in one file
  logs\main.log            what the application did on start-up
  backups\                 where "Back up career…" suggests saving, and
                           where each update keeps its copy
  last-version.json        the last version that started — how an update
                           is recognised
```

Uninstalling deliberately does **not** delete that folder. Reinstall later and
your history is still there.

**Career → Back up career…** writes a copy wherever you like, safely, while the
application is running. Copying `endurance.db` by hand while the application is
open is not safe; use the menu, or close the application first.

### More than one person, one PC

The application opens on an account picker. Each account is a separate career —
separate races, hours, XP, achievements, collections and statistics — and
nothing is shared between them.

An account can have a password, and it is worth being plain about what that
password is for: it stops a housemate opening your career by clicking on it. It
is not disk encryption. Anyone who can read the database file can read what is
in it, password or no password. There is also no way to recover a password you
have forgotten — no email, no reset, nothing to phone home to — so if you set
one, set one you will remember.

Accounts, passwords and everything else live on this machine only.

### If the Releases page is empty

The Windows `.exe` is built by GitHub Actions, on a `windows-latest` runner —
there is no Windows machine in this project's development environment, so
nobody can produce one by hand. To produce one:

- **Actions → Windows desktop build → Run workflow**, which attaches the
  installer and the portable build to that run as artefacts; or
- push a tag that starts with `v` (`git tag v0.1.0 && git push origin v0.1.0`),
  which does the same and also attaches them to a GitHub Release.

The workflow is `.github/workflows/desktop-windows.yml`. Its steps, and why
they have to run in that order, are in [docs/releasing.md](docs/releasing.md).

### What has actually been tested

Worth saying out loud, because "it builds" and "it works" are different claims:

- The desktop shell — splash, migrations, server supervision, window, menu,
  backup — has been built and run end to end on Linux.
- The whole application has been **packaged with electron-builder and the
  packaged binary driven through the real flows**: first run, creating an
  account, adding a race, logging a stint and being paid the XP for it,
  signing out, creating a second password-protected account, confirming it
  cannot see the first account's races, a wrong password, a right one, and a
  clean quit with no server process left behind. That is the Linux package of
  exactly the code the Windows job builds.
- The same packaged binary has been through a **simulated update**: started
  once, then made to look like a copy of 0.2.0 and started again, to check that
  it takes exactly one copy of the career before touching it and shows what
  changed exactly once.
- The upgrade to 0.4.0 is tested against a career database written by the
  real 0.3.2 code (`tests/fixtures/career-0.3.2.db`): migrated, read by the
  one-time history pass, and checked row by row — every stint, interval and
  race status exactly as 0.3.2 left it, every milestone dated, nothing paid
  twice, and a second start changing nothing. `tests/e2e/desktop.mjs` ends
  with a simulated upgrade of the same fixture in the packaged application
  (history pass complete, every milestone dated, 2025 frozen once, no pause or
  failure in the log), but that has not yet been run on a 0.4.0 package.
- The Windows installer is produced by the CI workflow above. The 0.2.0
  installer has been installed and used on Windows. Installing a newer version
  over an existing one has so far only been simulated on the Linux package,
  not done on Windows; [docs/releasing.md](docs/releasing.md) lists what to
  check.
- Nothing here is code-signed, so Windows will show a "Windows protected your
  PC" warning on first run. It looks like a virus warning and is not one:
  choose **More info → Run anyway**.

---

## Running it from the source

You do not need any of this to use the application. It is here for working on
it.

```bash
npm install                       # also generates the database client
cp .env.example .env              # the default value works as-is
npm run db:deploy                 # create the database
npm run dev                       # http://localhost:3000
```

The first page you land on asks you to create an account, exactly as the
desktop application does.

If you would rather see the systems with data in them, `npm run db:seed:demo`
adds a separate *Demo Driver* account with a demonstration career in it —
eleven races, real coverage, a populated ledger. Add `-- --account "Your Name"`
to put that career in an account you have already made instead, and
`npm run db:unseed:demo` takes it away again.

On Windows, **`start.bat`** does the same thing by double-click: it checks for
Node, installs on first run, applies migrations and starts the development
server in your browser. It is a fallback for working on the project without a
terminal, not the way to use the application — the installer is.

### The desktop shell, from a checkout

```bash
npm run desktop:build             # compile desktop/ -> desktop/out
npm run desktop:dev               # Electron around `next dev`
```

`desktop:dev` uses the repository's own `endurance.db`, so it shows the same
career `npm run dev` does. `npm run desktop:start` instead runs the built
standalone server exactly as an installed copy does, down to running it under
Electron rather than Node — so it needs the §1.2 build order first:

```bash
npm run desktop:rebuild     # better-sqlite3 for Electron's ABI
npm run desktop:prepare     # next build + prepare-standalone
npm run desktop:start
npm rebuild better-sqlite3  # ...and back to Node's ABI for `npm test`
```

On Linux the application needs a display; in a container,
`xvfb-run -a npm run desktop:dev`.

One trap worth knowing before you hit it: `better-sqlite3` is a native module,
and Electron and Node need it compiled differently. `npm run desktop:rebuild`
builds it for Electron and stops `npm test` working; `npm rebuild
better-sqlite3` puts it back. See [docs/releasing.md](docs/releasing.md).

### The other commands

```bash
npm test                          # the full suite
npm run test:coverage             # with coverage
npm run typecheck                 # tsc --noEmit
npm run lint
npm run db:studio                 # browse the database
npm run db:recompute              # rebuild every derived figure from source
```

`db:recompute` is the safety net. Cached counters, career XP, mastery,
achievements and collections are all *derived*; this rebuilds them from the
watched intervals, the session log and the XP ledger. It is also how a
re-balanced economy is applied to an existing career. With no arguments it
rebuilds every account on the machine; `npm run db:recompute -- Alex` rebuilds
one, by name or id.

Since 0.4.0 it rebuilds, in order:

1. every race from its stints: its watched intervals, its cached figures
   (credited time included) and whether it holds its Story Complete bonus;
2. the ledger: awards whose stint or race is gone are removed — including
   Expedition checkpoints of races no longer in the library — and every
   running total is re-stamped;
3. mastery (writing the event-step credits first), collections, achievements,
   the lifetime ladders and Career Milestones, and the date of any milestone
   or event step that has none yet;
4. every Expedition: checkpoints the coverage no longer reaches are taken back,
   checkpoints are re-sized to the race's current length, missing ones are
   paid and missing summaries written;
5. the account is marked as upgraded, and any finished year that is due is
   frozen into its Chronicle chapter.

Running it twice changes nothing. It never pays a landmark twice, never
rewrites an Expedition Summary, and never rewrites a frozen chapter or a
milestone's date unless it is asked to:

```bash
npm run db:recompute -- --rebuild-chronicle 2026     # rebuild the frozen 2026 chapter from
                                                     # today's history (repeat for more years)
npm run db:recompute -- --rebuild-milestone-dates    # date every milestone again from the
                                                     # history, where the history can place it
```

Both are for repairs. The first does what a chapter's own **Rebuild this
chapter from today's history…** button does; the second is the one exception to
"a milestone keeps its date", and moves a date only where the history can place
it, never to more than five minutes after the application recorded the
milestone.

---

## How the tracking works

### Real time versus timeline time

These are different quantities and the application never conflates them.

A six-hour race watched at 1.5× costs **four real hours**. Four hours come out
of the viewing budget; six hours of race timeline are recorded. Both are stored,
along with the playback speed and the resulting coverage.

### Watched intervals

Coverage is a set of merged half-open intervals over the race timeline:

```
00:00:00–01:43:17   watched
01:43:17–03:02:44   not watched
03:02:44–06:00:00   watched
```

That race is 76% complete, not 100%, even though the furthest point reached is
the chequered flag. `WatchedInterval` rows hold the canonical merged set;
`RaceViewingSession` rows are an append-only log of what you actually did and
are never rewritten. Deleting a session rebuilds coverage from the sessions that
remain rather than subtracting an interval — merged intervals cannot be soundly
subtracted.

### Story Complete

Unlocks when the timeline is covered to `STORY_CONFIG.coverageRatio` (99.5%)
*and* no more than `maxUncoveredSeconds` (120s) is missing in total. The second
condition is the important one: 99.6% of a 24-hour race still leaves nearly six
minutes unseen, and the ratio alone would let that pass.

### Not double-counting

Watch 00:00–01:00, then re-watch 00:30–01:00. Real viewing time is 1h30m;
unique coverage is 1h. This distinction applies consistently to statistics,
completion and XP — re-watched timeline pays
`XP_CONFIG.rewatchXpMultiplier` (25%), which is what stops logging the same
interval repeatedly from being a strategy.

Playback speed cannot be used to farm XP either. XP follows real time, so faster
playback earns less; the inverse exploit is bounded by `xpMinSpeed`.

---

## Your career, year by year (0.4.0)

0.4.0 adds five ways to look back: a **Chronicle** with a chapter for every
year and an **Endurance Wrapped** to click through, a page for every
**recurring event**, **Race Expeditions** for long races, **Career
Statistics** with personal records, and **Career Milestones** that keep the
date they happened. They are one system rather than five. Every figure in them
comes from the same replay of your stints, in the order they were logged, so
the Chronicle, the statistics, an event's page and a milestone never disagree
about the same hour.

A few words are used the same way everywhere:

- **Credited time** is real viewing time counted the way XP counts it. At
  0.75× or faster it is exactly the real time; below 0.75× a stint counts as if
  it had been watched at 0.75×, so a stint logged at a crawl cannot add more
  hours than it could earn. Every hour figure in 0.4.0 uses it, and so does the
  race page's "Real viewing". The Viewing Budget alone keeps raw real time,
  because it measures time actually spent.
- A race is **started** once it has a stint. It is **experienced** once it has
  had ten minutes of credited viewing *and* a tenth of its length covered — or
  an hour, for a race over ten hours. A glimpse of a race is started but not
  experienced, and nothing that pays XP counts a glimpse.
- A race is **completed** when its story is complete: its coverage passes the
  Story Complete test. "Races completed" and "Story Completes" are the same
  number everywhere in 0.4.0, shown once as "Races completed (Story
  Complete)". A race marked *Completed* by hand in the library still counts
  where it counted before 0.4.0 — the lifetime ladders, collections — and in
  none of the new figures.
- **Years** follow this computer's local clock. A stint is dated by when it
  was logged, and its time is spread over the stretch before that, split at
  local midnight: a stint watched from 22:30 on 31 December to 00:30 counts in
  both years.

### Career Chronicle

**Chronicle**, in the menu, lists every calendar year from your first stint to
now, newest first. Each card says which Career Year it was — the year of your
first stint is Career Year 1, and a year with nothing logged still counts, so
the numbering never skips — with its hours, races experienced and complete race
stories, and a link to its chapter and its Wrapped.

A chapter has the year's career summary (and in Career Year 1, how it began:
your first stint, your first complete story, your first edition of an event),
its viewing statistics down to the most active day, week and month, its
championships and events, its Story Completes and completed Expeditions (each
with its full summary), the mastery steps, achievements and milestones reached
in it, the personal records set in it, its notable races, twelve months of
activity, and the year's XP and levels. Previous and next links move between
chapters, and "See 2026 in Career Statistics" opens the same year there.

The current year is shown live, marked **Year to date — still being written**.
A finished year is **frozen**: its chapter is saved as it stands, and nothing
you change later — deleting a stint, renaming an event, moving to another time
zone — rewrites it. A year is frozen **72 hours** after New Year, not at
midnight. A stint reaches back over the time it took, so one logged at 00:31 on
1 January can hold an hour and a half of 31 December; a year frozen at midnight
would leave that time out of its chapter for ever. Until then the finished year
says **Complete — finalising until 4 January**. (It also says *Complete —
finalising*, with no date, while 0.4.0 is still reading an older history for
the first time; see [How historical backfilling
works](#how-historical-backfilling-works).) The end of a frozen chapter has a
**Rebuild this chapter from today's history…** button, which asks first. It is
the only way a chapter changes.

### Endurance Wrapped

Every chapter has an Endurance Wrapped: up to fifteen cards, each saying one
thing about the year — its hours, its races, the most-watched championship and
event, the longest race and the longest session, the favourite circuit, the
busiest month and week, the XP and levels, the landmarks, the Expeditions, the
records, and how it compares with the year before — opening on the year and
closing on its chapter. A card with nothing true to say is left out: the
favourite circuit, for instance, appears only when races with a circuit carry
at least half of the year's hours.

You click through yourself, with Back and Next, the arrow keys or the dots;
Escape goes back to the chapter. Nothing plays by itself. Once a finished year
is frozen, the dashboard and the Chronicle say *Your 2026 Endurance Wrapped is
ready*, with **Open** and **Hide**; reaching the last card, or Hide, puts the
prompt away, and the Wrapped stays in the Chronicle. The current year's Wrapped
can be opened at any time as a preview. Every card of it is marked **Year to
date · as of** the day, and opening it marks nothing as seen.

### Event Legacy

**Events**, in the menu, gathers every edition of the races you come back to —
every Le Mans, every Sebring — into one history each. An event is the existing
recurring-event mastery tree, given a page and a name you control. Its key
never changes, so renaming or combining events never makes a second tree or
pays anything twice.

An event's page leads with a sentence such as "24 Hours of Le Mans — 9
editions experienced — 181h 42m watched — 8 complete race stories", then the
first and latest editions watched, editions experienced and Story Complete,
credited hours, unique coverage, re-watch time, the longest run of consecutive
complete editions (history, never a "current streak"), the longest edition and
the highest completion. Below that is every edition, each opening its race
page, with the years missing between the first and the latest shown as "not in
your library", and the event's steps with the date each was reached.

An **edition** is one year of an event: two races of one event in the same
year are one edition. The year is the race date as you typed it, whatever the
time zone (or the season's year when there is no date), and a race with
neither is an edition of its own.

The steps are the event's mastery nodes. 0.4.0 adds nine small ones — three,
five, ten and twenty-five editions experienced, 25, 100 and 250 hours here, and
ten complete in a row — beside the eight that were there (the six for complete
editions now say "complete" in their names). The first edition experienced is
recorded but pays nothing, so that a race put into an event of its own cannot
earn a step for a few clicks.

#### How recurring events are associated

Nothing is ever linked by itself. You choose, in one of three places:

- **On a race.** Add Race and Edit Race have a *Recurring event* list: None,
  your events, or *New event…*, which asks for a name. It is always there,
  whatever "Major event" says. Add Race suggests an event when the name you
  type looks like one of its editions; the choice stays yours. A name typed in
  another case, or with other accents, finds the existing event instead of
  making a second one. A race page whose race looks like an edition of an event
  says so in one line, with *Link* and *Not this one*.
- **On an event's page.** *Add races* searches the races in no event, the
  likely editions first. *Rename* changes the name and nothing else. *Merge
  into…* combines two events: the races move, the steps the old event reached
  come across with their dates, and nothing is paid again. It cannot be undone,
  and the dialog says so. *Archive* hides an event with no races. Events are
  never deleted.
- **On the Events page.** *Create an event* makes one. A **Suggested** panel
  offers what your races suggest: a race whose name, without its year, matches
  an event's editions (or whose circuit and length do); two unlinked races that
  look like editions of an event you have not made yet; two events that look
  like the same one. Each can be taken or dismissed, and a dismissed suggestion
  stays dismissed. The suggestions come from your own races only; there is no
  built-in list of famous races.

**What moving an edition does to its steps.** A race can help pay each kind of
step once, in any event. Before a race moves — linked, unlinked, merged, moved
on its edit page, or deleted — the steps it has already helped reach are
recorded against it, so it cannot pay them again somewhere else. The price is
that a race linked to the wrong event and then moved to the right one does not
pay again the steps the wrong event reached with it; the step says "Recorded —
these editions were already counted for this step in another event". Every step
it has not helped reach still pays. Unlinking never takes XP back.

### Race Expeditions

A race **scheduled** for 10 hours or more is an Expedition automatically, so a
10-hour race cut short by a red flag is still one. Any race can be switched on
or off with **Expedition Mode**, on its race page or its Expedition page, and
*Reset to automatic* hands the decision back to the race's length. Race cards
show an *Expedition* badge.

The Expedition page (*Open the expedition* on the race page) shows the
race's duration, unique coverage, real viewing, what is still to watch, the
completion, the resume point, the number of sessions, when the Expedition
started and how long ago (worked out from when stints were logged) and its
Story Complete; then the **Expedition timeline**, the checkpoints, what the rest
of the race would ask of the viewing plan (as information — the plan is a
guide), the championship, event and mastery around it, and every stint. A stint
can be logged from the page itself, and the dashboard's current stint says how
far an Expedition has got.

The timeline draws the watched stretches, each stint as its own thin bar
(re-watches on rows of their own, the latest brightest), and marks the resume
point and the furthest point reached, labelled as not the same as watched. Its
caption says it in words: "Watched in 3 stretches: 18h 12m of 24h 00m. 2
stretches still to watch, 5h 48m in total." Completion is always unique
coverage rounded down, so it reads 100% only when every second is watched.

When an Expedition's story is complete, an **Expedition Summary** is written:
the race and its length, real viewing, unique coverage, re-watch time, the
number of sessions, the calendar days from start to finish, the average and
longest session, the final completion, the XP the race earned (summed from the
ledger), the mastery, milestones and achievements its completing stint brought,
and any records it set. It is permanent. It is never rewritten, it stays when
the race is deleted, and it is shown on the race page, on the Expedition page
and in the Chronicle chapter of the year it was completed.

#### How Expedition XP works

Checkpoints sit at 10%, 25%, 50%, 75% and 90% of the race's unique coverage.
Story Complete is the sixth, and pays only the Story Complete bonus it always
has. Checkpoints pay XP on races of **6 hours or more**; on a shorter race that
is switched on they are shown and dated, with no XP. The checkpoints of a race
share 40% of its ordinary Story Complete bonus:

| Race length | 10% | 25% | 50% | 75% | 90% | In all |
|---|---|---|---|---|---|---|
| under 6 hours | — | — | — | — | — | 0 |
| 6 hours | 60 | 90 | 150 | 150 | 150 | 600 |
| 8 hours | 80 | 120 | 200 | 200 | 200 | 800 |
| 10 to 12 hours | 120 | 180 | 300 | 300 | 300 | 1,200 |
| 18 hours | 180 | 270 | 450 | 450 | 450 | 1,800 |
| 24 hours | 300 | 450 | 750 | 750 | 750 | 3,000 |

That is at most 9% of what watching the whole race pays at 1×, and at the
fastest playback still less per real minute than watching earns. It is career
XP only and never feeds the season pass.

- Each checkpoint is held **once** per race; its dedupe key is
  `expedition:<race>:<percent>`, with no amount in it. Re-watching a part
  already seen never reaches one.
- **Switching Expedition Mode off keeps what the checkpoints earned.** Off only
  stops new checkpoints paying; on again pays only those not already held.
- Checkpoint XP **follows the data**, like the Story Complete bonus. Deleting
  the viewing, or the race, that reached a checkpoint takes it back, and
  changing a race's length re-sizes its checkpoints and takes back any that the
  coverage no longer reaches.
- A race already past a checkpoint when it becomes an Expedition — switched on,
  or read by the 0.4.0 upgrade — receives it then.

### Career Statistics and Personal Records

Statistics is now **Career Statistics**, next to Career and the Chronicle in
the menu. Its figures come from the same replay as the Chronicle, so the
statistics for 2026 and the 2026 chapter agree. *Races experienced* and *races
completed* mean what they mean above: a race you have properly watched some
of, and a race whose story is complete. "Races completed" is the Story
Complete count, because a story you have seen end to end is the only
completion the history can vouch for.

- **Filters**: year, championship, recurring event, race (offered once a
  championship, event or year is chosen) and race length, in the one set of
  length bands every page uses: up to 3 hours, 4, 6, 8, 10 and 12 hours, 13 to
  20 hours, and 24 hours.
- **Overview, Cadence, Breakdown and Career** switch instantly, without asking
  the server again. They add re-watch time, races started and races
  experienced, the Story Complete rate, the average race completion, the
  longest and the shortest meaningful session (ten minutes or more), the
  longest race experienced, championships and events followed, viewing by
  weekday and by race length, Story Completes by championship and by year,
  race completions over time, landmarks over time, and XP and levels in the
  year-by-year table. A chart with fewer than three points is said in a
  sentence instead.
- **Records** shows the personal records you have set — longest session, most
  in a day, in seven days and in a month, most Story Completes in a month and
  in a year, longest race completed, fastest long race start to finish,
  longest start to finish, most new race coverage in a day, and the longest
  run of complete editions of an event — each with when it was set and every
  time it was improved. With a year chosen it shows your best within that
  year. Records marked * depend on when stints were logged.
- **Compare** puts two years side by side: each figure, the difference ("4h
  10m more", "2 fewer", "the same"), and a percentage change only where the
  smaller year has enough in it for one to mean something (ten hours, five
  races, 5,000 XP). A year in progress is compared with the same stretch of the
  other year, a rate needs five races started in both years, and the year your
  career began in is shown without percentage changes, so a few months are
  never set against a whole year as if they were alike.

**XP is counted in the year it was recorded.** An award has one date, the
moment it was paid, so XP by year, by month and in a chapter follows that date.
XP the 0.4.0 upgrade pays for older history counts in the year of the upgrade,
while the milestones it dates sit in the years they happened.

### Career Milestones

**Career Milestones**, opened from its panel on the Career page (or from
Achievements), lists the major moments of your career in six groups — firsts,
complete race stories, career hours, races experienced, years and recurring
events — or, with *By date*, as one timeline. A milestone reached says when, how exactly that is known, the
race or event it happened in, and what it paid. One not reached yet shows where
your career stands ("Still ahead: 212 of 250 hours"), never a date to reach it
by. *Years* lists only the calendar years that held a whole year's viewing plan
(two full weeks of racing); the current year is a plain fact ("2026 so far: 36
hours"), with no bar.

Most milestones are rungs of the lifetime ladders, shown with their dates and
paid exactly as before. The new ones pay a little, as career XP: the first
6-hour race 500 XP, 250 career hours 1,000, 100 / 250 / 500 / 1,000 races
experienced 500 / 750 / 1,000 / 1,500, and each calendar year that holds a
whole year's viewing plan 1,000. A few moments are shown with **no XP of their
own**, because something else already pays them, and the card says what: the
first race started (the Green Flag achievement and the first viewing-session
rung), 2,500 career hours (The Archive) and 5, 10 or 25 editions of one event
(that event's own steps). The Achievements page's *Milestones* tab is now
called *Lifetime ladders*.

#### How milestones differ from achievements

Achievements are challenges you complete; some are playful, some take years.
Career Milestones are the permanent moments of an endurance-racing life — the
first 24-hour race, the thousandth hour — each with the day it happened. Many
are moments the lifetime ladders and achievements already pay; the milestone
adds the date and the place, and never pays a moment twice.

#### Why a milestone keeps its date

A milestone is written once, and never moved or taken away. Delete the stint
that took you past 1,000 hours and your statistics drop below 1,000 hours, but
the milestone still says when you reached it, because you did. The same goes
for an edited race, a backdated stint or a recompute. That is the rule for
every landmark — achievements, milestones, mastery and event steps, trophies,
the Hall of Fame, Expedition Summaries and frozen chapters — while the XP that
depends on the data (viewing, re-watches, Story Complete bonuses, Expedition
checkpoints) follows the data.

How exactly a date is known is always said:

- **"Reached around 21:45 on 14 June 2030, during a stint of 24 Hours of Le
  Mans 2030 (worked out from when the stint was logged)"** — for hours. The
  stint's time is spread back from when it was logged, and the moment the total
  crossed the line is worked out inside it. It is shown to the nearest five
  minutes, because it rests on when the stint was logged; the stored time is
  exact.
- **"Reached with the stint logged at 21:50 on 14 June 2030"** — for counts
  (the tenth complete story, the hundredth race experienced), and for hours
  when stints were logged so close together that a time inside one cannot be
  worked out.
- **"Recorded on 14 June 2030 (history cannot place it more exactly)"** — when
  the history cannot say: a figure that does not come from stints alone, such
  as a level, or a moment whose stints have since been deleted.

### How historical backfilling works

The first time 0.4.0 starts on a career from an earlier version, it reads the
whole viewing history once, before the window opens, and fills in what 0.4.0
knows about it, in this order:

1. **Races.** Each race's credited time is worked out. A race whose length was
   shortened under 0.3.x no longer counts coverage past its new end (its status
   is kept), and each Story Complete bonus exists exactly when its race's story
   is complete.
2. **Events.** Every event gets the 0.4.0 steps, each race is recorded against
   the steps it had already helped reach, and the new steps an event had
   already passed are paid, once.
3. **Milestones.** The new rungs you had already passed are written and paid,
   once. Then every milestone and event step gets its date from the history —
   the moment it happened, wherever the stints can place it, and "Recorded on"
   where they cannot. A milestone reached under 0.3.x is dated to when it
   really happened, not to the day of the upgrade. Hours get a time worked out
   inside the stint that crossed the line ("around 21:45", shown to the
   nearest five minutes because it rests on when the stint was logged); counts
   get the stint that reached them; a figure the stints cannot account for,
   such as a level, says "Recorded on" the day the app first saw it. [Why a
   milestone keeps its date](#why-a-milestone-keeps-its-date) has the three
   wordings in full.
4. **Expeditions.** Every race that is an Expedition receives the checkpoints
   its coverage had already reached, paid now, and one whose story is complete
   gets its Expedition Summary. Such a summary is marked as reconstructed, and
   leaves out the championship mastery of the time, which today's figure would
   not describe.
5. **The Chronicle.** Every finished year is frozen into its chapter, now that
   its dates and summaries are in place.

An ordinary career takes a second or two. A very large one is read over a few
starts: each start spends at most 30 seconds on it, records exactly how far it
got, and carries on from there the next time. Meanwhile the application works
as usual — a stint logged in the meantime does for its own race everything the
pass would — nothing is paid twice, and a finished year says *Complete —
finalising* until its chapter can be frozen. Every step can safely run again,
which is why a start cut short loses nothing.

XP that races deleted under 0.3.x left in the ledger (viewing XP whose stint is
gone, a Story Complete bonus whose race is gone) is counted and logged, not
removed: `npm run db:recompute` removes it.

### Derived versus persisted

Everything historical is worked out from three sources: the stints
(`RaceViewingSession`), the races they belong to, and the XP ledger. Only what
cannot be worked out again, or must not change once it has happened, is
stored:

| What | Kept how | Why |
|---|---|---|
| Expedition Mode on a race (`Race.expeditionMode`) | stored | Your choice. Empty means automatic. |
| A race's credited time (`Race.creditedViewingSec`) | stored, as a cache | The mastery trees read it on every stint. Recompute and the upgrade rebuild it. |
| An event's name, and whether you made, archived or merged it | stored | Your decisions. The event's key never changes. |
| When a milestone or an event step happened, how exactly, and in which stint, race or event | stored | A landmark keeps its date even when the history is edited later. |
| Expedition Summaries | stored, never rewritten | The journey as it was. |
| Frozen Chronicle chapters, and whether a year's Wrapped was seen | stored | A finished year is not rewritten by later edits or a time-zone change. |
| Which race helped pay which event step (`EventStepCredit`) | stored | So moving, merging or deleting races never pays a step twice. |
| Expedition checkpoints, the new milestone rungs and the new event steps | ledger rows | XP is the ledger. |
| The upgrade's progress (`careerBackfill`) and dismissed event suggestions | stored, per account | So the upgrade resumes where it stopped, and a dismissed suggestion stays dismissed. |
| The replay, every statistic and record, the current year's chapter, Wrapped cards, event figures, live Expedition figures, suggestions, comparisons, Career Year numbers and "since beaten" notes | worked out when read | They are deterministic from the sources. The replay is cached in memory for each account and built again whenever the history changes; it is never stored. |

### Balance constants

All of them are in `src/lib/config`, with a comment on every number. 0.4.0
adds:

| Block | Values |
|---|---|
| `EXPEDITION_CONFIG` | checkpoints share 0.4 of the race's ordinary Story Complete bonus; at 10 / 25 / 50 / 75 / 90% they take 0.10 / 0.15 / 0.25 / 0.25 / 0.25 of it; XP rounded to 10 |
| `EXPEDITION_SHAPE` | automatic from 10 scheduled hours; checkpoint XP from 6 hours of runtime; at most 6 rows of stints on the timeline |
| `CAREER_STATS_SHAPE` | a meaningful session is 10 minutes; experienced is 10 credited minutes and 10% coverage, or 60 minutes of it; percentage changes from a base of 10 hours, 5 or 5,000 XP; rates from 5 races; a 7-day record window; 4 replays cached; 10 rows before "Show all"; charts from 3 points; 200 races in the race filter, 50 at a time in "Add races" |
| `DURATION_CLASSES` | up to 3 hours (below 3.5), 4 hours (below 5), 6 (7), 8 (9), 10 (11), 12 (13), 13 to 20 hours (21), 24 hours |
| `CHRONICLE_SHAPE` | snapshot version 1; frozen 72 hours after New Year; 6 notable races; 3 records on Wrapped; the favourite circuit needs 50% of the hours; 25 stories a page |
| `TIMELINE_SHAPE` | a stint may be dated at most 5 minutes ahead; a date from the history is accepted up to 5 minutes after the app recorded the landmark; "around" needs half of a stint's time left after batch logging; times shown to 5 minutes |
| `EVENT_SHAPE` | at most 10 merge hops followed; 500 dismissed suggestions remembered |
| `MASTERY_SHAPE` | a 6-hour Story Complete band from 5.5 hours, and the 8- and 10-hour bands (7.5 and 9.5 hours) moved into configuration |
| `MASTERY_CONFIG.raceEventNodes` | appends `experienced_1/3/5/10/25` (0 / 300 / 500 / 1,000 / 2,500 XP), `event_hours_25/100/250` (500 / 1,500 / 3,000) and `consecutive_10` (5,000); renames the six complete-edition steps |
| `career-milestones.ts` | the Career Milestones catalogue: which rungs belong to the lifetime ladders, which are new, and what each pays |

---

## The systems

| | |
|---|---|
| **Viewing budget** | 336 hours a year, ~8 hours a week. These deliberately do not multiply out, so the budget is *allocated* adaptively rather than divided. A quiet week gets four hours; a Le Mans week gets twelve or more. |
| **Race Strategist** | Three suggestions: continue a story, something that fits your window, and a wildcard. It explicitly does **not** optimise XP per hour — there is no XP term in the scoring function, and a test enforces that structurally. |
| **Career XP & levels** | `cost(level) = base × level^1.35`, unbounded. Level 10 arrives in about twelve hours of watching, level 25 inside a first season, level 100 after years. Ordinary watching is always the main source. |
| **Prestige** | Purely additive. Never resets XP, races, achievements, collections or statistics. |
| **Season pass** | Four free quarterly passes a year, 100 tiers each, closing on real calendar deadlines. Rewards are cosmetic, statistical or collectible only — which is precisely why a real deadline is acceptable. |
| **Challenges** | Daily, weekly, monthly and seasonal, generated from the races you actually have so a target can never be impossible. Entirely optional; expiry costs nothing. |
| **Momentum** | A gentler alternative to streaks. Rises with watching and settles gently; never resets catastrophically and never mentions what happens if you stop. |
| **Mastery** | A tree per championship (custom ones included, automatically), a tree per recurring event, and one for the career. Nodes unlock permanently. |
| **Collections** | Seasons as collectible sets of race cards. You define what a season contains; partial seasons are entirely normal. |
| **Hall of Fame & trophies** | A permanent archive with the career statistics frozen as they stood at the moment. Nothing can be revoked. |
| **Chronicle & Endurance Wrapped** | A chapter for every calendar year, frozen three days into January so later edits never rewrite it, and a set of cards for each year that you click through yourself. The current year is always there as a preview, marked as still being written. |
| **Events** | Every recurring event you follow — the existing recurring-event mastery tree, with a page, a name you control, every edition and its steps. Any race can join one. Merging and moving editions never pays a step twice. |
| **Race Expeditions** | Races of 10 hours or more, or any race you switch on: a page with a timeline of exactly what you have seen, checkpoints at 10/25/50/75/90% that pay a little on races of 6 hours or more, and a permanent summary when the story is complete. Switching off never takes XP back. |
| **Career Statistics & Records** | Lifetime and yearly figures filtered by championship, event, race or length; two years compared, with percentages only where they mean something; personal records with their history. |
| **Career Milestones** | The major moments of a career, each with the date and time it happened, worked out from the stints. Written once and never moved; a moment something else already pays is shown at 0 XP. |

Completion percentages always apply to a scope you defined — a season, a mastery
tree, a pass, your library. There is deliberately **no** global figure implying
that every endurance race in existence is waiting to be watched.

---

## Architecture

```
desktop/                  the Electron shell: window, menu, server supervision,
                          migrations at start-up, backups. A separate program
                          from the one below, and it imports nothing from it.
src/
  app/                    Next.js App Router — pages and route handlers only
  components/
    ui/                   panels, timing bars, progress rings, controls
    races/                race cards, the timeline bar, the 24-hour clock
    dashboard/            the dashboard and system panels
    accounts/             the picker, the cards, the sign-in prompt
    chronicle/  events/  expeditions/  milestones/  stats/  charts/
                          the 0.4.0 pages' parts, and the shared charts
  lib/
    auth/                 passwords, sessions, accounts
    config/               every game-balance constant, in one place
    domain/               pure logic: intervals, playback, levels, periods;
                          and the career history — the local calendar, the
                          replay, editions, event suggestions, landmark dates,
                          records, window summaries, Expeditions, chapters
    engines/              budget, strategist, challenges, achievements,
                          mastery, collections, season pass, momentum,
                          awards, statistics, and the session orchestrator;
                          and the career timeline (the replay's loader and
                          cache), career milestones, event legacy,
                          expeditions, the chronicle, the resync after a race
                          edit, and a stint's unlocks
    server/               data access, server actions, validation,
                          db:recompute, and the start-up upgrades
                          (upgrades/: the 0.3.1 season reset, the 0.4.0
                          career backfill, the Chronicle's freeze pass)
    copy/                 the application's voice
tests/
  domain/                 pure logic
  engines/                the pure core of each engine
  auth/                   passwords, sessions, accounts, account isolation
  desktop/                the shell's testable parts
  integration/            against a real database
  perf/                   a ten-year career, against the timing targets
  fixtures/               a career database written by the real 0.3.2
  e2e/                    the whole application, driven through Electron
```

Three rules keep it maintainable:

1. **No game logic in React components.** Components render what an engine
   computed. The engines are where the rules live.
2. **No balance constant outside `lib/config`.** Every rate, threshold, weight
   and curve parameter is there, which is what makes the economy
   re-balanceable later.
3. **Every XP award is a ledger row.** Career XP is never a bare mutable
   number — `XPTransaction.dedupeKey` is unique, which is what structurally
   prevents a one-shot bonus being granted twice however often an engine
   re-runs.

A fourth rule arrived with accounts: **no page and no server action ever
accepts a user id.** Both resolve one from the session, first, before they look
at anything the browser sent. A race id or a session id that belongs to someone
else reads as gone rather than as something to edit.

Two more arrived with 0.4.0:

5. **One replay.** Every figure about the past — the Chronicle, statistics,
   records, event pages, Expedition figures, milestone dates — comes from
   `buildCareerTimeline` (`lib/domain/career-timeline.ts`): the stints replayed
   in one canonical order, `(watchedAt, createdAt, id)`, with their coverage
   rebuilt as it grew. Nothing reads a stint's stored coverage snapshot for
   history, because it goes stale after a delete. Pages read the replay through
   a per-account cache (`lib/engines/career-timeline-engine.ts`) that is built
   again whenever the history changes.
6. **One ledger settlement.** Every change that removes XP rows ends with
   `settleLedger` (`lib/engines/xp-ledger.ts`): the running totals are
   re-stamped, in batches, from the earliest row removed. Career XP always
   equals the sum of the ledger, whichever path took XP away.

[docs/career-history.md](docs/career-history.md) explains the replay, the
landmark rules, the upgrade and the exploit analysis in detail, for anyone
working on them.

Each engine that writes takes a transaction client and never opens its own, so
one logged stint is one atomic write across every system it touches.

### Stack

Electron 38 · Next.js 16 · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
SQLite · Prisma 7 · Zod · Vitest

SQLite rather than a database server, deliberately: this is a desktop
application whose whole history lives on one machine, so a single file is the
right shape for it — nothing to install, nothing to keep running, and every
account on the PC in one thing to back up. The application has been scoped by
account in its schema since the first commit, which is why adding accounts
needed columns and a session rather than a rewrite.

---

## Testing

The suite concentrates on the places where an error would corrupt a career —
or lock someone out of one — rather than on the places where one would look
untidy:

- watched-interval merging, overlap and subtraction
- real time versus timeline time, at every playback speed
- Story Complete detection, including the skipped-section case
- XP calculation, the re-watch rule and both speed exploits
- the level curve, round-tripping at every level
- budget allocation, rest weeks, year and quarter transitions
- challenge feasibility — no generated objective can be impossible
- the strategist's refusal to optimise XP (asserted against the source)
- season-pass tier curve and reward determinism
- mastery metrics, including consecutive editions of a recurring event
- collection completion against the user's own season definition
- password hashing, including every way a stored record can be corrupt
- sessions: expiry, sign-out, unknown tokens, and the cookie that must never
  be marked `secure`
- one account being unable to read or change another's races, stints or XP
- the start-up migrations that turn an empty folder into a working database
- window bounds being rejected when the monitor they were saved on is gone
- end-to-end session logging against a real database
- the career replay: canonical order, coverage and re-watches, credited time
  at every speed, and the exact moment a threshold was crossed
- the local calendar: stints across midnight on New Year's Eve, leap days,
  days of 23 and 25 hours, and the same instant in different time zones
- editions, event suggestions, and merging and moving editions without paying
  a step twice
- landmark dates, personal records, year summaries and year comparisons
- Expedition eligibility, checkpoints, the mode switch and the summary
- the Chronicle's freezing rule, its grace period and Wrapped
- every XP exploit the 0.4.0 design considered, one test each
  (`tests/integration/xp-exploits.test.ts`)
- the upgrade of a career the real 0.3.2 code wrote

Integration tests run against a real database rather than a fake, because
progression integrity is exactly the sort of thing a fake would let through.
They use a separate file so a test run can never touch a real viewing history,
and it is created automatically:

```bash
npm test
```

The test database looks after itself. `tests/setup.ts` compares the migrations
on disk against the ones the file records as applied and re-runs
`db:deploy` when they disagree, so pulling a change that adds a migration
needs nothing from you.

Three conventions arrived with 0.4.0:

- **Time zones.** A test about local days or years sets `process.env.TZ`
  through `inTimeZone` (`tests/helpers/time-zone.ts`) — Auckland, Los Angeles
  or London — and first checks the zone's January and July offsets, so a
  machine that ignores the change fails loudly instead of passing by accident.
  Dates are built inside each test, never while the file is being collected.
- **The 0.3.2 fixture.** `tests/fixtures/career-0.3.2.db` is a career written
  by the real 0.3.2 code (its README says how it was made). Tests never open it
  for writing: `tests/helpers/fixture-db.ts` copies it and points the database
  client at the copy before the first query.
- **Performance.** `PERF=1 npx vitest run tests/perf` builds a synthetic
  ten-year career — 5,000 races, 60,000 stints, 180,000 ledger rows — and holds
  the replay, logging and deleting stints and races, the upgrade's phases and
  every 0.4.0 page to their timing targets. It takes a few minutes and is not
  part of `npm test`.

`tests/e2e/desktop.mjs` drives the built desktop application itself — launching
it, creating accounts, logging a stint and checking the XP, then the 0.4.0
pages (`tests/e2e/career-history.mjs`), and finally a simulated upgrade of the
0.3.2 fixture. It needs a build and a display, so it is run deliberately rather
than by `npm test`; the header of the file says how. It also runs against a
packaged build:

```bash
xvfb-run -a node tests/e2e/desktop.mjs --app dist/linux-unpacked/endurance-racing-career
```

---

## Known limits

Worth knowing, and each a deliberate trade rather than an oversight:

- **Tiny gaps count as watched.** Coverage treats a gap of up to 20 seconds as
  watched, the tolerance Story Complete has always used, so thousands of
  one-second stints 20 seconds apart could cover a race without watching it.
  Doing that by hand for one 24-hour race would take about 4,000 stints, so the
  definition of coverage every page shows is left as it is.
- **Moving races to a new championship can pay its mastery nodes again.** This
  is from before 0.4.0, outside the five new systems, and 0.4.0 does not widen
  it.
- **XP is counted in the year it was recorded**, not the year of the viewing
  that earned it, because an award's only date is when it was paid. XP the
  0.4.0 upgrade pays for older history counts in the year of the upgrade.
- **A race deleted and added again can earn a second Major Event trophy and
  Hall of Fame plaque**, because those belong to a race rather than an edition.
  Neither carries XP.
- **A deleted race keeps its Expedition Summary**, so adding the race again and
  completing it as an Expedition gives it a second one. The Chronicle shows
  both, each with its own dates.
- **Editing a race just before deleting it can let its edition pay event steps
  once more.** A deleted race is remembered by its edition year, rounded length
  and circuit or name, so that the same edition added to another event cannot
  pay its steps again. If its date, or its length by enough to change the
  rounded hours, is edited first, the re-added edition can pay them a second
  time once its viewing is logged again. Closing that would need a race's
  earlier values, which 0.4.0 does not keep.
- **On a very long history, the Chronicle can take up to about a second to
  open the first time after a change.** With ten years and 60,000 stints, the
  index or a finished chapter takes between half a second and a second the
  first time after a start or a change (the aim was half a second), and well
  under a quarter of a second after that. A career of a few thousand stints
  opens it in a fraction of that either way.

---

## A note on what this is for

Watching endurance racing is the hobby. The progression system is here to
celebrate it, and the relationship is never the other way round.

If a mechanic would make you watch something you did not want to watch, skip
through something you wanted to see, or feel behind on a hobby, it does not
belong in this application. That constraint is why the strategist cannot see XP,
why momentum settles instead of breaking, why the budget is a plan rather than a
limit, and why nothing anywhere can take progress away.
