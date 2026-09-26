/**
 * Accent colours for a tinted surface.
 *
 * `Panel`'s `accent` prop sets `--accent` alone, but every tinted fill in the
 * interface — an accent `Badge`, the primary button, a highlighted block —
 * reads `--accent-soft`. The two have to move together, or a championship's
 * blue border sits around the theme's gold fill. The mix is the one the themes
 * use (`globals.css`).
 */

import type { CSSProperties } from 'react';

/**
 * The pair of custom properties an accented subtree needs, from one colour.
 *
 * `color` must be a real colour, never `var(--accent)`: a custom property that
 * refers to itself is a cycle, and the browser then drops both. Leave the
 * style off to keep the inherited accent instead.
 */
export function accentVars(color: string): CSSProperties {
  return {
    ['--accent' as string]: color,
    ['--accent-soft' as string]: `color-mix(in oklab, ${color} 16%, transparent)`,
  } as CSSProperties;
}
