import { notFound } from 'next/navigation';
import { ExpeditionView } from '@/components/expeditions/expedition-view';
import { getExpeditionView } from '@/lib/engines/expedition-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { getStintEntryMode } from '@/lib/server/preferences';
import { getSessionUserId, requireUserId } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/races/[id]/expedition'>) {
  const { id } = await props.params;
  // Metadata is generated outside the page render, where a redirect has
  // nowhere to go, so a missing session gets the neutral title.
  const userId = await getSessionUserId();
  if (userId === null) return { title: 'Expedition' };
  const race = await prisma.race.findFirst({ where: { id, userId }, select: { name: true } });
  return { title: race === null ? 'Expedition' : `${race.name} — Expedition` };
}

export default async function ExpeditionPage(props: PageProps<'/races/[id]/expedition'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const { id } = await props.params;

  // Read inside the account: another career's race is simply not found.
  const [view, entryMode] = await Promise.all([getExpeditionView(userId, id, new Date()), getStintEntryMode(userId)]);
  if (view === null) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <ExpeditionView view={view} defaultEntryMode={entryMode} />
    </div>
  );
}
