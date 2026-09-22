/**
 * The Next server, supervised as a child process.
 *
 * The application you see is a Next server talking to a Chromium window, both
 * owned by this process. Two things about that are worth stating plainly,
 * because both are security properties rather than implementation details:
 *
 *   * the server binds to 127.0.0.1 and nothing else, so a career is not
 *     reachable from the network the machine happens to be on;
 *   * the port is chosen at random on every launch, so nothing on the machine
 *     can rely on finding it either.
 *
 * Once installed there is no Node runtime to run the server with — so we use
 * the one already inside Electron, by re-launching our own binary with
 * `ELECTRON_RUN_AS_NODE=1`. In a checkout we use the developer's Node
 * instead, because a checkout's native modules are built for Node's ABI.
 *
 * No Electron imports here: this file is the supervisor, and it can be run
 * and reasoned about without a window.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import type { Logger } from './log';
import type { ServerRuntime } from './paths';

/** The loopback address, spelled out because it is the whole security story. */
const HOST = '127.0.0.1';

/** How long the server gets to answer before we give up and say so. */
const DEFAULT_READY_TIMEOUT_MS = 60_000;

/** How long a terminated child gets to go quietly before it is forced. */
const GRACE_MS = 5_000;

/** A port can be taken between choosing it and binding it. Rare; cheap to survive. */
const MAX_PORT_ATTEMPTS = 5;

export interface StartServerOptions {
  runtime: ServerRuntime;
  /** `DATABASE_URL` for the child — the only way it learns where the career is. */
  databaseUrl: string;
  logger: Logger;
  readyTimeoutMs?: number;
  /**
   * Called if the child dies on its own while the application is still up.
   * A dead server behind a live window is the one failure that looks like the
   * application hanging, so the shell turns it into a visible error.
   */
  onUnexpectedExit?: (details: { code: number | null; signal: string | null; tail: string }) => void;
}

/**
 * A start that did not get as far as a running server.
 *
 * `portTaken` is the one failure worth retrying: the port was free when we
 * asked the operating system for it and taken by the time the server bound
 * it. The child reports that on its own output rather than to us, so it is
 * noticed there and carried out here.
 */
class ServerStartError extends Error {
  constructor(
    message: string,
    readonly portTaken: boolean,
  ) {
    super(message);
    this.name = 'ServerStartError';
  }
}

export interface ServerHandle {
  port: number;
  url: string;
  /** Stop the server and everything it started. Safe to call more than once. */
  stop(): Promise<void>;
  /** Last-resort synchronous kill, for `process.on('exit')`. */
  killNow(): void;
}

export async function startServer(options: StartServerOptions): Promise<ServerHandle> {
  const { logger } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = await findFreePort();
    logger.info(`starting the server on ${HOST}:${port} (attempt ${attempt} of ${MAX_PORT_ATTEMPTS})`);

    try {
      return await startOnce(options, port);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!(lastError instanceof ServerStartError) || !lastError.portTaken) throw lastError;
      logger.warn(`port ${port} was taken after all; choosing another`);
    }
  }

  throw lastError ?? new Error('The server could not be started.');
}

async function startOnce(options: StartServerOptions, port: number): Promise<ServerHandle> {
  const { runtime, databaseUrl, logger } = options;
  const command = runtime.electronAsNode ? process.execPath : 'node';

  const child = spawn(command, [runtime.entry, ...runtime.args], {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      // Turns our own binary into a plain Node runtime for the child.
      ...(runtime.electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      NODE_ENV: runtime.nodeEnv,
      PORT: String(port),
      // Next's standalone server defaults to 0.0.0.0. It must not.
      HOSTNAME: HOST,
      DATABASE_URL: databaseUrl,
      // Lets the application know it is inside the desktop shell rather than
      // being served in a browser tab.
      ENDURANCE_DESKTOP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // A process group of its own, so stopping the server stops anything it
    // started. Windows has no process groups worth the name; there the whole
    // tree is taken down by pid instead.
    detached: process.platform !== 'win32',
  });

  let exited = false;
  let stopping = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let sawAddressInUse = false;

  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      logger.info(`server process exited (code ${String(code)}, signal ${String(signal)})`);
      resolve();
      if (!stopping) {
        options.onUnexpectedExit?.({ code, signal, tail: logger.tail(30) });
      }
    });
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  const watch = (chunk: string) => {
    if (chunk.includes('EADDRINUSE')) sawAddressInUse = true;
    logger.raw(chunk);
  };
  child.stdout?.on('data', watch);
  child.stderr?.on('data', watch);

  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      exited = true;
      reject(
        error.code === 'ENOENT' && command === 'node'
          ? new Error(
              'Node.js was not found. Running the desktop shell from a checkout uses your own ' +
                'Node, the same one `npm run dev` uses.',
            )
          : error,
      );
    });
  });

  const handle: ServerHandle = {
    port,
    url: `http://${HOST}:${port}`,
    async stop() {
      if (exited) return;
      stopping = true;
      logger.info('stopping the server');
      terminate(child, false, logger);
      await Promise.race([exitPromise, delay(GRACE_MS)]);
      if (!exited) {
        logger.warn('the server did not stop; forcing it');
        terminate(child, true, logger);
        await Promise.race([exitPromise, delay(2_000)]);
      }
    },
    killNow() {
      if (exited) return;
      stopping = true;
      terminate(child, true, logger);
    },
  };

  try {
    await Promise.race([
      spawnFailure,
      waitForHealth(port, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, () => exited, logger),
    ]);
  } catch (error) {
    // Whether it had already gone has to be read before stopping it, or every
    // failure looks like a crash — including the ones we caused by giving up.
    const diedOnItsOwn = exited;
    await handle.stop();
    const original = error instanceof Error ? error.message : String(error);
    if (sawAddressInUse) {
      throw new ServerStartError(`Port ${port} was already in use.`, true);
    }
    if (diedOnItsOwn && exitCode !== 0) {
      throw new ServerStartError(
        `The server stopped before it was ready (code ${String(exitCode)}, signal ${String(exitSignal)}). ${original}`,
        false,
      );
    }
    throw new ServerStartError(original, false);
  }

  logger.info(`the server is ready on ${handle.url}`);
  return handle;
}

/**
 * Wait until the server answers on the loopback interface.
 *
 * `/api/health` is the readiness probe and answers 200 without touching the
 * database. Any answer at all proves the listener is up, though, and refusing
 * to open the window over a non-200 would turn a cosmetic problem with one
 * route into an application that will not start — so anything short of a
 * server error counts as ready, and the status is logged either way.
 */
async function waitForHealth(
  port: number,
  timeoutMs: number,
  hasExited: () => boolean,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;

  while (Date.now() < deadline) {
    if (hasExited()) throw new Error('The server stopped before it finished starting.');

    const status = await probe(port);
    if (status !== null) {
      lastStatus = status;
      if (status < 500) {
        if (status !== 200) logger.warn(`the health check answered ${status}; carrying on`);
        return;
      }
    }
    await delay(200);
  }

  const seconds = Math.round(timeoutMs / 1000);
  throw new Error(
    lastStatus === 0
      ? `The server did not start within ${seconds} seconds.`
      : `The server did not become ready within ${seconds} seconds (last answer: ${lastStatus}).`,
  );
}

function probe(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const request = httpGet(
      {
        host: HOST,
        port,
        path: '/api/health',
        // One connection per probe: a pooled socket outliving the attempt
        // would keep the process alive for no reason.
        agent: false,
        timeout: 3_000,
        headers: { connection: 'close' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

/** An unused loopback port, chosen by the operating system. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probeServer = createServer();
    probeServer.once('error', reject);
    probeServer.listen(0, HOST, () => {
      const address = probeServer.address();
      if (typeof address === 'string' || address === null) {
        probeServer.close();
        reject(new Error('The operating system did not offer a port.'));
        return;
      }
      const { port } = address;
      probeServer.close(() => resolve(port));
    });
  });
}

/**
 * Stop the child, and on Windows everything below it.
 *
 * `SIGTERM` on Windows is not a signal at all — Node turns it into an
 * immediate TerminateProcess of that one process, which would leave any
 * worker the server started running with no parent. `taskkill /T` takes the
 * tree down together, so nothing survives the window closing.
 */
function terminate(child: ChildProcess, force: boolean, logger: Logger): void {
  const pid = child.pid;
  if (pid === undefined) return;

  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])], {
        windowsHide: true,
      });
      if (result.status !== 0) child.kill(force ? 'SIGKILL' : 'SIGTERM');
      return;
    }
    // Negative pid: the process group created by `detached`.
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH simply means it had already gone.
    if (code !== 'ESRCH') logger.warn(`could not stop the server process: ${String(code ?? error)}`);
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // Nothing further to try.
    }
  }
}

/**
 * Deliberately NOT unref'd: between one start attempt and the next there may
 * be nothing else keeping the event loop alive, and an unref'd timer lets the
 * process exit mid-retry with a success code and no explanation.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
