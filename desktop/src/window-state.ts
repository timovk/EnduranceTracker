/**
 * Remembering where the window was, without ever losing it.
 *
 * Saved bounds are a guess about a machine that may have changed since. A
 * monitor gets unplugged, a laptop leaves its dock, a resolution drops — and
 * a window restored to coordinates that no longer exist is invisible, with no
 * way to get it back short of deleting a file the user does not know about.
 *
 * So every saved value is checked against the displays that exist *now*, and
 * anything that does not survive the check is discarded in favour of a
 * centred default. Losing a window position is nothing; losing the window is
 * the application.
 *
 * Pure geometry and one small file: no Electron here, so it can be reasoned
 * about and tested on its own.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** Null when there is nothing trustworthy to restore. */
  bounds: Rect | null;
  maximised: boolean;
}

export const DEFAULT_SIZE = { width: 1440, height: 900 };
export const MINIMUM_SIZE = { width: 1100, height: 700 };

/**
 * How much of the window has to land on a real display for the saved position
 * to be worth using. A quarter is enough to grab the title bar and drag it
 * somewhere better, which is the only thing that actually matters.
 */
const VISIBLE_FRACTION = 0.25;

/** The window is reachable on at least one of the displays that exist now. */
export function isOnScreen(bounds: Rect, displays: Rect[]): boolean {
  const area = bounds.width * bounds.height;
  if (area <= 0) return false;
  return displays.some((display) => intersectionArea(bounds, display) >= area * VISIBLE_FRACTION);
}

/** A centred window on the given display, never larger than the display is. */
export function defaultBounds(display: Rect): Rect {
  const width = Math.min(DEFAULT_SIZE.width, display.width);
  const height = Math.min(DEFAULT_SIZE.height, display.height);
  return {
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + (display.height - height) / 2),
    width,
    height,
  };
}

/**
 * Whatever was in the file, reduced to something safe to apply.
 *
 * Anything unreadable, the wrong shape, too small or off-screen becomes
 * `bounds: null` — the caller then centres a default window.
 */
export function sanitiseWindowState(raw: unknown, displays: Rect[]): WindowState {
  if (typeof raw !== 'object' || raw === null) return { bounds: null, maximised: false };
  const candidate = raw as { bounds?: unknown; maximised?: unknown };
  const maximised = candidate.maximised === true;
  const bounds = readRect(candidate.bounds);

  if (!bounds) return { bounds: null, maximised };
  if (bounds.width < MINIMUM_SIZE.width || bounds.height < MINIMUM_SIZE.height) {
    return { bounds: null, maximised };
  }
  if (displays.length > 0 && !isOnScreen(bounds, displays)) return { bounds: null, maximised };

  return { bounds, maximised };
}

export function readWindowState(file: string, displays: Rect[]): WindowState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // No state yet, or a file that is not JSON. Both mean "use the default".
    return { bounds: null, maximised: false };
  }
  return sanitiseWindowState(raw, displays);
}

export function writeWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // Where the window was is not worth failing a quit over.
  }
}

function readRect(value: unknown): Rect | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const rect = {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
  for (const side of Object.values(rect)) {
    if (typeof side !== 'number' || !Number.isFinite(side)) return null;
  }
  return rect as Rect;
}

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}
