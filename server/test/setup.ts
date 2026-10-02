/**
 * Per-worker setup. Runs before any test file is imported, which is what lets it
 * redirect DATABASE_URL before configs/env.ts reads it.
 *
 * Nothing here touches the database; the schema is created once in
 * global-setup.ts.
 */
import 'reflect-metadata';
import { resolveTestDatabaseUrl } from './db-url.js';

const url = resolveTestDatabaseUrl();
if (url) process.env.DATABASE_URL = url;
