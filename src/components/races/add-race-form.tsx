'use client';

/**
 * The Add Race form.
 *
 * Adding a race should take seconds. Choosing a race type fills in the
 * duration; naming a circuit is enough; a championship can be created inline
 * rather than sending the user away to make one first. Everything beyond the
 * name, type and duration is optional and tucked into a second section.
 *
 * The recurring event is guessed from the name once it is typed — the same
 * name without its year as an edition already in an event — and picked for
 * the user, who can change it. It is only ever a guess until they save.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Star } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, Toggle } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { RACE_TYPE_PRESETS } from '@/lib/config/championships';
import { formatTimestamp } from '@/lib/domain/time';
import { createRaceAction } from '@/lib/server/actions';
import { suggestEventForNameAction } from '@/lib/server/career-actions';
import { cn } from '@/lib/utils';
import { EventPicker, type EventChoice } from './event-picker';

export interface ChampionshipOption {
  id: string;
  name: string;
  shortName: string | null;
  accentColor: string;
  seasons: { id: string; year: number; raceCount: number }[];
}

export function AddRaceForm({
  championships, events, redirectTo = '/races',
}: {
  championships: ChampionshipOption[];
  /** The account's recurring events, by name. */
  events: EventChoice[];
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  const [raceType, setRaceType] = React.useState<string>('H6');
  const [duration, setDuration] = React.useState(formatTimestamp(6 * 3600));
  const [championshipId, setChampionshipId] = React.useState('');
  const [creatingChampionship, setCreatingChampionship] = React.useState(false);
  const [isMajorEvent, setIsMajorEvent] = React.useState(false);
  const [eventChoice, setEventChoice] = React.useState('');
  const [newEventName, setNewEventName] = React.useState('');
  /**
   * Once the user picks an event themselves, the guess never overrides them.
   * A ref, so a guess still on its way when they pick reads their choice.
   */
  const eventTouched = React.useRef(false);
  const [guessedEvent, setGuessedEvent] = React.useState<string | null>(null);
  const [showOptional, setShowOptional] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const [excitement, setExcitement] = React.useState(3);

  /** Picking a race type fills in the nominal duration, but never locks it. */
  function onRaceTypeChange(type: string) {
    setRaceType(type);
    const preset = RACE_TYPE_PRESETS.find((p) => p.type === type);
    if (preset && type !== 'CUSTOM') setDuration(formatTimestamp(preset.defaultHours * 3600));
  }

  /**
   * When the name is typed, pick the event it looks like an edition of, unless
   * the user already chose. A guess the new name no longer supports is taken
   * back, so a corrected name never saves the race into the old guess's event.
   */
  async function guessEvent(name: string) {
    if (eventTouched.current) return;
    const circuit = formRef.current ? new FormData(formRef.current).get('circuit') : null;
    const guess = name.trim() === '' || events.length === 0
      ? null
      : await suggestEventForNameAction(name, typeof circuit === 'string' ? circuit : undefined).catch(() => null);
    if (eventTouched.current) return;
    // Untouched, the choice is either nothing or an earlier guess.
    const known = guess !== null && events.some((event) => event.key === guess.key);
    setEventChoice(known ? guess.key : '');
    setGuessedEvent(known ? guess.name : null);
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createRaceAction(formData);
      if (result.ok && result.data) {
        router.push(`${redirectTo}?added=${result.data.id}`);
        router.refresh();
      } else {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className="space-y-4">
      <Panel>
        <PanelHeader title="The race" />
        <PanelBody className="space-y-4">
          <Field label="Race name" required error={errors.name} hint="For example, 6 Hours of Fuji">
            <Input
              name="name"
              placeholder="6 Hours of Fuji"
              required
              autoFocus
              onBlur={(event) => { void guessEvent(event.target.value); }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Race type" error={errors.raceType}>
              <Select name="raceType" value={raceType} onChange={(e) => onRaceTypeChange(e.target.value)}>
                {RACE_TYPE_PRESETS.map((preset) => (
                  <option key={preset.type} value={preset.type}>{preset.label}</option>
                ))}
              </Select>
            </Field>

            <Field
              label="Scheduled duration"
              required
              error={errors.scheduledDuration}
              hint="HH:MM:SS, or a number of hours"
            >
              <Input
                name="scheduledDuration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="timing"
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Championship" error={errors.championshipId}>
              {creatingChampionship ? (
                <div className="flex gap-2">
                  <Input name="newChampionshipName" placeholder="Championship name" autoFocus />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingChampionship(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select
                    name="championshipId"
                    value={championshipId}
                    onChange={(e) => setChampionshipId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {championships.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    onClick={() => { setCreatingChampionship(true); setChampionshipId(''); }}
                    title="Create a championship"
                  >
                    <Plus size={13} />
                  </Button>
                </div>
              )}
            </Field>

            <Field
              label="Season year"
              error={errors.seasonYear}
              hint="Groups this race into a collectible season"
            >
              <Input name="seasonYear" type="number" inputMode="numeric" placeholder={`${new Date().getFullYear()}`} className="timing" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Circuit" error={errors.circuit}>
              <Input name="circuit" placeholder="Fuji Speedway" />
            </Field>
            <Field label="Country" error={errors.country}>
              <Input name="country" placeholder="Japan" />
            </Field>
            <Field label="Race date" error={errors.raceDate}>
              <Input name="raceDate" type="date" className="timing" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-5 border-t border-hairline pt-4">
            <Toggle
              checked={isMajorEvent}
              onChange={setIsMajorEvent}
              label="Major event"
            />
            <input type="hidden" name="isMajorEvent" value={isMajorEvent ? 'true' : 'false'} />

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

          <EventPicker
            idPrefix="add-race"
            events={events}
            value={eventChoice}
            onChange={(value) => { setEventChoice(value); eventTouched.current = true; setGuessedEvent(null); }}
            newName={newEventName}
            onNewNameChange={setNewEventName}
            error={errors.eventKey ?? errors.newEventName}
            hint={guessedEvent !== null
              ? `Looks like an edition of ${guessedEvent}, so it is picked for you. Change it if it is not.`
              : undefined}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Everything else"
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowOptional((v) => !v)}>
              {showOptional ? 'Hide' : 'Show'}
            </Button>
          }
        />
        {showOptional ? (
          <PanelBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Status">
                <Select name="status" defaultValue="UNWATCHED">
                  <option value="UNWATCHED">Unwatched</option>
                  <option value="QUEUED">Queued</option>
                  <option value="WATCHING">Watching</option>
                  <option value="PAUSED">Paused</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              </Field>
              <Field label="Priority">
                <Select name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="MUST_WATCH">Must watch</option>
                </Select>
              </Field>
              <Field
                label="Actual duration"
                error={errors.actualDuration}
                hint="If it ran short — red flags, a shortened race"
              >
                <Input name="actualDuration" placeholder="—" className="timing" />
              </Field>
            </div>

            <Field
              label="Races in this season"
              error={errors.plannedRaceCount}
              hint="You decide what a complete season is. Leave blank for “whatever I add”."
            >
              <Input name="plannedRaceCount" type="number" min={1} max={100} className="timing" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Replay URL" error={errors.replayUrl}>
                <Input name="replayUrl" type="url" placeholder="https://" />
              </Field>
              <Field label="Poster image URL" error={errors.posterUrl}>
                <Input name="posterUrl" type="url" placeholder="https://" />
              </Field>
            </div>

            <Field label="Notes" hint="Optional. You never have to write down what happened.">
              <Textarea name="notes" rows={3} />
            </Field>
          </PanelBody>
        ) : null}
      </Panel>

      {message ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
          {message}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add to library'}
        </Button>
      </div>
    </form>
  );
}
