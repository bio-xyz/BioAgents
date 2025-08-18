import express from 'express';
import type { AgentServer } from '../../index';
import { jwtAuth, corsOptions } from '../../customAuth';
import cors from 'cors';

/**
 * Debug and diagnostic endpoints
 */
export function createDebugRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // Debug endpoint to check message servers
  (router as any).get('/servers', cors(corsOptions), jwtAuth, async (_req, res) => {
    try {
      const servers = await serverInstance?.getServers();
      res.json({
        success: true,
        servers: servers || [],
        count: servers?.length || 0,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
