/**
 * Test environment.
 *
 * Integration tests run against a real PostgreSQL database — progression
 * integrity is exactly the kind of thing an in-memory fake would let through.
 * `.env.test` points at a separate database so a test run can never touch real
 * viewing history.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const testEnv = resolve(process.cwd(), '.env.test');
config({ path: existsSync(testEnv) ? testEnv : resolve(process.cwd(), '.env'), quiet: true });
