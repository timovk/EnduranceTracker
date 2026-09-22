'use client';

/**
 * Settings.
 *
 * The viewing plan (annual budget, weekly anchor, week start) and the cosmetic
 * choices unlocked through the season pass. Changing the annual budget only
 * affects the current year — past years keep their own figure, so history is
 * never rewritten.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader, Stat } from '@/components/ui/primitives';
import { PLAYBACK_SPEEDS } from '@/lib/domain/playback';
import { seedPresetChampionshipsAction, updateSettingsAction } from '@/lib/server/actions';
import { formatNumber } from '@/lib/utils';

const WEEKDAYS = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export function SettingsForm({
  name, weekStart, annualBudgetHours, weeklyTargetHours, themeKey, raceCardKey,
  titleKey, defaultPlaybackSpeed, themes, raceCards, titles, libraryCounts,
}: {
  name: string;
  weekStart: number;
  annualBudgetHours: number;
  weeklyTargetHours: number;
  themeKey: string;
  raceCardKey: string;
  titleKey: string;
  defaultPlaybackSpeed: number;
  themes: { key: string; name: string; description: string; accent: string }[];
  raceCards: { key: string; name: string; description: string }[];
  titles: string[];
  libraryCounts: { races: number; championships: number; sessions: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState(themeKey);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateSettingsAction(formData);
      setNotice(result.message ?? null);
      router.refresh();
    });
  }

  function onSeed() {
    startTransition(async () => {
      const result = await seedPresetChampionshipsAction();
      setNotice(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <Panel>
        <PanelHeader title="The viewing plan" />
        <PanelBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Annual budget"
              hint="Hours of real viewing across the year. Only this year — past years keep theirs."
            >
              <Input
                name="annualBudgetHours"
                type="number"
                min={1}
                max={8760}
                step="any"
                defaultValue={annualBudgetHours}
                className="timing"
              />
            </Field>

            <Field label="Weekly anchor" hint="The nominal target. Never a ceiling.">
              <Input
                name="weeklyTargetHours"
                type="number"
                min={0.5}
                max={168}
                step="any"
                defaultValue={weeklyTargetHours}
                className="timing"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Week starts on">
              <Select name="weekStart" defaultValue={weekStart}>
                {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
              </Select>
            </Field>

            <Field label="Usual playback speed" hint="Used for the time estimates on race pages.">
              <Select name="defaultPlaybackSpeed" defaultValue={defaultPlaybackSpeed}>
                {PLAYBACK_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
              </Select>
            </Field>
          </div>

          <p className="border-t border-hairline pt-3 text-xs leading-relaxed text-ink-dim">
            The annual figure and the weekly anchor deliberately do not multiply out. The budget engine
            allocates the year adaptively — a quiet week gets less, a Le Mans week gets more — and it
            will never tell you not to watch something.
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Appearance" />
        <PanelBody className="space-y-4">
          <div>
            <div className="label mb-2">Dashboard theme</div>
            <div className="flex flex-wrap gap-2">
              {themes.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTheme(option.key)}
                  title={option.description}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    option.key === theme
                      ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-ink'
                      : 'border-hairline-strong bg-panel-2 text-ink-dim hover:text-ink-muted'
                  }`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: option.accent }} />
                  {option.name}
                </button>
              ))}
            </div>
            <input type="hidden" name="themeKey" value={theme} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Race card design">
              <Select name="raceCardKey" defaultValue={raceCardKey}>
                {raceCards.map((card) => <option key={card.key} value={card.key}>{card.name}</option>)}
              </Select>
            </Field>

            <Field label="Displayed title" hint="Titles unlock with career level and are purely cosmetic.">
              <Select name="titleKey" defaultValue={titleKey}>
                {titles.map((title) => <option key={title} value={title}>{title}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Your name">
            <Input name="name" defaultValue={name} maxLength={60} />
          </Field>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Library" />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Races" value={formatNumber(libraryCounts.races)} size="sm" />
            <Stat label="Championships" value={formatNumber(libraryCounts.championships)} size="sm" tone="muted" />
            <Stat label="Sessions" value={formatNumber(libraryCounts.sessions)} size="sm" tone="muted" />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
            <Button type="button" variant="subtle" size="sm" onClick={onSeed} disabled={pending}>
              Add the preset championships
            </Button>
            <span className="text-xs text-ink-dim">
              WEC, IMSA, ELMS, Asian Le Mans, GTWC Europe and the 24H Series. A convenience only —
              custom championships behave identically, mastery tree included.
            </span>
          </div>
        </PanelBody>
      </Panel>

      {notice ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{notice}</p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
