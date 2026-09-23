'use client';

/**
 * Settings.
 *
 * The viewing plan (annual budget, weekly anchor, week start) and the cosmetic
 * choices unlocked through the season pass, which AppearancePicker draws.
 * Changing the annual budget only affects the current year — past years keep
 * their own figure, so history is never rewritten.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader, Stat } from '@/components/ui/primitives';
import { PLAYBACK_SPEEDS } from '@/lib/domain/playback';
import { seedPresetChampionshipsAction, updateSettingsAction } from '@/lib/server/actions';
import type { CosmeticState } from '@/lib/server/cosmetics';
import { AppearancePicker } from '@/components/dashboard/appearance-picker';
import { formatNumber } from '@/lib/utils';

const WEEKDAYS = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export function SettingsForm({
  weekStart, annualBudgetHours, weeklyTargetHours, defaultPlaybackSpeed, cosmetics, libraryCounts,
}: {
  weekStart: number;
  annualBudgetHours: number;
  weeklyTargetHours: number;
  defaultPlaybackSpeed: number;
  cosmetics: CosmeticState;
  libraryCounts: { races: number; championships: number; sessions: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | null>(null);

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

      <AppearancePicker cosmetics={cosmetics} />

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
