import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.join(serverRoot, '.env') });

/**
 * Prisma 7 keeps the migration connection here rather than in schema.prisma.
 * The runtime client gets its own connection through the pg driver adapter in
 * src/configs/prisma.ts, so changing one does not silently change the other.
 *
 * `prisma generate` runs on postinstall, from a fresh clone, with no database
 * and no .env. It reads this config to find the schema and would fail outright
 * if the value were resolved strictly, taking `npm install` down with it. So the
 * URL is resolved leniently here and checked strictly where it is actually
 * needed: `prisma migrate` and `prisma db push` both fail with a clear message
 * if it is still the placeholder, and the server refuses to start rather than
 * failing to connect.
 */
const PLACEHOLDER_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

const databaseUrl = process.env.DATABASE_URL?.trim() || PLACEHOLDER_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
  // Fails at the CLI boundary rather than at the socket, and only when the
  // string is still the one shipped in .env.example.
  migrations: {
    seed: 'tsx src/bin/seed.ts',
  },
});

// `prisma migrate` and `prisma db push` must not silently target the
// placeholder. Migrations are the one operation that changes a real database,
// so this is checked hard; everything read-only is allowed through.
const requiresRealDatabase = ['migrate', 'db', 'studio'];
const command = process.argv[2] ?? '';
if (requiresRealDatabase.some((verb) => command.startsWith(verb)) && databaseUrl === PLACEHOLDER_URL) {
  if (!existsSync(path.join(serverRoot, '.env'))) {
    console.error('No .env found. Copy .env.example to .env and set DATABASE_URL.');
  } else {
    console.error('DATABASE_URL is still the placeholder from .env.example.');
  }
  console.error('Set it to a real PostgreSQL connection string, then retry.');
  process.exit(1);
}