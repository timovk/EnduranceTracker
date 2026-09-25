export const meta = {
  name: 'build-v040',
  description: 'Implement v0.4.0 in eight sequential work packages: implement, independent review, fix and commit each',
  phases: [
    { title: 'WP1', detail: 'foundation: fixture, schema, migration, config, pure domain' },
    { title: 'WP2', detail: 'engine plumbing, ledger settlement, delete race takes XP back' },
    { title: 'WP3', detail: 'Career Milestones and the backfill framework' },
    { title: 'WP4', detail: 'Event Legacy' },
    { title: 'WP5', detail: 'Race Expeditions' },
    { title: 'WP6', detail: 'Career Statistics' },
    { title: 'WP7', detail: 'Career Chronicle and Endurance Wrapped' },
    { title: 'WP8', detail: 'docs, version, changelog, e2e script, final verification' },
  ],
}

const DIR = '/tmp/claude-0/-home-user/10fd3b34-9c72-549b-815e-13d3a5861b5e/scratchpad/v040'
const REPO = '/home/user/endurance-racing-career'
const TRAILER = `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Rio8U8hJKBeyrsAUWEqVik`

const COMMON = `
You are building v0.4.0 of EnduranceTracker, a personal Windows desktop app (Electron + Next.js 16 App Router + React 19 + Tailwind 4 + Prisma 7/better-sqlite3 SQLite + Vitest). Repository: ${REPO}, branch release/v0.4.0.
The binding design is ${DIR}/SPEC.md (read §1 fully, §10 "Rules for every WP" and your WP, and every section your WP references; it cites file:line — find moved lines by symbol). The owner's brief and decisions are in ${DIR}/BRIEF.md. Reference artifacts: ${DIR}/work/schema.v040.prisma, ${DIR}/work/migration.sql, ${DIR}/work/econ-model.ts. Earlier work packages left hand-off notes in ${DIR}/HANDOFF-WP*.md — read all that exist before starting; they record deviations and facts you must know.
Hard rules:
- The Next.js in node_modules is newer than your training data: read the relevant guide in node_modules/next/dist/docs/ before relying on framework behaviour you have not seen used in this repo. Heed deprecations.
- Never run npx prisma (use npm run db:generate / npm run db:deploy / ./node_modules/.bin/prisma). Never run npm install, npm rebuild, desktop:rebuild, desktop:pack or electron-rebuild: better-sqlite3 must stay built for Node so the tests run. Do not edit an applied migration (the three from 2026-09-22).
- Keep TypeScript strict; no broad any, no ts-ignore, no eslint-disable to get green. No placeholders, fake statistics, TODO buttons, dead navigation or mocked production data. Do not delete existing functionality.
- Match the surrounding code: its comment density, naming, idiom, plain British-English user copy and tone rules (src/lib/copy/tone.ts, tests/domain/design-rules.test.ts). Tailwind trap: text-base is a colour here, use text-[1rem].
- The user-data folder, the real endurance.db and anything outside the repo and ${DIR} are off limits, except the test DB the test setup manages.
- Work in the repository working tree directly; do not create git worktrees or branches. Do not commit unless your instructions say so.
`

const CHECKS = `npm run db:generate && ./node_modules/.bin/next typegen && npx tsc --noEmit && npx eslint && npx vitest run`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    checks_passed: { type: 'boolean', description: 'true only if every command in the check list passed' },
    check_output: { type: 'string', description: 'Tail of any failing command output, else empty' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
    spec_gaps: { type: 'array', items: { type: 'string' }, description: 'Items this WP was required to deliver (per SPEC §10 and referenced sections) that are missing or partial' },
  },
  required: ['checks_passed', 'check_output', 'issues', 'spec_gaps'],
}

const WPS = (args && Array.isArray(args.wps)) ? args.wps : [1, 2, 3, 4, 5, 6, 7, 8]
const PARTIAL = args && typeof args.partial === 'number' ? args.partial : null
const results = []

for (const n of WPS) {
  phase(`WP${n}`)
  const wp8 = n === 8
    ? `\nWP8 specifics: do the documentation, version bump to 0.4.0 everywhere, the changelog entry (plain, warm, owner-facing voice like the existing entries) and CHANGELOG.md via npm run changelog, and add the e2e checks to tests/e2e/desktop.mjs (syntax-check with node --check). Do NOT run the packaged e2e or any build that rebuilds better-sqlite3 — the lead will run desktop:pack and the e2e afterwards. DO run the production web build (npm run build) and fix anything it reports. Write the owner notes from SPEC §9.4 into ${DIR}/OWNER-NOTES.md.`
    : ''
  const resume = n === PARTIAL
    ? `\nRESUMING: WP${n} was started earlier and stopped part-way at the owner's request, before it was finished, tested or reviewed. Its unfinished changes are present in the working tree as uncommitted changes (git diff HEAD, git status). There is no hand-off note for it yet. Read those changes critically first: keep what is correct and matches the spec, fix what is wrong or incomplete, and finish everything WP${n} requires.`
    : ''
  const extra = `${wp8}${resume}`
  const impl = await agent(`${COMMON}
Implement WORK PACKAGE WP${n} exactly as SPEC.md §10 WP${n} specifies, including every file, function, hook, test and acceptance criterion it lists and every section it references.${extra}
Where the spec is wrong about the current code or impossible as written, make the smallest sound deviation and record it. When done, run: ${CHECKS} plus the targeted tests and perf checks your WP names; iterate until all pass (fix causes, never bypass).
Finally write ${DIR}/HANDOFF-WP${n}.md: what you built (files), deviations from the spec with reasons, facts later WPs must know (new function names/signatures, hooks added, config keys, gotchas), and the exact check results. Return a 200-word summary.`, { label: `WP${n}:implement`, phase: `WP${n}` })

  const review = await agent(`${COMMON}
You are an independent reviewer of WORK PACKAGE WP${n} (read SPEC.md §10 WP${n}, the sections it references, and ${DIR}/HANDOFF-WP${n}.md). The implementation is the UNCOMMITTED diff: git -C ${REPO} diff HEAD, plus untracked files (git -C ${REPO} status --porcelain). Do NOT edit repository files (scratch files only under ${DIR}/review-wp${n}/).
1. Run: ${CHECKS} and the WP's targeted tests; report pass/fail honestly.
2. Review the diff for: correctness bugs, XP paid twice or exploitable (rewatch, speed, delete+relog, delete+recreate race, re-key/merge, toggles, recompute, backfill rerun), ledger not settled after removals, account-isolation leaks (every query scoped by userId), migration/data-safety problems, time-zone/calendar mistakes, performance traps (N+1, loading all sessions per stint beyond what the spec allows), missing or weak tests (tests that would still pass if the feature were broken — try a mutation mentally or in a scratch copy), design-rule/tone violations, placeholders/fake data, and deviations from the spec that are not justified in the hand-off.
3. List spec items for this WP that are missing or partial.
Report only concrete, evidenced problems with precise fixes.`, { label: `WP${n}:review`, phase: `WP${n}`, schema: REVIEW_SCHEMA })

  const fix = await agent(`${COMMON}
You are finishing WORK PACKAGE WP${n}. The implementation is the uncommitted diff in ${REPO}; its hand-off note is ${DIR}/HANDOFF-WP${n}.md. An independent reviewer reported:
${JSON.stringify(review ?? { checks_passed: false, check_output: 'reviewer returned nothing — run the checks yourself and review the diff', issues: [], spec_gaps: [] }, null, 1)}
For each issue and spec gap: verify it against the code; fix every valid one (with a test where it is a behaviour); for any you reject, write the reason in the hand-off note. Then run ${CHECKS} and the WP's targeted tests until everything passes. Update ${DIR}/HANDOFF-WP${n}.md (add a "Review fixes" section).
Then commit ALL changes (git add -A; make sure no stray scratch files or real databases are included — tests/fixtures/*.db may be committed only if the spec says so) with a message titled "v0.4.0 WP${n}: <short summary>", a body describing what the WP delivered in a few bullet points, and ending with exactly these two lines:
${TRAILER}
Then push: git push -u origin release/v0.4.0 (retry up to 4 times with 2s/4s/8s/16s backoff on network errors only). Return a 150-word summary including the commit hash and the final check results.`, { label: `WP${n}:fix+commit`, phase: `WP${n}` })

  results.push({ wp: n, impl, review_issue_count: review ? review.issues.length : null, review_checks_passed: review ? review.checks_passed : null, spec_gaps: review ? review.spec_gaps : null, fix })
  log(`WP${n} done: ${review ? review.issues.length : '?'} review issues; ${String(fix).slice(0, 160)}`)
}

return results
