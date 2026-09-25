# Where the v0.4.0 build stopped (25 September 2026)

- **Done:** WP1 (foundation, `d617807`) and WP2 (engine plumbing, ledger settlement,
  deleting a race takes its XP back, `f18c75d`), both reviewed and committed on
  `release/v0.4.0`.
- **Paused mid-way:** WP3 (Career Milestones and the upgrade backfill framework). The
  unfinished, unreviewed changes are saved as `96397b5` on `wip/v0.4.0-wp3`. They are
  not on `release/v0.4.0`.
- **Still to do:** the rest of WP3, then WP4 to WP8 as `SPEC.md` §10 describes, then
  the final whole-update review, the packaged desktop build and the upgrade test.

To resume: check out `release/v0.4.0`, bring the partial work across as uncommitted
changes (`git checkout wip/v0.4.0-wp3 -- . && git reset -q`), then run `build-v040.js`
with args `{"wps": [3, 4, 5, 6, 7, 8], "partial": 3}`. Each work package reads the
`HANDOFF-WP*.md` notes of the ones before it; the script expects `SPEC.md` and these
notes in the scratchpad `v040/` folder.
