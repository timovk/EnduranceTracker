'use client';

/**
 * The appearance pickers: theme, race card design, badge, banner and title.
 *
 * Everything is shown, earned or not. A locked option is greyed out and says
 * where it can be earned, because a picker that silently hides what exists is
 * a picker that never tells you there is anything to aim for. Only unlocked
 * options can be chosen — and the server checks that again when it saves.
 *
 * Every choice is a hidden field in the surrounding settings form, so the one
 * "Save settings" button saves the look together with everything else.
 */

import * as React from 'react';
import { Check, Lock } from 'lucide-react';
import { Field, Select } from '@/components/ui/controls';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { BadgeEmblem } from '@/components/cosmetics/badge-emblem';
import { BannerArt } from '@/components/cosmetics/banner-art';
import { RaceCard, raceCardVariantOf, type RaceCardData } from '@/components/races/race-card';
import { AUTOMATIC_TITLE, NO_SELECTION } from '@/lib/domain/cosmetics';
import type { CosmeticOption, CosmeticState } from '@/lib/server/cosmetics';
import { cn } from '@/lib/utils';

/** A race that exists only to show what a card design looks like. */
const SAMPLE_RACE: RaceCardData = {
  id: 'sample-6h-imola',
  name: '6 Hours of Imola',
  championshipName: 'WEC',
  championshipColor: '#4f8fd0',
  seasonYear: 2026,
  circuit: 'Imola',
  country: 'Italy',
  raceDate: null,
  runtimeSec: 6 * 3600,
  coverageSec: 3.5 * 3600,
  realViewingSec: 3 * 3600,
  sessionCount: 2,
  status: 'WATCHING',
  priority: 'NORMAL',
  excitement: 3,
  isMajorEvent: false,
  isExpedition: false,
  storyComplete: false,
  intervals: [{ start: 0, end: 2 * 3600 }, { start: 2 * 3600, end: 3.5 * 3600 }],
};

export function AppearancePicker({ cosmetics }: { cosmetics: CosmeticState }) {
  const [theme, setTheme] = React.useState(cosmetics.theme.effective ?? 'graphite');
  const [card, setCard] = React.useState(cosmetics.raceCard.effective ?? 'classic');
  // Badge and banner start blank rather than at their current value: an
  // untouched picker must save nothing, so a slot that has never been filled
  // stays open for the first one earned.
  const [badge, setBadge] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const shownBadge = badge ?? cosmetics.badge.effective ?? NO_SELECTION;
  const shownBanner = banner ?? cosmetics.banner.effective ?? NO_SELECTION;

  const titleChosen =
    cosmetics.title.chosen !== null
    && cosmetics.title.options.some((option) => option.value === cosmetics.title.chosen && option.unlocked)
      ? cosmetics.title.chosen
      : AUTOMATIC_TITLE;
  const levelTitles = cosmetics.title.options.filter((option) => option.value.startsWith('level:'));
  const passTitles = cosmetics.title.options.filter((option) => option.value.startsWith('pass:'));

  return (
    <Panel>
      <PanelHeader title="Appearance" />
      <PanelBody className="space-y-6">
        <Section
          title="Dashboard theme"
          hint="Graphite is yours from the start. The others are earned in the season pass — two each quarter."
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cosmetics.theme.options.map((option) => (
              <OptionTile key={option.value} option={option} selected={option.value === theme} onSelect={setTheme}>
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: option.color }} />
              </OptionTile>
            ))}
          </div>
          <input type="hidden" name="themeKey" value={theme} />
        </Section>

        <Section title="Race card design" hint="How races look in the library. Classic is yours from the start.">
          <div className="grid gap-3 sm:grid-cols-2">
            {cosmetics.raceCard.options.map((option) => (
              <OptionTile
                key={option.value}
                option={option}
                selected={option.value === card}
                onSelect={setCard}
                stacked
              >
                <RaceCard race={SAMPLE_RACE} variant={raceCardVariantOf(option.value)} preview compact className="w-full" />
              </OptionTile>
            ))}
          </div>
          <input type="hidden" name="raceCardKey" value={card} />
        </Section>

        <Section title="Badge" hint="Shown next to your name on the career page.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <NoneTile selected={shownBadge === NO_SELECTION} onSelect={() => setBadge(NO_SELECTION)} />
            {cosmetics.badge.options.map((option) => (
              <OptionTile key={option.value} option={option} selected={option.value === shownBadge} onSelect={setBadge}>
                <BadgeEmblem badgeKey={option.value} size={26} />
              </OptionTile>
            ))}
          </div>
          <input type="hidden" name="badgeKey" value={badge ?? ''} />
        </Section>

        <Section title="Banner" hint="Runs across the top of the career page.">
          <div className="grid gap-3 sm:grid-cols-2">
            <NoneTile selected={shownBanner === NO_SELECTION} onSelect={() => setBanner(NO_SELECTION)} />
            {cosmetics.banner.options.map((option) => (
              <OptionTile
                key={option.value}
                option={option}
                selected={option.value === shownBanner}
                onSelect={setBanner}
                stacked
              >
                <BannerArt bannerKey={option.value} className="h-12 rounded" />
              </OptionTile>
            ))}
          </div>
          <input type="hidden" name="bannerKey" value={banner ?? ''} />
        </Section>

        <Field
          label="Displayed title"
          hint="Shown on your career page and your account card. Automatic follows your career level."
        >
          <Select name="displayTitle" defaultValue={titleChosen}>
            <option value={AUTOMATIC_TITLE}>Automatic — {cosmetics.title.automaticName}</option>
            <optgroup label="Career level">
              {levelTitles.map((option) => (
                <option key={option.value} value={option.value} disabled={!option.unlocked}>
                  {option.unlocked ? option.name : `${option.name} — ${option.source.toLowerCase()}`}
                </option>
              ))}
            </optgroup>
            <optgroup label="Season pass">
              {passTitles.map((option) => (
                <option key={option.value} value={option.value} disabled={!option.unlocked}>
                  {option.unlocked ? option.name : `${option.name} — ${option.source}`}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
      </PanelBody>
    </Panel>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div data-picker={title}>
      <div className="label">{title}</div>
      <p className="mb-2 mt-0.5 text-xs text-ink-dim">{hint}</p>
      {children}
    </div>
  );
}

function OptionTile({
  option, selected, onSelect, children, stacked,
}: {
  option: CosmeticOption;
  selected: boolean;
  onSelect: (value: string) => void;
  children: React.ReactNode;
  /** Put the artwork above the text rather than beside it. */
  stacked?: boolean;
}) {
  const locked = !option.unlocked;
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={selected}
      onClick={() => onSelect(option.value)}
      title={locked ? `Locked — ${option.source}` : option.description ?? option.name}
      className={cn(
        'relative flex rounded-md border p-2.5 text-left transition-colors',
        stacked ? 'flex-col gap-2' : 'items-center gap-2.5',
        selected
          ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)]'
          : 'border-hairline-strong bg-panel-2',
        locked ? 'cursor-not-allowed' : !selected && 'hover:border-ink-faint',
      )}
    >
      <span className={cn(locked && 'opacity-35 grayscale', stacked ? 'block w-full' : 'contents')}>{children}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1.5 text-xs font-medium', locked ? 'text-ink-dim' : 'text-ink')}>
          {locked ? <Lock size={11} className="shrink-0" /> : null}
          <span className="truncate">{option.name}</span>
          {selected ? <Check size={12} className="ml-auto shrink-0 text-[var(--accent)]" /> : null}
        </span>
        <span className="mt-0.5 block text-[0.6875rem] leading-snug text-ink-faint">{option.source}</span>
      </span>
    </button>
  );
}

function NoneTile({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-md border p-2.5 text-left text-xs transition-colors',
        selected
          ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)] text-ink'
          : 'border-hairline-strong bg-panel-2 text-ink-dim hover:border-ink-faint',
      )}
    >
      <span className="font-medium">None</span>
      {selected ? <Check size={12} className="ml-auto text-[var(--accent)]" /> : null}
    </button>
  );
}
