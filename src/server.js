import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env, requireEnv } from './config/env.js';

async function main() {
  requireEnv('MONGODB_URI', 'JWT_SECRET');
  await connectDB(env.mongodbUri);

  const server = createApp().listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}  (demo mode: ${env.demoMode ? 'on' : 'off'})`);
  });

  const shutdown = (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});
