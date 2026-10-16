import mongoose from 'mongoose';
import { idField } from '../utils/ids.js';

const { Schema } = mongoose;

const productSchema = new Schema(
  {
    _id: idField('prod'),
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    image: String,
    description: String,
    weight: String,
    stock: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0, min: 0 },
    // Reward points per unit. When unset, 1 point per ৳10 is credited.
    pointsEarned: { type: Number, min: 0 },
  },
  { timestamps: true }
);

const orderItemSchema = new Schema(
  {
    // Snapshot of the product at purchase time, in the frontend's Product shape.
    product: { type: Schema.Types.Mixed, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const orderSchema = new Schema(
  {
    _id: idField('ord'),
    user: { type: String, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    deliveryCharge: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'confirmed' },
    shippingAddress: { type: String, required: true, maxlength: 500 },
    notes: { type: String, maxlength: 1000 },
    paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
    pointsEarned: { type: Number, default: 0, min: 0 },
    pointsReversed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const giftSchema = new Schema(
  {
    _id: idField('gift'),
    name: { type: String, required: true },
    pointsCost: { type: Number, required: true, min: 1 },
    image: String,
    stock: { type: Number, default: 0, min: 0 },
    description: String,
  },
  { timestamps: true }
);

const giftRedemptionSchema = new Schema(
  {
    _id: idField('red'),
    user: { type: String, ref: 'User', required: true, index: true },
    gift: { type: String, ref: 'Gift', required: true },
    giftName: { type: String, required: true },
    pointsCost: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: String, maxlength: 500 },
    status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered'], default: 'pending' },
  },
  { timestamps: true }
);

const rewardTransactionSchema = new Schema(
  {
    _id: idField('tx'),
    user: { type: String, ref: 'User', required: true, index: true },
    description: { type: String, required: true },
    // Earn rows may be negative (point reversal for a cancelled order).
    points: { type: Number, required: true },
    type: { type: String, enum: ['earn', 'redeem'], required: true },
    source: {
      type: String,
      enum: ['post', 'reaction', 'comment', 'order', 'order_reversal', 'contest', 'redemption', 'seed', 'admin'],
    },
    refId: String,
  },
  { timestamps: true }
);

const contestSchema = new Schema(
  {
    _id: idField('cont'),
    title: { type: String, required: true },
    type: { type: String, enum: ['recipe_video', 'review'], required: true },
    description: String,
    eligibility: { type: String, enum: ['all', 'delivered_order'], default: 'all' },
    startDate: String,
    endDate: String,
    prize: String,
    pointsReward: { type: Number, min: 0 },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    winners: { type: [{ name: String, prize: String, _id: false }], default: undefined },
  },
  { timestamps: true }
);

const contestSubmissionSchema = new Schema(
  {
    _id: idField('sub'),
    contest: { type: String, ref: 'Contest', required: true, index: true },
    user: { type: String, ref: 'User', required: true, index: true },
    userName: { type: String, required: true },
    mediaUrl: { type: String, maxlength: 2_000_000 },
    description: { type: String, required: true, maxlength: 2000 },
    order: { type: String, ref: 'Order' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

contestSubmissionSchema.index({ contest: 1, user: 1 }, { unique: true });

export const Product = mongoose.model('Product', productSchema);
export const Order = mongoose.model('Order', orderSchema);
export const Gift = mongoose.model('Gift', giftSchema);
export const GiftRedemption = mongoose.model('GiftRedemption', giftRedemptionSchema);
export const RewardTransaction = mongoose.model('RewardTransaction', rewardTransactionSchema);
export const Contest = mongoose.model('Contest', contestSchema);
export const ContestSubmission = mongoose.model('ContestSubmission', contestSubmissionSchema);
