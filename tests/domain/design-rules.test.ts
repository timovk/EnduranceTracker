/**
 * Architectural and tone rules, enforced against the source.
 *
 * These are the constraints that are easy to state and easy to erode. A code
 * review catches them once; a test catches them every time.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

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
const SERVER_FILES = walk(join(ROOT, 'src/lib/server'), /\.ts$/);
const AUTH_FILES = walk(join(ROOT, 'src/lib/auth'), /\.ts$/);
/**
 * The desktop shell. Only `src` is walked: `desktop/out` is build output, and
 * scanning a compiled copy of a file would report every rule twice.
 */
const DESKTOP_FILES = walk(join(ROOT, 'desktop/src'), /\.ts$/);
const PAGE_FILES = walk(join(ROOT, 'src/app'), /^page\.tsx$/);
const ALL_SOURCE = [...ENGINE_FILES, ...DOMAIN_FILES, ...COMPONENT_FILES, ...APP_FILES];

/**
 * A repository-relative path, always with forward slashes.
 *
 * `relative()` returns backslashes on Windows, which would stop the literals
 * below from ever matching and turn this whole file into false failures on a
 * Windows checkout.
 */
const rel = (file: string) => relative(ROOT, file).split(sep).join('/');

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

describe('a career belongs to whoever is signed in', () => {
  /**
   * A user id written into the source rather than resolved from the session.
   *
   * Either shape is the same mistake: the application had exactly one tenant
   * for as long as it had a constant to name it, and re-introducing one would
   * quietly hand every account the same career.
   */
  const HARD_CODED_ID = /USER_ID|['"`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"`]/i;

  it('never names a user id in a page, a route, a server module or the auth layer', () => {
    const offenders = [...APP_FILES, ...SERVER_FILES, ...AUTH_FILES].filter((file) =>
      HARD_CODED_ID.test(codeOf(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('exports no user id from the database client', () => {
    const code = codeOf(join(ROOT, 'src/lib/db/client.ts'));
    expect(code).not.toMatch(/export\s+const\s+USER_ID/);
    expect(code).not.toMatch(HARD_CODED_ID);
  });

  it('resolves the account from the session on every page', () => {
    // The session is the only source of an identity. A page that renders
    // career data without asking for one is a page that would render
    // somebody's career to whoever happened to open it.
    const signedOut = new Set([
      'src/app/welcome/page.tsx',
      'src/app/accounts/page.tsx',
      'src/app/accounts/new/page.tsx',
      'src/app/accounts/[id]/sign-in/page.tsx',
    ]);
    for (const file of PAGE_FILES) {
      if (signedOut.has(rel(file))) continue;
      expect(codeOf(file), `${rel(file)} should resolve the signed-in account`)
        .toMatch(/requireUserId\(\)/);
    }
  });

  it('keeps every page out of the full-route cache', () => {
    // `revalidatePath` is process-wide, not per-account. Nothing is cached
    // across a sign-in today because every page is dynamic; drop one of these
    // and one account's dashboard could be served to another.
    for (const file of PAGE_FILES) {
      expect(codeOf(file), `${rel(file)} should export dynamic = 'force-dynamic'`)
        .toMatch(/export\s+const\s+dynamic\s*=\s*'force-dynamic'/);
    }
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

describe('the desktop shell is a separate program', () => {
  /** Every module specifier a file imports, however it imports it. */
  function importsOf(file: string): string[] {
    const code = codeOf(file);
    return [...code.matchAll(/(?:\bfrom|\brequire\(|\bimport\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
  }

  it('finds the shell where it is supposed to be', () => {
    // If this ever reads zero, every rule below passes for the wrong reason.
    expect(DESKTOP_FILES.length).toBeGreaterThan(0);
  });

  it('never imports from the web application', () => {
    // `desktop/` runs in Electron's main process, on CommonJS, compiled by its
    // own tsconfig with no `@` alias and no bundler. An import from `src/`
    // would either fail to resolve or drag React and Prisma into the process
    // that is supposed to be supervising them.
    for (const file of DESKTOP_FILES) {
      for (const specifier of importsOf(file)) {
        expect(specifier.startsWith('@/'), `${rel(file)} imports ${specifier}`).toBe(false);
        expect(/(^|\/)src\//.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it('never lets the career server listen beyond this machine', () => {
    // The Next server the shell spawns is an ordinary HTTP server with no
    // authentication in front of it. Bound to 0.0.0.0 it would hand every
    // career on the machine to anyone sharing the wifi.
    for (const file of DESKTOP_FILES) {
      expect(codeOf(file), rel(file)).not.toContain('0.0.0.0');
    }
    expect(codeOf(join(ROOT, 'desktop/src/server.ts'))).toContain('127.0.0.1');
  });

  it('keeps the web application out of the shell’s reach as well', () => {
    // The other direction: nothing the Next build compiles may reach into the
    // Electron process, or the application would stop working in a browser.
    for (const file of ALL_SOURCE) {
      expect(codeOf(file), rel(file)).not.toMatch(/from\s+['"][^'"]*\bdesktop\//);
      expect(codeOf(file), rel(file)).not.toMatch(/from\s+['"]electron['"]/);
    }
  });
});
