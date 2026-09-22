/**
 * The log file, which is the only thing a user can send us when the
 * application will not start.
 *
 * It is deliberately small and synchronous. Everything worth logging happens
 * a handful of times per launch, and a logger that buffers is a logger that
 * loses the last few lines — which are always the interesting ones.
 *
 * Nothing here ever throws: a shell that crashed while trying to record that
 * something went wrong would be the worst of both worlds.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** One megabyte of log is far more than one launch produces. */
const MAX_BYTES = 1024 * 1024;

/** How much of the log the error window can show. */
const TAIL_LINES = 200;

export interface Logger {
  readonly file: string;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, cause?: unknown): void;
  /** Output from the server child process, already newline-terminated. */
  raw(chunk: string): void;
  /** The last lines written, for the error window. */
  tail(lines?: number): string;
}

export function createLogger(file: string, options: { mirrorToConsole?: boolean } = {}): Logger {
  const mirror = options.mirrorToConsole ?? false;
  const recent: string[] = [];

  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // Nothing to do — the writes below will fail quietly too.
  }

  rotateIfLarge(file);

  function remember(text: string): void {
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      recent.push(line);
    }
    if (recent.length > TAIL_LINES) recent.splice(0, recent.length - TAIL_LINES);
  }

  function write(text: string): void {
    remember(text);
    if (mirror) process.stdout.write(text);
    try {
      appendFileSync(file, text);
    } catch {
      // A read-only or full disk must not stop the application starting.
    }
  }

  function line(level: string, message: string): void {
    write(`${new Date().toISOString()}  ${level.padEnd(5)}  ${message}\n`);
  }

  return {
    file,
    info: (message) => line('info', message),
    warn: (message) => line('warn', message),
    error: (message, cause) => line('error', cause === undefined ? message : `${message}: ${describe(cause)}`),
    raw: (chunk) => write(chunk.endsWith('\n') ? chunk : `${chunk}\n`),
    tail: (lines = 40) => recent.slice(-lines).join('\n'),
  };
}

/** A human-readable form of whatever was thrown. */
export function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.stack ?? `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/**
 * Keep one previous log alongside the current one.
 *
 * Rotating on open rather than on write means a launch's log is never split
 * in two, which is what makes the file useful when something goes wrong.
 */
function rotateIfLarge(file: string): void {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // No log yet, or it cannot be rotated. Either way, carry on and append.
  }
}
