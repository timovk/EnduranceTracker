# Building the Windows application

There is no Windows machine and no Wine in this project's development
environment, so the `.exe` cannot be built or tried by hand here. It is built
by GitHub Actions on a `windows-latest` runner, which means the build has to be
right by construction rather than tuned by trial — nobody gets to iterate on it
interactively.

This file is what makes that possible: the order the steps must run in, why
each one depends on the last, and what to check the first time the result
reaches a real machine.

---

## Producing an installer

**From the Actions tab.** Open **Actions → Windows desktop build → Run
workflow**. When it finishes, the installer and the portable build are attached
to that run as artefacts.

**From a tag.** Push a tag beginning with `v`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Same build, and the two `.exe` files are additionally attached to a GitHub
Release for that tag. Keep the tag and `version` in `package.json` in step;
the artefact names are built from `version`.

The workflow is `.github/workflows/desktop-windows.yml`. It publishes to
nothing else: there is no update server and no auto-update, deliberately.

---

## The build order, and why it is load-bearing

```
npm ci
npm run db:generate          # prisma generate  — NEVER `npx prisma`
npm run desktop:rebuild      # better-sqlite3, for Electron's ABI
npm run desktop:build        # desktop/src -> desktop/out
npm run desktop:prepare      # next build + prepare-standalone.mjs
npx electron-builder --win nsis portable --publish never
```

`npm run dist:win` is exactly that chain, minus `npm ci`.

Three of those orderings are not stylistic.

**`desktop:rebuild` before `desktop:prepare`.** `better-sqlite3` is a native
module, and Node and Electron need it compiled against different ABIs. The
application's database work happens in two places: the Electron main process
(start-up migrations, backups) and the Next server child process — and the
child is Electron's own binary running with `ELECTRON_RUN_AS_NODE=1`, so both
want the Electron build. `next build` copies whatever `better_sqlite3.node` is
on disk at the time into `.next/standalone`. Rebuild afterwards and the
standalone tree keeps the Node-ABI copy: an installer that starts, shows a
window, and cannot open a career.

**`prepare-standalone.mjs` after `next build`.** `next build` produces most of
a runnable server and the gaps are silent — the application starts, serves
HTML, and has no styles, no images and no database. The script copies
`.next/static` and `public` into the standalone tree, deletes the `.env` that
`next build` helpfully copied in (a shipped application must never carry a
developer's `DATABASE_URL`), and then *verifies*: the native binary is present,
`server.js` is present, `BUILD_ID` is present. It exits non-zero and says what
is wrong if any of that fails. It is the guard rail that stops a broken
installer reaching somebody, so treat a failure there as the script doing its
job.

**`npmRebuild: false` in `electron-builder.yml`.** Letting the builder rebuild
native modules at packaging time would replace the binary the standalone tree
has already copied, which is the first ordering again, backwards.

## Never `npx prisma`

`prisma@latest` on npm is a release candidate for the next major version, with
a different command set. When `npx` cannot resolve the local binary it silently
fetches `latest` from the registry, and you get `CLI.UNKNOWN_COMMAND` from a
completely different program than the one you have installed. Always go through
the npm scripts — `npm run db:generate`, `npm run db:deploy` — which resolve
`node_modules/.bin` and nothing else.

## The native module, and `npm test`

`npm run desktop:rebuild` leaves `better_sqlite3.node` compiled for Electron.
Plain Node cannot load it, so from that moment `npm test`, `npm run dev` and
the seed scripts all fail with a confusing ABI error. Put it back with:

```bash
npm rebuild better-sqlite3
```

This matters only in a checkout. In CI the runner is thrown away, and the
typecheck-and-test job lives in a different workflow
(`.github/workflows/ci.yml`, on `ubuntu-latest`) that never rebuilds
anything.

---

## Rehearsing the whole chain on Linux

The Windows artefact cannot be produced here, but everything it is made of can
be, and running it is real verification:

```bash
npm run desktop:pack        # rebuild + build + prepare + linux dir
ls dist/linux-unpacked      # the launcher is the extensionless file in here
xvfb-run -a ./dist/linux-unpacked/<launcher>
```

and then the end-to-end script, which drives the real thing:

```bash
xvfb-run -a node tests/e2e/desktop.mjs --app dist/linux-unpacked/<launcher>
```

Without `--app` it drives the compiled shell in this checkout instead, which
needs `npm run desktop:build` and `npm run desktop:prepare` but no packaging
step. Either way, remember to `npm rebuild better-sqlite3` afterwards.

The script prints one line per check and ends with the count. In order, it:

- starts the application in a throwaway user-data folder, makes an account,
  adds a race, logs stints and checks the XP, the season pass and the update
  log;
- drives the 0.4.0 pages (`tests/e2e/career-history.mjs`): the menu order,
  Career Milestones with a dated milestone, an event created and given an
  edition, a 24-hour race logged from its own Expedition page with the
  timeline and checkpoints read back, Expedition Mode switched off (the
  checkpoints keep their XP), on again (nothing paid twice) and back to
  automatic, the Chronicle with this year's chapter and its Wrapped clicked to
  the last card, and the Records and Compare tabs of Career Statistics;
- makes a second, password-protected account and checks that neither account
  can see the other's races;
- shuts the application and reads the database: each checkpoint the page
  showed is held once, as career XP only; no chapter was frozen and no
  Wrapped marked seen for a year still being written; every milestone is
  dated; both new accounts are marked as needing no history pass;
- simulates an update from 0.3.0 (one pre-update copy, "What's new" once, the
  season reset once per account);
- simulates an upgrade from 0.3.2, below.

### The 0.3.2 → 0.4.0 upgrade

0.4.0 reads a career's whole history once, on its first start (the README's
*How historical backfilling works*), so the upgrade is rehearsed on a career
the real 0.3.2 code wrote: `tests/fixtures/career-0.3.2.db`.

- `npx vitest run tests/integration/upgrade-from-0.3.2.test.ts` migrates a
  copy of it with the desktop's own migration runner, runs the history pass,
  and checks it row by row: every stint, interval and race status as 0.3.2
  left them, every milestone and event step dated, the Expeditions paid and
  summed up, the 2025 chapter frozen, every dedupe key once and every running
  total right, and a second start changing nothing. (A pass cut short by the
  start-up budget, and resumed, is tested in
  `tests/integration/career-backfill.test.ts`.)
- The last section of `tests/e2e/desktop.mjs` rehearses the same upgrade in
  the packaged application, with fewer checks. It puts a copy of the fixture
  in the data folder in place of the career, makes the application think
  0.3.2 was the last version to run, and starts it. It then checks that the
  pre-update copy was taken before the migration, that "What's new" shows
  0.4.0, that 2025 is a finished chapter and the first race started is dated
  to its 2025 stint, and, once the application is shut, that the log has the
  `[career-backfill]` line for the account and no pause or failure, that the
  history pass is marked complete, that no milestone is undated and that the
  2025 chapter was frozen once. The SQL it uses is shared with the
  integration test above, which runs every query of it against the fixture
  before and after the upgrade, so it is known to recognise a finished
  upgrade before anything is packaged.

To try an upgrade by hand, do it on a copy, never on a real
`endurance.db`:

```bash
cp tests/fixtures/career-0.3.2.db /tmp/upgrade.db   # or a copy of a real career
DATABASE_URL=file:/tmp/upgrade.db npm run db:deploy
DATABASE_URL=file:/tmp/upgrade.db npm run dev
```

The server's output shows the `[career-backfill]` line as it starts; open
the Chronicle, Career Milestones, Events and a long race's Expedition page.
The fixture's account, *Demo Driver*, has no password.

### Regenerating the 0.3.2 fixture

The fixture is committed and should not need regenerating. If it ever does,
it must be written by the 0.3.2 code, not by this one, so make it in a
separate worktree of the 0.3.2 release, `4c59efc`:

```bash
git worktree add ../erc-0.3.2 4c59efc
cd ../erc-0.3.2
npm ci                              # its own node_modules, built for Node
DATABASE_URL=file:$OLDPWD/tests/fixtures/career-0.3.2.db ./node_modules/.bin/prisma migrate deploy
DATABASE_URL=file:$OLDPWD/tests/fixtures/career-0.3.2.db npm run db:seed:demo
cd "$OLDPWD" && git worktree remove ../erc-0.3.2
```

Move the old file aside first: both commands add to whatever is there. Use
`db:seed:demo`, not `db:seed`, which makes an empty career and would test
nothing. The seed dates the demonstration career relative to the moment it
runs, so afterwards update the generation time in `tests/fixtures/README.md`
and `FIXTURE_GENERATED_AT` in `tests/helpers/fixture-db.ts`, and check the
years the tests expect of it (the upgrade test and `FIXTURE_FIRST_YEAR` in
`tests/e2e/desktop.mjs` both expect its first year to be 2025).

---

## What to check the first time it runs on Windows

Everything below has either been verified on Linux or reasoned about carefully;
none of it has been watched happening on Windows. In rough order of how badly
it would hurt to get wrong:

- [ ] The installer runs **without** an administrator prompt, and lets you
      choose the folder.
- [ ] The Start-menu entry and the desktop shortcut both open the application.
- [ ] First launch reaches the Welcome screen — not a blank white window, not a
      silent exit. If it fails it must fail into an error window with a button
      that opens the log folder.
- [ ] The database appears at
      `%APPDATA%\Endurance Racing Career\data\endurance.db`, and
      `logs\main.log` records the migrations being applied.
- [ ] Create an account, add a race, log a stint, and check the XP appears.
- [ ] Close the application, then check Task Manager: **no `electron.exe` is
      left behind**. `SIGTERM` is not real on Windows and this is the path that
      could not be exercised on Linux.
- [ ] Reopen it: the window returns to the size and position it had.
- [ ] Launch it twice: the second launch focuses the first window rather than
      opening a second copy.
- [ ] **Career → Back up career…** writes a file that opens as a database.
- [ ] Install 0.4.0 over a 0.3.2 that has a career in it:
      `backups\pre-update-0.4.0-<date>.db` appears, `logs\main.log` has one
      `[career-backfill]` line per account and none that says `failed`, every
      milestone reached on the Career Milestones page (from the Career page)
      shows a date, and the Chronicle opens on this year's chapter.
- [ ] Uninstall, and confirm `%APPDATA%\Endurance Racing Career` is still
      there with the career in it. Reinstall, and confirm the career is back.
- [ ] The portable build runs from a folder it was just dropped into.

---

## The icon

`build/icon.ico` and `build/icon.png` are generated, not drawn by hand:

```bash
npm run desktop:icon
```

`scripts/desktop/make-icon.mjs` writes both, so the icon is reproducible rather
than a mystery binary in the repository. If you change it, check it at 16×16
first — that is the size it will be seen at most often, and the size that
decides whether a design works.
