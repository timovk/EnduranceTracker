import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { CollectionGrid } from '@/components/dashboard/collection-grid';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { ensureSeasonCollections, getCollections } from '@/lib/engines/collection-engine';
import { prisma, USER_ID } from '@/lib/db/client';
import type { Tx } from '@/lib/db/client';
import { ensureCareer } from '@/lib/server/bootstrap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  await ensureCareer();

  // Reconciled on view so a race added a moment ago already has its card.
  await prisma.$transaction((tx) => ensureSeasonCollections(tx as Tx, USER_ID), { timeout: 30_000 });
  const collections = await getCollections(USER_ID);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Collectible sets"
        title="Championship collections"
        description="A season is a set of cards. Finishing a race fills its card; watching every minute of it earns the card a border. You decide what a season contains — partial seasons are entirely normal."
      />

      {collections.length === 0 ? (
        <Panel>
          <EmptyState
            title="No sets yet"
            body="Give a race a championship and a year and it becomes part of a collectible season."
            action={<Link href="/races/new"><Button variant="primary" size="sm">Add a race</Button></Link>}
          />
        </Panel>
      ) : (
        <CollectionGrid collections={collections} />
      )}
    </div>
  );
}
