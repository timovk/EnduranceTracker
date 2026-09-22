import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { AccountPicker } from '@/components/accounts/account-picker';
import { PICKER_DESCRIPTION, lastRacedNote } from '@/components/accounts/copy';
import { Button } from '@/components/ui/controls';
import { listAccounts, type AccountSummary } from '@/lib/auth/accounts';
import { titleForLevel } from '@/lib/domain/progression';
import type { AccountCardData } from '@/components/accounts/account-card';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts' };

export default async function AccountsPage() {
  const accounts = await listAccounts();
  // Nothing to pick from means this is a first run, whatever route got here.
  if (accounts.length === 0) redirect('/welcome');

  const now = new Date();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Who is watching"
        title="Choose your career"
        description={PICKER_DESCRIPTION}
        actions={
          <Link href="/accounts/new">
            <Button variant="subtle" size="sm"><Plus size={14} /> New account</Button>
          </Link>
        }
      />

      <AccountPicker accounts={accounts.map((account) => toCard(account, now))} />
    </div>
  );
}

/**
 * Resolve everything the card shows here rather than in the component: the
 * title depends on the level curve and the phrasing depends on the clock, and
 * neither belongs in a button.
 */
function toCard(account: AccountSummary, now: Date): AccountCardData {
  return {
    id: account.id,
    name: account.name,
    avatarKey: account.avatarKey,
    accentKey: account.accentKey,
    hasPassword: account.hasPassword,
    level: account.level,
    title: account.titleKey ?? titleForLevel(account.level).title,
    hoursWatched: account.hoursWatched,
    racesCompleted: account.racesCompleted,
    lastRaced: lastRacedNote(account.lastActiveAt, now),
  };
}
