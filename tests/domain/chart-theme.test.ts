/**
 * Chart colours under every dashboard theme.
 *
 * A chart's first series is the theme's accent, so a theme whose accent is
 * one of the other series' colours would draw two series alike, and a chart
 * comparing them could not be read. The colours are resolved the way the
 * browser resolves them: from `globals.css`, through each theme's block.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHART_COLORS } from '@/components/charts/chart-theme';
import { THEMES } from '@/lib/config';

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties each selector sets, blocks with the same selector merged. */
function customProperties(): Map<string, Map<string, string>> {
  const bySelector = new Map<string, Map<string, string>>();
  for (const [, selectors = '', body = ''] of CSS.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(',').map((part) => part.trim())) {
      const properties = bySelector.get(selector) ?? new Map<string, string>();
      for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        properties.set(name, value.trim());
      }
      bySelector.set(selector, properties);
    }
  }
  return bySelector;
}

const PROPERTIES = customProperties();

/** A colour as a theme shows it: its own block first, then `:root`, then the `@theme` tokens. */
function resolveColour(value: string, theme: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (reference === null) return value.trim().toLowerCase();
  const name = reference[1] ?? '';
  const next = PROPERTIES.get(`[data-theme="${theme}"]`)?.get(name)
    ?? PROPERTIES.get(':root')?.get(name)
    ?? PROPERTIES.get('@theme')?.get(name);
  if (next === undefined) throw new Error(`${name} is not defined for the ${theme} theme`);
  return resolveColour(next, theme);
}

describe('chart colours', () => {
  it('resolve the accent each theme is sold with', () => {
    for (const theme of THEMES) {
      expect(resolveColour(CHART_COLORS.primary, theme.key), theme.key).toBe(theme.accent.toLowerCase());
    }
  });

  it('never draw two series of one chart in the same colour, under any theme', () => {
    for (const theme of THEMES) {
      const series = [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.tertiary]
        .map((colour) => resolveColour(colour, theme.key));
      expect(new Set(series).size, `${theme.key}: ${series.join(', ')}`).toBe(series.length);
    }
  });
});
