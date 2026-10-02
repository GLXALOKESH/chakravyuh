/**
 * The Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter on the client, so the connection string
 * reaches PostgreSQL through @prisma/adapter-pg rather than through a `url` in
 * schema.prisma. The migration connection is configured separately in
 * prisma.config.ts; keeping the two apart means changing one does not silently
 * change the other.
 *
 * One client for the process. Creating more would open a connection pool per
 * instance, and the test suite shares this one too.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env.js';
import { PrismaClient } from '../repositories/prisma/client.js';

const build = (): PrismaClient => {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and put the PostgreSQL ' +
        'connection string there before starting the server or running the seed.',
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg(config.databaseUrl),
    log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });
};

let client: PrismaClient | null = null;

export const prisma = (): PrismaClient => {
  client ??= build();
  return client;
};

/**
 * Releases the pool. Called from the shutdown path in bin/server.ts so the
 * process exits promptly instead of waiting on idle connections.
 */
export const disconnect = async (): Promise<void> => {
  if (!client) return;
  await client.$disconnect();
  client = null;
};

/** A description of the connection for /health and the startup banner. */
export const describeDatabase = (): { driver: string; host: string; database: string } => {
  try {
    const url = new URL(config.databaseUrl);
    return {
      driver: 'postgresql (prisma)',
      host: `${url.hostname}:${url.port || 5432}`,
      database: url.pathname.replace(/^\//, '') || '(default)',
    };
  } catch {
    return { driver: 'postgresql (prisma)', host: 'unknown', database: 'unknown' };
  }
};
