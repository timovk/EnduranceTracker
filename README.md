# Endurance Racing Career Mode

A permanent career record for watching endurance racing.

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

## Running it

Requires Node.js 20.9+ and PostgreSQL.

```bash
npm install                       # also generates the Prisma client
cp .env.example .env              # then point DATABASE_URL at your database
npm run db:migrate                # create the schema
npm run db:seed                   # an empty career, ready for real races
npm run dev                       # http://localhost:3000
```

To see everything working before adding anything of your own:

```bash
npm run db:seed:demo              # a fictional career, ~70 hours of viewing
npm run db:unseed:demo            # remove every trace of it
```

The demonstration data is entirely invented — no calendar is imported and there
is no external API. It is built by logging stints through the real session
engine, so what you see is produced by exactly the code path a genuine career
would use.

### The other commands

```bash
npm run test                      # the full suite
npm run test:coverage             # with coverage
npm run typecheck                 # tsc --noEmit
npm run lint
npm run db:studio                 # browse the database
npm run db:recompute              # rebuild every derived figure from source
```

`db:recompute` is the safety net. Cached counters, career XP, mastery,
achievements and collections are all *derived*; this rebuilds them from the
watched intervals, the session log and the XP ledger. It is also how a
re-balanced economy is applied to an existing career.

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
src/
  app/                    Next.js App Router — pages and route handlers only
  components/
    ui/                   panels, timing bars, progress rings, controls
    races/                race cards, the timeline bar, the 24-hour clock
    dashboard/            the dashboard and system panels
  lib/
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
  integration/            against a real PostgreSQL database
```

Three rules keep it maintainable:

1. **No game logic in React components.** Components render what an engine
   computed. The engines are where the rules live.
2. **No balance constant outside `lib/config`.** Every rate, threshold, weight
   and curve parameter is there, which is what makes the economy
   re-balanceable later.
3. **Every XP award is a ledger row.** Career XP is never a bare mutable
   number — `XPTransaction.dedupeKey` is UNIQUE, which is what structurally
   prevents a one-shot bonus being granted twice however often an engine
   re-runs.

Each engine that writes takes a transaction client and never opens its own, so
one logged stint is one atomic write across every system it touches.

### Stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind CSS 4 · PostgreSQL ·
Prisma 7 · Zod · Vitest

---

## Testing

The suite concentrates on the places where an error would corrupt a career
rather than on the places where one would look untidy:

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
- end-to-end session logging against a real database

Integration tests need a database; `.env.test` points at a separate one so a
test run can never touch a real viewing history.

```bash
createdb endurance_test
DATABASE_URL="postgresql://…/endurance_test" npx prisma migrate deploy
npm run test
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
