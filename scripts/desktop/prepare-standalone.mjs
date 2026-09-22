/**
 * Finish the standalone build, and refuse to hand on a broken one.
 *
 * `next build` produces most of a runnable server in `.next/standalone`, but
 * not all of it, and the gaps are silent: the application starts, serves
 * HTML, and has no styles, no images and no database. This script closes
 * those gaps and then checks the result, because the alternative is finding
 * out from an installer that is already on someone's machine.
 *
 *     npm run desktop:prepare
 *
 * Every failure exits non-zero and says what to do about it.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STANDALONE = join(ROOT, '.next', 'standalone');

/** Where a rebuilt `better_sqlite3.node` can legitimately be found. */
const NATIVE_BINARY = join('better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const NATIVE_SOURCES = [
  join(ROOT, 'node_modules', NATIVE_BINARY),
  join(ROOT, 'node_modules', '@prisma', 'adapter-better-sqlite3', 'node_modules', NATIVE_BINARY),
];
const NATIVE_TARGETS = [
  join(STANDALONE, 'node_modules', NATIVE_BINARY),
  join(STANDALONE, 'node_modules', '@prisma', 'adapter-better-sqlite3', 'node_modules', NATIVE_BINARY),
];

const problems = [];
const steps = [];

function note(message) {
  steps.push(message);
  console.log(`  ${message}`);
}

function fail(message, remedy) {
  problems.push(remedy ? `${message}\n      ${remedy}` : message);
}

console.log('\nPreparing .next/standalone\n');

// ---------------------------------------------------------------------------
// 0. There has to be a build to prepare.
// ---------------------------------------------------------------------------
if (!existsSync(STANDALONE)) {
  console.error(
    '\n  There is no .next/standalone directory.\n' +
      '      Run `next build` first, with `output: "standalone"` in next.config.ts.\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1 & 2. Next traces server code only. The browser's half of the application —
// every stylesheet, every script chunk, everything in public/ — is left where
// it was, and has to be carried across by hand.
// ---------------------------------------------------------------------------
copyInto(join(ROOT, '.next', 'static'), join(STANDALONE, '.next', 'static'), '.next/static', true);
copyInto(join(ROOT, 'public'), join(STANDALONE, 'public'), 'public', false);

// ---------------------------------------------------------------------------
// 3. The build copies the developer's .env in with it. A shipped application
// must never carry someone else's DATABASE_URL: the desktop shell passes the
// one belonging to the person running it, and a stray file here would win.
// ---------------------------------------------------------------------------
for (const entry of readdirSync(STANDALONE)) {
  if (!entry.startsWith('.env')) continue;
  rmSync(join(STANDALONE, entry), { force: true });
  note(`removed ${entry} — a shipped application carries nobody's settings`);
}

// ---------------------------------------------------------------------------
// 4. The native SQLite binding. Tracing usually brings it across; when it does
// not, the application installs perfectly and then cannot open a career.
// ---------------------------------------------------------------------------
const presentBinaries = NATIVE_TARGETS.filter((target) => existsSync(target));
if (presentBinaries.length > 0) {
  for (const target of presentBinaries) note(`found ${relative(ROOT, target)}`);
} else {
  const source = NATIVE_SOURCES.find((candidate) => existsSync(candidate));
  if (source) {
    const target = NATIVE_TARGETS[0];
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    note(`copied ${relative(ROOT, source)} → ${relative(ROOT, target)}`);
  } else {
    fail(
      'better_sqlite3.node is not in the standalone tree and could not be found in node_modules.',
      'Run `npm run db:generate && npm run desktop:rebuild` before `next build`.',
    );
  }
}

// ---------------------------------------------------------------------------
// 5. The two files that prove this is a build at all.
// ---------------------------------------------------------------------------
requireFile(join(STANDALONE, 'server.js'), 'The standalone server is missing.');
requireFile(
  join(STANDALONE, '.next', 'BUILD_ID'),
  'The standalone build has no BUILD_ID, so Next will not serve it.',
);

// ---------------------------------------------------------------------------
if (problems.length > 0) {
  console.error('\n  This build is not fit to package:\n');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  Ready to package. ${steps.length} step${steps.length === 1 ? '' : 's'} completed.\n`);

// ---------------------------------------------------------------------------

function copyInto(source, target, label, required) {
  if (!existsSync(source)) {
    if (required) {
      fail(
        `${label} does not exist, so the application would have no styles or scripts.`,
        'Check that `next build` finished without errors.',
      );
    }
    return;
  }
  // Recreating the target rather than merging keeps a stale chunk from a
  // previous build out of the installer.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  const files = countFiles(target);
  note(`copied ${label} → ${relative(ROOT, target)} (${files} file${files === 1 ? '' : 's'})`);
}

function requireFile(file, message) {
  if (existsSync(file)) {
    note(`verified ${relative(ROOT, file)}`);
    return;
  }
  fail(message, `Expected it at ${relative(ROOT, file)}.`);
}

function countFiles(directory) {
  let total = 0;
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    total += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return total;
}
