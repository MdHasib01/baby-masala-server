import mongoose from 'mongoose';

const { Schema } = mongoose;
const { Mixed } = Schema.Types;

/**
 * Per-user collections with no server-side business rules (children, friends,
 * messenger, doctor questions). The client owns their content and syncs the
 * whole list via PUT /api/sync/:collection.
 *
 * `clientId` holds the id the frontend uses ("child-1", "f1", ...) and is unique
 * per owner, so two users can both have a friend called "f1".
 */
function defineOwned(modelName, fields) {
  const schema = new Schema(
    {
      owner: { type: String, ref: 'User', required: true },
      clientId: { type: String, required: true, maxlength: 100 },
      position: { type: Number, default: 0 },
      ...fields,
    },
    { timestamps: true }
  );
  schema.index({ owner: 1, clientId: 1 }, { unique: true });
  schema.index({ owner: 1, position: 1 });
  const model = mongoose.model(modelName, schema);
  return { model, fields: Object.keys(fields) };
}

export const OWNED = {
  children: defineOwned('Child', {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    dob: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    photo: { type: String, maxlength: 2_000_000 },
    allergies: { type: String, maxlength: 500 },
  }),

  friends: defineOwned('Friend', {
    name: { type: String, required: true },
    avatar: String,
    bio: String,
    location: String,
    mutualFriendsCount: { type: Number, default: 0 },
    friendshipStatus: {
      type: String,
      enum: ['friends', 'request_sent', 'request_received', 'none'],
      default: 'none',
    },
    isBlocked: Boolean,
  }),

  conversations: defineOwned('Conversation', {
    participant: { type: Mixed, required: true },
    lastMessage: { type: String, default: '' },
    lastTimestamp: String,
    unreadCount: { type: Number, default: 0, min: 0 },
    isRequest: Boolean,
  }),

  messages: defineOwned('Message', {
    conversationId: { type: String, required: true },
    senderId: { type: String, required: true },
    text: { type: String, default: '', maxlength: 5000 },
    mediaUrl: { type: String, maxlength: 2_000_000 },
    timestamp: String,
    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  }),

  doctorQuestions: defineOwned('DoctorQuestion', {
    childNameOrGeneral: String,
    category: String,
    title: { type: String, required: true, maxlength: 300 },
    detailedQuestion: { type: String, maxlength: 5000 },
    attachmentUrl: { type: String, maxlength: 2_000_000 },
    status: { type: String, enum: ['জমা হয়েছে', 'উত্তর অপেক্ষায়', 'উত্তর এসেছে', 'বন্ধ হয়েছে'] },
    submissionDate: String,
    assignedDoctorName: String,
    sampleReply: String,
    followUpQuestions: { type: [Mixed], default: [] },
    isPrivate: { type: Boolean, default: true },
  }),
};

// Server-written, per-user. Clients may only mark them read.
const notificationSchema = new Schema(
  {
    owner: { type: String, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    type: { type: String, enum: ['reward', 'order', 'community', 'tip', 'friend', 'message', 'doctor', 'complaint'], required: true },
  },
  { timestamps: true }
);

export const Notification = mongoose.model('Notification', notificationSchema);
