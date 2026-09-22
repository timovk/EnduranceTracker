import { cn } from '@/lib/utils';
import { resolveAvatar } from '@/components/accounts/identity';

/**
 * The account mark.
 *
 * Deliberately the wordmark tile from the navigation rail with the account's
 * glyph in place of the `24`: an account is the same kind of object as the
 * application itself, so it wears the same badge. The colour comes from
 * `--accent`, which whoever renders the mark has already set to the account's
 * own accent.
 */
export function AccountAvatar({
  avatarKey, size = 'md', className,
}: { avatarKey: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { icon: Icon, name } = resolveAvatar(avatarKey);
  const boxes = { sm: 'h-7 w-7', md: 'h-11 w-11', lg: 'h-14 w-14' } as const;
  const glyphs = { sm: 14, md: 18, lg: 22 } as const;

  return (
    <span
      title={name}
      className={cn(
        'grid shrink-0 place-items-center rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]',
        boxes[size],
        className,
      )}
    >
      <Icon size={glyphs[size]} aria-hidden />
    </span>
  );
}
