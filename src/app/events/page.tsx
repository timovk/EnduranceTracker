import { PageHeader } from '@/components/layout/page-header';
import { CreateEventButton } from '@/components/events/event-dialogs';
import { EventsIndex } from '@/components/events/events-index';
import { getEventsIndex } from '@/lib/engines/event-legacy-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Events' };

export default async function EventsPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const view = await getEventsIndex(userId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Event Legacy"
        title="Recurring events"
        description="Every edition of the races you come back to, year after year, gathered into one history each."
        actions={<CreateEventButton />}
      />
      <EventsIndex view={view} />
    </div>
  );
}
