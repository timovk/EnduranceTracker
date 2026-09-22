import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes, later utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 1234567 -> "1,234,567" */
export function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** 12.4 -> "12.4h" */
export function formatHours(hours: number, fractionDigits = 1): string {
  return `${formatNumber(hours, fractionDigits)}h`;
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${formatNumber(value, fractionDigits)}%`;
}

export function formatDate(date: Date | string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', style === 'long'
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
