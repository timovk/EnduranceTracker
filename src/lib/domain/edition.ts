/**
 * Editions of recurring events (0.4.0).
 *
 * An edition is one year of an event: the 2026 24 Hours of Le Mans. Two races
 * of the same event in the same year — the race and a re-upload of it, say —
 * are one edition, not two, and a race with no date at all is an edition of
 * its own: counted, but never part of a run of consecutive years.
 *
 * Also here: the name signatures that let the Events page suggest which races
 * belong together, and the fingerprint that remembers an edition after its race
 * is deleted, so adding it again cannot pay an event step a second time.
 *
 * Pure. Nothing here is a list of famous races.
 */

/**
 * The year an edition belongs to.
 *
 * The race date's UTC year, because `raceDate` is stored as UTC midnight of
 * the day the user typed (`domain/race-day`): read in local time west of
 * Greenwich, 1 January would slide back into the previous year. Without a
 * date, the season's year.
 */
export function editionYear(race: { raceDate: Date | null; seasonYear: number | null }): number | null {
  if (race.raceDate !== null) return race.raceDate.getUTCFullYear();
  return race.seasonYear ?? null;
}

/** The identity of an edition, once its year is known: the year, or the race itself when it has none. */
export function editionIdentityOf(raceId: string, year: number | null): string {
  return year !== null ? `${year}` : `race:${raceId}`;
}

/** The identity of the edition a race belongs to. Races sharing one are the same edition. */
export function editionIdentity(race: { id: string; raceDate: Date | null; seasonYear: number | null }): string {
  return editionIdentityOf(race.id, editionYear(race));
}

/** A run of consecutive years. */
export interface Run {
  length: number;
  fromYear: number;
  toYear: number;
}

/** The longest run of consecutive years. Repeats count once; a tie goes to the earliest run. */
export function longestConsecutiveRun(years: readonly number[]): Run | null {
  const unique = [...new Set(years)].sort((a, b) => a - b);
  let best: Run | null = null;
  let current: Run | null = null;
  for (const year of unique) {
    current = current !== null && year === current.toYear + 1
      ? { length: current.length + 1, fromYear: current.fromYear, toYear: year }
      : { length: 1, fromYear: year, toYear: year };
    if (best === null || current.length > best.length) best = current;
  }
  return best;
}

/** The years strictly between the first and the latest edition that have no edition. */
export function missingEditionYears(years: readonly number[]): number[] {
  const present = new Set(years);
  if (present.size === 0) return [];
  const sorted = [...present].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let year = sorted[0]! + 1; year < sorted[sorted.length - 1]!; year += 1) {
    if (!present.has(year)) missing.push(year);
  }
  return missing;
}

/** Lowercase, with accents taken off: "Nürburgring" → "nurburgring". */
function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * An event key or name reduced to what identifies it, for noticing that two
 * events are the same one: "Le-Mans 24" and "le mans 24" both give "le-mans-24".
 */
export function normaliseEventKey(text: string): string {
  return foldText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A standalone four-digit year: 1900 to 2199, not part of a longer number or word. */
const STANDALONE_YEAR = /\b(?:19|20|21)\d\d\b/g;

/**
 * What stays the same from one edition's name to the next, for matching only.
 * Never shown.
 *
 *     "2026 24 Hours of Le Mans"          → "24 hours of le mans"
 *     "The 94th Annual 24 Hours of Le Mans" → "24 hours of le mans"
 */
export function eventNameSignature(raceName: string): string {
  return foldText(raceName)
    .replace(STANDALONE_YEAR, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, ' ')
    .replace(/\b(?:edition|annual|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A name for the event a race belongs to, proposed from the race's own name:
 * its standalone years taken out, and the user's own casing and accents kept.
 * "2026 24 Hours of Nürburgring" → "24 Hours of Nürburgring".
 */
export function eventNameFromRaceName(raceName: string): string {
  const name = raceName
    .replace(STANDALONE_YEAR, ' ')
    // A year in brackets leaves the brackets behind.
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    // …and a year at either end leaves its separator behind.
    .replace(/^[\s\-–—:,·|/]+|[\s\-–—:,·|/]+$/g, '');
  return name === '' ? raceName.trim() : name;
}

/**
 * What identifies an edition once its race is gone: its year, its length in
 * whole hours, where it was held, and its name signature.
 */
export interface EditionFingerprint {
  year: number | null;
  hours: number;
  circuit: string | null;
  signature: string;
}

export function editionFingerprint(race: {
  editionYear: number | null;
  circuitSlug: string | null;
  name: string;
  runtimeSec: number;
}): EditionFingerprint {
  return {
    year: race.editionYear,
    hours: Math.round(race.runtimeSec / 3600),
    circuit: race.circuitSlug,
    signature: eventNameSignature(race.name),
  };
}

/** Stable JSON, keys in alphabetical order, so equal fingerprints are equal strings. */
export function serialiseFingerprint(fingerprint: EditionFingerprint): string {
  return JSON.stringify({
    circuit: fingerprint.circuit,
    hours: fingerprint.hours,
    signature: fingerprint.signature,
    year: fingerprint.year,
  });
}

function parseFingerprint(stored: string): EditionFingerprint | null {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { year, hours, circuit, signature } = record;
  if (!(year === null || typeof year === 'number')) return null;
  if (typeof hours !== 'number') return null;
  if (!(circuit === null || typeof circuit === 'string')) return null;
  if (typeof signature !== 'string') return null;
  return { year, hours, circuit, signature };
}

/**
 * Whether a stored fingerprint is this edition again.
 *
 * The year and the rounded length must agree, and then either the circuit or
 * the name: rounding means a runtime changed by a few seconds still matches,
 * and needing only one of circuit or name means both would have to change to
 * pass as a different edition.
 */
export function fingerprintMatches(stored: string, race: EditionFingerprint): boolean {
  const known = parseFingerprint(stored);
  if (!known) return false;
  if (known.year !== race.year || known.hours !== race.hours) return false;
  const sameCircuit = known.circuit !== null && known.circuit === race.circuit;
  const sameName = known.signature !== '' && known.signature === race.signature;
  return sameCircuit || sameName;
}
