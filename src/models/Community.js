import mongoose from 'mongoose';
import { idField } from '../utils/ids.js';

const { Schema } = mongoose;

export const POST_TOPICS = ['খাবার', 'ঘুম', 'বিকাশ', 'মায়ের গল্প'];

const postSchema = new Schema(
  {
    _id: idField('post'),
    author: { type: String, ref: 'User', index: true },
    // Denormalised so the feed renders without a join; refreshed when the author edits their profile.
    authorName: { type: String, required: true },
    authorAvatar: String,
    isVerifiedBuyer: { type: Boolean, default: false },
    topic: { type: String, enum: POST_TOPICS, required: true },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    mediaUrl: { type: String, maxlength: 2_000_000 },
    mediaType: { type: String, enum: ['image', 'video'] },
    status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },

    likes: { type: Number, default: 0, min: 0 },
    likedBy: { type: [String], default: [] },
    // Users who already received reaction points for this post (never removed,
    // so un-liking and liking again does not award twice).
    reactionRewardedTo: { type: [String], default: [] },
    savedBy: { type: [String], default: [] },
    hiddenBy: { type: [String], default: [] },
    reports: {
      type: [{ user: String, reason: String, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
    commentsCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

postSchema.index({ status: 1, createdAt: -1 });

const commentSchema = new Schema(
  {
    _id: idField('comm'),
    post: { type: String, ref: 'Post', required: true, index: true },
    author: { type: String, ref: 'User' },
    authorName: { type: String, required: true },
    authorAvatar: String,
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    likes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const AGE_GROUPS = ['under_6m', '6_8m', '9_12m', '1_2y', '2y_plus'];

const recipeSchema = new Schema(
  {
    _id: idField('rec'),
    title: { type: String, required: true },
    ageGroup: { type: String, enum: AGE_GROUPS, required: true },
    ageGroupLabel: String,
    image: String,
    videoUrl: String,
    prepTime: String,
    ingredients: { type: [String], default: [] },
    steps: { type: [String], default: [] },
    textureNotes: String,
    allergens: String,
    shopProductId: { type: String, ref: 'Product' },
    savedBy: { type: [String], default: [] },
  },
  { timestamps: true }
);

const doctorSchema = new Schema(
  {
    _id: idField('doc'),
    name: { type: String, required: true },
    avatar: String,
    specialty: String,
    languages: { type: [String], default: [] },
    experience: String,
    feePlaceholder: String,
    demoTimeSlots: { type: [String], default: [] },
    demoQualifications: String,
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Post = mongoose.model('Post', postSchema);
export const Comment = mongoose.model('Comment', commentSchema);
export const Recipe = mongoose.model('Recipe', recipeSchema);
export const Doctor = mongoose.model('Doctor', doctorSchema);
