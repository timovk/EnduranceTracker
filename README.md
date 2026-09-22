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
your statistics or your collections. Challenges expire without penalty, streaks
freeze rather than break, the annual viewing plan will never tell you not to
watch something, and a backlog is described as a library of future experiences
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

### Your career, and where it lives

```
%APPDATA%\Endurance Racing Career\
  data\endurance.db        your entire career, in one file
  logs\main.log            what the application did on start-up
  backups\                 where "Back up career…" suggests saving
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
- The Windows installer is produced by the CI workflow above. At the time of
  writing, no one had yet run the resulting `.exe` on a Windows machine — the
  packaging itself is verified, the Windows-specific parts (NSIS, shortcuts,
  SmartScreen) are not. If you are the first,
  [docs/releasing.md](docs/releasing.md) lists what to check.
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
rebuilds every account on the machine.

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
  lib/
    auth/                 passwords, sessions, accounts
    config/               every game-balance constant, in one place
    domain/               pure logic: intervals, playback, levels, periods
    engines/              budget, strategist, challenges, achievements,
                          mastery, collections, season pass, momentum,
                          awards, statistics, and the session orchestrator
    server/               data access, server actions, validation
    copy/                 the application's voice
tests/
  domain/                 pure logic
  engines/                the pure core of each engine
  auth/                   passwords, sessions, accounts, account isolation
  desktop/                the shell's testable parts
  integration/            against a real database
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

`tests/e2e/desktop.mjs` drives the built desktop application itself — launching
it, creating accounts, logging a stint and checking the XP. It needs a build and
a display, so it is run deliberately rather than by `npm test`; the header of
the file says how. It also runs against a packaged build:

```bash
xvfb-run -a node tests/e2e/desktop.mjs --app dist/linux-unpacked/endurance-racing-career
```

---

## A note on what this is for

Watching endurance racing is the hobby. The progression system is here to
celebrate it, and the relationship is never the other way round.

If a mechanic would make you watch something you did not want to watch, skip
through something you wanted to see, or feel behind on a hobby, it does not
belong in this application. That constraint is why the strategist cannot see XP,
why momentum settles instead of breaking, why the budget is a plan rather than a
limit, and why nothing anywhere can take progress away.
