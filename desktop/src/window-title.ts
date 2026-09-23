/**
 * The text in the window's title bar.
 *
 * Electron shows each page's <title> there by default, which reads
 * "Career · Endurance Career" — no version, and a shortened product name. The
 * title bar is the one place a version is visible without opening anything,
 * so it is composed here instead: the product, its version, and the page.
 *
 * The page title's shape comes from the metadata in src/app/layout.tsx. The
 * desktop shell may not import from src/, so the two strings are repeated
 * here, and a test reads that file to make sure they still match.
 */

export const PRODUCT_NAME = 'Endurance Racing Career';

/** `title.template` in src/app/layout.tsx, less the `%s`. */
export const PAGE_TITLE_SUFFIX = ' · Endurance Career';

/** `title.default` in src/app/layout.tsx: a page with no title of its own. */
export const DEFAULT_PAGE_TITLE = 'Endurance Racing Career Mode';

/** The page's own name, or null when it has none worth showing. */
function pageName(pageTitle: string | null | undefined): string | null {
  const title = pageTitle?.trim() ?? '';
  if (title === '' || title === DEFAULT_PAGE_TITLE) return null;
  // Before the first page has loaded Chromium titles the window with its URL.
  if (/^(https?:\/\/|127\.0\.0\.1|localhost)/.test(title)) return null;
  if (title.endsWith(PAGE_TITLE_SUFFIX)) return title.slice(0, -PAGE_TITLE_SUFFIX.length).trim() || null;
  return title;
}

/** "Endurance Racing Career 0.3.0 — Settings" */
export function composeWindowTitle(version: string, pageTitle: string | null | undefined): string {
  const base = `${PRODUCT_NAME} ${version}`;
  const page = pageName(pageTitle);
  return page === null ? base : `${base} — ${page}`;
}
