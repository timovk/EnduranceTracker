/**
 * Architectural and tone rules, enforced against the source.
 *
 * These are the constraints that are easy to state and easy to erode. A code
 * review catches them once; a test catches them every time.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

/** Source with comments and string literals removed, for structural checks. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ENGINE_FILES = walk(join(ROOT, 'src/lib/engines'), /\.ts$/);
const DOMAIN_FILES = walk(join(ROOT, 'src/lib/domain'), /\.ts$/);
const COMPONENT_FILES = walk(join(ROOT, 'src/components'), /\.tsx?$/);
const APP_FILES = walk(join(ROOT, 'src/app'), /\.tsx?$/);
const ALL_SOURCE = [...ENGINE_FILES, ...DOMAIN_FILES, ...COMPONENT_FILES, ...APP_FILES];

const rel = (file: string) => relative(ROOT, file);

describe('the progression economy stays re-balanceable', () => {
  it('keeps every engine reading its constants from configuration', () => {
    // An engine that computes anything must import from config. The exceptions
    // are the two that deliberately own no balance constants at all.
    const exempt = new Set(['src/lib/engines/contracts.ts', 'src/lib/engines/xp-ledger.ts']);
    for (const file of ENGINE_FILES) {
      if (exempt.has(rel(file))) continue;
      const code = codeOf(file);
      expect(code, `${rel(file)} should import from @/lib/config`).toMatch(/@\/lib\/config/);
    }
  });

  it('defines the level curve in exactly one place', () => {
    // The exponent is the signature of the curve. If it appears anywhere but
    // configuration, the curve has been duplicated.
    const offenders = ALL_SOURCE.filter((file) => /\b1\.35\b/.test(codeOf(file)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('never repeats the annual budget figure outside configuration', () => {
    const offenders = ALL_SOURCE.filter((file) => /\b336\b/.test(codeOf(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('game logic stays out of React components', () => {
  it('never awards XP from a component', () => {
    for (const file of [...COMPONENT_FILES, ...APP_FILES]) {
      const code = codeOf(file);
      expect(code, rel(file)).not.toMatch(/\bawardXp\b/);
      expect(code, rel(file)).not.toMatch(/xpForSession/);
    }
  });

  it('never talks to the database from a component', () => {
    for (const file of COMPONENT_FILES) {
      expect(codeOf(file), rel(file)).not.toMatch(/from\s+['"]@\/lib\/db\/client['"]/);
    }
  });

  it('never merges intervals for progression purposes in a page', () => {
    // A page may render coverage; it may not decide what counts as watched.
    for (const file of APP_FILES) {
      expect(codeOf(file), rel(file)).not.toMatch(/isStoryComplete/);
    }
  });
});

describe('progression can only ever go forwards', () => {
  it('never writes a negative XP amount', () => {
    for (const file of ENGINE_FILES) {
      const code = codeOf(file);
      // `amount:` is the ledger field. It may never be given a negative literal.
      expect(code, rel(file)).not.toMatch(/amount:\s*-\d/);
      expect(code, rel(file)).not.toMatch(/careerXp:\s*\{\s*decrement/);
      expect(code, rel(file)).not.toMatch(/level:\s*\{\s*decrement/);
    }
  });

  it('never decrements a permanent counter', () => {
    const permanent = ['careerXp', 'level', 'prestige', 'longestStreakDays', 'lifetimeActiveDays'];
    for (const file of ENGINE_FILES) {
      const code = codeOf(file);
      for (const field of permanent) {
        expect(code, `${rel(file)} decrements ${field}`)
          .not.toMatch(new RegExp(`${field}[^,;]*decrement`));
      }
    }
  });

  it('never clears an unlock once it has been recorded', () => {
    for (const file of ENGINE_FILES) {
      const code = codeOf(file);
      expect(code, rel(file)).not.toMatch(/unlockedAt:\s*null\s*[,}]\s*\}\s*\)/);
      expect(code, rel(file)).not.toMatch(/awardedAt:\s*null/);
    }
  });

  it('never deletes a trophy or a Hall of Fame entry', () => {
    for (const file of ENGINE_FILES) {
      const code = codeOf(file);
      expect(code, rel(file)).not.toMatch(/trophy\.delete/);
      expect(code, rel(file)).not.toMatch(/hallOfFameEntry\.delete/);
    }
  });
});

describe('the application never scolds', () => {
  const FORBIDDEN = [
    'you failed', 'you lost', 'you missed', 'penalty', 'penalised', 'penalized',
    'overdue', 'you should have', 'falling behind', 'catch up on',
  ];

  /** Every user-visible string literal in a file. */
  function stringsIn(file: string): string[] {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    return [...source.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? '');
  }

  it('says none of the forbidden things anywhere a user can see', () => {
    for (const file of ALL_SOURCE) {
      for (const text of stringsIn(file)) {
        const lower = text.toLowerCase();
        for (const phrase of FORBIDDEN) {
          expect(lower, `${rel(file)}: "${text}"`).not.toContain(phrase);
        }
      }
    }
  });

  it('never tells the user they cannot watch something', () => {
    for (const file of ALL_SOURCE) {
      for (const text of stringsIn(file)) {
        const lower = text.toLowerCase();
        expect(lower, rel(file)).not.toContain('you cannot watch');
        expect(lower, rel(file)).not.toContain('budget exceeded');
        expect(lower, rel(file)).not.toContain('limit reached');
      }
    }
  });
});

describe('determinism', () => {
  it('never uses Math.random in an engine', () => {
    // A recommendation or a challenge board that changes on every page view
    // would be unusable. Every choice is seeded from the period instead.
    for (const file of ENGINE_FILES) {
      expect(codeOf(file), rel(file)).not.toMatch(/Math\.random/);
    }
  });
});

describe('the strategist cannot see XP', () => {
  it('has no route to the XP economy at all', () => {
    const code = codeOf(join(ROOT, 'src/lib/engines/strategist-engine.ts'));
    for (const forbidden of ['XP_CONFIG', 'xpForSession', 'awardXp', 'careerXp', 'xpReward']) {
      expect(code, `strategist references ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('completion percentages are always scoped', () => {
  it('never implies that all of endurance racing is a completion target', () => {
    for (const file of ALL_SOURCE) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      expect(source, rel(file)).not.toMatch(/global\s*completion\s*percent/);
      expect(source, rel(file)).not.toMatch(/overall\s*completion\s*of\s*all/);
    }
  });
});
