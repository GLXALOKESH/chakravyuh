/**
 * Server entry point: Express, Socket.IO and the replay engine (F11).
 *
 * The dashboard talks only to Express. It never calls Python directly.
 */
import http from 'node:http';
import 'reflect-metadata';
import { Server as SocketServer } from 'socket.io';
import { config, hasDatabase } from '../configs/env.js';
import { describeDatabase, disconnect } from '../configs/prisma.js';
import { createApp } from '../app.js';
import { ReplayEngine, REPLAY_EVENTS } from '../services/replay.service.js';

const app = createApp();
const server = http.createServer(app);

const io = new SocketServer(server, {
  // The dashboard runs on a different port in development (Vite, 5173).
  cors: { origin: true, credentials: true },
});

// One engine instance shared by the REST and socket layers, so a presenter can
// start replay with either.
const engine = new ReplayEngine({
  emit: (event, payload) => {
    io.emit(event, payload);
  },
});

io.on('connection', (socket) => {
  socket.emit(REPLAY_EVENTS.STATE, engine.state());

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
  // live PostgreSQL then would defeat the point of having mocks.
  let script = { transactions: 0, alerts: 0 };
  if (config.useMocks) {
    console.log('mock mode: no database connection will be opened');
  } else if (!hasDatabase()) {
    // Fail here with the actionable message rather than as a Prisma stack trace
    // from three frames down.
    throw new Error(
      'DATABASE_URL is not set. Either put a real connection string in server/.env, ' +
        'or start with USE_MOCKS=true to serve the contract fixtures (TRD section 15).',
    );
  } else {
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
        : `  replay     ${script.transactions} transactions, ${script.alerts} alerts ready`,
    );
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
