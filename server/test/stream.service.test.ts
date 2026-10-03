/**
 * Live mode (docs/STREAMING.md): the stream service on its own.
 *
 * The generator, the predictor and the timers are all fakes driven by hand, so
 * a whole run plays in a few milliseconds with no Python: lines go in through
 * the fake generator, tick() and pump() are called directly, and every event
 * the dashboard would receive is recorded.
 */
import { describe, expect, it } from 'vitest';
import { STREAM_EVENTS } from '../src/constants/index.js';
import { StreamService } from '../src/services/stream.service.js';
import { PredictorError, type PredictorClient, type PredictRequest, type PredictResponse } from '../src/services/predictor.client.js';
import type { GeneratorOptions } from '../src/services/generator.process.js';

interface Recorded {
  event: string;
  payload: any;
}

const ts = (minutes: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const account = (id: string) => ({ type: 'account', account: { id, holder: `Holder ${id}`, bank: 'Bank', home: { city: 'Pune', lat: 18.5, lng: 73.8 }, opened_at: ts(-3 * 1440), opening_balance_paise: 500_000 } });

const txn = (id: string, from: string, to: string, paise: number, minutes: number, fraud = false, channel = 'UPI') => ({
  type: 'txn',
  txn: { id, from, to, amount_paise: paise, ts: ts(minutes), channel, location: channel === 'ATM' ? { city: 'Delhi', lat: 28.6, lng: 77.2 } : null },
  gt: { is_fraud: fraud, ring: fraud ? 'G01' : null },
});

const ring = (version: number, members = ['ACC0001', 'ACC0002', 'ACC0003']) => ({
  id: 'LIVE-R01',
  version,
  member_ids: members,
  roles: { ACC0001: { role: 'source', role_reason: 'first' }, ACC0002: { role: 'mule', role_reason: 'forwards' }, ACC0003: { role: 'cash-out', role_reason: 'atm' } },
  edges: [{ from: 'ACC0001', to: 'ACC0002', amount: 12_345_67, count: 1 }],
  identity_links: [{ identifier: 'DEV1', type: 'device' as const, account_ids: members }],
  volume_paise: 12_345_67,
  risk: 0.9,
  victim_txn_ids: ['T1'],
  first_seen: ts(10),
});

const answer = (req: PredictRequest, extra: Partial<PredictResponse> = {}): PredictResponse => ({
  seq: req.seq,
  applied: true,
  took_ms: 5,
  scores: [],
  rings: [],
  alerts: [],
  stats: {},
  ...extra,
});

/** A predictor whose answers are scripted per call, and which records every request. */
const fakePredictor = (script: ((req: PredictRequest) => PredictResponse | Error)[] = []) => {
  const calls: PredictRequest[] = [];
  const resets: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client: PredictorClient = {
    reset: async (runId) => {
      resets.push(runId);
      return { ok: true };
    },
    predict: async (req) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const step = script.shift();
      const out = step ? step(req) : answer(req);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { client, calls, resets, maxInFlight: () => maxInFlight };
};

const setup = (predictor = fakePredictor(), options: { maxTxns?: number; batchMax?: number } = {}) => {
  const events: Recorded[] = [];
  let generator: GeneratorOptions | null = null;
  let killed = 0;
  let now = 1_000_000;
  const service = new StreamService({
    emit: (event, payload) => events.push({ event, payload }),
    predictor: predictor.client,
    spawn: (opts) => {
      generator = opts;
      return { pid: 4242, kill: () => (killed += 1) };
    },
    setTimer: () => Symbol('timer'),
    clearTimer: () => {},
    now: () => now,
    ...options,
  });
  const send = (...lines: Record<string, unknown>[]) => lines.forEach((line) => generator!.onEvent(line));
  return {
    service,
    events,
    predictor,
    send,
    of: (name: string) => events.filter((e) => e.event === name).map((e) => e.payload),
    advance: (ms: number) => (now += ms),
    killed: () => killed,
    exit: (code: number | null) => generator!.onExit(code),
  };
};

const opening = () => [
  { type: 'run', seed: 7, rate: 300, sim_start: ts(0), sim_end: ts(1440) },
  account('ACC0001'),
  account('ACC0002'),
  account('ACC0003'),
  { type: 'identifier', id: 'DEV1', kind: 'device', account_id: 'ACC0001' },
  { type: 'identifier', id: 'DEV1', kind: 'device', account_id: 'ACC0002' },
  txn('S1', 'SALARY', 'ACC0001', 5_000_000, 1),
];

describe('stream service', () => {
  it('relays transactions in batches, in rupees, without salary credits or labels', () => {
    const t = setup();
    t.service.start({ seed: 7, rate: 300 });
    t.send(...opening(), txn('T1', 'VICTIM_7F3A21C0', 'ACC0001', 10_000_050, 5, true), txn('T2', 'ACC0001', 'ACC0002', 4_000_049, 6, true));
    t.service.tick();

    const batches = t.of(STREAM_EVENTS.TXNS);
    expect(batches).toHaveLength(1);
    const sent = batches[0].txns;
    expect(sent.map((x: any) => x.id)).toEqual(['T1', 'T2']);
    // Paise to whole rupees, half up, with no threshold.
    expect(sent[0].amount).toBe(100_001);
    expect(sent[1].amount).toBe(40_000);
    for (const x of sent) {
      expect(x).not.toHaveProperty('is_fraud');
      expect(x).not.toHaveProperty('gt');
      expect(x).not.toHaveProperty('amount_paise');
    }
    expect(t.of(STREAM_EVENTS.CLOCK).at(-1).ts).toBe(ts(0));
  });

  it('sends the predictor everything in order, numbered, without ground truth', async () => {
    const t = setup();
    t.service.start({});
    t.send(...opening(), txn('T1', 'VICTIM_7F3A21C0', 'ACC0001', 10_000_000, 5, true), { type: 'truth', ring: 'G01', pattern: 'A', member_ids: ['ACC0001'], victim_txn_id: 'T1', planted_at: ts(5) });
    await t.service.pump();
    t.send(txn('T2', 'ACC0001', 'ACC0002', 4_000_000, 6, true));
    await t.service.pump();
    await t.service.pump();

    expect(t.predictor.resets).toHaveLength(1);
    expect(t.predictor.calls.map((c) => c.seq)).toEqual([1, 2]);
    expect(t.predictor.calls[0]!.accounts).toHaveLength(3);
    expect(t.predictor.calls[0]!.identifiers).toHaveLength(2);
    expect(t.predictor.calls[0]!.txns.map((x: any) => x.id)).toEqual(['S1', 'T1']);
    expect(t.predictor.calls[1]!.txns.map((x: any) => x.id)).toEqual(['T2']);
    const raw = JSON.stringify(t.predictor.calls);
    expect(raw).not.toContain('is_fraud');
    expect(raw).not.toContain('"gt"');
    expect(raw).not.toContain('G01');
    expect(t.predictor.maxInFlight()).toBe(1);
  });

  it('relays scores, ring versions once each, and one alert per ring', async () => {
    const steps = [
      (req: PredictRequest) =>
        answer(req, {
          scores: [{ id: 'ACC0001', risk: 0.8, risk_v1: 0.4, risk_v2: 0.95, band: 'CRITICAL', provisional: false, signals: [{ feature: 'pass_through', label: 'Forwards 99% of what it receives', weight: 1 }] }],
          rings: [ring(1)],
          alerts: [{ id: 'LIVE-A01', ring_id: 'LIVE-R01', fired_at: ts(10), reason: '3 linked accounts moved ₹1.2 lakh' }],
        }),
      (req: PredictRequest) => answer(req, { rings: [ring(1)], alerts: [{ id: 'LIVE-A01', ring_id: 'LIVE-R01', fired_at: ts(11), reason: 'again' }] }),
      (req: PredictRequest) => answer(req, { rings: [ring(2, ['ACC0001', 'ACC0002', 'ACC0003', 'ACC0004'])] }),
    ];
    const t = setup(fakePredictor(steps));
    t.service.start({});
    t.send(...opening());
    await t.service.pump();
    t.send(txn('T2', 'ACC0001', 'ACC0002', 4_000_000, 12));
    await t.service.pump();
    t.send(txn('T3', 'ACC0002', 'ACC0003', 3_000_000, 13));
    await t.service.pump();

    expect(t.of(STREAM_EVENTS.SCORES)[0].scores[0]).toMatchObject({ id: 'ACC0001', risk_v2: 0.95, band: 'CRITICAL' });
    const rings = t.of(STREAM_EVENTS.RING);
    expect(rings.map((r) => r.version)).toEqual([1, 2]);
    expect(rings[0].ring).toMatchObject({ id: 'LIVE-R01', version: 1, volume: 12_346 });
    expect(rings[0].ring.nodes.find((n: any) => n.id === 'ACC0003').role).toBe('cash-out');
    expect(rings[0].ring.edges.find((e: any) => e.kind === 'txn').amount).toBe(12_346);
    expect(rings[1].ring.nodes.filter((n: any) => n.type === 'account')).toHaveLength(4);
    const alerts = t.of(STREAM_EVENTS.ALERT);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert).toMatchObject({ id: 'LIVE-A01', ring_id: 'LIVE-R01', members: 3, volume: 12_346, before_cashout: true });
    expect(t.service.store.accountDetail('ACC0001')).toMatchObject({ ring_id: 'LIVE-R01', role: 'source', risk_v2: 0.95 });
  });

  it('keeps streaming while the predictor is down, then delivers what it missed', async () => {
    const down = new PredictorError('predictor unreachable: connect ECONNREFUSED', 0);
    const t = setup(fakePredictor([() => down, () => down]));
    t.service.start({});
    t.send(...opening());
    await t.service.pump();
    expect(t.service.state().predictor.status).toBe('down');

    t.send(txn('T2', 'ACC0001', 'ACC0002', 1_000_000, 8));
    t.service.tick();
    expect(t.of(STREAM_EVENTS.TXNS).flatMap((b) => b.txns).map((x: any) => x.id)).toEqual(['T2']);

    // Backing off: no new request until the retry time.
    await t.service.pump();
    expect(t.predictor.calls).toHaveLength(1);
    t.advance(1000);
    await t.service.pump();
    expect(t.predictor.calls).toHaveLength(2);
    t.advance(2000);
    await t.service.pump();

    // The same batch was resent each time under the same number, and nothing was lost.
    expect(t.predictor.calls.map((c) => c.seq)).toEqual([1, 1, 1]);
    expect(t.predictor.calls[2]!.txns.map((x: any) => x.id)).toEqual(['S1']);
    await t.service.pump();
    expect(t.predictor.calls.at(-1)!.txns.map((x: any) => x.id)).toEqual(['T2']);
    expect(t.service.state().predictor.status).toBe('ok');
  });

  it('resends the whole run when the predictor answers 409', async () => {
    const t = setup(fakePredictor([(r) => answer(r), () => new PredictorError('HTTP 409', 409, { error: 'run_mismatch' })]));
    t.service.start({});
    t.send(...opening());
    await t.service.pump();
    t.send(txn('T2', 'ACC0001', 'ACC0002', 1_000_000, 8));
    await t.service.pump();
    await t.service.pump();

    expect(t.predictor.resets).toHaveLength(2);
    const last = t.predictor.calls.at(-1)!;
    expect(last.seq).toBe(1);
    expect(last.txns.map((x: any) => x.id)).toEqual(['S1', 'T2']);
  });

  it('cuts big backlogs into batches and stops a batch at its last transaction', async () => {
    const t = setup(fakePredictor(), { batchMax: 2 });
    t.service.start({});
    t.send(...opening(), txn('T2', 'ACC0001', 'ACC0002', 100, 2), txn('T3', 'ACC0002', 'ACC0003', 100, 3), { type: 'clock', ts: ts(30) });
    await t.service.pump();
    await t.service.pump();
    expect(t.predictor.calls.map((c) => c.txns.length)).toEqual([2, 1]);
    expect(t.predictor.calls[0]!.clock).toBe(ts(2));
    expect(t.predictor.calls[1]!.clock).toBe(ts(30));
  });

  it('rejects malformed lines without stopping the run', () => {
    const t = setup();
    t.service.start({});
    const result = t.service.ingest([
      { type: 'txn', txn: { id: 'X', from: 'A', to: 'B', amount_paise: 1.5, ts: ts(1), channel: 'UPI' } },
      { type: 'txn', txn: { id: 'Y', from: 'A', to: 'B', amount_paise: 100, ts: '2026-10-01 00:00', channel: 'UPI' } },
      { type: 'txn', txn: { id: 'Z', from: 'A', to: 'B', amount_paise: 100, ts: ts(1), channel: 'CHEQUE' } },
      { type: 'identifier', id: 'D', kind: 'email', account_id: 'A' },
      { type: 'nonsense' },
      txn('OK', 'ACC0001', 'ACC0002', 100, 1),
    ]);
    expect(result).toEqual({ accepted: 1, rejected: 5 });
    expect(t.service.isRunning).toBe(true);
  });

  it('ends the run at the capacity limit', () => {
    const t = setup(fakePredictor(), { maxTxns: 3 });
    t.service.start({});
    t.send(...opening(), txn('T2', 'ACC0001', 'ACC0002', 100, 2), txn('T3', 'ACC0002', 'ACC0003', 100, 3), txn('T4', 'ACC0002', 'ACC0003', 100, 4));
    expect(t.service.isRunning).toBe(false);
    expect(t.killed()).toBe(1);
    expect(t.service.store.txns).toHaveLength(3);
    expect(t.of(STREAM_EVENTS.ERROR)[0].error).toContain('was ended');
  });

  it('drains to the predictor after the generator ends, then ends the run', async () => {
    const t = setup();
    t.service.start({});
    t.send(...opening(), { type: 'end', reason: 'duration' });
    expect(t.service.state().mode).toBe('live');
    await t.service.pump();
    expect(t.of(STREAM_EVENTS.END)).toEqual([{ run_id: t.service.store.runId, reason: 'duration' }]);
    expect(t.service.state().mode).toBe('idle');
  });

  it('reports a generator that dies mid-run', () => {
    const t = setup();
    t.service.start({});
    t.send(...opening());
    t.exit(1);
    expect(t.service.state().generator.status).toBe('failed');
    expect(t.of(STREAM_EVENTS.ERROR)[0].error).toContain('stopped unexpectedly');
  });

  it('starts one run at a time, and a new run starts clean', () => {
    let replayStops = 0;
    const events: Recorded[] = [];
    const service = new StreamService({
      emit: (event, payload) => events.push({ event, payload }),
      predictor: fakePredictor().client,
      spawn: (opts) => {
        opts.onEvent(account('ACC0009'));
        return { pid: 1, kill: () => {} };
      },
      setTimer: () => Symbol('t'),
      clearTimer: () => {},
      onStart: () => (replayStops += 1),
    });
    const first = service.start({});
    expect(service.start({})).toMatchObject({ alreadyRunning: true });
    expect(replayStops).toBe(1);
    service.stop();
    const second = service.start({});
    expect(second.run_id).not.toBe(undefined);
    expect(service.store.accounts.size).toBe(1);
    expect(replayStops).toBe(2);
    expect(first.ok).toBe(true);
  });

  it('clears a run, running or not, so nothing is left to restore', async () => {
    const t = setup();
    t.service.start({});
    t.send(...opening(), txn('T2', 'ACC0001', 'ACC0002', 100, 2));
    await t.service.pump();
    t.service.clear();
    expect(t.killed()).toBe(1);
    expect(t.of(STREAM_EVENTS.END).at(-1)).toMatchObject({ reason: 'cleared' });
    const state = t.service.state();
    expect(state).toMatchObject({ mode: 'idle', running: false, run_id: null, ended: null });
    expect(state.counts).toEqual({ txns: 0, accounts: 0, scored: 0, high_risk: 0, rings: 0, alerts: 0 });
    expect(t.service.store.txns).toHaveLength(0);
    expect(t.service.store.accounts.size).toBe(0);
    // Clearing again, with nothing there, is harmless.
    expect(t.service.clear()).toEqual({ ok: true });
  });

  it('scores the predictor against the planted rings', async () => {
    const t = setup(
      fakePredictor([
        (r) => answer(r, { rings: [ring(1)], alerts: [{ id: 'LIVE-A01', ring_id: 'LIVE-R01', fired_at: ts(20), reason: 'r' }] }),
      ]),
    );
    t.service.start({});
    t.send(...opening(), { type: 'truth', ring: 'G01', pattern: 'A', member_ids: ['ACC0001', 'ACC0002', 'ACC0003'], victim_txn_id: 'T1', planted_at: ts(5) }, { type: 'truth', ring: 'G02', pattern: 'B', member_ids: ['ACC0007', 'ACC0008', 'ACC0009'], victim_txn_id: 'T9', planted_at: ts(6) }, { type: 'truth', ring: 'G03', pattern: 'C', member_ids: ['ACC0011'], victim_txn_id: 'T10', planted_at: ts(90) }, { type: 'clock', ts: ts(30) });
    await t.service.pump();
    expect(t.service.store.liveMetrics()).toMatchObject({ planted: 2, caught: 1, missed: 1, false_rings: 0, median_minutes_to_alert: 15 });
  });
});
