/**
 * Prisma client singleton.
 *
 * The database is SQLite, held in a single file. For a single-user
 * application whose whole history lives on one machine that is the right
 * shape: there is no server to install, nothing to keep running, and the
 * entire career is one file the user can copy or back up.
 *
 * The client is created LAZILY, on the first property access. That matters for
 * two reasons: Next.js hot-reloads modules in development and would otherwise
 * open a new connection on every edit, and — more importantly — importing an
 * engine module must not require a database. The pure cores of the budget,
 * strategist and challenge engines are tested without one.
 */

import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env — the default value works as-is.');
  }
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * The client, behind a proxy so that nothing connects until a query is
 * actually issued.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient() as object, property, receiver) as unknown;
  },
  has(_target, property) {
    return Reflect.has(getClient() as object, property);
  },
  ownKeys() {
    return Reflect.ownKeys(getClient() as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getClient() as object, property);
  },
});

/** Force the connection open. Used by scripts that want to fail fast. */
export async function connectDb(): Promise<void> {
  await getClient().$connect();
}

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.prisma) await globalForPrisma.prisma.$disconnect();
}

/** A Prisma transaction client, for engines that must write atomically. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/**
 * How a caller identifies the rows that are already there.
 *
 * `keyOf` turns a candidate row into the unique constraint's identity, and
 * `findExisting` answers which of those identities the database already holds.
 * The caller does the asking because only the caller knows which `where`
 * clause is cheap — usually one it was about to run anyway.
 */
export interface SkipDuplicatesFilter<T> {
  keyOf: (row: T) => string;
  findExisting: (candidates: readonly T[]) => Iterable<string> | Promise<Iterable<string>>;
}

/**
 * `createMany` that ignores rows which already exist.
 *
 * Prisma's `skipDuplicates` is not available on SQLite, but the engines rely on
 * the behaviour it provides: creating the rows that are missing is how
 * `ensureChallenges`, `ensureMasteryTrees` and friends stay idempotent, and
 * calling one of them twice must not fail.
 *
 * Pass a `filter` and the duplicates are removed before anything is sent, so
 * the steady state — everything already there, nothing to insert — costs one
 * read and no failing statement. That matters beyond speed: Prisma logs every
 * constraint violation as `prisma:error` before rejecting, and a healthy
 * desktop application must not fill the user's log with errors it caused
 * itself and then swallowed.
 *
 * Without a filter, the fast path is a single statement and a unique-constraint
 * violation falls back to inserting row by row, skipping the ones that
 * conflict. The fallback stays either way: it is the backstop for a genuine
 * race between two callers, which a read-then-write pre-filter cannot close.
 *
 * Returns the number of rows actually inserted.
 */
export async function createManySkippingDuplicates<T>(
  delegate: {
    createMany: (args: { data: T[] }) => Promise<{ count: number }>;
    create: (args: { data: T }) => Promise<unknown>;
  },
  data: T[],
  filter?: SkipDuplicatesFilter<T>,
): Promise<number> {
  if (data.length === 0) return 0;

  const pending = filter === undefined ? data : await withoutExisting(data, filter);
  if (pending.length === 0) return 0;

  try {
    const result = await delegate.createMany({ data: pending });
    return result.count;
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }

  let created = 0;
  for (const row of pending) {
    try {
      await delegate.create({ data: row });
      created += 1;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
    }
  }
  return created;
}

/**
 * The candidates the database does not already hold.
 *
 * Also drops repeats within `data` itself: two candidates sharing a key would
 * violate the same constraint, and the point of the filter is that the insert
 * it produces cannot fail.
 */
async function withoutExisting<T>(data: T[], filter: SkipDuplicatesFilter<T>): Promise<T[]> {
  const seen = new Set(await filter.findExisting(data));
  const pending: T[] = [];
  for (const row of data) {
    const key = filter.keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(row);
  }
  return pending;
}

/** Prisma reports a unique-constraint violation as P2002 on every provider. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
