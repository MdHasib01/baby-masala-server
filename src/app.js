import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { canonDeep } from './utils/bnText.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import postRoutes from './routes/posts.js';
import rewardRoutes from './routes/rewards.js';
import shopRoutes from './routes/shop.js';
import syncRoutes from './routes/sync.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin: env.clientOrigins }));
  // Photos are sent as data URLs, so allow reasonably large bodies.
  app.use(express.json({ limit: '8mb' }));
  // One spelling for Bengali nukta letters, so enum values like topics always match.
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') req.body = canonDeep(req.body);
    next();
  });

  app.get('/api/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'connected' : 'disconnected' });
  });

  app.use('/api/auth', authRoutes);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/posts', postRoutes);
  api.use('/admin', requireAdmin, adminRoutes);
  api.use(meRoutes);
  api.use(shopRoutes);
  api.use(rewardRoutes);
  api.use(syncRoutes);
  app.use('/api', api);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
