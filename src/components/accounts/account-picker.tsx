'use client';

/**
 * The account picker.
 *
 * The whole card is the control, so it can be reached with Tab and opened with
 * Enter — on a machine with one account that is the entire sign-in flow.
 * Protected accounts go to the password prompt instead of opening; the server
 * checks that again before it creates a session.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AccountCardFace, type AccountCardData } from '@/components/accounts/account-card';
import { accentStyle } from '@/components/accounts/identity';
import { Panel } from '@/components/ui/primitives';
import { openAccountAction } from '@/lib/server/account-actions';
import { cn } from '@/lib/utils';

export function AccountPicker({ accounts }: { accounts: AccountCardData[] }) {
  const router = useRouter();
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | null>(null);

  function open(account: AccountCardData) {
    if (account.hasPassword) {
      router.push(`/accounts/${account.id}/sign-in`);
      return;
    }

    setOpeningId(account.id);
    startTransition(async () => {
      // Opening an account redirects, so anything that comes back is a reason
      // it could not — the account having been deleted in another window.
      const result = await openAccountAction(account.id);
      setOpeningId(null);
      setNotice(result.message ?? null);
    });
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {accounts.map((account) => {
          const opening = openingId === account.id;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => open(account)}
              disabled={openingId !== null}
              aria-busy={opening}
              className="group block w-full rounded-[0.625rem] text-left"
            >
              <Panel
                raised
                style={accentStyle(account.accentKey)}
                className={cn(
                  'h-full transition-colors group-hover:border-[var(--accent)]/45',
                  opening && 'border-[var(--accent)]/45',
                )}
              >
                <AccountCardFace account={account} />
              </Panel>
            </button>
          );
        })}
      </div>
    </div>
  );
}
