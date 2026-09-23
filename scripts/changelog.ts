/**
 * Write CHANGELOG.md from src/lib/changelog.ts.
 *
 *     npm run changelog
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderChangelogMarkdown } from '@/lib/changelog';

const target = resolve(process.cwd(), 'CHANGELOG.md');
writeFileSync(target, renderChangelogMarkdown(), 'utf8');
console.log(`Wrote ${target}`);
