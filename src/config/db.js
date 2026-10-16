import mongoose from 'mongoose';

/** Strips the password from a connection string so it is safe to log. */
const redact = (uri) => uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:****@');

export async function connectDB(uri) {
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));
  mongoose.connection.on('error', (err) => console.error('[db] error:', err.message));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  console.log(`[db] connected to "${mongoose.connection.name}" (${redact(uri)})`);
  return mongoose.connection;
}

export const disconnectDB = () => mongoose.disconnect();
