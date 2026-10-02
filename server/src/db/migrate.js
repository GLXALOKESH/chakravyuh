#!/usr/bin/env node
/** Applies server/sql/*.sql. Safe to run repeatedly. */
import { migrate, close, getDriverName } from './index.js';

try {
  const applied = await migrate();
  const fresh = applied.length > 0;
  console.log(`driver: ${getDriverName()}`);
  console.log(fresh ? `applied ${applied.join(', ')}` : 'nothing to apply');
  await close();
  process.exit(0);
} catch (err) {
  console.error('migrate failed:', err.message);
  await close().catch(() => {});
  process.exit(1);
}