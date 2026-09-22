/**
 * The two windows that exist before the application does.
 *
 * Starting up means running migrations and booting a server, which takes a
 * second or two on a good machine and longer on a tired one. The rule this
 * file exists to keep is simple: the user always sees something, and if
 * something goes wrong they see *what*. A blank white frame or a launcher
 * that quietly exits are both worse than any error message.
 *
 * Both windows are built from a data URL rather than a file on disk. It keeps
 * them working identically inside an asar archive and in a checkout, with no
 * build step to copy assets that the TypeScript compiler would not.
 */

import { BrowserWindow } from 'electron';

/** Straight from `globals.css` — the shell must not flash a different palette. */
const BASE = '#0b0e12';
const PANEL = '#12171e';
const HAIRLINE = '#222c37';
const INK = '#e9edf1';
const INK_MUTED = '#94a3b1';
const GOLD = '#c8a45c';
const SIGNAL = '#c0504d';

const FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif";

export interface Splash {
  window: BrowserWindow;
  /** Tell the user what is happening now. Safe before the page has loaded. */
  setStatus(text: string): void;
  close(): void;
}

/**
 * The loading window, shown immediately on launch.
 *
 * `backgroundColor` is set so the very first paint is already the right
 * colour: Chromium shows a white frame otherwise, and on a slow disk that
 * white frame is the first impression the application makes.
 */
export function createSplash(): Splash {
  const window = new BrowserWindow({
    width: 460,
    height: 260,
    show: true,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    skipTaskbar: false,
    backgroundColor: BASE,
    title: 'Endurance Racing Career',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  void window.loadURL(asDataUrl(splashHtml()));

  let pending: string | null = null;
  let loaded = false;

  window.webContents.once('did-finish-load', () => {
    loaded = true;
    if (pending !== null) apply(pending);
  });

  function apply(text: string): void {
    if (window.isDestroyed()) return;
    void window.webContents
      .executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)};`)
      .catch(() => {
        // The window is going away; the status no longer matters.
      });
  }

  return {
    window,
    setStatus(text: string) {
      pending = text;
      if (loaded) apply(text);
    },
    close() {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

export interface ErrorWindowOptions {
  /** One plain sentence about what did not happen. */
  headline: string;
  /** The underlying message. Shown verbatim — it is what gets reported back. */
  message: string;
  /** The tail of the log, when there is one worth showing. */
  detail?: string;
  /** Absolute path to `preload.js`, for the "Open log folder" button. */
  preload: string;
}

/**
 * The end of every failure path.
 *
 * It says what went wrong in words, shows the last of the log, and offers the
 * folder containing the whole of it — because the alternative is a user with
 * nothing to send but "it didn't open".
 */
export function showErrorWindow(options: ErrorWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 680,
    height: 520,
    show: true,
    backgroundColor: BASE,
    title: 'Endurance Racing Career',
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  void window.loadURL(asDataUrl(errorHtml(options)));
  return window;
}

function asDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function splashHtml(): string {
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Endurance Racing Career</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: ${BASE};
    color: ${INK};
    font-family: ${FONT};
    display: flex; flex-direction: column; justify-content: center;
    padding: 34px 36px;
    border: 1px solid ${HAIRLINE};
    user-select: none; cursor: default;
    -webkit-app-region: drag;
  }
  .mark { width: 34px; height: 3px; background: ${GOLD}; margin-bottom: 22px; }
  h1 { font-size: 19px; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 6px; }
  p { margin: 0; font-size: 13px; color: ${INK_MUTED}; }
  .track { position: relative; height: 2px; margin-top: 26px; background: ${HAIRLINE}; overflow: hidden; }
  .car { position: absolute; inset: 0 auto 0 0; width: 34%; background: ${GOLD}; animation: sweep 1.5s ease-in-out infinite; }
  @keyframes sweep { 0% { left: -34%; } 100% { left: 100%; } }
  @media (prefers-reduced-motion: reduce) { .car { animation: none; left: 0; width: 100%; opacity: 0.35; } }
</style>
</head>
<body>
  <div class="mark"></div>
  <h1>Endurance Racing Career</h1>
  <p id="status">Starting…</p>
  <div class="track"><div class="car"></div></div>
</body>
</html>`;
}

function errorHtml(options: ErrorWindowOptions): string {
  const detail = options.detail?.trim();
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Endurance Racing Career</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: ${BASE}; color: ${INK}; font-family: ${FONT};
    display: flex; flex-direction: column; gap: 16px; padding: 30px 32px;
  }
  .mark { width: 34px; height: 3px; background: ${SIGNAL}; }
  h1 { font-size: 19px; font-weight: 600; margin: 0; }
  p { margin: 0; font-size: 13.5px; line-height: 1.6; color: ${INK_MUTED}; }
  .message {
    background: ${PANEL}; border: 1px solid ${HAIRLINE}; border-left: 2px solid ${SIGNAL};
    padding: 12px 14px; font-size: 13px; color: ${INK}; white-space: pre-wrap; word-break: break-word;
  }
  pre {
    flex: 1; min-height: 0; overflow: auto; margin: 0;
    background: ${PANEL}; border: 1px solid ${HAIRLINE}; padding: 12px 14px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11.5px; line-height: 1.55; color: ${INK_MUTED}; white-space: pre-wrap;
  }
  .actions { display: flex; gap: 10px; }
  button {
    font: inherit; font-size: 13px; padding: 9px 16px; cursor: pointer;
    background: ${PANEL}; color: ${INK}; border: 1px solid ${HAIRLINE};
  }
  button:hover { border-color: ${GOLD}; }
  button:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
</style>
</head>
<body>
  <div class="mark"></div>
  <h1>${escapeHtml(options.headline)}</h1>
  <p>Your career is safe — nothing here touches what you have already recorded.
     The log has the whole story, and closing this window closes the application.</p>
  <div class="message">${escapeHtml(options.message)}</div>
  ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
  <div class="actions">
    <button id="log" type="button">Open log folder</button>
    <button id="close" type="button">Close</button>
  </div>
  <script>
    document.getElementById('log').addEventListener('click', () => {
      window.endurance?.openLogFolder();
    });
    document.getElementById('close').addEventListener('click', () => window.close());
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
