export const meta = {
  name: 'final-review-v040',
  description: 'Whole-update review of v0.4.0 across seven lenses, adversarial verification, grouped fixes, and a final green gate',
  phases: [
    { title: 'Review', detail: 'seven independent lenses over the whole v0.4.0 diff' },
    { title: 'Verify', detail: 'one skeptic per finding tries to refute it' },
    { title: 'Fix', detail: 'confirmed findings fixed area by area, committed and pushed' },
    { title: 'Gate', detail: 'full checks, production build, perf harness, final report' },
  ],
}

const DIR = '/tmp/claude-0/-home-user/10fd3b34-9c72-549b-815e-13d3a5861b5e/scratchpad/v040'
const REPO = '/home/user/endurance-racing-career'
const BASE = '4c59efc'
const TRAILER = `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Rio8U8hJKBeyrsAUWEqVik`

const COMMON = `
You are working on v0.4.0 of EnduranceTracker, a personal Windows desktop app (Electron + Next.js 16 App Router + React 19 + Tailwind 4 + Prisma 7/better-sqlite3 SQLite + Vitest) used daily by one non-technical owner. Repository: ${REPO}, branch release/v0.4.0. The whole update is the diff ${BASE}..HEAD (0.3.2 was ${BASE}).
Binding design: ${DIR}/SPEC.md (§1 rules; §6 exploit table; §8 test plan). Owner's brief and decisions: ${DIR}/BRIEF.md. Each work package's notes and deviations: ${DIR}/HANDOFF-WP1.md … HANDOFF-WP8.md. Owner notes: ${DIR}/OWNER-NOTES.md.
Environment rules:
- The Next.js in node_modules is newer than your training data: read node_modules/next/dist/docs/ before asserting framework behaviour.
- Never run npm install, npm rebuild, desktop:rebuild, desktop:pack or electron-rebuild (better-sqlite3 must stay built for Node). Never use npx prisma (use ./node_modules/.bin/prisma or the npm scripts).
- SHARED TEST DATABASE: other agents run in parallel. Whenever you run vitest or any script that touches a database, point it at your OWN copy: prefix commands with DATABASE_URL=file:${DIR}/db/<your-label>.db (create ${DIR}/db/ first; the test setup migrates a new file automatically; dotenv does not override an existing DATABASE_URL). Never use the repository's endurance.db or endurance-test.db.
- Chromium for screenshots is at /opt/pw-browsers (Playwright is configured; never run playwright install).
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string', enum: ['xp-integrity', 'upgrade', 'statistics', 'ui', 'isolation', 'performance', 'completeness'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
          reproduction: { type: 'string', description: 'Exact steps/commands/inputs that show it, and what happened vs what should happen' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'area', 'file', 'problem', 'reproduction', 'fix'],
      },
    },
    verified_ok: { type: 'array', items: { type: 'string' }, description: 'Important things you checked that are correct (brief)' },
  },
  required: ['findings', 'verified_ok'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    best_fix: { type: 'string' },
  },
  required: ['real', 'confidence', 'reasoning', 'best_fix'],
}

const REVIEW_RULES = `
READ-ONLY on the repository: do not edit, create or delete files under ${REPO} (git worktrees you create under ${DIR} for comparison are fine; remove them when done). Scratch files go under ${DIR}/final/<your-label>/.
Report only concrete, reproduced problems with a precise fix. A test that would still pass if the feature were broken counts as a problem (say which mutation survives). Do not report style preferences. An empty findings list is a valid answer.`

const LENSES = [
  {
    key: 'xp-integrity',
    prompt: `LENS: XP integrity and exploits. Using real-database scripts or scratch vitest files (against your own DB copy), actively try to earn XP twice or keep XP that should be revoked through every path: rewatching covered time; playback speed extremes (0.1x RANGE, 8x); crossing an expedition checkpoint repeatedly (log, delete, relog; shrink runtime then restore it); toggling Expedition Mode off/on; lowering thresholds via config/settings; deleting and recreating stints and races (with the same name, date, runtime); moving races between events, renaming, merging and re-creating events; backdated and future watchedAt; running the upgrade backfill twice, interrupted mid-way, and after new data; running db:recompute; restarting. Also check: every new ledger row has seasonAmount 0; the ledger sum equals CareerProfile.careerXp after each attack (settleLedger); landmarks (milestones, mastery steps, expedition summaries, chronicle years) are never revoked or re-dated; season-pass XP is unaffected. Report each attack you ran and its outcome in verified_ok if it held.`,
  },
  {
    key: 'upgrade',
    prompt: `LENS: upgrading a real 0.3.2 career. Build a realistic 0.3.2 database WITH THE 0.3.2 CODE: git -C ${REPO} worktree add ${DIR}/final/upgrade/v032 ${BASE}; symlink ${REPO}/node_modules into it; generate its Prisma client there; create a DB at ${DIR}/db/upgrade-v032.db with its migrations; create two accounts and a varied career through its own engines (several championships and seasons, iconicKey events with 3+ editions across years, a 24h race partly watched with fragmented coverage, a 12h Story Complete, rewatches, a deleted stint, a race deleted, stints spanning local midnight and New Year's Eve via backdated watchedAt). Then apply the v0.4.0 migrations the way the desktop app does (desktop/src/migrate.ts runner) and run the v0.4.0 start-up upgrade (src/instrumentation.ts register / the career backfill) against it. Verify: no row lost or changed that should not be; migration idempotent; backfill idempotent and resumable (interrupt it); every milestone that had been reached exists with a correct historical achievedAt (interpolated inside the crossing stint for hour rungs) and precision label; no XP paid twice; event steps and expedition checkpoints awarded correctly; Chronicle years correct; the second account is independent; timing within the start-up budget. Also check tests/fixtures and tests/integration/upgrade-from-0.3.2.test.ts really exercise this. Remove your worktree at the end.`,
  },
  {
    key: 'statistics',
    prompt: `LENS: correctness of derived numbers. Build a small hand-computable career in your own DB (fixed now, local-time zone set explicitly, e.g. TZ=Europe/Amsterdam and TZ=America/Los_Angeles runs) including: a stint spanning local midnight, one spanning 31 Dec -> 1 Jan, a leap-day stint (2028-02-29), rewatch, speed 2x and 0.5x, a race Story Completed over two calendar years, an iconicKey event with a missing edition year (streak break), a 7-day window record. Compute by hand the expected Chronicle chapter figures (hours, coverage, races started/completed, Story Completes, XP/levels gained, most active week/month, longest session, notable races), Wrapped cards, Career Statistics (lifetime and per-year filters, event/race filters), year-vs-year comparison (small-denominator rules), every Personal Record, Event Legacy page figures and streaks, Expedition page figures and summary, and milestone achievedAt instants. Compare with what the engines/services return. Report every mismatch with numbers.`,
  },
  {
    key: 'ui',
    prompt: `LENS: the user interface. Build the app (cd ${REPO} && npm run build — you are the only agent allowed to build) and start it (npm run start -- -p 3217) against your own DB copy seeded two ways: (a) a brand-new account with two races and three stints; (b) a rich career (npm run db:seed:demo against your DB, plus several years of backdated stints if the demo is thin). Sign in through the UI (the app has local accounts). With Playwright + Chromium, screenshot EVERY new or changed page at 1440x900 and 390x844 in both careers: /chronicle, /chronicle/[year] (a completed year and the current year-to-date), the Wrapped deck for both (step through every card; also with prefers-reduced-motion: reduce), /events, /events/[key], event management (create, rename, merge, link a race), a race page with Expedition Mode on and off, /races/[id]/expedition before and after Story Complete (summary), /stats every tab incl. Records and Compare with filters, the Career Milestones page, the dashboard and nav. Save screenshots under ${DIR}/shots/ with descriptive names. Look at each screenshot yourself: report layout breakage, overflow, unreadable contrast, empty-state failures, wrong or fabricated numbers, jargon or tone-rule violations (src/lib/copy/tone.ts), placeholders/TODOs, dead links or buttons that do nothing, console errors, hydration warnings, and anything that looks unlike the rest of the app. Stop the server when done.`,
  },
  {
    key: 'isolation',
    prompt: `LENS: account isolation and input handling. Enumerate every new/changed page, server action, route handler and service in the diff. For each: is the account resolved server-side (requireUserId), is every query and write scoped by userId, are ids/keys/years from the browser resolved inside the account before use (a race id, event key, merge target, summary id, year from another account must not read or change anything), are inputs validated (zod) with sane bounds, do caches key by userId, can one account's backfill/recompute touch another's data. Prove leaks with a two-account script against your own DB copy. Also check tests/auth/account-isolation.test.ts covers the new surfaces.`,
  },
  {
    key: 'performance',
    prompt: `LENS: performance at ten-year scale. Run the perf harness (see SPEC §1.3, §8 and HANDOFF notes; PERF=1 npx vitest run tests/perf with your own DATABASE_URL) and record every number against the §1.3 targets. Inspect the hot paths added in the diff for N+1 queries, full-table loads per stint, per-request replays that bypass the timeline cache, cache invalidation holes (stale data after delete/edit/merge/toggle), unbounded lists rendered without pagination/aggregation on pages (thousands of races/sessions), and missing indexes (EXPLAIN QUERY PLAN on the real queries). Report measured regressions and misses with numbers.`,
  },
  {
    key: 'completeness',
    prompt: `LENS: completeness against the owner's brief. Go through ${DIR}/BRIEF.md line by line (every statistic, section, Wrapped item, legacy stat and milestone, expedition field and summary field, statistics item, record, milestone example, cross-system integration, database/migration/recompute item, XP integrity item, UI/UX item, performance item, TESTING item, DOCUMENTATION item, version item) and find where each is implemented (file + function or test name). Report as findings only the items that are missing, partial, fabricated, non-functional, or contradicted by the owner's decisions (the decisions at the top of BRIEF.md override the brief's examples; SPEC §1.2 R4 lists the sanctioned zero-XP departures). Confirm the version is 0.4.0 everywhere and the docs (README, docs/) cover every DOCUMENTATION item accurately.`,
  },
]

phase('Review')
const reviewed = await pipeline(
  LENSES,
  (lens) => agent(`${COMMON}\n${REVIEW_RULES}\n\n${lens.prompt}\nUse the label "${lens.key}" for your DB copy and scratch folder.`,
    { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS }),
  (res, lens) => parallel((res?.findings ?? []).map((f, i) => () =>
    agent(`${COMMON}\nA reviewer (lens ${lens.key}) reported the finding below against v0.4.0. Try to REFUTE it: re-derive the facts from the code and reproduce it yourself (read-only on the repository; scratch under ${DIR}/final/verify-${lens.key}-${i + 1}/, your own DB copy labelled verify-${lens.key}-${i + 1}). Mark real=true only if you reproduced it or the code unambiguously shows it AND it matters to the owner or to correctness/integrity. Theoretical concerns, style, or intended documented behaviour (check SPEC.md and the HANDOFF notes) are real=false. Give the best fix.\n\nFINDING:\n${JSON.stringify(f, null, 2)}`,
      { label: `verify:${lens.key}:${i + 1}`, phase: 'Verify', schema: VERDICT })
      .then((v) => ({ ...f, lens: lens.key, verdict: v })))),
)

const all = reviewed.filter(Boolean).flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict && f.verdict.real)
const refuted = all.filter((f) => !(f.verdict && f.verdict.real))
log(`${all.length} findings, ${confirmed.length} confirmed, ${refuted.length} refuted`)

phase('Fix')
const ORDER = ['xp-integrity', 'upgrade', 'isolation', 'statistics', 'performance', 'completeness', 'ui']
const fixes = []
for (const area of ORDER) {
  const group = confirmed.filter((f) => f.area === area || (!ORDER.includes(f.area) && f.lens === area))
  if (group.length === 0) continue
  const out = await agent(`${COMMON}
You are fixing confirmed review findings in the area "${area}" for v0.4.0. Work in the repository working tree on release/v0.4.0 (you MAY edit files now). Findings, each with an independent verifier's reasoning and best fix:
${JSON.stringify(group, null, 1)}
For each finding: fix the cause (not the symptom), add or strengthen a test that fails without the fix, and keep the design rules (SPEC §1.2). If on inspection a finding is wrong or intended behaviour, do not change it; record why. Use your own DB copy for tests (DATABASE_URL=file:${DIR}/db/fix-${area}.db). Then run: npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && DATABASE_URL=file:${DIR}/db/fix-${area}.db npx vitest run — all must pass. Append a section to ${DIR}/FINAL-FIXES.md listing each finding and what you did. Commit all changes with title "v0.4.0 review fixes: ${area}", a short bullet body, ending with exactly:
${TRAILER}
Push with git push origin release/v0.4.0 (retry on network errors 2s/4s/8s/16s). Return a 150-word summary with the commit hash.`, { label: `fix:${area}`, phase: 'Fix' })
  fixes.push({ area, count: group.length, out })
}

phase('Gate')
const gate = await agent(`${COMMON}
Final gate for v0.4.0 on release/v0.4.0 (you may edit files only to fix a failure you find, then commit and push as "v0.4.0 final gate fixes" with the trailer below). Run, with DATABASE_URL=file:${DIR}/db/gate.db where a database is used:
1. npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && npx vitest run (report the test count)
2. PERF=1 npx vitest run tests/perf (report numbers vs SPEC §1.3)
3. npm run build (production build)
4. node --check tests/e2e/desktop.mjs and any other e2e scripts
5. git status is clean and origin/release/v0.4.0 equals HEAD
Then write ${DIR}/FINAL-REPORT.md: what v0.4.0 contains (plain words, per system), the check results with numbers, the review statistics (findings/confirmed/fixed), anything deliberately not done or deferred with reasons, and the owner notes. Return the report text.
Trailer for any commit:
${TRAILER}`, { label: 'gate', phase: 'Gate' })

return {
  counts: { findings: all.length, confirmed: confirmed.length, refuted: refuted.length },
  confirmed: confirmed.map((f) => ({ area: f.area, severity: f.severity, title: f.title })),
  refuted: refuted.map((f) => ({ area: f.area, title: f.title, why: f.verdict ? f.verdict.reasoning.slice(0, 300) : 'no verdict' })),
  fixes,
  gate,
}
