import mongoose from 'mongoose';
import { idField } from '../utils/ids.js';

const { Schema } = mongoose;

export const AI_BATCH_STATUSES = ['queued', 'running', 'done', 'stopped'];
export const AI_BATCH_ITEM_STATUSES = ['pending', 'profile', 'photo', 'done', 'failed', 'skipped'];

// One "create N AI users" request from Admin → AI ইউজার. Stored so progress survives
// server restarts (node --watch, deploys) and unfinished batches resume on start.
const itemSchema = new Schema(
  {
    index: { type: Number, required: true },
    status: { type: String, enum: AI_BATCH_ITEM_STATUSES, default: 'pending' },
    name: String,
    avatar: String,
    userId: String,
    error: String,
    retried: Boolean,
    // This user's style mix, planned when the batch starts (looks.js planCombos).
    combo: {
      picture: String,
      age: String,
      camera: String,
      child: String,
      dress: String,
      place: String,
    },
  },
  { _id: false }
);

const aiBatchSchema = new Schema(
  {
    _id: idField('batch'),
    requested: { type: Number, required: true, min: 1 },
    guidance: { type: String, default: '', maxlength: 500 },
    // Options selected per style group, e.g. { picture: ['photo', 'flower'], ... }.
    styles: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: AI_BATCH_STATUSES, default: 'queued', index: true },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: null },
    items: { type: [itemSchema], default: [] },
  },
  { timestamps: true }
);

export const AiBatch = mongoose.model('AiBatch', aiBatchSchema);
