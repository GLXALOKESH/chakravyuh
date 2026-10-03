/**
 * GET /api/transactions, the paginated ledger.
 *
 * Exists because the dashboard asked not to be handed the whole ledger at once.
 * What matters here is that pages do not overlap or skip when transactions share
 * a timestamp, which is common in synthetic data where the generator writes many
 * rows at the same minute.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { freshDb, shutdown, startServer, type TestClient } from './helpers.js';

let api: TestClient;

beforeAll(async () => {
  await freshDb();
  api = await startServer(createApp());
});

afterAll(async () => {
  await api?.stop();
  await shutdown();
});

describe('GET /api/transactions', () => {
  it('defaults to a first page of 50 and reports the totals', async () => {
    const { status, body } = await api.get('/api/transactions');

    expect(status).toBe(200);
    expect(body.rows.length).toBe(50);
    expect(body.page).toBe(1);
    expect(body.total).toBeGreaterThan(0);
    expect(body.pages).toBe(Math.ceil(body.total / 50));
  });

  it('honours page and limit', async () => {
    const { status, body } = await api.get('/api/transactions?page=2&limit=25');

    expect(status).toBe(200);
    expect(body.rows.length).toBe(25);
    expect(body.page).toBe(2);
    expect(body.pages).toBe(Math.ceil(body.total / 25));
  });

  it('serves oldest first and never repeats a row across a page boundary', async () => {
    // The tiebreak on _id is what makes this hold. Sorting on ts alone would let
    // two transactions with the same timestamp straddle a boundary and appear on
    // both pages, or neither.
    const first = await api.get('/api/transactions?page=1&limit=100');
    const second = await api.get('/api/transactions?page=2&limit=100');

    const ids = [...first.body.rows, ...second.body.rows].map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    const times = first.body.rows.map((t: { ts: string }) => Date.parse(t.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('clamps a page past the end to the last page instead of returning nothing', async () => {
    // An empty array here reads as "no data", which is worse than showing the
    // final page the caller almost certainly meant.
    const last = await api.get('/api/transactions?limit=25');
    const beyond = await api.get(`/api/transactions?page=${last.body.pages + 50}&limit=25`);

    expect(beyond.status).toBe(200);
    expect(beyond.body.page).toBe(last.body.pages);
    expect(beyond.body.rows.length).toBeGreaterThan(0);
  });

  it('rejects a limit that would serialise the whole ledger', async () => {
    const { status, body } = await api.get('/api/transactions?limit=100000');

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/limit/);
  });

  it('rejects nonsense page values by name', async () => {
    const { status, body } = await api.get('/api/transactions?page=0');

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/page/);
  });

  it('never returns is_fraud', async () => {
    // Ground truth stays in the database and out of every response, including
    // the one route that hands back raw rows.
    const { body } = await api.get('/api/transactions?limit=50');

    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(['amount', 'channel', 'from', 'id', 'location', 'to', 'ts']);
    }
  });
});