'use client';

/**
 * The dialogs of the Events pages: creating, renaming and combining events,
 * and adding races to one.
 *
 * Each one says what will happen before it happens. Combining two events is
 * the only thing here that cannot be undone, and its confirmation says so in
 * as many words; none of them can pay anything twice, and the combining one
 * says that too.
 *
 * A dialog's form is drawn only while it is open, so every opening starts
 * from the values it was opened with.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import {
  createEventAction, findRacesToLinkAction, linkRacesToEventAction, mergeEventsAction, renameEventAction,
} from '@/lib/server/career-actions';
import type { LinkableRace } from '@/lib/engines/event-legacy-engine';
import { cn } from '@/lib/utils';

/** A sentence from the server, with the event it names when there is one. */
function Notice({ message, link }: { message: string | null; link?: { name: string; href: string } | null }) {
  if (message === null) return null;
  return (
    <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
      {message}
      {link ? (
        <>
          {' '}
          <Link href={link.href} className="text-[var(--accent)] underline-offset-2 hover:underline">
            Open {link.name}
          </Link>
        </>
      ) : null}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

interface CreateProps {
  onClose: () => void;
  initialName: string;
  races: { id: string; name: string; editionYear: number | null }[];
}

/**
 * Create an event. From a "create" suggestion it is opened with the proposed
 * name, which stays editable, and the suggested races become its first
 * editions.
 */
export function CreateEventDialog({
  open, onClose, initialName = '', races = [],
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  /** The races a suggestion proposed, linked to the new event as it is created. */
  races?: CreateProps['races'];
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Create an event">
      {open ? <CreateEventForm onClose={onClose} initialName={initialName} races={races} /> : null}
    </Dialog>
  );
}

function CreateEventForm({ onClose, initialName, races }: CreateProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(initialName);
  const [message, setMessage] = React.useState<string | null>(null);
  const [existing, setExisting] = React.useState<{ name: string; href: string } | null>(null);

  function submit(form: FormData) {
    startTransition(async () => {
      const result = await createEventAction(form);
      if (result.ok && result.data?.event) {
        onClose();
        router.push(result.data.event.href);
        return;
      }
      setMessage(result.message ?? 'That event could not be created.');
      setExisting(result.data?.existing ?? null);
    });
  }

  return (
    <form action={submit} className="space-y-4">
      <Field label="Event name" hint="The name you know it by. It can be changed later without changing anything it reached.">
        <Input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="24 Hours of Le Mans"
          required
          autoFocus
        />
      </Field>
      {races.length > 0 ? (
        <div className="space-y-1.5">
          <div className="label">Its first editions</div>
          <ul className="space-y-1 text-sm text-ink-muted">
            {races.map((race) => (
              <li key={race.id} className="flex items-baseline gap-2">
                <span className="timing w-10 shrink-0 text-xs text-ink-faint">{race.editionYear ?? '—'}</span>
                <span className="truncate">{race.name}</span>
                <input type="hidden" name="raceIds" value={race.id} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Notice message={message} link={existing} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending || name.trim() === ''}>
          {pending ? 'Creating…' : 'Create the event'}
        </Button>
      </div>
    </form>
  );
}

/** The Events page's "Create an event" action. */
export function CreateEventButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>Create an event</Button>
      <CreateEventDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/** Give an event a name of its own. Its key, and everything it reached, stay. */
export function RenameEventDialog({
  open, onClose, eventKey, currentName,
}: {
  open: boolean;
  onClose: () => void;
  eventKey: string;
  currentName: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Rename the event">
      {open ? <RenameEventForm onClose={onClose} eventKey={eventKey} currentName={currentName} /> : null}
    </Dialog>
  );
}

function RenameEventForm({ onClose, eventKey, currentName }: { onClose: () => void; eventKey: string; currentName: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(currentName);
  const [message, setMessage] = React.useState<string | null>(null);
  const [existing, setExisting] = React.useState<{ name: string; href: string } | null>(null);

  function submit(form: FormData) {
    startTransition(async () => {
      const result = await renameEventAction(form);
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setMessage(result.message ?? 'That name could not be saved.');
      setExisting(result.data?.existing ?? null);
    });
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="key" value={eventKey} />
      <Field label="Event name" hint="Only the name changes. Every edition and every step it reached stay as they are.">
        <Input name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus />
      </Field>
      <Notice message={message} link={existing} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending || name.trim() === ''}>
          {pending ? 'Saving…' : 'Save the name'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

interface MergeProps {
  onClose: () => void;
  from: { key: string; name: string };
  into?: { key: string; name: string };
  targets: { key: string; name: string }[];
}

/**
 * Combine one event into another, after a confirmation that says it cannot be
 * undone. With `targets`, the event to combine into is chosen from a list;
 * with `into`, it is fixed (a suggestion names both).
 */
export function MergeEventDialog({
  open, onClose, from, into, targets = [],
}: Omit<MergeProps, 'targets'> & { open: boolean; targets?: MergeProps['targets'] }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Combine ${from.name}`}>
      {open ? <MergeEventForm onClose={onClose} from={from} into={into} targets={targets} /> : null}
    </Dialog>
  );
}

function MergeEventForm({ onClose, from, into, targets }: MergeProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [choice, setChoice] = React.useState(into?.key ?? '');
  const [message, setMessage] = React.useState<string | null>(null);

  const target = into ?? targets.find((candidate) => candidate.key === choice) ?? null;

  function confirm() {
    if (target === null) return;
    startTransition(async () => {
      const result = await mergeEventsAction(from.key, target.key);
      if (result.ok && result.data) {
        onClose();
        router.push(result.data.into.href);
        return;
      }
      setMessage(result.message ?? 'Those events could not be combined.');
    });
  }

  return (
    <div className="space-y-4">
      {into === undefined ? (
        targets.length === 0 ? (
          <p className="text-sm text-ink-muted">There is no other event to combine it with yet.</p>
        ) : (
          <Field label="Combine it into">
            <Select value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Choose an event…</option>
              {targets.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.name}</option>)}
            </Select>
          </Field>
        )
      ) : null}
      {target !== null ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2.5 text-sm leading-relaxed text-ink-muted">
          This combines {from.name} into {target.name}. It cannot be undone. Nothing is paid twice.
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-ink-dim">
        Its editions join {target?.name ?? 'the other event'}, and the steps it reached come with them, with their dates.
        Its own page then leads to the combined event.
      </p>
      <Notice message={message} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" disabled={pending || target === null} onClick={confirm}>
          {pending ? 'Combining…' : 'Combine them'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add races
// ---------------------------------------------------------------------------

interface AddRacesProps {
  onClose: () => void;
  eventKey: string;
  /** The first page, before anything is searched for. */
  initial: LinkableRace[];
}

/**
 * Add races to an event: a search over the races in no event, the ones that
 * look like its editions first, then the most recently watched. At most a
 * page of them at a time, so it works in a library of thousands.
 */
export function AddRacesDialog({
  open, onClose, eventKey, eventName, initial,
}: AddRacesProps & { open: boolean; eventName: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Add races to ${eventName}`} size="lg">
      {open ? <AddRacesForm onClose={onClose} eventKey={eventKey} initial={initial} /> : null}
    </Dialog>
  );
}

function AddRacesForm({ onClose, eventKey, initial }: AddRacesProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [query, setQuery] = React.useState('');
  const [found, setFound] = React.useState<{ query: string; races: LinkableRace[] } | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [message, setMessage] = React.useState<string | null>(null);

  // Searching asks the server, a moment after typing stops.
  React.useEffect(() => {
    const wanted = query.trim();
    if (wanted === '') return;
    let current = true;
    const timer = setTimeout(() => {
      void findRacesToLinkAction(eventKey, wanted).then((races) => {
        if (current) setFound({ query: wanted, races });
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, eventKey]);

  const searching = query.trim() !== '';
  const shown = !searching ? initial : found !== null && found.query === query.trim() ? found.races : null;

  function toggle(id: string) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function link() {
    startTransition(async () => {
      const result = await linkRacesToEventAction(eventKey, [...chosen]);
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setMessage(result.message ?? 'Those races could not be added.');
    });
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the races in no event, by name or circuit"
          className="pl-8"
          aria-label="Search races"
          autoFocus
        />
      </div>
      <Notice message={message} />
      {shown === null ? (
        <p className="py-6 text-center text-sm text-ink-dim">Searching…</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-dim">
          {searching ? 'No race outside an event matches that.' : 'Every race in the library is already in an event.'}
        </p>
      ) : (
        <ul className="divide-y divide-hairline rounded-md border border-hairline">
          {shown.map((race) => (
            <li key={race.id}>
              <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2', chosen.has(race.id) && 'bg-panel-2')}>
                <input
                  type="checkbox"
                  checked={chosen.has(race.id)}
                  onChange={() => toggle(race.id)}
                  className="accent-[var(--accent)]"
                />
                <span className="timing w-10 shrink-0 text-xs text-ink-faint">{race.editionYear ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{race.name}</span>
                {race.championshipName ? (
                  <span className="hidden truncate text-xs text-ink-dim sm:inline">{race.championshipName}</span>
                ) : null}
                {race.suggested === 'strong' ? <Badge tone="positive">Same name</Badge> : null}
                {race.suggested === 'likely' ? <Badge tone="outline">Same circuit</Badge> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <span className="timing text-[0.6875rem] text-ink-faint">{chosen.size} chosen</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" disabled={pending || chosen.size === 0} onClick={link}>
            {pending ? 'Adding…' : 'Add as editions'}
          </Button>
        </div>
      </div>
    </div>
  );
}
