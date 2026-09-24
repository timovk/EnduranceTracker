# SPEC.md v0.4.0: product and UX completeness review

Lens: every brief item, the owner's binding decisions, reuse of the visual language, empty states, 10-year scale, tone, pressure mechanics, reduced motion, navigation, and statistics that could be fabricated. I checked each claim against `release/v0.4.0` @ 4c59efc. File:line references are to the repository unless they say "SPEC".

**Verdict.** Coverage of the brief is nearly complete. Every listed Chronicle statistic and section, Wrapped item, Event Legacy statistic and step, Expedition field and summary field, Career Statistics item, record, milestone, test item and doc item has a home. There are **no blockers**. There are **10 major** findings:
- two departures from binding decisions;
- one celebration requirement that has no visible effect;
- one permanent mislabel;
- one navigation-latency regression;
- three permanence or fabrication problems in frozen snapshots;
- a misleading first comparison;
- the "never imply the whole race was watched" rule is not enforced where figures are shown.

The minor findings are mostly vocabulary, empty-state and scale polish.

---

## Major

### M1. D3 is not honoured exactly: Expedition Mode cannot be switched on for "any individual race" (SPEC §4.3.1 l.1452-1456, §3.3 `manualMinimumHours` l.982, §4.3.4 l.1510)
- **The decision.** The owner's decision 3 reads: "The user can switch Expedition Mode on or off for **any individual race**."
- **What the spec does.** It refuses "on" below 6 h ("Expedition Mode is for races of 6 hours or more."). SPEC l.3 says the decisions win, so this is a departure. The stated reason (a 10% checkpoint on a tiny race "celebrates noise" and pays XP) is about **XP**, not about presentation.
- **Fix: split presentation from reward.**
  - `isExpedition` becomes `mode === true || (mode === null && runtime ≥ autoThresholdHours)`, so any race can be switched on.
  - Add `checkpointsPayXp(runtimeSec) = runtimeSec ≥ EXPEDITION_SHAPE.checkpointXpMinimumHours·3600` (rename `manualMinimumHours`). `checkpointSchedule` returns `xp: 0` below it.
  - The page and stint summary say "Checkpoints on races of 6 hours or more also earn XP" (built from config).
  - The summary, timeline and checkpoint dates still work for a 2 h race.
  - Update: the `expedition.test.ts` case "switching on needs 6 hours", exploit row #9/#15 ("… 5-hour race cannot be switched on" becomes "… earns no checkpoint XP"), and the changelog line "any race of 6 hours or more".

### M2. Switching Expedition Mode off takes XP away. That is punitive, goes beyond announced default A3, and contradicts the spec's own unlink rule (SPEC §4.3.3 l.1488-1496, §4.3.4 l.1517-1518, §6 row 8)
- **What A3 says.** Checkpoint XP "follows the data like the Story Complete bonus (revoked if **the viewing that earned it is deleted**; can only ever be held once)". Switching the mode off deletes no viewing.
- **What the spec does.** It revokes anyway: "The 600 XP from its checkpoints came off; switch it back on and they return."
- **Why that is wrong.** A presentation preference is being treated as a loss. The engine's own charter forbids that: "never punish forbids taking XP away as a PENALTY" (`session-engine.ts:453-455`). The spec is also inconsistent with itself: "Unlinking never takes XP back" (SPEC l.1331).
- **Fix.**
  - Mode off stops **new** checkpoint awards. It never revokes.
  - Revocation stays for data changes: stint deletion, race deletion, and a runtime change that re-sizes a row.
  - Restate I3 as: "held EXPEDITION rows ⊆ checkpoints satisfied by current coverage under the current schedule; each was created while the race was an Expedition; at most one row per key".
  - Messages: "Expedition Mode is off. Checkpoints already reached keep their XP." When it is switched back on, only checkpoints not yet held are paid.
  - Dedupe keys still make on/off/on pay nothing twice. Keep the test `toggling Expedition Mode never holds a checkpoint twice` and add `switching Expedition Mode off keeps held checkpoints`.

### M3. "Major milestone ⇒ at least NOTABLE" produces no visible celebration (SPEC §4.1.6 l.1278, §4.7.3 l.1995-2000)
- **What the code does.** `StintSummary` only distinguishes `celebrate === 'SPECTACULAR'` (`stint-summary.tsx:31`). NOTABLE renders exactly like QUIET, and no component reads NOTABLE (grep `src/components`, `src/app`).
- **The consequence.** The brief's "celebratory animation … for meaningful moments such as major milestones" is not delivered. "1,000 career hours" or "First 24-hour race" arrives as one plain `UnlockRow`.
- **Fix.**
  1. Give NOTABLE a visible treatment in `stint-summary.tsx`: an accent heading plus the existing `rise` entrance on the unlock block. Keep it CSS only, so the global reduced-motion rule covers it (`globals.css:208-214`).
  2. Render a `major` career milestone as a highlighted block, reusing the "Season Complete" block style at `stint-summary.tsx:192-198`, not as an `UnlockRow`.
  3. Decide explicitly which milestones are SPECTACULAR, for example `hours-1000+`, `stories-100` and `year-plan`, and add them to `chooseCelebration`.
  4. Add a test: `a major career milestone renders the highlighted block`. It can go through a pure `celebrationView(outcome)` helper, because there are no component tests.

### M4. "Race duration category" uses the XP-band labels, so a 10-hour race is shown as "12 Hours", and chapters freeze that permanently (SPEC §3.1 l.545 `durationClassOf`; used in §3.2.6 `byDurationClass`, §4.4.4 Breakdown l.1716, snapshot `storyComplete.byDurationClass` l.1852)
- **The labels are wrong.** `XP_CONFIG.storyCompleteBonuses` bands are `maxHours` 8.5 → "8 Hours" and 12.5 → "12 Hours" (`economy.ts:48-56`). So Petit Le Mans and Suzuka 10 Hours are "12 Hours", a 3 h race is "4 Hours", and a 6h40 race is "8 Hours". The Stats "Race length" chart, the Chronicle "by race length" breakdown and every frozen `ChronicleYear` would carry wrong labels.
- **A second classification already exists.** The app has `RaceType` with `H10` (`config/championships.ts:47-56`), and the Stats length filter already uses it (`statistics-view.tsx:133-138`).
- **Fix.** Add a dedicated `DURATION_CLASSES` config: runtime bands centred on real formats (≤3 h, 4 h, 6 h, 8 h, 10 h, 12 h, 24 h, with the same half-hour tolerance as `MASTERY_SHAPE`), whose labels describe what they contain. Use it for the chart, the chapter and the filter options, so one page never shows two length taxonomies. Add a test: `a 10-hour race is classed as 10 Hours`.

### M5. URL-driven tabs and Wrapped cards use `router.replace`, which re-renders the whole server page on every click (SPEC §4.4.1 l.1648, §4.5.1 l.1800)
- **What happens today.** The Stats tabs switch instantly (React state, `statistics-view.tsx:43`).
- **What the spec's change does.** Pages receive `searchParams` and are re-rendered on navigation (Next docs `01-app/03-api-reference/03-file-conventions/page.md:67-80`; `use-search-params.md:274`). Every tab click therefore re-runs `getStatistics` (SPEC target: < 1 s real, < 5 s cold at large scale). Every **Next** in Wrapped re-renders `/chronicle/[year]/wrapped`, including the year-to-date chapter build (< 800 ms real, < 4 s large). There are no `loading.tsx` or Suspense boundaries, so the click appears frozen.
- **Fix.**
  - Use `window.history.replaceState`, which updates the URL and `useSearchParams` without a server round trip (`01-app/01-getting-started/04-linking-and-navigating.md:343-347, 399-415`), for `?card=N` and for switching between the four existing Stats tabs. The server reads `tab`/`card` only for the first render.
  - Load Records and Compare data only when their tab is active. Their switch is a real navigation, wrapped in `useTransition` with a pending state.
  - Add `loading.tsx` using the existing `Skeleton` primitive for `/stats`, `/chronicle/[year]` and `/events/[key]`.

### M6. `ChronicleChapterV1` is frozen permanently, but v1 lacks what the owner's first chapter needs. 2026 freezes on about 1 January 2027 (SPEC §4.5.2 l.1834-1869, §4.5.5 l.1939)
The brief's closing line is "a user opening the application in 2035 should be able to look back at 2026 and understand how their endurance-racing journey began". Once frozen, anything not in v1 needs a schema v2 plus a manual Rebuild. Fix all of the following before WP7:
- **(a) Beginnings.** Add `beginnings: { firstStint: { at, raceId, raceName } | null; firstStoryComplete: {…} | null; firstEventEdition: {…} | null }` to the snapshot. Render it on the chapter and as Wrapped card 1 whenever `careerYear === 1` ("Your chronicle begins on 22 September 2026 with …"). All three facts are replay facts (`raceStartEvents`, `storyCompleteEvents`), so nothing is invented.
- **(b) Milestone subject.** `milestones.career[]` has no `subjectName`/`raceId` (l.1858), so "First race started — 22 Sep 2026" can never say which race. Add `subjectName` and `subjectId`.
- **(c) `careerYear` is used but never defined** (l.1751, 1836, 1917). With gap years ("2029 — no racing logged") and engine-backdated stints, it is ambiguous. Define it as `year − firstActivityYear + 1`. Compute it **at read time on the index**, not from the snapshot, so a later backdated stint cannot leave frozen chapters numbered inconsistently.
- **(d) "Show all" is inconsistent with storage.** §4.5.5 promises "Show all" for championships, events and circuits, but the snapshot stores circuits as "top 10" (l.1851). Either store full lists (bounded by what the user watched in one year, so they are small) or drop "Show all" for frozen years.
- **(e) `records[].since` goes stale.** It is computed at freeze time (l.1861), so a 2026 record beaten in 2028 never says so. Compute "since beaten on …" live at render from the current `computeRecordProgression` (records are derived, so this is allowed), and keep only the record value frozen.
- **(f) Expeditions of deleted races become stubs.** The chapter stores only a 6-field stub (l.1863), and the full summary is reachable only from the race and Expedition pages, which 404 once the race is deleted. That breaks "Completed Expedition summaries should remain accessible through … the Career Chronicle" (brief; SPEC l.1571 promises it). Render the full `ExpeditionSummaryCard` in the chapter from `expedition_summaries` by `summaryId` (immutable rows), or add `/chronicle/[year]/expeditions/[summaryId]`.

### M7. Retrospective Expedition Summaries freeze a present-day mastery percentage as if it were historical (SPEC §4.3.6 l.1590-1592, l.1608)
- **The problem.** `mastery.championship.percent` in a summary written by the upgrade, by Expedition Mode switched on later, or by recompute is today's championship mastery, not the value at `completedAt`. It is then frozen as part of "the permanent record" of an expedition that finished months earlier. This is exactly the "do not fabricate statistics" case.
- **Fix.** For `retrospective: true`, either:
  - compute it as `nodes unlocked with (achievedAt ?? unlockedAt) ≤ completedAt / nodes existing then`, marked `approximate: true`; or
  - omit it (`championship: null`) and show "Mastery at the time was not recorded."

  Event figures can be replayed at `completedAt` (`editionsExperienced/StoryComplete` from the timeline cut at that instant). Say so, and test `a retrospective summary never shows mastery reached after completion`.

### M8. The first "compared with last year" compares a full year with a 100-day first year (SPEC §4.5.4 card 14 l.1930, §4.5.2 `previousYear` l.1865-1866, §4.4.4 Compare l.1722-1727)
- **The problem.** The owner's 2026 runs from 22 Sep to 31 Dec. The 2027 Wrapped card and the chapter strip will read "+300 h more" and, above the 10 h base, a percentage change (for example +233%) with no hint that 2026 was partial.
- **Fix.**
  - Store `activeFrom` (the first stint instant) in each chapter's `window`.
  - When `previousYear.activeFrom` is after 1 January of that year, `compareSummaries` sets `percentChange: null` with the note "Your {a} chapter began on {date}". The Wrapped card leads with that sentence.
  - Make "Same stretch" symmetric: it applies whenever either year is the current year, not only when `b` is (l.1722).

### M9. "Reaching the end must never falsely imply the whole race was watched" is not enforced where percentages are displayed (SPEC §3.2.8 `completionPercent` l.846, snapshot `finalCompletionPercent` "one decimal" l.1587, §4.3.7 l.1626, §4.3.8)
- **The problem.** Story Complete allows up to 120 s uncovered (`STORY_CONFIG.maxUncoveredSeconds`, `economy.ts:159`). With the existing display code:
  - `toFixed(1)` shows 99.96% as "100.0%";
  - the stint summary's `toFixed(0)` shows "99% → 100%" for 99.6% (`stint-summary.tsx:63`);
  - `describeCoverage` rounds the same way (`race-timeline.tsx:162-165`).

  Nothing in the spec stops the Expedition instruments, checkpoint meter, summary or new stint group from repeating this.
- **Fix.** Add one pure `formatCoveragePercent(coverageSec, runtimeSec)` in `domain/time.ts` or `tone.ts`. It **floors** to one decimal and returns "100%" only when `coverageSec ≥ runtimeSec`. Use it on every Expedition surface, `describeFragments`, the summary snapshot, and the existing stint-summary Completion figure (the Expedition experience includes that panel). Add a test: `a Story Complete race with a 40 s gap never shows 100%`.

### M10. Wrapped is specified as a list of figures, with no mechanism for "a celebratory retrospective rather than an analytics report" (SPEC §4.5.4 l.1911-1933, §4.7.4 l.2003)
- **The problem.** Apart from `wrappedOpeningLine`, cards are numbers only. The visual treatment of a card is unspecified beyond `aspect-[4/5] sm:aspect-[16/10]`.
- **Fix.**
  - Add a pure `wrappedCardLine(card: WrappedCard): string` in `tone.ts` with one plain, warm sentence per card type. For example: "212 hours at the track — nearly nine days, end to end." Or: "Your longest race was the 24 Hours of Le Mans: 62% of the story so far." Never "not completed". Register it in `periods-tone.test.ts` with zero and small inputs.
  - Specify the card anatomy once: label, hero number (raw `timing text-timing-lg` class, not `cn()`), line, and an optional accent via a helper that sets **both** `--accent` and `--accent-soft`.
  - Use `min-h` instead of a fixed aspect ratio, so long race or championship names cannot clip. Use `line-clamp-2` on names.

---

## Minor

1. **D2 departure not surfaced to the owner** (SPEC R4 l.68-71, §4.1.2 l.1176). "First race started" was named by the owner as new and paying, but the spec pays 0 XP because `sessions:1` and *Green Flag* already pay for the same instant (verified: `config/milestones.ts:42`, `config/achievements.ts:32`). The reasoning is sound, but the owner is non-technical and only sees the result. Add a line to the WP8 hand-off and changelog: "First race started is celebrated by Green Flag and the first-session milestone, so it adds no new XP."
2. **Expedition page is a dead end** (SPEC §4.3.5 l.1531-1558). It has no "Log a stint". Add the header action, reusing `LogSessionForm` in a `Dialog` plus the inline `StintSummary` exactly as `race-detail-view.tsx:50-63`. Otherwise the owner must go back to the race page for every stint of an Expedition.
3. **No "Expedition started" moment** (SPEC §4.3.8). Before 10% (2.4 h of a 24 h race), `hasUnlocks` has nothing to show. Add `began: boolean` (first stint while `isExpedition`) to `ExpeditionOutcome` with a QUIET line, "Expedition under way — open it" (brief: "When an Expedition begins, create an Expedition experience").
4. **Delete-race message is discarded** (SPEC §4.6 l.1965). `race-detail-view.tsx:284-287` awaits `deleteRaceAction` and `router.push('/races')`, ignoring the result. The "with the {n} XP it earned" message is never shown. Pass it on (`/races?removed=<name>&xp=<n>`, read by the library page), or show it before navigating.
5. **Strategist copy collides with the new feature name.** `strategist-engine.ts:604-605` tells the user "the {race} is an expedition of about …" for every ≥ 12 h race. That includes races with Expedition Mode off, and it excludes 10–12 h Expeditions. SPEC §4.3.1 l.1457 keeps it unchanged, and only the achievement is renamed. Reword it to "a long race of about …".
6. **Eligibility tolerance is inconsistent.** Elsewhere "10 hours or more" is ≥ 9.5 h (`stories10hMinHours`, SPEC l.1026, used by *Night Shift*). Auto-Expedition uses runtime ≥ 10.0 h exactly (l.1453), so a 10 h race cut to 9h50 by a red flag (`actualDurationSec`) silently stops being an Expedition. Use `scheduledDurationSec` (the advertised format) for eligibility and runtime for checkpoints, or apply the same half-hour tolerance.
7. **ExpeditionModeControl "Automatic · On · Off"** is opaque for a ≥ 10 h race, where Automatic and On mean the same thing. Show a switch with the effective state, plus "(automatic for races of 10 hours or more)" and "Reset to automatic" when overridden.
8. **Two "Real viewing" figures for one race.** The race page shows raw `realViewingSec` (`race-detail-view.tsx:182`), while the Expedition page shows credited seconds (SPEC l.1536). The Stats sub-label "wall clock, re-watches included" (`statistics-view.tsx:173`) becomes wrong for < 0.75× stints. Use credited time on the race page too, or label the new figure "Counted viewing time", and update the Stats sub-label.
9. **Completion panel duplicates** (SPEC §4.4.3 l.1683). Once `racesCompleted` equals the Story Complete count, the Overview "Completion" panel's `library` and `storyLibrary` rows (`stats-engine.ts:2277-2288`) become two identical bars. Drop `library`. (Merging "completed" into Story Complete is right: no UI path sets `COMPLETED`, since `setRaceStatusAction` has no caller and the add form omits it at `add-race-form.tsx:232-238`. The spec should say so in §3.1, so the owner understands why the brief's two items are one number.)
10. **Vocabulary drift for the same fact (≥ 1 stint):**
    - "races watched" (milestones, Chronicle, SPEC l.1190, l.1751);
    - "editions experienced" (events);
    - "races started" (Stats);
    - Wrapped card 3 shows both "races watched" and "races started", with different numbers.

    Pick "races experienced / editions experienced" (the brief's word) everywhere, and put only one of the two on the card. Also rename the StintSummary group "Milestones" to "Lifetime ladders", matching the renamed tab, so the stint summary does not show "Milestones" and "Career milestones" side by side (SPEC l.1279-1280). Retitle `first-race-completed` "First complete race story" instead of "First race completed — First Story Complete".
11. **Event legacy step XP looks broken when listed by threshold** (SPEC §3.3 l.1031-1039).
    - Hours: 25 h +500, 50 h +5,000, **100 h +1,500**, 150 h +20,000, **250 h +3,000**.
    - Consecutive: **Ten in a Row +5,000** below Five in a Row +15,000.
    - "Five Editions" (existing, Story Complete) sits next to "Five Editions Watched".

    The event page groups them (l.1389), but the rising-then-falling XP still reads as a bug. Either show new-step XP as a secondary "+XP" chip only, or order the rows by group and explain "Added in 0.4.0: small extra steps". Rename the existing node *display* names to "… Complete Editions". Names are not paid, so D2 is untouched.
12. **"Consecutive editions" is Story Complete runs only** (SPEC §3.1 l.537, event page l.1385). The brief says "consecutive editions *followed*". Label it "Consecutive complete editions" and also show the watched run, since `longestConsecutiveRun` over watched years is free. Present runs as history ("2024–2026"), never as a live "current streak" (anti-pressure).
13. **"Full viewing year" invites pressure and confusion** (SPEC l.1135, l.1187).
    - It is a per-year quota with a progress bar that resets on 1 January.
    - Its target (config 336) differs from the owner's editable plan on `/budget`.
    - For 2026 (from 22 Sep) it is unreachable by construction.

    Show it for the current year as a fact ("2026 so far: 36 h"), with no bar and no remaining figure. Never list past years that fell short. Keep it off the dashboard. Word it as "{annualHours} hours in {year} — two full weeks of racing", not "plan".
14. **Suggestion names and merges** (SPEC §3.2.4 l.708, §4.2.4 l.1353).
    - Title-casing the signature produces "24 Hours Of Le Mans" and strips diacritics ("Nurburgring"). Suggest the most recent member race's own name with the year removed, editable in the create dialog.
    - A one-click **Merge** from the Suggested panel is irreversible (there is no unmerge). Route it through the same confirm `Dialog` as the event page, stating that it cannot be undone.
    - Add "Link all strong suggestions", for 10-year libraries.
15. **"Add races" dialog does not scale** (SPEC l.1376). It lists every unlinked race as a checkbox. With thousands of races that is unusable inside `Dialog`'s 70vh body. Add a search `Input`, suggested races first, and at most 50 results.
16. **Chronicle browsing at 10 years** (SPEC §4.5.1). The chapter has no previous/next year links. Add "← 2026 · 2028 →" in the header.
    - Clicking a month goes to `/stats?year=`, which promises a month drill-down that does not exist. Relabel it "See {year} in Career Statistics".
    - The current year with no stints yet (1 January) should show "Your {year} chapter starts with your next stint", not an empty year-to-date card.
17. **Year-to-date marking and accessibility in Wrapped** (SPEC l.1802). Put a "Year to date · as of {date}" chip on **every** card of the preview, not only on a banner card, so it is always clearly incomplete (A8). Add `aria-live="polite"` on the card region.
18. **Wrapped banner can arrive late** (SPEC §4.5.2 l.1823-1826, §4.5.4 l.1935). The freeze triggers are `register()`, Chronicle pages and mutating actions. If the app was started on 31 December, the dashboard on 1 January shows no "Wrapped is ready" until the owner logs a stint or opens the Chronicle. `pendingWrapped` should call `ensureChroniclesFrozen` first; it is cheap when nothing is due.
19. **Empty and thin states still missing:**
    - an event with no linked races ("No editions linked yet — Add races");
    - an Expedition with no stints ("Your expedition starts with the first stint");
    - Records: 11 cards of which several say "Not set yet" for a new account (brief: "not enormous empty dashboards"). Show only set records, plus one line listing the rest;
    - the "Based on when stints were logged" note, repeated on 7 cards. Make it one footnote.
    - Charts with one data point (landmarks, completions over time, compare bars) should fall back to a sentence until there are at least 2–3 points ("no charts merely for decoration").
20. **XP and levels over time at 10 years** (SPEC l.1702, "unchanged"). The lifetime XP chart shows the last 24 months (`STATS_CONFIG.xpHistoryDefaultMonths`, `statistics-view.tsx:526`), capped at 60. Add "XP earned" and "Levels gained" columns to the existing Year-by-year table: one bounded ledger `groupBy` per year.
21. **Compare rows are not enumerated** (SPEC §3.2.6 l.776-794). The brief names "session length" and "championship distribution". List the row keys: hours, new coverage, re-watch, sessions, active days, average and longest session, races experienced, Story Completes, Story Complete rate, completion %, XP, levels gained, championships and events watched. A test should assert the set. Also say what the Records tab does with the `year` filter: records set within that year, or current records restricted to it.
22. **Dashboard integration is thin, so the systems do not "feel like one"**:
    - `CurrentStint` does not mention an Expedition in progress ("Expedition · 62% · next 75%");
    - `RecentUnlocks` kinds are only achievement, mastery, trophy and hall-of-fame (`dashboard.ts:160-230`, `panels.tsx:253-268`), so career milestones, the app's "major permanent moments", never appear there. Add a `milestone` kind.
23. **Accent mechanism.** R/§4.7.2 l.1992 requires tinted panels to set both `--accent` and `--accent-soft`. `Panel accent=` sets only `--accent` (`primitives.tsx:17-29`), and `accentStyle()` takes a theme key, not a colour (`identity.ts:97-103`). Specify `accentVars(color)` in `components/ui` (or extend `Panel`) and use it for the Expedition Summary (l.1612) and Wrapped.
24. **Tone coverage gap.** The new user-facing messages in `src/lib/server/career-actions.ts` and `actions.ts` are scanned by neither `design-rules.test.ts` (it scans only engines, domain, components and app, `ALL_SOURCE` at l.43) nor `periods-tone.test.ts`. Move them into `tone.ts` functions and register them, or add `SERVER_FILES` to the forbidden-phrase scan.
25. **Navigation order.** "Career Statistics" stays 15th of 16, far from Chronicle (8th). Place it after Chronicle: Career · Chronicle · Career Statistics · Events · Mastery …. That keeps the history trio together, and the owner's decision does not fix the order.
26. **Recharts reduced motion.** Recharts 3.10 honours `prefers-reduced-motion` only while `isAnimationActive` is left at its default `'auto'` (`node_modules/recharts/lib/animation/JavascriptAnimate.js:44-45`). Add to `chart-theme.ts` rules: never pass `isAnimationActive={true}`.
27. **README.** Give the brief's doc item "How historical backfilling works" its own plain-language subsection:
    - what gets dated exactly;
    - what "about 21:47" means (it is inferred from when the stint was logged);
    - what "Recorded on" means.

    Today it is split between "Updating" and the developer doc (SPEC §9.1).
28. **Precision caveat.** INTERPOLATED labels give a time to the minute. That time rests on the stint window inferred from the log time (R6), and records say so ("based on when stints were logged"). `precisionLabel` should carry the same caveat, or round the time to 5 minutes.

---

## Keep as is

- Suggestions never auto-link, and `MAJOR_EVENT_SUGGESTIONS` is never consulted. Events have immutable keys, rename changes only `displayName`, events are never deleted, and unlinking never takes XP back.
- Wrapped is user-advanced, with no timer and no auto-play. It is a full page, not a `Dialog`. The year-to-date preview is never marked seen. Cards without data are omitted, and the favourite-circuit card has a data-sufficiency gate. The banner can be hidden. Nothing auto-opens.
- Completed years are frozen, and rebuilding happens only on an explicit, confirmed request. The time zone and week start are recorded on the chapter.
- Precision is honest: INTERPOLATED, STINT or RECOGNISED, with plain labels. Dates are written once. A 0-XP milestone names who pays ("Celebrated by …").
- Compare has small-denominator rules, the "Same stretch" toggle, and a `differencePhrase` that never says worse, decline or behind. The Story Complete rate is shown only from 5 races.
- On the Expedition timeline:
  - "Furthest point reached — not the same as watched";
  - stint lanes make re-watches visible;
  - `describeFragments` gives a caption;
  - there is hover, keyboard and touch parity;
  - the `GapList` is reused.
- Missing editions appear as muted rows, and runs of five or more years collapse.
- New pages are built only from the existing primitives. Charts move to `components/charts`. The `text-base` and `cn()` traps are called out. New copy goes through `tone.ts` and is registered in the tone tests.
- Navigation matches decision A7. Nested routes highlight their parent through the existing prefix match.
- The delete-race confirm text says exactly what goes and what stays. The false "XP already earned stays where it is" message on stint deletion is fixed (`actions.ts:335`).
- Every TESTING and DOCUMENTATION item in the brief is mapped to a named test or doc section (SPEC §8.2, §9).
