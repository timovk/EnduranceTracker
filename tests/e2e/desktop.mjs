/**
 * The desktop application, driven the way a person drives it.
 *
 * This is the only test that exercises what actually ships: an Electron main
 * process, a Next server running as a child of it, a SQLite file in a fresh
 * user-data folder, and two accounts that must not be able to see each other.
 * Everything else in `tests/` checks a piece; this checks that the pieces were
 * assembled.
 *
 * It is NOT part of `npm test`, deliberately. It needs a build, it needs a
 * display, and on this machine it needs `better-sqlite3` compiled for
 * Electron's ABI — which is the same file `npm test` needs compiled for Node's.
 * The two cannot both be true at once, so this is a script you run on purpose.
 *
 *   npm run desktop:rebuild        # better-sqlite3 for Electron's ABI
 *   npm run desktop:prepare        # next build + prepare-standalone (§1.2 order)
 *   npm run desktop:build          # compile desktop/src -> desktop/out
 *   xvfb-run -a node tests/e2e/desktop.mjs
 *
 *   npm rebuild better-sqlite3     # ...and back to Node's ABI for `npm test`
 *
 * Options:
 *   --app <path>   drive a packaged binary (dist/linux-unpacked/...) instead
 *                  of the compiled shell in this checkout
 *   --keep         leave the throwaway user-data folder behind to look at
 *   --headed       ignored; kept so the command reads the same as Playwright's
 *
 * This has been run against the packaged Linux build under xvfb: 29 checks,
 * including a simulated update from 0.2.0, all passing in about a minute and
 * a half. It is not a paper exercise.
 */

import { _electron as electron } from 'playwright';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const argv = process.argv.slice(2);
const packagedApp = valueOf('--app');
const keepUserData = argv.includes('--keep');

/** The server may be building on first launch, so nothing here is in a hurry. */
const BOOT_TIMEOUT_MS = 120_000;
const ACTION_TIMEOUT_MS = 30_000;

const FIRST_ACCOUNT = 'Alex';
const SECOND_ACCOUNT = 'Sam';
const SECOND_PASSWORD = 'sebring-12';

function valueOf(flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

// ---------------------------------------------------------------------------
// A very small harness. A test runner here would be more machinery than test.
// ---------------------------------------------------------------------------

let failures = 0;
let passes = 0;

async function step(name, work) {
  process.stdout.write(`  ${name} ... `);
  try {
    await work();
    passes += 1;
    process.stdout.write('ok\n');
  } catch (error) {
    failures += 1;
    process.stdout.write('FAILED\n');
    process.stdout.write(`      ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------------------
// Driving the shell
// ---------------------------------------------------------------------------

/**
 * The window showing the application.
 *
 * The first window to appear is the splash, which is a local file and has no
 * http URL. The one we want is whichever ends up on 127.0.0.1, and it may not
 * exist for a minute while migrations run and the server boots.
 */
async function waitForApplicationWindow(app) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const window of app.windows()) {
      const url = window.url();
      if (url.startsWith('http://127.0.0.1')) {
        await window.waitForLoadState('domcontentloaded');
        return window;
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }

  throw new Error(
    `No window reached the application within ${BOOT_TIMEOUT_MS / 1000}s. ` +
      'Check the log in the user-data folder — the server child writes into it.',
  );
}

/** The origin the server ended up on, which is a fresh port on every launch. */
function originOf(page) {
  return new URL(page.url()).origin;
}

async function go(page, path) {
  await page.goto(`${originOf(page)}${path}`, { waitUntil: 'domcontentloaded' });
}

/** Wait until the window is on a path this function accepts. */
async function waitForPath(page, accepts) {
  await page.waitForURL((url) => accepts(url.pathname), { timeout: ACTION_TIMEOUT_MS });
}

function pathOf(page) {
  return new URL(page.url()).pathname;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const userDataDir = mkdtempSync(join(tmpdir(), 'endurance-e2e-'));
process.stdout.write(`Throwaway user data: ${userDataDir}\n`);

const launchOptions = packagedApp
  ? { executablePath: resolve(packagedApp), args: [`--user-data-dir=${userDataDir}`] }
  : {
      args: [
        join(ROOT, 'desktop', 'out', 'main.js'),
        // Run the built standalone server rather than `next dev`, which is
        // what an installed copy does.
        '--standalone',
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: ROOT,
    };

const startedAt = Date.now();
const app = await electron.launch({ ...launchOptions, timeout: BOOT_TIMEOUT_MS });

try {
  section('Starting up');

  let page;
  await step('shows a window while the server boots', async () => {
    const splash = await app.firstWindow({ timeout: 15_000 });
    check(splash !== null, 'no window appeared at all');
  });

  await step('reaches the application', async () => {
    page = await waitForApplicationWindow(app);
    process.stdout.write(`(${Math.round((Date.now() - startedAt) / 1000)}s) `);
  });

  if (page === undefined) {
    process.stdout.write('\n  The application never opened. Nothing else can be checked.\n');
    process.stdout.write(`  The main process log is in ${join(userDataDir, 'logs', 'main.log')}.\n`);
  } else {
    await step('answers its own health probe', async () => {
      const response = await page.request.get(`${originOf(page)}/api/health`);
      check(response.ok(), `health probe answered ${response.status()}`);
      const body = await response.json();
      check(body.ok === true, `health probe said ${JSON.stringify(body)}`);
    });

    section('First run');

    await step('opens on the welcome screen, because there are no accounts yet', async () => {
      check(pathOf(page) === '/welcome', `expected /welcome, got ${pathOf(page)}`);
      await page.waitForSelector('input[name="name"]', { timeout: ACTION_TIMEOUT_MS });
    });

    await step('creates the first account and signs straight in', async () => {
      await page.fill('input[name="name"]', FIRST_ACCOUNT);
      await page.click('button[type="submit"]');
      await waitForPath(page, (path) => path === '/');
    });

    await step('shows the account in the chrome', async () => {
      await page.waitForSelector(`text=${FIRST_ACCOUNT}`, { timeout: ACTION_TIMEOUT_MS });
    });

    section('A career of one race');

    /** The race the first account adds, so later steps can open it directly. */
    let raceId = null;

    await step('adds a race to the library', async () => {
      await go(page, '/races/new');
      await page.fill('input[name="name"]', '6 Hours of Fuji');
      await page.fill('input[name="scheduledDuration"]', '06:00:00');
      await page.click('button[type="submit"]');
      // The form returns to the library with the new race called out, rather
      // than opening it — adding several races in a row is the common case.
      await page.waitForURL((url) => url.pathname === '/races' && url.searchParams.has('added'), {
        timeout: ACTION_TIMEOUT_MS,
      });
      raceId = new URL(page.url()).searchParams.get('added');
      check(raceId !== null, 'the library did not say which race was added');
    });

    await step('logs a two-hour stint', async () => {
      await go(page, `/races/${raceId}`);
      await page.click('button:has-text("Log a stint")');
      // The dialog's two timeline fields are the only ones with these
      // placeholders, which is steadier than an index.
      await page.fill('input[placeholder="01:35:20"]', '00:00:00');
      await page.fill('input[placeholder="02:47:31"]', '02:00:00');
      await page.click('button:has-text("Log stint")');
      await page.waitForSelector('text=Career XP', { timeout: ACTION_TIMEOUT_MS });
    });

    await step('awards XP for it', async () => {
      const summary = await page.textContent('body');
      const awarded = /Career XP\s*\+?([\d,]+)/.exec(summary?.replace(/\s+/g, ' ') ?? '');
      check(awarded !== null, 'no career XP figure appeared in the stint summary');
      const amount = Number(awarded[1].replace(/,/g, ''));
      check(amount > 0, `career XP awarded was ${amount}`);
    });

    section(`Version ${VERSION}`);

    await step('puts the version in the title bar', async () => {
      const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
      check(
        titles.some((title) => title.startsWith(`Endurance Racing Career ${VERSION}`)),
        `no window title carried the version: ${JSON.stringify(titles)}`,
      );
    });

    await step('shows no "What\'s new" to an account created on this version', async () => {
      await go(page, '/');
      await page.waitForSelector('text=Dashboard', { timeout: ACTION_TIMEOUT_MS });
      check(!(await page.isVisible("text=What's new in")), 'the update notes were shown to a brand-new account');
    });

    await step('opens the update log from the version in the sidebar', async () => {
      await page.click(`a:has-text("v${VERSION}")`);
      await waitForPath(page, (path) => path === '/changelog');
      const body = (await page.textContent('body')) ?? '';
      check(body.includes('Update log') && body.includes(VERSION), 'the update log did not show this version');
    });

    await step('draws the app in Graphite, the one theme every account has', async () => {
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      check(theme === 'graphite', `the dashboard theme was ${theme}`);
    });

    await step('offers only earned themes in Settings', async () => {
      await go(page, '/settings');
      const picker = page.locator('[data-picker="Dashboard theme"]');
      await picker.waitFor({ timeout: ACTION_TIMEOUT_MS });
      check(await picker.locator('button:has-text("Graphite")').isEnabled(), 'Graphite could not be chosen');
      check(await picker.locator('button:has-text("Midnight")').isDisabled(), 'Midnight could be chosen unearned');
    });

    await step('logs a stint by the time left on the clock', async () => {
      await go(page, `/races/${raceId}`);
      await page.click('button:has-text("Log a stint")');
      await page.click('button:has-text("Time left")');
      // The resume point, 02:00:00 in, reads as 04:00:00 left on a six-hour clock.
      const start = page.locator('input[placeholder="06:00:00"]');
      check((await start.inputValue()) === '04:00:00', `the start read ${await start.inputValue()}`);
      await page.fill('input[placeholder="05:30:00"]', '03:30:00');
      await page.waitForSelector('text=/In race time that is\\s*02:00:00\\s*to\\s*02:30:00/', { timeout: ACTION_TIMEOUT_MS });
      await page.click('button:has-text("Log stint")');
      await page.waitForSelector('text=/33% → 42%/', { timeout: ACTION_TIMEOUT_MS });
    });

    await step('remembers "Time left" for the next stint', async () => {
      await go(page, `/races/${raceId}`);
      await page.click('button:has-text("Log a stint")');
      const selected = await page.getAttribute('button:has-text("Time left")', 'aria-selected');
      check(selected === 'true', 'the form did not open on Time left');
      const start = await page.inputValue('input[placeholder="06:00:00"]');
      check(start === '03:30:00', `the resume point read ${start}`);
      await page.keyboard.press('Escape');
    });

    section('A second account');

    await step('signs out', async () => {
      // The account control opens a dialog; sign out is a server action inside it.
      await page.click(`button:has-text("${FIRST_ACCOUNT}")`);
      await page.click('button:has-text("Sign out")');
      await waitForPath(page, (path) => path.startsWith('/accounts'));
    });

    await step('creates a password-protected account', async () => {
      await go(page, '/accounts/new');
      await page.fill('input[name="name"]', SECOND_ACCOUNT);
      await page.fill('input[name="password"]', SECOND_PASSWORD);
      await page.fill('input[name="confirmPassword"]', SECOND_PASSWORD);
      await page.click('button[type="submit"]');
      await waitForPath(page, (path) => path === '/');
    });

    await step('starts that career empty — the first account’s race is not in it', async () => {
      await go(page, '/races');
      const body = (await page.textContent('body')) ?? '';
      check(!body.includes('6 Hours of Fuji'), 'the other account’s race appeared in this library');
    });

    section('Signing back in');

    await step('asks for the password rather than opening the card', async () => {
      await page.click(`button:has-text("${SECOND_ACCOUNT}")`);
      await page.click('button:has-text("Sign out")');
      await waitForPath(page, (path) => path.startsWith('/accounts'));

      await page.click(`button:has-text("${SECOND_ACCOUNT}")`);
      await waitForPath(page, (path) => /^\/accounts\/[0-9a-f-]+\/sign-in$/.test(path));
    });

    await step('says a wrong password did not match, and nothing worse', async () => {
      await page.fill('input[name="password"]', 'not-the-password');
      await page.click('button:has-text("Open career")');
      await page.waitForSelector('text=/didn.t match/i', { timeout: ACTION_TIMEOUT_MS });

      const body = ((await page.textContent('body')) ?? '').toLowerCase();
      for (const forbidden of ['denied', 'locked', 'too many', 'try again in']) {
        check(!body.includes(forbidden), `the password prompt said "${forbidden}"`);
      }
    });

    await step('opens the career with the right password', async () => {
      await page.fill('input[name="password"]', SECOND_PASSWORD);
      await page.click('button:has-text("Open career")');
      await waitForPath(page, (path) => path === '/');
    });

    await step('still shows the first account on the picker', async () => {
      await go(page, '/accounts');
      const body = (await page.textContent('body')) ?? '';
      check(body.includes(FIRST_ACCOUNT), `${FIRST_ACCOUNT} was missing from the picker`);
      check(body.includes(SECOND_ACCOUNT), `${SECOND_ACCOUNT} was missing from the picker`);
    });
  }
} finally {
  section('Shutting down');
  await step('quits without leaving the server child behind', async () => {
    await app.close();
  });
}

section('Updating from an earlier version');

const markerFile = join(userDataDir, 'last-version.json');
const backupDir = join(userDataDir, 'backups');
let updated = null;

try {
  await step('recorded this version once it had started', async () => {
    const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
    check(marker.version === VERSION, `the marker says ${marker.version}`);
    check(!existsSync(backupDir) || readdirSync(backupDir).length === 0, 'a first install took a backup of nothing');
  });

  await step('is made to look like 0.2.0 was the last version here', async () => {
    // 0.2.0 kept no version marker and knew nothing of release notes, so an
    // update from it looks exactly like this.
    rmSync(markerFile);
    const script = join(userDataDir, 'forget-notes.cjs');
    writeFileSync(script, `
      const Database = require(${JSON.stringify(join(ROOT, 'node_modules', 'better-sqlite3'))});
      const db = new Database(${JSON.stringify(join(userDataDir, 'data', 'endurance.db'))});
      db.prepare("DELETE FROM config_overrides WHERE key = 'lastSeenVersion'").run();
      db.close();
    `);
    const electronBinary = packagedApp ? resolve(packagedApp) : require('electron');
    const result = spawnSync(electronBinary, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    check(result.status === 0, `could not edit the database: ${result.stderr}`);
  });

  updated = await electron.launch({ ...launchOptions, timeout: BOOT_TIMEOUT_MS });
  const page = await waitForApplicationWindow(updated);

  await step('saved a copy of the career before touching it', async () => {
    const copies = existsSync(backupDir) ? readdirSync(backupDir).filter((name) => name.startsWith(`pre-update-${VERSION}-`)) : [];
    check(copies.length === 1, `expected one pre-update copy, found ${JSON.stringify(copies)}`);
  });

  await step('shows "What\'s new" once, and not again after it is closed', async () => {
    if (pathOf(page).startsWith('/accounts')) {
      await page.click(`button:has-text("${FIRST_ACCOUNT}")`);
      await waitForPath(page, (path) => path === '/');
    }
    await page.waitForSelector(`text=What's new in ${VERSION}`, { timeout: ACTION_TIMEOUT_MS });
    await page.click('button:has-text("Got it")');
    await page.waitForSelector(`text=What's new in ${VERSION}`, { state: 'hidden', timeout: ACTION_TIMEOUT_MS });
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Dashboard', { timeout: ACTION_TIMEOUT_MS });
    check(!(await page.isVisible(`text=What's new in ${VERSION}`)), 'the notes came back after being closed');
  });
} finally {
  if (updated) {
    await step('quits cleanly after the update', async () => {
      await updated.close();
    });
  }

  if (!keepUserData) rmSync(userDataDir, { recursive: true, force: true });
  else process.stdout.write(`Kept ${userDataDir}\n`);
}

process.stdout.write(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
