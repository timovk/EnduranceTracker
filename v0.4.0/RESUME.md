# Where the v0.4.0 build stopped (26 September 2026)

- **Done, reviewed and committed on `release/v0.4.0`:**
  - WP1 foundation (`d617807`)
  - WP2 engine plumbing, ledger settlement, deleting a race takes its XP back (`f18c75d`)
  - WP3 Career Milestones, exact landmark dates, upgrade backfill (`228d90e`)
  - WP4 Event Legacy (`8a9e8fa`)
  - WP5 Race Expeditions (`688f1b7`)
  - WP6 Career Statistics (`ee42fb0`)
- **Paused mid-way:** WP7 (Career Chronicle and Endurance Wrapped). The unfinished,
  unreviewed changes are saved as a commit on `wip/v0.4.0-wp7`. They are not on
  `release/v0.4.0`.
- **Still to do:** the rest of WP7, then WP8 (docs, version 0.4.0, changelog, e2e
  checks), then the final whole-update review, the packaged desktop build and the
  upgrade test.

To resume: check out `release/v0.4.0`, bring the partial work across as uncommitted
changes (`git checkout wip/v0.4.0-wp7 -- . && git reset -q`), then run
`build-v040.js` with args `{"wps": [7, 8], "partial": 7}`. Each work package reads the
`HANDOFF-WP*.md` notes of the ones before it; the script expects `SPEC.md` and these
notes in the scratchpad `v040/` folder.
