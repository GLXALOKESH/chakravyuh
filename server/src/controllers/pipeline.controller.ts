/**
 * Pipeline trigger (TRD section 7.10).
 *
 * Runs the Python pipeline and reloads the database from whatever it wrote.
 * This exists so a presenter can go from "regenerate the data" to "the
 * dashboard shows it" with one call, instead of a terminal command and a
 * restart.
 *
 * Two things this deliberately does not do:
 *
 *   - It does not shell out to Python. The pipeline is the other member's code
 *     and its entry point is not ours to assume; `ml/service.py` exposes
 *     POST /pipeline/run and that is the only trigger used.
 *   - It does not half-apply. If the run fails, the response says so and the
 *     previously seeded data is still serving. Reloading is transactional.
 */
import type { Request, Response } from 'express';
import { config } from '../configs/env.js';
import { runPipeline } from '../services/ml.service.js';
import { seed } from '../services/seed.service.js';
import type { PipelineRunBodyDto } from '../DTOClasses/index.js';

interface PipelineResult {
  ok: boolean;
  seconds?: number;
  error?: string;
}

export const pipelineRoutes = () => ({
  /**
   * POST /api/pipeline/run
   *
   * Body `{ profile }`, defaulting to the configured SEED_PROFILE. Triggers the
   * Python run, then reseeds. The reseed is the part that makes this useful: the
   * pipeline writes files, and without it the server keeps serving the old
   * documents while the files on disk have moved on.
   */
  run: async (req: Request, res: Response): Promise<void> => {
    const body = (req as unknown as Record<string, unknown>).bodyDto as PipelineRunBodyDto | undefined;
    const profile = body?.profile ?? config.seedProfile;

    const startedAt = Date.now();
    let result: PipelineResult;

    try {
      result = await runPipeline(profile) as PipelineResult;
    } catch (err) {
      // The service being down is the common case, not an exception. It reads
      // the same as any other failure from here, and the old data keeps serving.
      res.status(502).json({
        error: `pipeline service unreachable at ${config.mlUrl}: ${err instanceof Error ? err.message : String(err)}`,
        profile,
        reloaded: false,
      });
      return;
    }

    if (!result?.ok) {
      res.status(502).json({
        error: result?.error ?? 'pipeline reported failure',
        profile,
        reloaded: false,
      });
      return;
    }

    // The run reported success. Reseed, so the new files are actually live.
    try {
      // forceFixtures: false on purpose. With SEED_FIXTURES=true the seeder
      // substitutes the built-in generator when data/<profile>/ is missing, which
      // would make this route report success while the dashboard kept showing
      // fixture data. A reload that cannot find the pipeline's output must say
      // so rather than quietly load the wrong thing.
      const loaded = await seed(profile, { forceFixtures: false });
      res.json({
        ok: true,
        profile,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        pipeline_seconds: result.seconds ?? null,
        source: loaded.source,
        counts: loaded.counts,
        reloaded: true,
      });
    } catch (err) {
      // The pipeline succeeded but the data did not load. The previous dataset is
      // still intact because the seeder runs in a transaction, so this is a
      // loud partial success rather than a corrupt state.
      res.status(500).json({
        error: `pipeline ran but the reload failed: ${err instanceof Error ? err.message : String(err)}`,
        profile,
        pipeline_seconds: result.seconds ?? null,
        reloaded: false,
      });
    }
  },
});