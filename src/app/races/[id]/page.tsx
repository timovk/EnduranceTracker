import { notFound } from 'next/navigation';
import { RaceDetailView } from '@/components/races/race-detail-view';
import { getRaceDetail } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { getSessionUserId, requireUserId } from '@/lib/auth/session';
import { TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { getStintEntryMode } from '@/lib/server/preferences';
import { getEventSuggestionForRace } from '@/lib/engines/event-legacy-engine';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/races/[id]'>) {
  const { id } = await props.params;

  // Metadata is generated outside the page render, where a redirect has
  // nowhere to go. A missing session therefore gets the neutral title and the
  // page body — which renders a moment later — is what asks for a sign-in.
  const userId = await getSessionUserId();
  if (userId === null) return { title: 'Race' };

  const race = await getRaceDetail(userId, id);
  return { title: race?.name ?? 'Race' };
}

export default async function RacePage(props: PageProps<'/races/[id]'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const { id } = await props.params;
  const [race, entryMode] = await Promise.all([getRaceDetail(userId, id), getStintEntryMode(userId)]);
  if (!race) notFound();
  // A race in no event may look like an edition of one: offered, never linked.
  const eventSuggestion = race.event === null ? await getEventSuggestionForRace(userId, race.id) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <RaceDetailView
        race={race}
        longHaulThresholdSec={TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec}
        defaultEntryMode={entryMode}
        eventSuggestion={eventSuggestion === null
          ? null
          : { key: eventSuggestion.key, name: eventSuggestion.name, suggestionId: eventSuggestion.suggestionId }}
      />
    </div>
  );
}
