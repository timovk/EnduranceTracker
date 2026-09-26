import { notFound, redirect } from 'next/navigation';
import { EventLegacyView } from '@/components/events/event-legacy-view';
import { findRacesToLink, getEventLegacy } from '@/lib/engines/event-legacy-engine';
import { getEventOptions } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { getSessionUserId, requireUserId } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/**
 * The event a segment names. Keys are free text from 0.3.x, so links encode
 * them; the segment is looked up as it arrives and, failing that, decoded —
 * whichever form Next hands over, the event is found.
 */
async function eventKeyOf(userId: string, segment: string): Promise<string | null> {
  const known = await prisma.raceMastery.findFirst({ where: { userId, key: segment }, select: { key: true } });
  if (known !== null) return known.key;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (decoded === segment) return null;
  const found = await prisma.raceMastery.findFirst({ where: { userId, key: decoded }, select: { key: true } });
  return found?.key ?? null;
}

export async function generateMetadata(props: PageProps<'/events/[key]'>) {
  const { key } = await props.params;
  // Metadata is generated outside the page render, where a redirect has
  // nowhere to go, so a missing session gets the neutral title.
  const userId = await getSessionUserId();
  if (userId === null) return { title: 'Event' };
  const eventKey = await eventKeyOf(userId, key);
  if (eventKey === null) return { title: 'Event' };
  const event = await prisma.raceMastery.findFirst({
    where: { userId, key: eventKey },
    select: { name: true, displayName: true },
  });
  return { title: event?.displayName ?? event?.name ?? 'Event' };
}

export default async function EventPage(props: PageProps<'/events/[key]'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const { key } = await props.params;

  const eventKey = await eventKeyOf(userId, key);
  if (eventKey === null) notFound();

  const view = await getEventLegacy(userId, eventKey);
  if (view === null) notFound();
  if ('redirectTo' in view) redirect(view.redirectTo);

  const [options, linkable] = await Promise.all([
    getEventOptions(userId),
    view.event.archived ? Promise.resolve([]) : findRacesToLink(userId, eventKey),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <EventLegacyView
        view={view}
        mergeTargets={options.filter((option) => option.key !== eventKey).map((option) => ({ key: option.key, name: option.name }))}
        linkable={linkable}
      />
    </div>
  );
}
