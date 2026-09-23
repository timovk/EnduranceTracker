/**
 * The desktop application: lifecycle, window, and the order things happen in.
 *
 * Starting up is a sequence with several ways to fail, and the rule running
 * through all of it is that the user is never left looking at nothing. A
 * splash window appears before any work begins; every failure ends in a real
 * error window naming what went wrong, with the log a click away; and the
 * server child process is stopped — with its whole tree, on Windows — before
 * the application is allowed to exit.
 *
 * The window itself is locked down on purpose: no Node in the renderer,
 * navigation confined to the local server, and links to anywhere else handed
 * to the system browser only when they are http or https.
 */

import { BrowserWindow, app, dialog, ipcMain, screen, shell } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backUpCareer } from './backup';
import { createLogger, describe, type Logger } from './log';
import { applyApplicationMenu } from './menu';
import { runMigrations } from './migrate';
import { recordVersion, takePreUpdateSnapshot } from './update-snapshot';
import { composeWindowTitle } from './window-title';
import { directoriesToCreate, environmentFlags, resolvePaths, type DesktopPaths } from './paths';
import { startServer, type ServerHandle } from './server';
import { createSplash, showErrorWindow, type Splash } from './splash';
import {
  MINIMUM_SIZE,
  defaultBounds,
  readWindowState,
  writeWindowState,
  type Rect,
} from './window-state';

/** The application's own background, so the first frame is never white. */
const BACKGROUND = '#0b0e12';

/** How long the server gets before we admit it is not coming. */
const READY_TIMEOUT_MS = 60_000;

/**
 * Set before anything asks for a path: `userData` is derived from the name,
 * and a checkout that wrote to a different folder than the installed
 * application would quietly give a developer a second, invisible career.
 */
app.setName('Endurance Racing Career');
// Windows groups taskbar entries and notifications by this; it matches the
// `appId` the installer is built with.
app.setAppUserModelId('com.enduranceracing.career');

let paths: DesktopPaths | null = null;
let logger: Logger | null = null;
let splash: Splash | null = null;
let mainWindow: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let quitting = false;
let failed = false;
let stoppingServer = false;
let saveStateTimer: NodeJS.Timeout | null = null;

/**
 * One career, one application. A second launch hands the user back the window
 * they already have rather than a second copy fighting over the same file.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', stopServerBeforeQuitting);
  app.on('web-contents-created', (_event, contents) => harden(contents));
  // If the process is going down in a way we did not choose, the child must
  // still not outlive it.
  process.on('exit', () => server?.killNow());

  app.whenReady().then(boot, (error) => fail('The application could not start', error));
}

/**
 * The version to show the user.
 *
 * `app.getVersion()` reads the package.json at the app path, which once
 * installed is the asar and is right. Run from a checkout the app path is
 * `desktop/out`, which has no package.json of its own, so Electron falls back
 * to "0.0" — and the About box is the one place a wrong version is actively
 * misleading. Fall back to the repository's own package.json instead.
 */
function applicationVersion(): string {
  const reported = app.getVersion();
  if (app.isPackaged || paths === null) return reported;
  try {
    const manifest = readFileSync(join(paths.repoRoot, 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? reported;
  } catch {
    return reported;
  }
}

async function boot(): Promise<void> {
  try {
    paths = resolvePaths({
      userData: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      ...environmentFlags(),
    });
    for (const directory of directoriesToCreate(paths)) mkdirSync(directory, { recursive: true });

    logger = createLogger(paths.logFile, { mirrorToConsole: !app.isPackaged });
    logger.info(`Endurance Racing Career ${applicationVersion()} starting (${paths.mode})`);
    logger.info(`database:   ${paths.databaseFile}`);
    logger.info(`migrations: ${paths.migrationsDir}`);
    logger.info(`server:     ${paths.server.entry}`);

    // Before anything slow: the user should see the application within a
    // frame or two of double-clicking it.
    splash = createSplash();
    applyApplicationMenu(menuActions());
    registerIpcHandlers();
    await splashPainted(splash);

    splash.setStatus('Preparing your career database…');

    // Before the migrations, and before the server has the file open: the
    // first start of a new version keeps a copy of the career as it was.
    if (paths.mode !== 'dev') {
      try {
        const snapshot = takePreUpdateSnapshot({
          databaseFile: paths.databaseFile,
          backupDir: paths.backupDir,
          markerFile: paths.versionMarkerFile,
          currentVersion: applicationVersion(),
        });
        if (snapshot.taken) logger.info(`saved a copy of the career before updating: ${snapshot.taken}`);
        else logger.info(`no pre-update copy needed: ${snapshot.skipped}`);
        for (const name of snapshot.pruned) logger.info(`removed an older pre-update copy: ${name}`);
      } catch (error) {
        // A copy that could not be written is worth a line in the log, not a
        // career that will not open. Every migration is still transactional.
        logger.error(`could not save a copy before updating; carrying on: ${describe(error)}`);
      }
    }

    const migrations = runMigrations(paths.databaseFile, paths.migrationsDir);
    logger.info(
      migrations.applied.length === 0
        ? `database up to date (${migrations.alreadyApplied.length} migrations, ${migrations.durationMs} ms)`
        : `applied ${migrations.applied.map((m) => m.name).join(', ')} in ${migrations.durationMs} ms`,
    );
    for (const name of migrations.checksumMismatches) {
      logger.warn(`migration ${name} no longer matches the one recorded in this database`);
    }

    splash.setStatus('Starting your career server…');
    server = await startServer({
      runtime: paths.server,
      databaseUrl: paths.databaseUrl,
      logger,
      readyTimeoutMs: READY_TIMEOUT_MS,
      onUnexpectedExit: ({ code, signal, tail }) => {
        if (quitting || stoppingServer) return;
        const how = signal !== null ? `it was stopped by ${signal}` : `it exited with code ${String(code)}`;
        fail('The server stopped unexpectedly', new Error(`The career server closed on its own — ${how}.`), tail);
      },
    });

    splash.setStatus('Almost there…');
    await openMainWindow(server.url);
  } catch (error) {
    fail('The application could not start', error);
  }
}

async function openMainWindow(url: string): Promise<void> {
  const displays = screen.getAllDisplays().map((display) => display.workArea as Rect);
  const state = readWindowState(paths!.windowStateFile, displays);
  const bounds = state.bounds ?? defaultBounds(screen.getPrimaryDisplay().workArea as Rect);

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MINIMUM_SIZE.width,
    minHeight: MINIMUM_SIZE.height,
    // Shown only once it has something to show; the splash covers the gap.
    show: false,
    backgroundColor: BACKGROUND,
    title: composeWindowTitle(applicationVersion(), null),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  if (state.maximised) window.maximize();

  // Every page sets its own <title>; keep the version in front of it.
  window.on('page-title-updated', (event, pageTitle) => {
    event.preventDefault();
    window.setTitle(composeWindowTitle(applicationVersion(), pageTitle));
  });

  window.on('resize', rememberWindowLater);
  window.on('move', rememberWindowLater);
  window.on('close', rememberWindowNow);
  window.on('closed', () => {
    mainWindow = null;
  });

  await window.loadURL(url);
  window.show();
  window.focus();
  splash?.close();
  splash = null;
  logger?.info('the window is open');

  // Only now does this version count as having started here. Recorded any
  // earlier, an update that failed to start would not take its snapshot again.
  try {
    recordVersion(paths!.versionMarkerFile, applicationVersion());
  } catch (error) {
    logger?.warn(`could not record the version that started: ${describe(error)}`);
  }
}

/**
 * Everything a window is not allowed to do.
 *
 * The application is a local server, so any navigation away from it is either
 * a link the user meant for their browser or something that should not be
 * happening at all. `window.open` is refused outright, and only http and
 * https ever reach the system — handing `file:` or a custom scheme to
 * `shell.openExternal` is how a page turns a link into "run this".
 */
function harden(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (server && isSameOrigin(url, server.url)) return;
    event.preventDefault();
    openExternally(url);
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function openExternally(target: string): void {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    logger?.warn(`refused to open a ${parsed.protocol} link`);
    return;
  }
  void shell.openExternal(parsed.href);
}

function isSameOrigin(candidate: string, base: string): boolean {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * The end of every failure path: a window that says what happened.
 *
 * Exiting silently or leaving an empty frame both produce the same support
 * question, which nobody can answer. This produces one that can be.
 *
 * The error window is opened BEFORE the splash and the main window are taken
 * away. Closing the last window quits the application, so doing it the other
 * way round makes the error appear and vanish in the same breath — which is
 * exactly the silent exit this function exists to prevent.
 */
function fail(headline: string, error: unknown, detail?: string): void {
  logger?.error(headline, error);
  if (failed) return;
  failed = true;

  const doomed = [splash?.window, mainWindow];
  const message = error instanceof Error ? error.message : String(error);

  try {
    showErrorWindow({
      headline,
      message,
      detail: detail ?? logger?.tail(30),
      preload: join(__dirname, 'preload.js'),
    });
  } catch (windowError) {
    // If even that fails there is nothing left but the console and the log.
    console.error(headline, message, describe(windowError));
    app.quit();
    return;
  }

  splash = null;
  mainWindow = null;
  for (const window of doomed) {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

function menuActions() {
  return {
    switchAccount() {
      if (!server || !mainWindow) return;
      void mainWindow.loadURL(`${server.url}/accounts`);
    },
    backUpCareer() {
      if (!paths || !logger) return;
      void backUpCareer({
        parent: mainWindow,
        databaseFile: paths.databaseFile,
        backupDir: paths.backupDir,
        logger,
      });
    },
    openDataFolder() {
      if (paths) void shell.openPath(paths.dataDir);
    },
    openLog() {
      if (paths) void shell.openPath(paths.logFile);
    },
    about() {
      if (!paths) return;
      const options = {
        type: 'info' as const,
        title: 'About Endurance Racing Career',
        message: `Endurance Racing Career ${applicationVersion()}`,
        detail: [
          'Your career, kept on this machine and nowhere else.',
          '',
          `Data folder:  ${paths.dataDir}`,
          `Log folder:   ${paths.logDir}`,
          `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
        ].join('\n'),
        buttons: ['Close'],
        noLink: true,
      };
      void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
    },
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle('endurance:open-log-folder', async () => {
    if (paths) await shell.openPath(paths.logDir);
  });
}

/**
 * Stop the server before the process goes away.
 *
 * `will-quit` cannot be awaited, so the first time round we cancel the quit,
 * stop the child, and ask again — by which time there is no server left and
 * the event runs straight through.
 */
function stopServerBeforeQuitting(event: Electron.Event): void {
  if (!server || stoppingServer) return;
  event.preventDefault();
  stoppingServer = true;

  void (async () => {
    try {
      await server?.stop();
    } catch (error) {
      logger?.error('the server could not be stopped cleanly', error);
      server?.killNow();
    } finally {
      server = null;
      stoppingServer = false;
      logger?.info('goodbye');
      app.quit();
    }
  })();
}

function focusExistingWindow(): void {
  const window = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Wait for the splash to actually paint, but never wait long for it. */
function splashPainted(target: Splash): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 500);
    timer.unref?.();
    target.window.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Remember the window's shape.
 *
 * `getNormalBounds` is the un-maximised geometry, which is what a maximised
 * window should be restored to when it is un-maximised again.
 */
function rememberWindowNow(): void {
  if (!paths || !mainWindow || mainWindow.isDestroyed()) return;
  if (saveStateTimer) {
    clearTimeout(saveStateTimer);
    saveStateTimer = null;
  }
  writeWindowState(paths.windowStateFile, {
    bounds: mainWindow.getNormalBounds(),
    maximised: mainWindow.isMaximized(),
  });
}

/** Dragging a window fires a great many events; one write afterwards is enough. */
function rememberWindowLater(): void {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(rememberWindowNow, 400);
  saveStateTimer.unref?.();
}
