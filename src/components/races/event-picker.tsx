'use client';

/**
 * The race forms' "Recurring event" choice (0.4.0).
 *
 * Always shown, whatever "Major event" says: any race can be an edition of a
 * recurring event. The list offers the account's own events by name, "None",
 * and "New event…", which asks for a name. A name that an event already goes
 * by joins that event rather than making a second one, so the list is never
 * the place where Le Mans turns into two events.
 *
 * The chosen key is posted as `eventKey`; a new event's name as
 * `newEventName`. The famous-race names are offered only as a convenience for
 * typing a new name.
 */

import { Field, Input, Select } from '@/components/ui/controls';
import { MAJOR_EVENT_SUGGESTIONS } from '@/lib/config/championships';

export interface EventChoice {
  key: string;
  name: string;
  /** Editions of it already in the library. */
  editions: number;
}

/**
 * The value of "New event…" in the list. A key is trimmed text, so it can
 * never begin with a space, and this can never be mistaken for one.
 */
export const NEW_EVENT = ' new';

export function EventPicker({
  events, value, onChange, newName, onNewNameChange, hint, error, idPrefix,
}: {
  events: EventChoice[];
  /** An event key, "" for none, or `NEW_EVENT`. */
  value: string;
  onChange: (value: string) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  hint?: string;
  error?: string;
  /** Keeps the datalist id unique when two forms share a page. */
  idPrefix: string;
}) {
  const listId = `${idPrefix}-event-names`;

  return (
    <div className="space-y-3">
      <Field
        label="Recurring event"
        error={error}
        hint={hint ?? 'Links every edition of the same event into one history, whatever the year'}
      >
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">None</option>
          {events.map((event) => (
            <option key={event.key} value={event.key}>
              {event.name}
              {event.editions > 0 ? ` · ${event.editions} ${event.editions === 1 ? 'edition' : 'editions'}` : ''}
            </option>
          ))}
          <option value={NEW_EVENT}>New event…</option>
        </Select>
      </Field>
      <input type="hidden" name="eventKey" value={value === NEW_EVENT ? '' : value} />

      {value === NEW_EVENT ? (
        <Field
          label="New event name"
          required
          hint="An event you already follow under this name is used instead of a new one"
        >
          <Input
            name="newEventName"
            value={newName}
            onChange={(event) => onNewNameChange(event.target.value)}
            list={listId}
            maxLength={80}
            placeholder="24 Hours of Le Mans"
            required
            autoFocus
          />
          <datalist id={listId}>
            {MAJOR_EVENT_SUGGESTIONS.map((suggestion) => <option key={suggestion.key} value={suggestion.name} />)}
          </datalist>
        </Field>
      ) : null}
    </div>
  );
}
