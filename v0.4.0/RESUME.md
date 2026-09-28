# Where the v0.4.0 build is (28 September 2026)

- **All eight work packages are done**, reviewed and committed on `release/v0.4.0`
  (WP8 = `554c361`: docs, version 0.4.0, changelog, 0.3.2 upgrade e2e).
- **Running:** the final whole-update review (`final-review.js`): seven lenses, a
  skeptic per finding, grouped fixes committed as "v0.4.0 review fixes: <area>", and a
  final gate.
- **Still to do after it:** `npm run desktop:pack` and the packaged e2e
  (`xvfb-run -a node tests/e2e/desktop.mjs --app dist/linux-unpacked/endurance-racing-career`),
  then `npm rebuild better-sqlite3`, then merge to `main` for the owner to publish.
