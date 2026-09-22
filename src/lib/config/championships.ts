/**
 * Championship presets.
 *
 * These are seeded as a convenience only. Races are always added manually and
 * no motorsport calendar is ever imported — the user decides what exists, what
 * a season contains, and what counts as a major event.
 *
 * Custom championships created by the user behave identically, including
 * automatically receiving their own mastery tree.
 */

export interface ChampionshipPreset {
  slug: string;
  name: string;
  shortName: string;
  accentColor: string;
  sortOrder: number;
}

export const CHAMPIONSHIP_PRESETS: readonly ChampionshipPreset[] = [
  { slug: 'wec', name: 'FIA World Endurance Championship', shortName: 'WEC', accentColor: '#c0504d', sortOrder: 10 },
  { slug: 'imsa', name: 'IMSA SportsCar Championship', shortName: 'IMSA', accentColor: '#3f7fb5', sortOrder: 20 },
  { slug: 'elms', name: 'European Le Mans Series', shortName: 'ELMS', accentColor: '#3fa06b', sortOrder: 30 },
  { slug: 'alms-asian', name: 'Asian Le Mans Series', shortName: 'AsLMS', accentColor: '#d97a3a', sortOrder: 40 },
  { slug: 'gtwc-europe', name: 'GT World Challenge Europe', shortName: 'GTWC', accentColor: '#8f6fc0', sortOrder: 50 },
  { slug: '24h-series', name: '24H Series', shortName: '24H', accentColor: '#c8a45c', sortOrder: 60 },
];

/**
 * Suggested major-event tags offered in the Add Race form. Suggestions only —
 * any race can be tagged as a major event, and these are not hard-coded as the
 * only ones that count anywhere in the application.
 */
export const MAJOR_EVENT_SUGGESTIONS: readonly { key: string; name: string }[] = [
  { key: 'le-mans-24', name: '24 Hours of Le Mans' },
  { key: 'daytona-24', name: '24 Hours of Daytona' },
  { key: 'sebring-12', name: '12 Hours of Sebring' },
  { key: 'nurburgring-24', name: 'Nürburgring 24 Hours' },
  { key: 'spa-24', name: 'Spa 24 Hours' },
  { key: 'petit-le-mans', name: 'Petit Le Mans' },
  { key: 'bathurst-12', name: 'Bathurst 12 Hour' },
  { key: 'indianapolis-8', name: 'Indianapolis 8 Hour' },
  { key: 'suzuka-10', name: 'Suzuka 10 Hours' },
];

/** Standard race types and their nominal runtimes, used by the Add Race form. */
export const RACE_TYPE_PRESETS = [
  { type: 'SPRINT_ENDURANCE', label: 'Sprint Endurance', defaultHours: 2 },
  { type: 'H4', label: '4 Hours', defaultHours: 4 },
  { type: 'H6', label: '6 Hours', defaultHours: 6 },
  { type: 'H8', label: '8 Hours', defaultHours: 8 },
  { type: 'H10', label: '10 Hours', defaultHours: 10 },
  { type: 'H12', label: '12 Hours', defaultHours: 12 },
  { type: 'H24', label: '24 Hours', defaultHours: 24 },
  { type: 'CUSTOM', label: 'Custom', defaultHours: 3 },
] as const;
