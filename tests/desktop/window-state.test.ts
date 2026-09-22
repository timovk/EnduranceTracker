/**
 * Remembering where the window was, without ever losing it.
 *
 * Saved bounds are a guess about a machine that may have changed since: a
 * monitor unplugged, a laptop out of its dock, a resolution dropped. A window
 * restored onto coordinates that no longer exist is invisible, and the only
 * way back is deleting a file the user has never heard of.
 *
 * Every test here is therefore about rejection rather than about restoration.
 * Losing a window position costs nothing; losing the window is the whole
 * application.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rect } from '../../desktop/src/window-state';
import {
  DEFAULT_SIZE,
  MINIMUM_SIZE,
  defaultBounds,
  isOnScreen,
  readWindowState,
  sanitiseWindowState,
  writeWindowState,
} from '../../desktop/src/window-state';

/** A single 1080p display at the origin, which is the ordinary case. */
const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
/** A second screen to the left, the arrangement that most often disappears. */
const SECONDARY: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };

const SAVED: Rect = { x: 100, y: 80, width: 1440, height: 900 };

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'endurance-window-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('deciding whether a window is still reachable', () => {
  it('accepts a window sitting on a display', () => {
    expect(isOnScreen(SAVED, [PRIMARY])).toBe(true);
    expect(isOnScreen({ x: -1800, y: 40, width: 1440, height: 900 }, [PRIMARY, SECONDARY])).toBe(true);
  });

  it('rejects a window on a display that is no longer there', () => {
    // The unplugged-monitor case, and the one this whole file exists for.
    expect(isOnScreen({ x: -1800, y: 40, width: 1440, height: 900 }, [PRIMARY])).toBe(false);
    expect(isOnScreen({ x: 4000, y: 0, width: 1440, height: 900 }, [PRIMARY])).toBe(false);
    expect(isOnScreen({ x: 0, y: 3000, width: 1440, height: 900 }, [PRIMARY])).toBe(false);
  });

  it('accepts a window that is only a quarter on screen', () => {
    // A quarter is enough to grab the title bar and drag it somewhere better,
    // which is the only thing that actually matters.
    const width = 1000;
    const height = 800;
    // Exactly half of each axis overlaps, so a quarter of the area does.
    const half: Rect = { x: -width / 2, y: -height / 2, width, height };
    expect(isOnScreen(half, [PRIMARY])).toBe(true);

    const sliver: Rect = { x: -width + 100, y: -height + 100, width, height };
    expect(isOnScreen(sliver, [PRIMARY])).toBe(false);
  });

  it('rejects a window with no area at all', () => {
    expect(isOnScreen({ x: 0, y: 0, width: 0, height: 900 }, [PRIMARY])).toBe(false);
    expect(isOnScreen({ x: 0, y: 0, width: -1440, height: -900 }, [PRIMARY])).toBe(false);
  });
});

describe('the default window', () => {
  it('is centred on the display', () => {
    const bounds = defaultBounds(PRIMARY);
    expect(bounds).toEqual({ x: 240, y: 90, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height });
  });

  it('never opens larger than the screen it is on', () => {
    // A 1366×768 laptop is still an extremely ordinary machine, and a window
    // taller than the screen puts its own controls out of reach.
    const small: Rect = { x: 0, y: 0, width: 1366, height: 768 };
    const bounds = defaultBounds(small);

    expect(bounds.width).toBeLessThanOrEqual(small.width);
    expect(bounds.height).toBeLessThanOrEqual(small.height);
    expect(bounds.x).toBeGreaterThanOrEqual(small.x);
    expect(bounds.y).toBeGreaterThanOrEqual(small.y);
  });

  it('is centred on whichever display it was given', () => {
    const bounds = defaultBounds(SECONDARY);
    expect(bounds.x).toBeLessThan(0);
    expect(isOnScreen(bounds, [SECONDARY])).toBe(true);
  });
});

describe('sanitising what was in the file', () => {
  it('keeps bounds that are still usable', () => {
    expect(sanitiseWindowState({ bounds: SAVED, maximised: false }, [PRIMARY])).toEqual({
      bounds: SAVED,
      maximised: false,
    });
  });

  it('discards bounds that are off-screen but still restores maximised', () => {
    // The two are independent: the display arrangement changed, the user's
    // preference for a maximised window did not.
    const state = sanitiseWindowState(
      { bounds: { x: -3000, y: 0, width: 1440, height: 900 }, maximised: true },
      [PRIMARY],
    );
    expect(state).toEqual({ bounds: null, maximised: true });
  });

  it('discards a window smaller than the interface fits in', () => {
    const tooSmall = { x: 0, y: 0, width: MINIMUM_SIZE.width - 1, height: MINIMUM_SIZE.height - 1 };
    expect(sanitiseWindowState({ bounds: tooSmall, maximised: false }, [PRIMARY]).bounds).toBeNull();
  });

  it('discards anything that is not a rectangle of finite numbers', () => {
    const rubbish: unknown[] = [
      null,
      'not an object',
      42,
      {},
      { bounds: null },
      { bounds: {} },
      { bounds: { x: 0, y: 0, width: 1440 } },
      { bounds: { x: '0', y: 0, width: 1440, height: 900 } },
      { bounds: { x: Number.NaN, y: 0, width: 1440, height: 900 } },
      { bounds: { x: 0, y: Number.POSITIVE_INFINITY, width: 1440, height: 900 } },
    ];

    for (const raw of rubbish) {
      expect(sanitiseWindowState(raw, [PRIMARY]).bounds, JSON.stringify(raw)).toBeNull();
    }
  });

  it('trusts the file when no displays were reported', () => {
    // Electron has never been observed to return an empty display list, but if
    // it did, rejecting every position would be a worse answer than keeping
    // the one that worked last time.
    expect(sanitiseWindowState({ bounds: SAVED, maximised: false }, []).bounds).toEqual(SAVED);
  });
});

describe('the state file', () => {
  it('round-trips a window position', () => {
    const file = join(scratch, 'round-trip', 'window-state.json');
    // The folder does not exist yet — writing has to create it.
    writeWindowState(file, { bounds: SAVED, maximised: true });

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ bounds: SAVED, maximised: true });
    expect(readWindowState(file, [PRIMARY])).toEqual({ bounds: SAVED, maximised: true });
  });

  it('falls back to the default when there is no file yet', () => {
    expect(readWindowState(join(scratch, 'never-written.json'), [PRIMARY])).toEqual({
      bounds: null,
      maximised: false,
    });
  });

  it('falls back to the default when the file is not JSON', () => {
    // A half-written file after a power cut is a first launch, not a crash.
    const file = join(scratch, 'corrupt.json');
    writeFileSync(file, '{ "bounds": { "x": 10,', 'utf8');
    expect(readWindowState(file, [PRIMARY])).toEqual({ bounds: null, maximised: false });
  });

  it('never fails a quit over a position it could not save', () => {
    // The write happens on the way out. Where the window was is not worth
    // holding the application open for, let alone crashing it.
    expect(() =>
      writeWindowState(join(scratch, 'round-trip', 'window-state.json', 'nested.json'), {
        bounds: SAVED,
        maximised: false,
      }),
    ).not.toThrow();
  });
});
