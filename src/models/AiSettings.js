import mongoose from 'mongoose';

const { Schema } = mongoose;

export const AI_TASKS = ['post', 'comment', 'like'];

/** A node-agent CLI + model pair. Empty strings mean "use NODE_AGENT_CLI / NODE_AGENT_MODEL from .env". */
const modelChoice = {
  cli: { type: String, default: '', maxlength: 60 },
  model: { type: String, default: '', maxlength: 120 },
};

/**
 * The single settings document (_id "global") for Admin → AI টাস্ক: the master
 * auto switch, each task's random interval/count ranges and the node-agent
 * model each task uses. Read through services/ai/aiSettings.js.
 */
const aiSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    autoEnabled: { type: Boolean, default: false },
    activeHours: {
      start: { type: Number, default: 8, min: 0, max: 23 },
      end: { type: Number, default: 23, min: 1, max: 24 },
    },
    post: {
      enabled: { type: Boolean, default: true },
      minMinutes: { type: Number, default: 50 },
      maxMinutes: { type: Number, default: 60 },
      imagePercent: { type: Number, default: 40 },
      textModel: modelChoice,
      imageModel: modelChoice,
    },
    comment: {
      enabled: { type: Boolean, default: true },
      minMinutes: { type: Number, default: 15 },
      maxMinutes: { type: Number, default: 20 },
      minCount: { type: Number, default: 4 },
      maxCount: { type: Number, default: 8 },
      recentPosts: { type: Number, default: 20 },
      maxAiCommentsPerPost: { type: Number, default: 12 },
      includeAiPosts: { type: Boolean, default: true },
      model: modelChoice,
    },
    like: {
      enabled: { type: Boolean, default: true },
      minMinutes: { type: Number, default: 10 },
      maxMinutes: { type: Number, default: 15 },
      minCount: { type: Number, default: 5 },
      maxCount: { type: Number, default: 10 },
      recentPosts: { type: Number, default: 20 },
      reactionMix: {
        like: { type: Number, default: 70 },
        love: { type: Number, default: 20 },
        care: { type: Number, default: 10 },
        haha: { type: Number, default: 0 },
      },
    },
    persona: {
      profileModel: modelChoice,
      portraitModel: modelChoice,
    },
    nextRunAt: {
      post: { type: Date, default: null },
      comment: { type: Date, default: null },
      like: { type: Date, default: null },
    },
  },
  { timestamps: true, minimize: false }
);

export const AiSettings = mongoose.model('AiSettings', aiSettingsSchema);

/** History of AI task runs for the admin panel; kept for 7 days. */
const aiRunLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, index: { expires: 7 * 24 * 3600 } },
    what: { type: String, required: true },
    ok: { type: Boolean, default: true },
    manual: { type: Boolean, default: false },
    persona: String,
    personas: [String],
    postId: String,
    commentId: String,
    count: Number,
    topic: String,
    withImage: Boolean,
    error: String,
    kind: String,
    note: String,
  },
  { versionKey: false }
);
aiRunLogSchema.index({ at: -1 });

export const AiRunLog = mongoose.model('AiRunLog', aiRunLogSchema);
