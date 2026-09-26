/**
 * Account identity — the avatar and accent vocabulary.
 *
 * Both keys are stored on `User` as slugs and resolved here, so a key written
 * by an older build renders the default rather than an empty square. The
 * default is first in each list, which is what an unknown key falls back to.
 *
 * The accents are the season-pass theme palette rather than a second set of
 * colours: an account accent and a dashboard theme are the same idea at two
 * scales, and a parallel palette would only ever drift from the first one.
 */

import type { CSSProperties } from 'react';
import {
  CloudRain, Flag, Fuel, HardHat, Moon, Mountain, Sunrise, Timer, Trophy, Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { THEMES } from '@/lib/config';
import { accentVars } from '@/components/ui/accent';

export interface AccountAvatar {
  key: string;
  /** The tile's accessible name, and its tooltip in the picker. */
  name: string;
  icon: LucideIcon;
}

export interface AccountAccent {
  key: string;
  name: string;
  description: string;
  /** A hex colour. Every one of these matches a token in globals.css. */
  accent: string;
}

/** What `createAccount` gives a brand-new account. See src/lib/auth/accounts.ts. */
export const DEFAULT_AVATAR_KEY = 'helmet';
export const DEFAULT_ACCENT_KEY = 'amber';

/**
 * Ten marks, all drawn from the endurance-racing vocabulary the rest of the
 * application already speaks. Enough that a household never has to share one;
 * few enough to sit on a single row.
 */
export const ACCOUNT_AVATARS: readonly AccountAvatar[] = [
  { key: DEFAULT_AVATAR_KEY, name: 'Helmet', icon: HardHat },
  { key: 'stopwatch', name: 'Stopwatch', icon: Timer },
  { key: 'chequered', name: 'Chequered flag', icon: Flag },
  { key: 'sector', name: 'Sector', icon: Waypoints },
  { key: 'pitlane', name: 'Pit lane', icon: Fuel },
  { key: 'nightrun', name: 'Night run', icon: Moon },
  { key: 'sunrise', name: 'Sunrise', icon: Sunrise },
  { key: 'rain', name: 'Wet race', icon: CloudRain },
  { key: 'greenhell', name: 'Green hell', icon: Mountain },
  { key: 'silverware', name: 'Silverware', icon: Trophy },
];

/**
 * Marshal's amber, in front of the five season-pass themes because it is what
 * a new account is given. It is not one of the dashboard themes, so it has to
 * be named here: a stored key that resolved to nothing would render as no
 * accent at all, which is worse than any colour.
 */
const AMBER: AccountAccent = {
  key: DEFAULT_ACCENT_KEY,
  name: 'Amber',
  description: 'Marshal’s amber. What a new account starts with.',
  accent: '#d9a13a',
};

export const ACCOUNT_ACCENTS: readonly AccountAccent[] = [AMBER, ...THEMES];

export function resolveAvatar(key: string | null | undefined): AccountAvatar {
  return ACCOUNT_AVATARS.find((avatar) => avatar.key === key) ?? ACCOUNT_AVATARS[0];
}

export function resolveAccent(key: string | null | undefined): AccountAccent {
  return ACCOUNT_ACCENTS.find((accent) => accent.key === key) ?? ACCOUNT_ACCENTS[0];
}

/** The key as it should be stored: one of ours, or the default. Never free text. */
export function avatarKeyOf(key: string | null | undefined): string {
  return resolveAvatar(key).key;
}

export function accentKeyOf(key: string | null | undefined): string {
  return resolveAccent(key).key;
}

/**
 * The pair of custom properties an accented subtree needs, for an account's
 * accent key.
 *
 * `Panel`'s `accent` prop sets `--accent` alone, but every tinted fill in the
 * interface — the avatar tile, an accent `Badge`, the primary button — reads
 * `--accent-soft`. The two have to move together, or a midnight account draws
 * a blue border around a gold fill; `accentVars` is the one place that pairs
 * them.
 */
export function accentStyle(key: string | null | undefined): CSSProperties {
  return accentVars(resolveAccent(key).accent);
}
