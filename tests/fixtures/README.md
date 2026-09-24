# Test fixtures

## `career-0.3.2.db`

A career database written by the real 0.3.2 code, so the 0.4.0 migration and
upgrade are tested against what 0.3.2 actually wrote rather than against rows a
test inserted to look like it. It holds only the demonstration career: one
account ("Demo Driver"), three championships, eleven races and 28 stints
logged through the real `logViewingSession`, backdated across 2025 and 2026 by
the seed, with the ledger, intervals, achievements, mastery, milestones and
Hall of Fame rows exactly as 0.3.2 left them.

- **Commit:** `4c59efc` (Release 0.3.2), with the 0.3.2 schema and its three
  migrations.
- **Generated:** 24 September 2026, 16:41:05 UTC. The seed dates everything
  relative to the moment it runs, so tests that reason about this fixture use
  `2026-09-24T16:41:05Z` (or a moment shortly after it) as their `now`.
- **Command,** run from the repository root before the 0.4.0 schema change:

  ```
  DATABASE_URL=file:./tests/fixtures/career-0.3.2.db ./node_modules/.bin/prisma migrate deploy
  DATABASE_URL=file:./tests/fixtures/career-0.3.2.db npm run db:seed:demo
  ```

  `npm run db:seed` without `:demo` creates an empty career, which would test
  nothing.

Never open it for writing. `tests/helpers/fixture-db.ts` copies it to a
temporary file for each test run, and every test works on the copy.
