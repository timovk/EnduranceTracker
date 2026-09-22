import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { AccountForm } from '@/components/accounts/account-form';
import { NEW_ACCOUNT_DESCRIPTION } from '@/components/accounts/copy';
import { Button } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { MAX_ACCOUNT_NAME_LENGTH } from '@/lib/auth/accounts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New account' };

export default function NewAccountPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Another career"
        title="New account"
        description={NEW_ACCOUNT_DESCRIPTION}
        actions={
          <Link href="/accounts">
            <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back to accounts</Button>
          </Link>
        }
      />

      <Panel raised>
        <PanelHeader title="Your account" />
        <PanelBody>
          <AccountForm submitLabel="Create account" maxNameLength={MAX_ACCOUNT_NAME_LENGTH} />
        </PanelBody>
      </Panel>
    </div>
  );
}
