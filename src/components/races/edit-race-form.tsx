'use client';

/**
 * Editing a race.
 *
 * Deliberately a flat form rather than the staged Add Race flow: when you are
 * correcting one field you want to see all of them. Changing the runtime
 * re-derives completion, which the page says out loud.
 *
 * The race's recurring event is preselected, and choosing another moves the
 * race there. Whatever it helped its old event reach stays reached, and is
 * never paid a second time in the new one.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import type { RaceDetail } from '@/lib/server/races';
import type { ChampionshipOption } from './add-race-form';
import { Button, Field, Input, Select, Textarea, Toggle } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { RACE_TYPE_PRESETS } from '@/lib/config/championships';
import { formatTimestamp } from '@/lib/domain/time';
import { updateRaceAction } from '@/lib/server/actions';
import { cn } from '@/lib/utils';
import { EventPicker, type EventChoice } from './event-picker';

export function EditRaceForm({
  race, championships, events,
}: {
  race: RaceDetail;
  championships: ChampionshipOption[];
  /** The account's recurring events, by name. */
  events: EventChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  const [isMajorEvent, setIsMajorEvent] = React.useState(race.isMajorEvent);
  const [excitement, setExcitement] = React.useState(race.excitement);
  const [duration, setDuration] = React.useState(formatTimestamp(race.scheduledDurationSec));

  const [eventChoice, setEventChoice] = React.useState(race.event?.key ?? '');
  const [newEventName, setNewEventName] = React.useState('');

  // The race's own event is always in the list, even one the list would not
  // otherwise offer (an archived event, or a 0.3.x key not yet recomputed).
  const eventChoices = React.useMemo(() => {
    const own = race.event;
    if (own === null || events.some((event) => event.key === own.key)) return events;
    return [...events, { key: own.key, name: own.name, editions: 0 }];
  }, [events, race.event]);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateRaceAction(formData);
      if (result.ok) {
        router.push(`/races/${race.id}`);
        router.refresh();
      } else {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="id" value={race.id} />

      <Panel>
        <PanelHeader title="Details" />
        <PanelBody className="space-y-4">
          <Field label="Race name" required error={errors.name}>
            <Input name="name" defaultValue={race.name} required />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Championship">
              <Select name="championshipId" defaultValue={race.championship?.id ?? ''}>
                <option value="">Unassigned</option>
                {championships.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Season year" error={errors.seasonYear}>
              <Input
                name="seasonYear"
                type="number"
                defaultValue={race.season?.year ?? ''}
                className="timing"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Circuit"><Input name="circuit" defaultValue={race.circuit ?? ''} /></Field>
            <Field label="Country"><Input name="country" defaultValue={race.country ?? ''} /></Field>
            <Field label="Race date">
              <Input
                name="raceDate"
                type="date"
                className="timing"
                defaultValue={race.raceDate ? race.raceDate.toISOString().slice(0, 10) : ''}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Race type">
              <Select name="raceType" defaultValue={race.raceType}>
                {RACE_TYPE_PRESETS.map((preset) => (
                  <option key={preset.type} value={preset.type}>{preset.label}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Scheduled duration"
              required
              error={errors.scheduledDuration}
              hint="Changing this recalculates completion"
            >
              <Input
                name="scheduledDuration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="timing"
                required
              />
            </Field>
            <Field
              label="Actual duration"
              error={errors.actualDuration}
              hint="If it ran short"
            >
              <Input
                name="actualDuration"
                defaultValue={race.actualDurationSec ? formatTimestamp(race.actualDurationSec) : ''}
                className="timing"
                placeholder="—"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Priority">
              <Select name="priority" defaultValue={race.priority}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="MUST_WATCH">Must watch</option>
              </Select>
            </Field>
            <Field label="Races in this season" error={errors.plannedRaceCount} hint="Blank = whatever I add">
              <Input name="plannedRaceCount" type="number" min={1} max={100} className="timing" />
            </Field>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <span className="label">Excitement</span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setExcitement(level)}
                      aria-label={`Excitement ${level} of 5`}
                      className="p-0.5"
                    >
                      <Star
                        size={14}
                        className={cn(level <= excitement ? 'text-[var(--accent)]' : 'text-ink-faint')}
                        fill={level <= excitement ? 'currentColor' : 'none'}
                      />
                    </button>
                  ))}
                </div>
                <input type="hidden" name="excitement" value={excitement} />
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-hairline pt-4">
            <Toggle checked={isMajorEvent} onChange={setIsMajorEvent} label="Major event" />
            <input type="hidden" name="isMajorEvent" value={isMajorEvent ? 'true' : 'false'} />

            <EventPicker
              idPrefix="edit-race"
              events={eventChoices}
              value={eventChoice}
              onChange={setEventChoice}
              newName={newEventName}
              onNewNameChange={setNewEventName}
              error={errors.eventKey ?? errors.newEventName}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Replay URL" error={errors.replayUrl}>
              <Input name="replayUrl" type="url" defaultValue={race.replayUrl ?? ''} />
            </Field>
            <Field label="Poster image URL" error={errors.posterUrl}>
              <Input name="posterUrl" type="url" defaultValue={race.posterUrl ?? ''} />
            </Field>
          </div>

          <Field label="Notes" hint="Optional, always.">
            <Textarea name="notes" rows={3} defaultValue={race.notes ?? ''} />
          </Field>
        </PanelBody>
      </Panel>

      {message ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{message}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
