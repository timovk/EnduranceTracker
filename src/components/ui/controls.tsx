'use client';

/**
 * Form controls.
 *
 * Styled to match the instrument-panel language: hairline borders, graphite
 * fills, and the accent colour reserved for focus and for the active state.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

const FIELD = 'w-full rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors outline-none ' +
  'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD, 'min-h-[5rem] resize-y', className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(FIELD, 'appearance-none bg-[length:1rem] pr-8', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b1' d='M6 8.5 2 4.5h8z'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.65rem center',
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Field({
  label, hint, error, children, className, required,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="label mb-1.5 block">
        {label}
        {required ? <span className="ml-1 text-[var(--accent)]">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-signal">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-ink-dim">{hint}</span> : null}
    </label>
  );
}

export function Button({
  variant = 'default', size = 'md', className, children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants = {
    default: 'border border-hairline-strong bg-panel-2 text-ink hover:bg-panel-3',
    primary:
      'border border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent)] ' +
      'hover:bg-[color-mix(in_oklab,var(--accent)_24%,transparent)]',
    ghost: 'border border-transparent text-ink-muted hover:bg-panel-2 hover:text-ink',
    subtle: 'border border-hairline bg-transparent text-ink-muted hover:bg-panel-2 hover:text-ink',
    danger: 'border border-signal/40 bg-signal/10 text-signal hover:bg-signal/20',
  } as const;
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' } as const;

  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** A segmented control, used for playback speed and filter tabs. */
export function Segmented<T extends string | number>({
  options, value, onChange, className, size = 'md',
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('inline-flex rounded-md border border-hairline-strong bg-panel-2 p-0.5', className)} role="tablist">
      {options.map((option) => (
        <button
          key={String(option.value)}
          role="tab"
          type="button"
          title={option.title}
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[0.8125rem]',
            option.value === value
              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'text-ink-dim hover:text-ink-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked, onChange, label, className, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex items-center gap-2.5 text-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60', className)}
    >
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]' : 'border-hairline-strong bg-panel-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] duration-200',
            checked ? 'left-[1.125rem] bg-[var(--accent)]' : 'left-0.5 bg-ink-dim',
          )}
        />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
