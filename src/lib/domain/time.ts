/**
 * Time parsing and formatting.
 *
 * Race positions are always seconds internally. The user works in
 * `HH:MM:SS` (or `MM:SS`, or `H:MM:SS`), so parsing has to be forgiving
 * without ever being ambiguous.
 */

/** Thrown when a timestamp cannot be understood. Carries the raw input. */
export class TimeParseError extends Error {
  constructor(public readonly input: string, message: string) {
    super(message);
    this.name = 'TimeParseError';
  }
}

/**
 * Parse a race timestamp into seconds.
 *
 * Accepts `HH:MM:SS`, `H:MM:SS`, `MM:SS`, `SS`, and tolerates surrounding
 * whitespace. Hours are unbounded (a 24-hour race legitimately reaches
 * `24:00:00`); minutes and seconds must be 0-59.
 */
export function parseTimestamp(input: string): number {
  const raw = input.trim();
  if (raw === '') throw new TimeParseError(input, 'Enter a timestamp such as 02:47:31.');

  const parts = raw.split(':');
  if (parts.length > 3) throw new TimeParseError(input, 'Use at most HH:MM:SS.');

  const numbers = parts.map((part) => {
    if (!/^\d+$/.test(part.trim())) {
      throw new TimeParseError(input, 'Timestamps use digits only, for example 02:47:31.');
    }
    return Number.parseInt(part.trim(), 10);
  });

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (numbers.length === 3) [hours, minutes, seconds] = numbers as [number, number, number];
  else if (numbers.length === 2) [minutes, seconds] = numbers as [number, number];
  else [seconds] = numbers as [number];

  if (numbers.length > 1 && seconds > 59) {
    throw new TimeParseError(input, 'Seconds must be between 0 and 59.');
  }
  if (numbers.length > 2 && minutes > 59) {
    throw new TimeParseError(input, 'Minutes must be between 0 and 59.');
  }

  return hours * 3600 + minutes * 60 + seconds;
}

/** Parse, returning null instead of throwing. */
export function tryParseTimestamp(input: string): number | null {
  try {
    return parseTimestamp(input);
  } catch {
    return null;
  }
}

/** Format seconds as `HH:MM:SS`, with hours growing past 24 as needed. */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Format seconds as a human duration: `6h 00m`, `1h 21m`, `47m`, `3m 20s`.
 * Used everywhere a duration is prose rather than a clock position.
 */
export function formatDuration(totalSeconds: number, options: { seconds?: boolean } = {}): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return options.seconds && seconds > 0
      ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${hours}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return options.seconds && seconds > 0 ? `${minutes}m ${pad(seconds)}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/** Compact form for dense panels: `6:00`, `1:21`, `0:47`. */
export function formatHoursMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${pad(minutes)}`;
}

/** Hours as a decimal, rounded to one place. */
export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600);
}

/**
 * Unique coverage as a percentage of the race: "62.4%".
 *
 * The one coverage formatter every screen uses, and it floors rather than
 * rounds. Story Complete allows up to two minutes of a race to go unwatched,
 * and a rounding formatter would print such a race as "100%" — reaching the
 * end would look like having seen all of it. So "100%" appears only when every
 * second is covered, and anything short of that reads at most "99.9%".
 */
export function formatCoveragePercent(coverageSec: number, runtimeSec: number): string {
  if (!(runtimeSec > 0)) return '0%';
  if (coverageSec >= runtimeSec) return '100%';
  const tenths = Math.min(999, Math.floor((Math.max(0, coverageSec) * 1000) / runtimeSec));
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
