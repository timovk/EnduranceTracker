'use client';

/**
 * Choosing an account's mark and accent.
 *
 * Both are chip rows rather than selects, for the same reason the season-pass
 * cosmetics are: the choice is a look, so it should be shown rather than
 * described. Each row carries a hidden input, so the surrounding form posts
 * the key without anything having to lift state out.
 */

import { ACCOUNT_ACCENTS, ACCOUNT_AVATARS } from '@/components/accounts/identity';
import { cn } from '@/lib/utils';

export function AvatarPicker({
  value, onChange,
}: { value: string; onChange: (key: string) => void }) {
  return (
    <div>
      <div className="label mb-1.5">Mark</div>
      <div className="flex flex-wrap gap-2">
        {ACCOUNT_AVATARS.map((option) => {
          const Icon = option.icon;
          const selected = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              title={option.name}
              aria-label={option.name}
              aria-pressed={selected}
              onClick={() => onChange(option.key)}
              className={cn(
                'grid h-10 w-10 place-items-center rounded-md border transition-colors',
                selected
                  ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-hairline-strong bg-panel-2 text-ink-dim hover:text-ink-muted',
              )}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>
      <input type="hidden" name="avatarKey" value={value} />
    </div>
  );
}

export function AccentPicker({
  value, onChange,
}: { value: string; onChange: (key: string) => void }) {
  return (
    <div>
      <div className="label mb-1.5">Card colour</div>
      <div className="flex flex-wrap gap-2">
        {ACCOUNT_ACCENTS.map((option) => (
          <button
            key={option.key}
            type="button"
            title={option.description}
            aria-pressed={option.key === value}
            onClick={() => onChange(option.key)}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors',
              option.key === value
                ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-ink'
                : 'border-hairline-strong bg-panel-2 text-ink-dim hover:text-ink-muted',
            )}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: option.accent }} />
            {option.name}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
        Colours your account card and avatar. The rest of the app takes its colour from your dashboard theme.
      </p>
      <input type="hidden" name="accentKey" value={value} />
    </div>
  );
}
