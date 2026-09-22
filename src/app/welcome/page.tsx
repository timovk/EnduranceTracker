import { redirect } from 'next/navigation';
import { Flag } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { AccountForm } from '@/components/accounts/account-form';
import { FIRST_RUN_BODY, FIRST_RUN_TITLE } from '@/components/accounts/copy';
import { EmptyState, Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { MAX_ACCOUNT_NAME_LENGTH, countAccounts } from '@/lib/auth/accounts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome' };

export default async function WelcomePage() {
  // First run only. Once anything exists there is something to pick from, and
  // the picker is a better front door than a blank form.
  if ((await countAccounts()) > 0) redirect('/accounts');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="First run"
        title="Endurance Racing Career Mode"
        description="A permanent record of the racing you actually watch — complete races, not highlights. Start by making yourself an account."
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelBody>
            <EmptyState icon={<Flag size={26} />} title={FIRST_RUN_TITLE} body={FIRST_RUN_BODY} />
          </PanelBody>
        </Panel>

        <Panel raised>
          <PanelHeader title="Your account" />
          <PanelBody>
            <AccountForm submitLabel="Start your career" maxNameLength={MAX_ACCOUNT_NAME_LENGTH} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
