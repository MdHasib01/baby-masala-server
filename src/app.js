import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { uploadMedia } from './middleware/uploadMedia.js';
import { canonDeep } from './utils/bnText.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import complaintRoutes from './routes/complaints.js';
import meRoutes from './routes/me.js';
import postRoutes from './routes/posts.js';
import rewardRoutes from './routes/rewards.js';
import shopRoutes from './routes/shop.js';
import syncRoutes from './routes/sync.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind the host's reverse proxy, so rate limits see the real client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  const allowedOrigins = new Set(env.clientOrigins);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        if (/^https?:\/\/([a-z0-9-]+\.)?babymasalabd\.com$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );
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

  // Code requests send email, so keep them well below abuse levels.
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method === 'GET',
    message: { message: 'অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।', code: 'RATE_LIMITED' },
  });
  app.use('/api/auth', authLimiter, authRoutes);

  const api = express.Router();
  api.use(requireAuth);
  api.use(uploadMedia);
  api.use('/posts', postRoutes);
  api.use('/complaints', complaintRoutes);
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
