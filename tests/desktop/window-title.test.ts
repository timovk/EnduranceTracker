/**
 * The title bar: product, version, page.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_PAGE_TITLE, PAGE_TITLE_SUFFIX, PRODUCT_NAME, composeWindowTitle,
} from '../../desktop/src/window-title';

describe('the window title', () => {
  it('puts the version in front of the page', () => {
    expect(composeWindowTitle('0.3.0', `Settings${PAGE_TITLE_SUFFIX}`))
      .toBe('Endurance Racing Career 0.3.0 — Settings');
  });

  it('shows just the product and version for a page with no title of its own', () => {
    expect(composeWindowTitle('0.3.0', DEFAULT_PAGE_TITLE)).toBe(`${PRODUCT_NAME} 0.3.0`);
    expect(composeWindowTitle('0.3.0', null)).toBe(`${PRODUCT_NAME} 0.3.0`);
    expect(composeWindowTitle('0.3.0', '   ')).toBe(`${PRODUCT_NAME} 0.3.0`);
  });

  it('never shows the address Chromium uses before the page has loaded', () => {
    expect(composeWindowTitle('0.3.0', 'http://127.0.0.1:34353/')).toBe(`${PRODUCT_NAME} 0.3.0`);
    expect(composeWindowTitle('0.3.0', '127.0.0.1:34353')).toBe(`${PRODUCT_NAME} 0.3.0`);
  });

  it('keeps a race name that itself contains the separator', () => {
    expect(composeWindowTitle('0.3.0', `Spa · 6 Hours${PAGE_TITLE_SUFFIX}`))
      .toBe('Endurance Racing Career 0.3.0 — Spa · 6 Hours');
  });

  it('agrees with the page titles the app actually sets', () => {
    // The desktop shell cannot import from src/, so the format is repeated
    // there. This is what notices if one side changes without the other.
    const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain(`template: '%s${PAGE_TITLE_SUFFIX}'`);
    expect(layout).toContain(`default: '${DEFAULT_PAGE_TITLE}'`);
  });
});
