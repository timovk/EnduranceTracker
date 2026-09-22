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

/** The single-user id this installation operates as. */
export const USER_ID = process.env.ENDURANCE_USER_ID ?? '00000000-0000-4000-8000-000000000001';

/** A Prisma transaction client, for engines that must write atomically. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/**
 * `createMany` that ignores rows which already exist.
 *
 * Prisma's `skipDuplicates` is not available on SQLite, but the engines rely on
 * the behaviour it provides: creating the rows that are missing is how
 * `ensureChallenges`, `ensureMasteryTrees` and friends stay idempotent, and
 * calling one of them twice must not fail.
 *
 * The fast path is a single statement. Only when that hits a unique-constraint
 * violation does it fall back to inserting row by row and skipping the ones
 * that conflict — so the cost is paid exactly when there is a duplicate, which
 * in a single-user application is almost never.
 */
export async function createManySkippingDuplicates<T>(
  delegate: {
    createMany: (args: { data: T[] }) => Promise<{ count: number }>;
    create: (args: { data: T }) => Promise<unknown>;
  },
  data: T[],
): Promise<number> {
  if (data.length === 0) return 0;

  try {
    const result = await delegate.createMany({ data });
    return result.count;
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }

  let created = 0;
  for (const row of data) {
    try {
      await delegate.create({ data: row });
      created += 1;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
    }
  }
  return created;
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
