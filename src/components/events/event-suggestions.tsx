'use client';

/**
 * The Events page's "Suggested" panel.
 *
 * What the library itself suggests: races that look like editions of an event
 * they are not in, races that look like an event of their own, and events
 * that look like the same one. Each is only ever offered — linking, creating
 * and combining all wait for a click, and combining still asks first. A
 * dismissed suggestion is not offered again.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import type { SuggestionItem } from '@/lib/engines/event-legacy-engine';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import {
  dismissEventSuggestionAction, linkRacesToEventAction, linkStrongSuggestionsAction,
} from '@/lib/server/career-actions';
import { CreateEventDialog, MergeEventDialog } from './event-dialogs';

type LinkSuggestion = Extract<SuggestionItem, { kind: 'link' }>;
type CreateSuggestion = Extract<SuggestionItem, { kind: 'create' }>;
type MergeSuggestion = Extract<SuggestionItem, { kind: 'merge' }>;

const REASON: Record<LinkSuggestion['reason'], string> = {
  'name-and-circuit': 'Same name and circuit',
  name: 'Same name',
  'circuit-and-length': 'Same circuit and length',
};

export function EventSuggestions({ suggestions }: { suggestions: SuggestionItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState<CreateSuggestion | null>(null);
  const [merging, setMerging] = React.useState<MergeSuggestion | null>(null);
  const [confirmingAll, setConfirmingAll] = React.useState(false);

  const strongLinks = suggestions.filter((item): item is LinkSuggestion => item.kind === 'link' && item.strength === 'strong');

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  if (suggestions.length === 0) return null;

  return (
    <Panel>
      <PanelHeader
        title="Suggested"
        icon={<Sparkles size={12} />}
        action={strongLinks.length >= 2 ? (
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => setConfirmingAll(true)}>
            Link all {strongLinks.length} strong suggestions
          </Button>
        ) : null}
      />
      <PanelBody className="space-y-3">
        <p className="text-xs leading-relaxed text-ink-dim">
          Worked out from the names, circuits and lengths in your own library. Nothing is linked until you say so.
        </p>
        {message !== null ? (
          <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{message}</p>
        ) : null}
        <ul className="divide-y divide-hairline rounded-md border border-hairline">
          {suggestions.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <SuggestionText item={item} />
              </div>
              <div className="flex shrink-0 gap-1.5">
                {item.kind === 'link' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => run(() => linkRacesToEventAction(item.event.key, [item.race.id]))}
                  >
                    Link
                  </Button>
                ) : null}
                {item.kind === 'create' ? (
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => setCreating(item)}>Create</Button>
                ) : null}
                {item.kind === 'merge' ? (
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => setMerging(item)}>Merge</Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissEventSuggestionAction(item.id))}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>

      <CreateEventDialog
        open={creating !== null}
        onClose={() => setCreating(null)}
        initialName={creating?.name ?? ''}
        races={creating?.races ?? []}
      />
      {merging !== null ? (
        <MergeEventDialog open onClose={() => setMerging(null)} from={merging.from} into={merging.into} />
      ) : null}

      <Dialog
        open={confirmingAll}
        onClose={() => setConfirmingAll(false)}
        title="Link every strong suggestion"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">These races become editions of the events beside them:</p>
          <ul className="space-y-1 text-sm">
            {strongLinks.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-x-2">
                <span className="text-ink">{item.race.name}</span>
                <span className="text-ink-dim">→ {item.event.name}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmingAll(false)}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending}
              onClick={() => {
                setConfirmingAll(false);
                run(() => linkStrongSuggestionsAction(strongLinks.map((item) => item.id)));
              }}
            >
              Link them all
            </Button>
          </div>
        </div>
      </Dialog>
    </Panel>
  );
}

function SuggestionText({ item }: { item: SuggestionItem }) {
  if (item.kind === 'link') {
    return (
      <>
        <p className="truncate text-sm text-ink">
          {item.race.name} <span className="text-ink-dim">looks like an edition of</span> {item.event.name}
        </p>
        <div className="mt-1">
          <Badge tone={item.strength === 'strong' ? 'positive' : 'outline'}>{REASON[item.reason]}</Badge>
        </div>
      </>
    );
  }
  if (item.kind === 'create') {
    return (
      <>
        <p className="text-sm text-ink">
          {item.races.length} races <span className="text-ink-dim">look like editions of one event:</span> {item.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-dim">
          {item.races.map((race) => (race.editionYear === null ? race.name : `${race.editionYear}`)).join(' · ')}
        </p>
      </>
    );
  }
  return (
    <p className="text-sm text-ink">
      {item.from.name} <span className="text-ink-dim">and</span> {item.into.name}{' '}
      <span className="text-ink-dim">look like the same event</span>
    </p>
  );
}
