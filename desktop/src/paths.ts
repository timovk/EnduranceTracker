/**
 * Where everything lives, in development and once installed.
 *
 * Two questions have different answers depending on how the shell was
 * started, and every other file in `desktop/` asks them through here:
 *
 *   * which server do we run — the packaged standalone build, or `next dev`?
 *   * which database file is the career in?
 *
 * The resolver is a pure function of an environment description rather than
 * of `app` itself, so it can be reasoned about (and tested) without an
 * Electron process. `main.ts` is the only file that reads the real `app`.
 */

import { join, resolve } from 'node:path';

/** How this launch was started, which decides paths and the server runtime. */
export type DesktopMode =
  /** Installed. Server and migrations come from `resources/`. */
  | 'packaged'
  /** A checkout, rehearsing the packaged server against the built standalone tree. */
  | 'standalone'
  /** A checkout, running `next dev` — `npm run desktop:dev`. */
  | 'dev';

/** How the Next server child process is launched. */
export interface ServerRuntime {
  /** The script to run. */
  entry: string;
  /** Arguments after the script. */
  args: string[];
  /** Working directory for the child. */
  cwd: string;
  /**
   * Run the server with Electron's own binary in Node mode.
   *
   * True once installed: the packaged application ships one runtime, and
   * `ELECTRON_RUN_AS_NODE=1` turns it into Node for the child. False in a
   * checkout, where `node_modules` has been built for Node's ABI — the same
   * binaries `npm test` and `next dev` need — and Electron's ABI would refuse
   * to load `better_sqlite3.node`.
   */
  electronAsNode: boolean;
  /**
   * `NODE_ENV` for the child. The standalone build is production; `next dev`
   * refuses to be anything but development.
   */
  nodeEnv: 'production' | 'development';
}

export interface DesktopPaths {
  mode: DesktopMode;
  /** The repository root. Meaningless once packaged. */
  repoRoot: string;
  userData: string;
  dataDir: string;
  databaseFile: string;
  /** `DATABASE_URL` for the server child, in the form Prisma expects. */
  databaseUrl: string;
  logDir: string;
  logFile: string;
  backupDir: string;
  windowStateFile: string;
  /** Directory of `<timestamp>_name/migration.sql` directories. */
  migrationsDir: string;
  server: ServerRuntime;
}

/** Everything the resolver needs to know about the running Electron app. */
export interface PathEnvironment {
  /** `app.getPath('userData')`. */
  userData: string;
  /** `process.resourcesPath`. */
  resourcesPath: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /**
   * Run the built standalone server from a checkout instead of `next dev`.
   * This is how the packaged server path gets exercised before an installer
   * is built, which is otherwise only ever tested by shipping it.
   */
  useStandalone?: boolean;
  /** Overrides the location derived from this file, for tests. */
  repoRoot?: string;
}

/**
 * The checkout this file was compiled into: `<repo>/desktop/out/paths.js`.
 *
 * Derived from the file rather than from `app.getAppPath()`, because the app
 * path depends on how Electron was invoked while this does not.
 */
export function repoRootFromHere(): string {
  return resolve(__dirname, '..', '..');
}

/**
 * Read the launch flags from the process, leaving `app` to the caller.
 *
 * The switch is accepted on the command line as well as in the environment
 * because `npm run` scripts cannot set an environment variable in a way that
 * works on both Windows and everything else.
 */
export function environmentFlags(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Pick<PathEnvironment, 'useStandalone'> {
  return {
    useStandalone: argv.includes('--standalone') || env.ENDURANCE_DESKTOP_STANDALONE === '1',
  };
}

export function resolvePaths(environment: PathEnvironment): DesktopPaths {
  const repoRoot = environment.repoRoot ?? repoRootFromHere();
  const userData = environment.userData;
  const dataDir = join(userData, 'data');
  const logDir = join(userData, 'logs');

  const mode: DesktopMode = environment.isPackaged
    ? 'packaged'
    : environment.useStandalone
      ? 'standalone'
      : 'dev';

  // A checkout's `next dev` writes to the repository's own database, so
  // `npm run desktop:dev` shows the same career as `npm run dev` does. An
  // installed application has no repository to write to and keeps the career
  // in the user's own profile, where an uninstall cannot reach it.
  const databaseFile =
    mode === 'dev' ? join(repoRoot, 'endurance.db') : join(dataDir, 'endurance.db');

  const server = resolveServer(mode, repoRoot, environment.resourcesPath);

  return {
    mode,
    repoRoot,
    userData,
    dataDir,
    databaseFile,
    databaseUrl: `file:${databaseFile}`,
    logDir,
    logFile: join(logDir, 'main.log'),
    backupDir: join(userData, 'backups'),
    windowStateFile: join(userData, 'window-state.json'),
    migrationsDir:
      mode === 'packaged'
        ? join(environment.resourcesPath, 'migrations')
        : join(repoRoot, 'prisma', 'migrations'),
    server,
  };
}

function resolveServer(mode: DesktopMode, repoRoot: string, resourcesPath: string): ServerRuntime {
  if (mode === 'packaged') {
    // `extraResources` puts the standalone tree at `resources/app`. It stays
    // outside the asar because Next reads its own files from disk at runtime.
    const appDir = join(resourcesPath, 'app');
    return {
      entry: join(appDir, 'server.js'),
      args: [],
      cwd: appDir,
      electronAsNode: true,
      nodeEnv: 'production',
    };
  }

  if (mode === 'standalone') {
    const appDir = join(repoRoot, '.next', 'standalone');
    return {
      entry: join(appDir, 'server.js'),
      args: [],
      cwd: appDir,
      electronAsNode: false,
      nodeEnv: 'production',
    };
  }

  return {
    entry: join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
    // The standalone server reads HOSTNAME from the environment; `next dev`
    // does not, and defaults to 0.0.0.0. Say it on the command line instead,
    // or a development run would be reachable from the local network.
    args: ['dev', '--hostname', '127.0.0.1'],
    cwd: repoRoot,
    electronAsNode: false,
    nodeEnv: 'development',
  };
}

/** The directories the shell writes into. Safe to call on every launch. */
export function directoriesToCreate(paths: DesktopPaths): string[] {
  return [paths.dataDir, paths.logDir, paths.backupDir];
}
