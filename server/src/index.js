/**
 * Server entry point: Express, Socket.IO and the replay engine (F11).
 *
 * The dashboard talks only to Express. It never calls Python directly.
 */
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { createApp } from './app.js';
import { connect, close, getDriverName } from './db/index.js';
import { ReplayEngine, REPLAY_EVENTS } from './replay.js';

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
  socket.emit('replay:state', engine.state());

  // TRD section 8 socket table: replay:start { speed } and replay:stop.
  socket.on(REPLAY_EVENTS.START, (payload) => {
    try {
      const speed = payload?.speed ?? config.replayDefaultSpeed;
      socket.emit('replay:state', engine.start({ speed }));
    } catch (err) {
      socket.emit('error', { error: err.message });
    }
  });

  socket.on(REPLAY_EVENTS.STOP, () => {
    socket.emit('replay:state', engine.stop());
  });
});

async function main() {
  await connect();
  // Load the replay script up front so a presenter pressing play never waits on
  // a 5,000 row query.
  const script = await engine.load();
  if (script.transactions === 0) {
    console.warn('warning: no transactions found. Run `npm run seed` before starting.');
  }

  server.listen(config.port, () => {
    console.log(`chakravyuh api on http://localhost:${config.port}`);
    console.log(`  database   ${getDriverName()}${config.databaseUrl ? ' (DATABASE_URL)' : ' (PGlite, in-process)'}`);
    console.log(`  ml service ${config.mlUrl} (${config.mlTimeoutMs}ms timeout)`);
    console.log(`  mocks      ${config.useMocks ? 'on' : 'off'}`);
    console.log(`  replay     ${script.transactions} transactions, ${script.alerts} alerts ready`);
  });
}

async function shutdown(signal) {
  console.log(`\n${signal} received, closing`);
  engine.stop();
  io.close();
  server.close();
  await close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (err) => {
  console.error('failed to start:', err.message);
  await close().catch(() => {});
  process.exit(1);
});