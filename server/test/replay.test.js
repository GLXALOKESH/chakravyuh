/**
 * Replay engine (F11, TRD section 8 socket table and section 9).
 *
 * The engine takes its timer and clock by injection, so ordering, the clock and
 * the end condition are tested directly with no real waiting.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, shutdown } from './helpers.js';

let ReplayEngine;
let REPLAY_EVENTS;

before(async () => {
  await freshDb();
  ({ ReplayEngine, REPLAY_EVENTS } = await import('../src/replay.js'));
});

after(async () => {
  await shutdown();
});

/** Collects every emitted event so assertions can inspect the whole run. */
function recorder() {
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });
  return { events, emit };
}

/** An engine whose timer never fires, so tick() can be driven by hand. */
function manualEngine(emit) {
  const engine = new ReplayEngine({ emit, setTimer: () => Symbol('timer'), clearTimer: () => {} });
  return engine;
}

describe('replay engine', () => {
  test('loads the transaction script and the alerts', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    const script = await engine.load();
    assert.ok(script.transactions > 1000, 'expected a full transaction script');
    assert.equal(script.alerts, 3);
    assert.equal(engine.running, false);
  });

  test('emits txn events in timestamp order as the clock advances', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 100_000 });

    for (let i = 0; i < 200; i += 1) engine.tick();

    const txns = events.filter((e) => e.event === REPLAY_EVENTS.TXN).map((e) => e.payload);
    assert.ok(txns.length > 0, 'expected transactions to be emitted');
    const times = txns.map((t) => Date.parse(t.ts));
    const sorted = [...times].sort((a, b) => a - b);
    assert.deepEqual(times, sorted, 'transactions must be emitted in timestamp order');
  });

  test('the txn socket payload carries no ground truth (TRD section 8)', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 100_000 });
    for (let i = 0; i < 50; i += 1) engine.tick();

    const txn = events.find((e) => e.event === REPLAY_EVENTS.TXN).payload;
    assert.deepEqual(
      Object.keys(txn).sort(),
      ['amount', 'channel', 'from', 'id', 'to', 'ts'].sort(),
      'txn payload should be exactly id, from, to, amount, ts, channel',
    );
  });

  test('emits an alert once the clock passes its fired_at', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 100_000 });

    for (let i = 0; i < 2000; i += 1) {
      engine.tick();
      if (events.some((e) => e.event === REPLAY_EVENTS.ALERT)) break;
    }

    const alerts = events.filter((e) => e.event === REPLAY_EVENTS.ALERT).map((e) => e.payload);
    assert.ok(alerts.length >= 1, 'expected at least one alert during the run');
    // An alert may only fire once its time has come.
    const firedAt = Date.parse(alerts[0].fired_at);
    const clock = Date.parse(engine.state().clock);
    assert.ok(clock >= firedAt, 'clock should have reached the alert time before emitting it');
    hasAlertShape(alerts[0]);
  });

  test('each alert is emitted exactly once', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 1_000_000 });
    while (engine.running && engine.state().emitted < engine.state().queued) engine.tick();

    const ids = events.filter((e) => e.event === REPLAY_EVENTS.ALERT).map((e) => e.payload.id);
    assert.deepEqual(ids, [...new Set(ids)], 'an alert must not fire twice');
  });

  test('replay:clock goes out at most once per replay second', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    // tickMs 250 with speed 60 advances 15 replay seconds per tick, so many
    // ticks share a replay second only if speed is low. Use speed 1 so one tick
    // is 0.25 replay seconds and four ticks make one replay second.
    engine.start({ speed: 1 });
    for (let i = 0; i < 40; i += 1) engine.tick();

    const clocks = events.filter((e) => e.event === REPLAY_EVENTS.CLOCK).map((e) => e.payload.ts);
    assert.ok(clocks.length > 0, 'expected clock ticks');
    assert.deepEqual(clocks, [...new Set(clocks)], 'a replay second must not be emitted twice');
  });

  test('replay ends after the last transaction and reports progress', async () => {
    const { emit, events } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    const queued = engine.state().queued;
    engine.start({ speed: 10_000_000 });

    let guard = 0;
    while (engine.running && guard < 10_000) {
      engine.tick();
      guard += 1;
    }

    assert.equal(engine.running, false, 'engine should have stopped itself');
    assert.equal(events.filter((e) => e.event === REPLAY_EVENTS.END).length, 1, 'replay:end fires exactly once');
    assert.equal(engine.state().progress, 1, 'progress should reach 1');
    assert.equal(engine.state().emitted, queued, 'every transaction should have been emitted');
  });

  test('start is idempotent and stop is safe when not running', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    engine.start({ speed: 60 });
    const again = engine.start({ speed: 120 });
    assert.equal(again.alreadyRunning, true, 'a second start should not restart the clock');
    assert.equal(engine.speed, 60, 'the original speed should be kept');

    assert.deepEqual(engine.stop(), { ok: true });
    assert.deepEqual(engine.stop(), { ok: true, alreadyStopped: true });
  });

  test('start without a loaded script reports a clear error', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    assert.throws(() => engine.start({ speed: 60 }), /replay script is empty/);
  });

  test('a non-positive speed falls back to the default instead of dividing by zero', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    await engine.load();
    const { speed } = engine.start({ speed: -5 });
    assert.ok(speed > 0, 'speed should fall back to a positive default');
  });

  test('replay:start and replay:stop are reachable over REST', async () => {
    const { emit } = recorder();
    const engine = manualEngine(emit);
    await engine.load();

    const { createApp } = await import('../src/app.js');
    const { startServer } = await import('./helpers.js');
    const api = await startServer(createApp({ engine }));

    const started = await api.post('/api/replay/start', { speed: 60 });
    assert.equal(started.status, 200);
    assert.equal(started.body.ok, true);

    const state = await api.get('/api/replay/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.running, true);

    const stopped = await api.post('/api/replay/stop', {});
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.ok, true);

    const bad = await api.post('/api/replay/start', { speed: 0 });
    assert.equal(bad.status, 400, 'speed must be positive');

    await api.stop();
  });
});

function hasAlertShape(alert) {
  for (const key of ['id', 'ring_id', 'fired_at', 'risk', 'members', 'volume', 'reason']) {
    assert.ok(key in alert, `alert is missing "${key}"`);
  }
}