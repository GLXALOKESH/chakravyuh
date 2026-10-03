/**
 * The pipeline trigger and its failure modes (TRD section 7.10).
 *
 * POST /api/pipeline/run exists to make one call take the data from "the
 * pipeline wrote new files" to "the API is serving them". Without it the flow is
 * a terminal command plus a restart, and the most likely mistake is running the
 * pipeline and forgetting to reload — which looks like success while the
 * dashboard keeps showing the previous dataset.
 *
 * The behaviour worth testing is what happens when things are broken, because
 * that is when a silent fallback would be most damaging.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { freshDb, shutdown, startServer, type TestClient } from './helpers.js';

let api: TestClient;

afterAll(async () => {
  await api?.stop();
  await shutdown();
});

describe('pipeline trigger', () => {
  it('reports a clear error when the Python service is unreachable', async () => {
    api ??= await startServer(createApp());
    await freshDb();

    // ML_URL points at a port nothing is listening on for this suite, so this is
    // the realistic "Python is not running" case. The response has to say the
    // service is unreachable rather than reporting a generic failure, because
    // those need different fixes.
    const { status, body } = await api.post('/api/pipeline/run', { profile: 'demo' });

    expect(status).toBe(502);
    expect(body.error).toMatch(/pipeline service unreachable/i);
    expect(body.reloaded).toBe(false);
  });

  it('leaves the previously seeded data serving when the trigger fails', async () => {
    // The point of the trigger being non-destructive. A failed run must not take
    // the dashboard down with it.
    const before = await api.get('/api/rings');
    const { status } = await api.post('/api/pipeline/run', { profile: 'demo' });
    const after = await api.get('/api/rings');

    expect(status).toBe(502);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);
    expect(Array.isArray(after.body) && after.body.length > 0).toBe(true);
  });

  it('rejects a profile outside the four the pipeline supports', async () => {
    // DTO validation, so a typo is a 400 naming the field rather than a 502 from
    // a service call that was never going to work.
    const { status, body } = await api.post('/api/pipeline/run', { profile: 'nonsense' });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/profile/);
  });

  it('treats an omitted profile as the configured one', async () => {
    // An empty body must reach the service, not fail validation. profile is
    // optional in the DTO precisely so `curl -X POST .../pipeline/run` works.
    const { status, body } = await api.post('/api/pipeline/run', {});

    expect(status).toBe(502);
    expect(body.profile).toBe('demo');
  });
});