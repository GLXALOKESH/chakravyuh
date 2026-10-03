/** Counter-only stream telemetry. Uses the existing engine tick, never its own timer. */
import { config } from '../configs/env.js';
import { logEvent } from './logger.service.js';
import { withLogContext } from '../utilities/log-context.util.js';

export class ActivityLog {
  private counts: Record<string, number> = {};
  private last = 0;
  private runId: string | undefined;

  constructor(private readonly mode: 'stream' | 'replay', private readonly now: () => number = Date.now) {}

  reset(runId: string): void {
    this.counts = {};
    this.runId = runId;
    this.last = this.now();
  }

  count(name: string, n = 1): void { this.counts[name] = (this.counts[name] ?? 0) + n; }

  flush(force = false): void {
    if (!this.runId || (!force && this.now() - this.last < config.logging.streamIntervalMs)) return;
    if (Object.keys(this.counts).length) {
      withLogContext({ run_id: this.runId }, () => logEvent('info', `${this.mode}.summary`, {
        mode: this.mode, counts: this.counts, direction: 'internal',
      }), { replace: true });
    }
    this.counts = {};
    this.last = this.now();
  }
}
