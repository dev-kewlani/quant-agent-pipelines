import { Router } from 'express';
import type { IConnectionProvider, IMarketDataProvider } from '../providers/types.js';

export function createHealthRouter(connection: IConnectionProvider, marketData: IMarketDataProvider) {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({
      connected: connection.isConnected(),
      status: connection.status,
      activeSubscriptions: marketData.getActiveCount(),
      uptime: process.uptime(),
    });
  });

  return router;
}
