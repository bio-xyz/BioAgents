import type { IAgentRuntime, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../index';
import { jwtAuth, corsOptions } from '../../customAuth';
import cors from 'cors';

/**
 * Health monitoring and status endpoints
 */
export function createHealthRouter(
  agents: Map<UUID, IAgentRuntime>,
  serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Health check
  (router as any).get('/ping', cors(corsOptions), jwtAuth, (_req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
  });

  // Hello world endpoint
  (router as any).get('/hello', cors(corsOptions), jwtAuth, (_req, res) => {
    logger.info('Hello endpoint hit');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ message: 'Hello World!' }));
  });

  // System status endpoint
  (router as any).get('/status', cors(corsOptions), jwtAuth, (_req, res) => {
    logger.info('Status endpoint hit');
    res.setHeader('Content-Type', 'application/json');
    res.send(
      JSON.stringify({
        status: 'ok',
        agentCount: agents.size,
        timestamp: new Date().toISOString(),
      })
    );
  });

  // Comprehensive health check
  (router as any).get('/health', cors(corsOptions), jwtAuth, (_req, res) => {
    logger.log({ apiRoute: '/health' }, 'Health check route hit');
    const healthcheck = {
      status: 'OK',
      version: process.env.APP_VERSION || 'unknown',
      timestamp: new Date().toISOString(),
      dependencies: {
        agents: agents.size > 0 ? 'healthy' : 'no_agents',
      },
    };

    const statusCode = healthcheck.dependencies.agents === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthcheck);
  });

  // Server stop endpoint
  (router as any).post('/stop', cors(corsOptions), jwtAuth, (_req, res) => {
    logger.log({ apiRoute: '/stop' }, 'Server stopping...');
    serverInstance?.stop(); // Use optional chaining in case server is undefined
    res.json({ message: 'Server stopping...' });
  });

  return router;
}
