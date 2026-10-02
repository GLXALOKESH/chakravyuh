/**
 * Replay control (F11, TRD section 8).
 *
 * The dashboard can drive replay over REST as well as the socket, so a presenter
 * can recover with a single curl if the socket drops mid-demo.
 */
import type { Request, Response } from 'express';
import { config } from '../configs/env.js';
import type { ReplayEngine } from '../services/replay.service.js';
import type { ReplayStartBodyDto } from '../DTOClasses/index.js';

export const replayRoutes = (engine: ReplayEngine) => ({
  start: async (req: Request, res: Response): Promise<void> => {
    const body = (req as unknown as Record<string, unknown>).bodyDto as ReplayStartBodyDto | undefined;
    // A non-positive speed is rejected by the DTO, and the default applies when
    // the field is absent, so there is no divide-by-zero path into the engine.
    res.json(engine.start({ speed: body?.speed ?? config.replayDefaultSpeed }));
  },

  stop: async (_req: Request, res: Response): Promise<void> => {
    res.json(engine.stop());
  },

  state: async (_req: Request, res: Response): Promise<void> => {
    res.json(engine.state());
  },
});
