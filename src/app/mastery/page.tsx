import { PageHeader } from '@/components/layout/page-header';
import { MasteryTrees } from '@/components/dashboard/mastery-trees';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import Link from 'next/link';
import { getMasteryOverview, ensureMasteryTrees } from '@/lib/engines/mastery-engine';
import { prisma, USER_ID } from '@/lib/db/client';
import type { Tx } from '@/lib/db/client';
import { ensureCareer } from '@/lib/server/bootstrap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mastery' };

export default async function MasteryPage() {
  await ensureCareer();

  // Trees are created lazily so a championship added five minutes ago already
  // has one, including a custom championship the user invented themselves.
  await prisma.$transaction((tx) => ensureMasteryTrees(tx as Tx, USER_ID), { timeout: 30_000 });
  const trees = await getMasteryOverview(USER_ID);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Long-term progression"
        title="Mastery"
        description="A tree for every championship you watch, every recurring event you return to, and one for the career as a whole. Nodes unlock permanently — none of them can ever be lost."
      />

      {trees.length === 0 ? (
        <Panel>
          <EmptyState
            title="No trees yet"
            body="A mastery tree appears for every championship in your library — including the ones you create yourself."
            action={<Link href="/races/new"><Button variant="primary" size="sm">Add a race</Button></Link>}
          />
        </Panel>
      ) : (
        <MasteryTrees trees={trees} />
      )}
    </div>
  );
}
