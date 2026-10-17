import mongoose from 'mongoose';
import { idField, newId } from '../utils/ids.js';

const { Schema } = mongoose;

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80';

const addressSchema = new Schema(
  {
    id: { type: String, default: () => newId('addr') },
    title: { type: String, trim: true, maxlength: 80, default: '' },
    details: { type: String, trim: true, maxlength: 500, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const cartItemSchema = new Schema(
  {
    product: { type: String, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    _id: idField('user'),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Normalised phone (01XXXXXXXXX) or lower-cased email.
    contact: { type: String, required: true, unique: true, trim: true },
    contactMethod: { type: String, enum: ['email', 'whatsapp'], default: 'whatsapp' },
    role: { type: String, enum: ['member', 'admin'], default: 'member' },

    isVerified: { type: Boolean, default: false },
    isMember: { type: Boolean, default: false },
    membershipExpiry: String,
    couponUsed: String,

    avatar: { type: String, default: DEFAULT_AVATAR, maxlength: 2_000_000 },
    bio: { type: String, maxlength: 500 },
    coverPhoto: { type: String, maxlength: 2_000_000 },
    location: { type: String, trim: true, maxlength: 120 },
    // YYYY-MM-DD, or '' when cleared.
    dateOfBirth: { type: String, match: /^(\d{4}-\d{2}-\d{2})?$/ },
    addresses: { type: [addressSchema], default: [] },
    notificationPrefs: {
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      communityAlerts: { type: Boolean, default: true },
    },
    privacySettings: {
      shareProfile: { type: Boolean, default: true },
      showChildrenInfo: { type: Boolean, default: true },
    },

    // Running totals kept in step with RewardTransaction / GiftRedemption so
    // balance checks and the leaderboard are single atomic reads.
    earnedPoints: { type: Number, default: 0 },
    spentPoints: { type: Number, default: 0, min: 0 },

    cart: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

userSchema.index({ earnedPoints: -1 });

export const User = mongoose.model('User', userSchema);
