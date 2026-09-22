/**
 * Prisma client singleton.
 *
 * The client is created LAZILY, on the first property access. That matters for
 * two reasons: Next.js hot-reloads modules in development and would otherwise
 * open a new connection pool on every edit, and — more importantly — importing
 * an engine module must not require a database. The pure cores of the budget,
 * strategist and challenge engines are tested without one.
 */

import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and point it at your database.');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
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
