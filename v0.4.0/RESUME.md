# Where the v0.4.0 build stopped (26 September 2026, evening)

- **Done, reviewed and committed on `release/v0.4.0`:** WP1 foundation (`d617807`),
  WP2 ledger settlement and delete-race XP (`f18c75d`), WP3 Career Milestones and
  backfill (`228d90e`), WP4 Event Legacy (`8a9e8fa`), WP5 Race Expeditions
  (`688f1b7`), WP6 Career Statistics (`ee42fb0`), WP7 Career Chronicle and
  Endurance Wrapped (`a0be7d3`).
- **Paused just after starting:** WP8 (docs, version 0.4.0, changelog, e2e checks).
  The small unfinished change set is saved on `wip/v0.4.0-wp8`; it is not on
  `release/v0.4.0`.
- **Still to do:** WP8, then the final whole-update review (integrity/exploits,
  upgrade from 0.3.2, statistics correctness, UI screenshots of every new page,
  account isolation, performance, completeness against the brief), fixes, the
  packaged desktop build with the e2e run, and merging to `main` for release.

To resume: check out `release/v0.4.0`, bring the partial work across as uncommitted
changes (`git checkout wip/v0.4.0-wp8 -- . && git reset -q`), then run
`build-v040.js` with args `{"wps": [8], "partial": 8}`.
