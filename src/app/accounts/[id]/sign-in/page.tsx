import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { AccountCardFace } from '@/components/accounts/account-card';
import { SignInForm } from '@/components/accounts/sign-in-form';
import { lastRacedNote } from '@/components/accounts/copy';
import { accentStyle } from '@/components/accounts/identity';
import { Panel, PanelBody, SectorRule } from '@/components/ui/primitives';
import { getAccount } from '@/lib/auth/accounts';
import { titleForLevel } from '@/lib/domain/progression';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/accounts/[id]/sign-in'>) {
  const { id } = await props.params;
  const account = await getAccount(id);
  return { title: account?.name ?? 'Sign in' };
}

export default async function SignInPage(props: PageProps<'/accounts/[id]/sign-in'>) {
  const { id } = await props.params;
  const account = await getAccount(id);

  // An account with no password opens straight from the picker, so there is
  // nothing to ask for here; one that has gone belongs back at the picker too.
  if (account === null || !account.hasPassword) redirect('/accounts');

  const card = {
    id: account.id,
    name: account.name,
    avatarKey: account.avatarKey,
    accentKey: account.accentKey,
    hasPassword: account.hasPassword,
    level: account.level,
    title: account.titleKey ?? titleForLevel(account.level).title,
    hoursWatched: account.hoursWatched,
    racesCompleted: account.racesCompleted,
    lastRaced: lastRacedNote(account.lastActiveAt),
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Welcome back"
        title={account.name}
        description="This account asks for a password. Everything behind it is exactly where you left it."
      />

      <Panel raised style={accentStyle(account.accentKey)}>
        <AccountCardFace account={card} />
        <SectorRule />
        <PanelBody>
          <SignInForm accountId={account.id} />
        </PanelBody>
      </Panel>
    </div>
  );
}
