/**
 * Where the installed application puts things, and which server it runs.
 *
 * `resolvePaths` is a pure function of a description of the launch rather than
 * of Electron's `app`, which is the only reason any of this can be tested at
 * all. Two answers matter enough to pin down here:
 *
 *   * the career database. In a checkout it is the repository's own file, so
 *     `npm run desktop:dev` shows the same career as `npm run dev`. Installed,
 *     it is in the user's profile — where an uninstall cannot reach it.
 *   * the server. Installed, it is the standalone build run by Electron's own
 *     binary in Node mode; in a checkout it is `next dev`, bound to loopback.
 *
 * `desktop/**` has no `@` alias, so this imports by relative path.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { PathEnvironment } from '../../desktop/src/paths';
import { directoriesToCreate, environmentFlags, resolvePaths } from '../../desktop/src/paths';

const REPO = join('/', 'home', 'someone', 'endurance-racing-career');
const USER_DATA = join('/', 'home', 'someone', '.config', 'Endurance Racing Career');
const RESOURCES = join('/', 'opt', 'Endurance Racing Career', 'resources');

function environment(overrides: Partial<PathEnvironment> = {}): PathEnvironment {
  return {
    userData: USER_DATA,
    resourcesPath: RESOURCES,
    isPackaged: false,
    repoRoot: REPO,
    ...overrides,
  };
}

describe('the user data folder', () => {
  it('lays out data, logs, backups and window state where §6.4 says', () => {
    const paths = resolvePaths(environment({ isPackaged: true }));

    expect(paths.dataDir).toBe(join(USER_DATA, 'data'));
    expect(paths.databaseFile).toBe(join(USER_DATA, 'data', 'endurance.db'));
    expect(paths.logDir).toBe(join(USER_DATA, 'logs'));
    expect(paths.logFile).toBe(join(USER_DATA, 'logs', 'main.log'));
    expect(paths.backupDir).toBe(join(USER_DATA, 'backups'));
    expect(paths.windowStateFile).toBe(join(USER_DATA, 'window-state.json'));
  });

  it('hands Prisma the database as a file URL', () => {
    const paths = resolvePaths(environment({ isPackaged: true }));
    expect(paths.databaseUrl).toBe(`file:${paths.databaseFile}`);
  });

  it('creates exactly the folders the shell writes into', () => {
    const paths = resolvePaths(environment({ isPackaged: true }));
    expect(directoriesToCreate(paths)).toEqual([paths.dataDir, paths.logDir, paths.backupDir]);
  });
});

describe('an installed copy', () => {
  const paths = resolvePaths(environment({ isPackaged: true }));

  it('reads its migrations out of the packaged resources', () => {
    // `extraResources` puts `prisma/migrations` here. There is no repository
    // on the machine to fall back to.
    expect(paths.mode).toBe('packaged');
    expect(paths.migrationsDir).toBe(join(RESOURCES, 'migrations'));
  });

  it('runs the standalone server with Electron’s own binary in Node mode', () => {
    // This is how the installer ships one runtime instead of two: the same
    // executable becomes Node for the child process.
    expect(paths.server).toEqual({
      entry: join(RESOURCES, 'app', 'server.js'),
      args: [],
      cwd: join(RESOURCES, 'app'),
      electronAsNode: true,
      nodeEnv: 'production',
    });
  });

  it('keeps the career out of the repository even when the dev switch is set', () => {
    // `--standalone` is a development affordance. Once installed there is no
    // checkout for it to mean anything about.
    const withSwitch = resolvePaths(environment({ isPackaged: true, useStandalone: true }));
    expect(withSwitch.mode).toBe('packaged');
    expect(withSwitch.databaseFile).toBe(join(USER_DATA, 'data', 'endurance.db'));
  });
});

describe('a checkout running next dev', () => {
  const paths = resolvePaths(environment());

  it('uses the repository’s own database, so it shows the career you already have', () => {
    expect(paths.mode).toBe('dev');
    expect(paths.databaseFile).toBe(join(REPO, 'endurance.db'));
    expect(paths.migrationsDir).toBe(join(REPO, 'prisma', 'migrations'));
  });

  it('never lets the dev server listen beyond this machine', () => {
    // The standalone server reads HOSTNAME from the environment; `next dev`
    // does not, and would otherwise default to 0.0.0.0 — a career readable by
    // anyone else on the café wifi.
    expect(paths.server.args).toEqual(['dev', '--hostname', '127.0.0.1']);
    expect(paths.server.args.join(' ')).not.toContain('0.0.0.0');
    expect(paths.server.nodeEnv).toBe('development');
  });

  it('runs the dev server as plain Node, not as Electron', () => {
    // `node_modules` in a checkout is built for Node's ABI — the same binaries
    // `npm test` needs — and Electron's ABI would refuse to load
    // `better_sqlite3.node`.
    expect(paths.server.electronAsNode).toBe(false);
    expect(paths.server.entry).toBe(join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next'));
    expect(paths.server.cwd).toBe(REPO);
  });
});

describe('a checkout rehearsing the packaged server', () => {
  const paths = resolvePaths(environment({ useStandalone: true }));

  it('runs the built standalone tree from the repository', () => {
    // This is the only way to exercise the packaged server path without
    // building an installer first.
    expect(paths.mode).toBe('standalone');
    expect(paths.server.entry).toBe(join(REPO, '.next', 'standalone', 'server.js'));
    expect(paths.server.cwd).toBe(join(REPO, '.next', 'standalone'));
    expect(paths.server.nodeEnv).toBe('production');
    expect(paths.server.electronAsNode).toBe(false);
  });

  it('keeps its career in the user data folder, like the installed app', () => {
    // Rehearsing the packaged path means rehearsing where it writes, too.
    expect(paths.databaseFile).toBe(join(USER_DATA, 'data', 'endurance.db'));
  });
});

describe('reading the launch switch', () => {
  it('accepts it on the command line or in the environment', () => {
    // `npm run` cannot set an environment variable in a way that works on both
    // Windows and everything else, so both are accepted.
    expect(environmentFlags(['electron', '.', '--standalone'], {}).useStandalone).toBe(true);
    expect(environmentFlags(['electron', '.'], { ENDURANCE_DESKTOP_STANDALONE: '1' }).useStandalone).toBe(
      true,
    );
  });

  it('defaults to the dev server', () => {
    expect(environmentFlags(['electron', '.'], {}).useStandalone).toBe(false);
    expect(environmentFlags(['electron', '.'], { ENDURANCE_DESKTOP_STANDALONE: '0' }).useStandalone).toBe(
      false,
    );
  });
});
