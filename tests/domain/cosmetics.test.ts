/**
 * Choosing a look versus showing one.
 */

import { describe, expect, it } from 'vitest';
import { LEVEL_TITLES } from '@/lib/config';
import { titleForLevel } from '@/lib/domain/progression';
import {
  AUTOMATIC_TITLE, PASS_TITLES, effectiveSelection, levelTitleChoice, passTitleChoice, passTitleName,
  resolveDisplayTitle,
} from '@/lib/domain/cosmetics';

describe('the displayed title', () => {
  const higher = LEVEL_TITLES.find((title) => title.level > 1)!;

  it('follows the level when nothing has been chosen', () => {
    expect(resolveDisplayTitle(null, 1)).toBe(titleForLevel(1).title);
    expect(resolveDisplayTitle(AUTOMATIC_TITLE, higher.level)).toBe(titleForLevel(higher.level).title);
  });

  it('shows a chosen level title while the career is at that level', () => {
    const lowest = LEVEL_TITLES[0]!;
    expect(resolveDisplayTitle(levelTitleChoice(lowest.title), higher.level)).toBe(lowest.title);
    expect(resolveDisplayTitle(levelTitleChoice(higher.title), higher.level)).toBe(higher.title);
  });

  it('falls back when the career is no longer at the chosen title’s level', () => {
    // Deleting stints can bring a level down, and a title that says otherwise
    // would be the career contradicting itself.
    expect(resolveDisplayTitle(levelTitleChoice(higher.title), higher.level - 1))
      .toBe(titleForLevel(higher.level - 1).title);
  });

  it('shows a season-pass title by its own name', () => {
    const reward = PASS_TITLES[0]!;
    expect(resolveDisplayTitle(passTitleChoice(reward.key), 1)).toBe(passTitleName(reward));
    expect(passTitleName(reward)).not.toMatch(/^Title:/);
  });

  it('falls back on anything it does not recognise', () => {
    expect(resolveDisplayTitle('pass:title_that_does_not_exist', 1)).toBe(titleForLevel(1).title);
    expect(resolveDisplayTitle('level:Not A Title', 1)).toBe(titleForLevel(1).title);
    expect(resolveDisplayTitle(42, 1)).toBe(titleForLevel(1).title);
  });

  it('has season-pass titles to offer', () => {
    expect(PASS_TITLES.length).toBeGreaterThan(0);
    for (const reward of PASS_TITLES) expect(reward.type).toBe('TITLE');
  });
});

describe('what is shown', () => {
  it('shows the choice while it is available and the fallback otherwise', () => {
    const available = new Set(['graphite', 'midnight']);
    expect(effectiveSelection('midnight', available, 'graphite')).toBe('midnight');
    expect(effectiveSelection('sarthe', available, 'graphite')).toBe('graphite');
    expect(effectiveSelection(null, available, 'graphite')).toBe('graphite');
    expect(effectiveSelection('none', new Set<string>(), null)).toBeNull();
  });
});
