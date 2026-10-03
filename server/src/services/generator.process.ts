/**
 * Runs ml/stream_generator.py for one live run and reads its output.
 *
 * The generator writes one JSON object per line to stdout. Reading it from a
 * child process the server owns, rather than having the generator post to the
 * server, means Start and Stop in the dashboard can launch a fresh seed or end
 * a run, events arrive in order with nothing lost, and there is no second
 * port to configure. stderr goes to the server log.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../configs/env.js';
import { errorFields, logEvent } from './logger.service.js';

export interface GeneratorOptions {
  seed?: number;
  rate: number;
  onEvent: (event: Record<string, unknown>) => void;
  onExit: (code: number | null) => void;
}

export interface GeneratorHandle {
  pid: number | undefined;
  kill(): void;
}

export type SpawnGenerator = (options: GeneratorOptions) => GeneratorHandle;

export const spawnGenerator: SpawnGenerator = ({ seed, rate, onEvent, onExit }) => {
  const args = [config.stream.generatorScript, '--rate', String(rate)];
  if (seed !== undefined) args.push('--seed', String(seed));
  const child = spawn(config.stream.pythonBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });
  logEvent('info', 'generator.started', { pid: child.pid, rate, seed, direction: 'internal' });

  // readline copes with lines split across reads.
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as Record<string, unknown>);
    } catch {
      logEvent('warn', 'generator.invalid_line', { direction: 'in', peer: 'generator', bytes: Buffer.byteLength(line) });
    }
  });
  // Python stderr is unstructured and may contain data. Report its presence,
  // not raw text, so stdout stays parseable and credentials/documents cannot leak.
  child.stderr.on('data', (chunk: Buffer) => logEvent('debug', 'generator.stderr', { direction: 'in', peer: 'generator', bytes: chunk.length }));
  child.on('error', (err) => {
    logEvent('error', 'generator.start_failed', { direction: 'internal', ...errorFields(err) });
    onExit(null);
  });
  child.on('exit', (code) => {
    logEvent(code === 0 || child.killed ? 'info' : 'warn', 'generator.exited', { exit_code: code, expected: child.killed, direction: 'internal' });
    lines.close();
    onExit(code);
  });

  return {
    pid: child.pid,
    kill: () => {
      if (child.exitCode === null) child.kill();
    },
  };
};
