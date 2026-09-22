'use client';

/**
 * The account control in the navigation.
 *
 * Switching account, reaching account settings and signing out are the three
 * things you can do to an account from anywhere, so they sit together behind
 * one control rather than being scattered through the rail. It opens as a
 * modal so that Escape, focus trapping and the top layer come from the
 * platform rather than from a hand-rolled popover.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Settings, Users } from 'lucide-react';
import { AccountAvatar } from '@/components/accounts/avatar';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { signOutAction } from '@/lib/server/account-actions';
import { cn, formatNumber } from '@/lib/utils';

/** What the chrome needs to draw the control. A `SessionUser` satisfies it. */
export interface AccountChip {
  name: string;
  avatarKey: string;
  accentKey: string;
  level: number;
}

export function AccountMenu({ user, compact }: { user: AccountChip; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onSignOut() {
    // Signing out deletes the session row and clears the cookie, so it has to
    // be a server action rather than a link.
    startTransition(async () => {
      await signOutAction();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2.5 rounded-md text-left transition-colors',
          'text-ink-dim hover:bg-panel/70 hover:text-ink-muted',
          compact ? 'px-2 py-1.5' : 'w-full px-3 py-2',
        )}
      >
        <AccountAvatar avatarKey={user.avatarKey} size="sm" />
        <span className="min-w-0">
          <span className="block max-w-[9rem] truncate text-[0.8125rem] font-medium leading-tight text-ink">
            {user.name}
          </span>
          {!compact ? (
            <span className="block truncate text-[0.625rem] uppercase tracking-[0.16em] text-ink-faint">
              Level {formatNumber(user.level)}
            </span>
          ) : null}
        </span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Account" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <AccountAvatar avatarKey={user.avatarKey} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{user.name}</div>
              <div className="label mt-1">Level {formatNumber(user.level)}</div>
            </div>
          </div>

          <div className="grid gap-2">
            <Button type="button" className="justify-start" onClick={() => go('/accounts')}>
              <Users size={15} />
              Switch account
            </Button>
            <Button type="button" className="justify-start" onClick={() => go('/settings')}>
              <Settings size={15} />
              Account settings
            </Button>
            <Button
              type="button"
              variant="subtle"
              className="justify-start"
              disabled={pending}
              onClick={onSignOut}
            >
              <LogOut size={15} />
              {pending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
