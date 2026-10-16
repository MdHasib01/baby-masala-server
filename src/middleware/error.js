import mongoose from 'mongoose';
import { HttpError } from '../utils/httpError.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' });
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, code: err.code });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(' ');
    return res.status(400).json({ message, code: 'VALIDATION_ERROR' });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Invalid value for ${err.path}.`, code: 'BAD_VALUE' });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ message: 'এই তথ্য ইতিমধ্যে আছে।', code: 'DUPLICATE' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body.', code: 'BAD_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'ফাইলটি অনেক বড়। ছোট ফাইল ব্যবহার করুন।', code: 'TOO_LARGE' });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ message: 'সার্ভারে একটি সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।', code: 'SERVER_ERROR' });
}
