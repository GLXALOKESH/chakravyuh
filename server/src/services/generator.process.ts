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

  // readline copes with lines split across reads.
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as Record<string, unknown>);
    } catch {
      console.warn(`stream generator: skipped a line that is not JSON: ${line.slice(0, 120)}`);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[generator] ${chunk}`));
  child.on('error', (err) => {
    console.error(`stream generator failed to start (${config.stream.pythonBin}): ${err.message}`);
    onExit(null);
  });
  child.on('exit', (code) => {
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
