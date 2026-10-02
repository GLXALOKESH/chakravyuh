/**
 * Replay engine (F11, TRD section 8 socket table and section 9).
 *
 * The engine takes its script and its timer by injection, so ordering, the
 * clock cadence and the end condition are tested directly with no real waiting
 * and no database. `setScript` is the seam that makes this possible: the
 * ordering guarantees are engine behaviour, not query behaviour.
 *
 * A separate group covers the real 5,000-transaction script loaded from the
 * database, which only runs when a connection string is configured.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ReplayEngine, REPLAY_EVENTS } from '../src/services/replay.service.js';
import { freshDb, hasDatabase, shutdown, startServer } from './helpers.js';
import type { AlertWithRing, ReplayState, Transaction } from '../src/interfaces/domain.interface.js';

interface Recorded {
  event: string;
  payload: unknown;
}

/** Collects every emitted event so assertions can inspect the whole run. */
const recorder = (): { events: Recorded[]; emit: (event: string, payload?: unknown) => void } => {
  const events: Recorded[] = [];
  return { events, emit: (event, payload) => events.push({ event, payload }) };
};

/** An engine whose timer never fires, so tick() can be driven by hand. */
const manualEngine = (emit: (event: string, payload?: unknown) => void): ReplayEngine =>
  new ReplayEngine({ emit, setTimer: () => Symbol('timer'), clearTimer: () => {} });

const txn = (id: string, minutes: number, amount = 1000): Transaction => ({
  id,
  from: 'ACC0001',
  to: 'ACC0002',
  amount,
  ts: new Date(Date.parse('2026-10-01T00:00:00Z') + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  channel: 'UPI',
  location: null,
});

const alert = (id: string, minutes: number): AlertWithRing => ({
  id,
  ring_id: 'RING01',
  fired_at: new Date(Date.parse('2026-10-01T00:00:00Z') + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  risk: 0.9,
  members: 4,
  volume: 1_200_000,
  reason: 'test alert',
});

/** A small deterministic script: one transaction a minute, alerts at 3 and 7. */
const script = () => ({
  transactions: Array.from({ length: 10 }, (_, i) => txn(`TXN${i}`, i + 1)),
  alerts: [alert('ALT02', 7), alert('ALT01', 3)],
});

describe('replay engine', () => {
  it('emits transactions in timestamp order as the clock advances', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    engine.start({ speed: 1000 });

    for (let i = 0; i < 100; i += 1) engine.tick();

    const times = events.filter((e) => e.event === REPLAY_EVENTS.TXN).map((e) => Date.parse((e.payload as Transaction).ts));
    expect(times.length).toBeGreaterThan(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('a script is sorted on the way in, whatever order it arrives in', () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    const shuffled = { transactions: [txn('TXN9', 9), txn('TXN1', 1), txn('TXN5', 5)], alerts: [] };
    engine.setScript(shuffled);
    expect(engine.state().queued).toBe(3);
  });

  it('the txn socket payload carries no ground truth (TRD section 8)', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    engine.start({ speed: 1000 });
    for (let i = 0; i < 20; i += 1) engine.tick();

    const payload = events.find((e) => e.event === REPLAY_EVENTS.TXN)!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['amount', 'channel', 'from', 'id', 'to', 'ts']);
  });

  it('emits an alert only once the clock passes its fired_at', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    engine.start({ speed: 1000 });

    for (let i = 0; i < 2000; i += 1) {
      engine.tick();
      if (events.some((e) => e.event === REPLAY_EVENTS.ALERT)) break;
    }

    const alerts = events.filter((e) => e.event === REPLAY_EVENTS.ALERT).map((e) => e.payload as AlertWithRing);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const clock = Date.parse(engine.state().clock!);
    expect(clock, 'clock should have reached the alert time before emitting it').toBeGreaterThanOrEqual(
      Date.parse(alerts[0]!.fired_at!),
    );
    expect(alerts[0]).toHaveProperty('ring_id');
    expect(alerts[0]).toHaveProperty('members');
    expect(alerts[0]).toHaveProperty('volume');
  });

  it('each alert is emitted exactly once', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    engine.start({ speed: 1_000_000 });
    while (engine.running && engine.state().emitted < engine.state().queued) engine.tick();

    const ids = events.filter((e) => e.event === REPLAY_EVENTS.ALERT).map((e) => (e.payload as AlertWithRing).id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids.sort()).toEqual(['ALT01', 'ALT02']);
  });

  it('replay:clock goes out at most once per replay second', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    // Speed 1 means one tick is 0.25 replay seconds, so four ticks make one
    // replay second. This is the case where the once-per-second guard matters.
    engine.start({ speed: 1 });
    for (let i = 0; i < 40; i += 1) engine.tick();

    const clocks = events.filter((e) => e.event === REPLAY_EVENTS.CLOCK).map((e) => (e.payload as { ts: string }).ts);
    expect(clocks.length).toBeGreaterThan(0);
    expect(clocks).toEqual([...new Set(clocks)]);
  });

  it('replay:clock still fires through a quiet stretch, so the bar keeps moving', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    // A single transaction an hour later: the clock must keep ticking after the
    // queue is otherwise empty.
    engine.setScript({ transactions: [txn('TXN0', 1), txn('TXN1', 120)], alerts: [] });
    engine.start({ speed: 60 });
    for (let i = 0; i < 4; i += 1) engine.tick();
    expect(events.filter((e) => e.event === REPLAY_EVENTS.CLOCK).length).toBeGreaterThan(0);
  });

  it('ends after the last transaction and reports progress', () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    const queued = engine.state().queued;
    engine.start({ speed: 10_000_000 });

    let guard = 0;
    while (engine.running && guard < 10_000) {
      engine.tick();
      guard += 1;
    }

    expect(engine.running, 'engine should have stopped itself').toBe(false);
    expect(events.filter((e) => e.event === REPLAY_EVENTS.END).length).toBe(1);
    const state: ReplayState = engine.state();
    expect(state.progress).toBe(1);
    expect(state.emitted).toBe(queued);
  });

  it('start is idempotent and stop is safe when not running', () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());

    engine.start({ speed: 60 });
    const again = engine.start({ speed: 120 });
    expect(again.alreadyRunning, 'a second start should not restart the clock').toBe(true);
    expect(engine.state().speed, 'the original speed should be kept').toBe(60);

    expect(engine.stop()).toEqual({ ok: true });
    expect(engine.stop()).toEqual({ ok: true, alreadyStopped: true });
  });

  it('start without a loaded script reports a clear error', () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    expect(() => engine.start({ speed: 60 })).toThrow(/replay script is empty/);
  });

  it('a non-positive speed falls back to the default instead of dividing by zero', () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    const { speed } = engine.start({ speed: -5 });
    expect(speed).toBeGreaterThan(0);
  });
  it('tick() is a no-op before start', () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    expect(engine.tick()).toBeNull();
  });
});

describe('replay over REST', () => {
  it('start, state and stop are all reachable', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    const api = await startServer(createApp({ engine }));

    try {
      const started = await api.post('/api/replay/start', { speed: 60 });
      expect(started.status).toBe(200);
      expect(started.body.ok).toBe(true);

      const state = await api.get('/api/replay/state');
      expect(state.status).toBe(200);
      expect(state.body.running).toBe(true);

      const stopped = await api.post('/api/replay/stop', {});
      expect(stopped.status).toBe(200);
      expect(stopped.body.ok).toBe(true);
    } finally {
      await api.stop();
    }
  });

  it('rejects a non-positive speed with 400', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    engine.setScript(script());
    const api = await startServer(createApp({ engine }));

    try {
      const bad = await api.post('/api/replay/start', { speed: 0 });
      expect(bad.status).toBe(400);
      expect(typeof bad.body.error).toBe('string');
    } finally {
      await api.stop();
    }
  });
});

// The real script, loaded from the database. Skipped until a connection string
// exists, because Prisma has no in-process substitute.
describe.skipIf(!hasDatabase())('replay against the seeded script', () => {
  afterAll(shutdown);

  it('loads the full transaction script and every alert', async () => {
    await freshDb();
    const { emit } = recorder();
    const engine = manualEngine(emit);
    const loaded = await engine.load();
    expect(loaded.transactions).toBeGreaterThan(1000);
    expect(loaded.alerts).toBe(3);
    expect(engine.running).toBe(false);
  });

  it('replays the seeded script in timestamp order end to end', async () => {
    await freshDb();
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 10_000_000 });

    let guard = 0;
    while (engine.running && guard < 100_000) {
      engine.tick();
      guard += 1;
    }

    const txns = events.filter((e) => e.event === REPLAY_EVENTS.TXN).map((e) => e.payload as Transaction);
    const times = txns.map((t) => Date.parse(t.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(txns.length).toBe(engine.state().queued);
    expect(events.filter((e) => e.event === REPLAY_EVENTS.ALERT).length).toBe(3);
  });
});
