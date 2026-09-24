# Where the v0.4.0 build stopped (24 September 2026, evening)

- **Done:** WP1 (foundation), reviewed and committed as `d617807` on `release/v0.4.0`.
- **Paused mid-way:** WP2 (engine plumbing, ledger settlement, deleting a race takes
  its XP back). The unfinished, unreviewed changes are saved as `30e45ba` on
  `wip/v0.4.0-wp2`. They are not on `release/v0.4.0`.
- **Still to do:** the rest of WP2, then WP3 to WP8 as `SPEC.md` §10 describes, then
  the final whole-update review, the packaged desktop build and the upgrade test.

To resume: start from `release/v0.4.0`. Either restart WP2 from scratch, or bring
the saved partial work across as uncommitted changes
(`git checkout wip/v0.4.0-wp2 -- .` after checking out `release/v0.4.0`) and tell
the WP2 implementer to finish it. Then run the remaining work packages with
`build-v040.js`, starting its loop at the next unfinished WP. Each work package
reads the `HANDOFF-WP*.md` notes of the ones before it, and the scripts expect
`SPEC.md` and these notes in the scratchpad `v040/` folder.
