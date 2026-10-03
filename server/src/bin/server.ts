/**
 * Server entry point: Express, Socket.IO and the replay engine (F11).
 *
 * The dashboard talks only to Express. It never calls Python directly.
 */
import http from 'node:http';
import 'reflect-metadata';
import { Server as SocketServer } from 'socket.io';
import { config, hasDatabase } from '../configs/env.js';
import { connect, describeDatabase, disconnect } from '../configs/mongoose.js';
import { createApp, isStreamOnly } from '../app.js';
import { STREAM_EVENTS } from '../constants/index.js';
import { ReplayEngine, REPLAY_EVENTS } from '../services/replay.service.js';
import { StreamService } from '../services/stream.service.js';

// The app is attached once it exists, below: the engines it is built with
// emit through the Socket.IO server, which needs the HTTP server first.
const server = http.createServer();


const io = new SocketServer(server, {
  // The dashboard runs on a different port in development (Vite, 5173).
  cors: { origin: true, credentials: true },
});

// One engine instance shared by the REST and socket layers, so a presenter can
// start replay with either. It is handed to createApp for that reason: the
// REST routes used to get an engine of their own, which never loaded a script.
const engine = new ReplayEngine({
  emit: (event, payload) => {
    io.emit(event, payload);
  },
});

// Live mode (docs/STREAMING.md). One mode at a time: starting a live run
// stops the replay, and starting the replay stops a live run.
const stream = new StreamService({
  emit: (event, payload) => {
    io.emit(event, payload);
  },
  onStart: () => {
    engine.stop();
  },
});
const replayStart = engine.start.bind(engine);
engine.start = (options) => {
  stream.stop('replay started');
  return replayStart(options);
};

const app = createApp({ engine, stream });
server.on('request', app);

io.on('connection', (socket) => {
  socket.emit(REPLAY_EVENTS.STATE, engine.state());
  socket.emit(STREAM_EVENTS.STATE, stream.state());
  // A dashboard that opens mid-run draws everything so far from one message.
  if (stream.store.runId) socket.emit(STREAM_EVENTS.SNAPSHOT, stream.snapshot());

  socket.on(STREAM_EVENTS.START, (payload: { seed?: number; rate?: number } | undefined) => {
    const rate = Number.isInteger(payload?.rate) && payload!.rate! >= 1 && payload!.rate! <= 3600 ? payload!.rate : undefined;
    const seed = Number.isInteger(payload?.seed) && payload!.seed! >= 0 ? payload!.seed : undefined;
    socket.emit(STREAM_EVENTS.STATE, { ...stream.state(), ...stream.start({ seed, rate }) });
  });

  socket.on(STREAM_EVENTS.STOP, () => {
    stream.stop();
  });

  // TRD section 8 socket table: replay:start { speed } and replay:stop.
  socket.on(REPLAY_EVENTS.START, (payload: { speed?: number } | undefined) => {
    try {
      const speed = payload?.speed ?? config.replayDefaultSpeed;
      socket.emit(REPLAY_EVENTS.STATE, engine.start({ speed }));
    } catch (err) {
      socket.emit(REPLAY_EVENTS.ERROR, { error: (err as Error).message });
    }
  });

  socket.on(REPLAY_EVENTS.STOP, () => {
    socket.emit(REPLAY_EVENTS.STATE, engine.stop());
  });
});

const main = async (): Promise<void> => {
  // Mock mode must work with no database at all: TRD section 15 has the whole
  // frontend built against fixed payloads for hours 2 to 10, and requiring a
  // live MongoDB then would defeat the point of having mocks.
  let script = { transactions: 0, alerts: 0 };
  if (config.useMocks) {
    console.log('mock mode: no database connection will be opened');
  } else if (isStreamOnly()) {
    console.log('STREAM_ONLY: no database; live mode only, replay and the stored-data routes are off');
  } else if (!hasDatabase()) {
    // Fail here with the actionable message rather than as a driver stack trace
    // from three frames down.
    throw new Error(
      'MONGO_URL is not set. Either put a real connection string in server/.env, ' +
        'or start with USE_MOCKS=true to serve the contract fixtures (TRD section 15).',
    );
  } else {
    // Connect before anything else so a bad connection string is reported now
    // rather than on the first request during a demo.
    await connect();

    // Load the replay script up front so a presenter pressing play never waits
    // on a five-thousand row query.
    script = await engine.load();
    if (script.transactions === 0) {
      console.warn('warning: no transactions found. Run `npm run seed` before starting.');
    }
  }

  server.listen(config.port, () => {
    console.log(`chakravyuh api on http://localhost:${config.port}`);
    console.log(`  database   ${config.useMocks ? '(mock mode)' : describeHost()}`);
    console.log(`  ml service ${config.mlUrl} (${config.mlTimeoutMs}ms timeout)`);
    console.log(`  mocks      ${config.useMocks ? 'on' : 'off'}`);
    console.log(
      config.useMocks
        ? '  replay     mocked'
        : isStreamOnly()
          ? '  replay     off (STREAM_ONLY)'
          : `  replay     ${script.transactions} transactions, ${script.alerts} alerts ready`,
    );
    console.log(`  live       ${config.stream.pythonBin} ${config.stream.generatorScript}`);
  });
};

/** "host:port/database", for the startup banner. */
const describeHost = (): string => {
  const database = describeDatabase();
  return `${database.driver} ${database.host}/${database.database}`;
};

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n${signal} received, closing`);
  engine.stop();
  stream.stop('server shutting down');
  io.close();
  server.close();
  await disconnect().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async (err: unknown) => {
  console.error('failed to start:', (err as Error).message);
  await disconnect().catch(() => {});
  process.exit(1);
});
